/**
 * Peakflow Voice Navigation
 * Turn-by-turn navigation with voice announcements for hazards, POIs, water, weather
 */
const PeakflowNavigation = {
  map: null,
  active: false,
  watchId: null,
  routeCoords: [],
  elevations: [],
  pois: [],
  currentIndex: 0,
  marker: null,
  accuracyCircle: null,
  lastSpoken: '',
  lastSpokenTime: 0,
  announcedPoints: new Set(),
  totalDistance: 0,
  startTime: null,
  _voiceLang: 'de-DE',

  init(map) {
    this.map = map;
  },

  start(routeCoords, elevations, pois) {
    if (!routeCoords || routeCoords.length < 2) {
      alert('Bitte zuerst eine Route planen!');
      return;
    }

    if (!navigator.geolocation) {
      alert('GPS wird von deinem Browser nicht unterstützt.');
      return;
    }

    this.routeCoords = routeCoords;
    this.elevations = elevations || [];
    this.pois = pois || [];
    this.currentIndex = 0;
    this.startTime = Date.now();
    this.announcedPoints.clear();
    this.active = true;

    // Precalculate cumulative distance for remaining-time calculation
    this._cumDist = [0]; // cumDist[i] = distance in km from start to point i
    for (var i = 1; i < routeCoords.length; i++) {
      this._cumDist[i] = this._cumDist[i - 1] + this._distBetween(routeCoords[i - 1], routeCoords[i]);
    }
    this.totalDistance = this._cumDist[routeCoords.length - 1] || 0;

    // Calculate total estimated time using route stats
    this._totalEstMinutes = 0;
    if (typeof PeakflowUtils !== 'undefined' && this.elevations.length > 0) {
      var gain = PeakflowUtils.calculateElevationGain(this.elevations);
      var est = PeakflowUtils.calculateTime(this.totalDistance, gain.ascent, gain.descent);
      this._totalEstMinutes = est.totalMinutes || 0;
    }

    // Precalculate navigation points (turns, POIs, dangers, water)
    this._buildNavPoints();

    // Keep screen on during navigation (Wake Lock API)
    this._requestWakeLock();

    // Create position marker
    this._createMarker();

    // Start GPS tracking
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._onPosition(pos),
      (err) => {
        console.warn('[Nav] GPS error:', err.message);
        if (err.code === 1) {
          alert('GPS-Zugriff wurde verweigert. Bitte erlaube den Standortzugriff.');
          this.stop();
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000
      }
    );

    // Show navigation UI
    this._showNavUI();

    // Welcome announcement
    this._speak('Los gehts! Navigation gestartet. Viel Spa\u00df auf deiner Tour!');

    console.log('[Nav] Started with ' + routeCoords.length + ' points, ' + this._navPoints.length + ' nav points');
  },

  stop() {
    this.active = false;

    // Release wake lock
    this._releaseWakeLock();

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    if (this.marker) {
      this.marker.remove();
      this.marker = null;
    }

    if (this.accuracyCircle) {
      try {
        if (this.map.getLayer('nav-accuracy')) this.map.removeLayer('nav-accuracy');
        if (this.map.getSource('nav-accuracy')) this.map.removeSource('nav-accuracy');
      } catch(e) {}
      this.accuracyCircle = null;
    }

    // Hide nav UI
    var navUI = document.getElementById('navUI');
    if (navUI) navUI.remove();

    // Restore sidebar
    var sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.display = '';

    speechSynthesis.cancel();
    console.log('[Nav] Stopped');
  },

  _buildNavPoints() {
    this._navPoints = [];
    var coords = this.routeCoords;
    var elevs = this.elevations;

    // 1. Direction changes (turns + forks + junctions)
    // Use wider sampling for more stable bearing calculation
    var sampleDist = 8; // points before/after for bearing
    var lastTurnIdx = -50; // prevent duplicate announcements within 50 indices
    for (var i = sampleDist + 2; i < coords.length - sampleDist - 2; i += 3) {
      // Average bearing over a wider window for stability
      var bearingBefore = this._avgBearing(coords, i - sampleDist, i);
      var bearingAfter = this._avgBearing(coords, i, i + sampleDist);
      var turn = bearingAfter - bearingBefore;
      if (turn > 180) turn -= 360;
      if (turn < -180) turn += 360;

      var absAngle = Math.abs(turn);

      // Skip tiny curves and too-close turns
      if (absAngle < 20 || (i - lastTurnIdx) < 30) continue;

      var direction = turn > 0 ? 'rechts' : 'links';
      var turnType;

      if (absAngle >= 160) {
        turnType = 'uturn';        // U-turn / Kehre
      } else if (absAngle >= 100) {
        turnType = 'sharp';        // Scharf abbiegen
      } else if (absAngle >= 45) {
        turnType = 'turn';         // Normal abbiegen
      } else {
        turnType = 'fork';         // Leicht halten = Abzweigung/Gabelung
      }

      this._navPoints.push({
        type: 'turn',
        index: i,
        coord: coords[i],
        direction: direction,
        angle: absAngle,
        turnType: turnType,
        announced200: false,
        announced50: false
      });
      lastTurnIdx = i;
    }

    // 2. Elevation changes (steep sections)
    for (var i = 0; i < elevs.length - 5; i += 10) {
      if (i + 10 >= elevs.length) break;
      var elevDiff = elevs[i + 10] - elevs[i];
      var segDist = this._distBetween(coords[Math.min(i * (coords.length / elevs.length) | 0, coords.length - 1)],
        coords[Math.min((i + 10) * (coords.length / elevs.length) | 0, coords.length - 1)]);

      if (segDist > 0) {
        var slope = Math.atan2(Math.abs(elevDiff), segDist * 1000) * 180 / Math.PI;
        if (slope > 25 && elevDiff > 0) {
          var ci = Math.min(i * (coords.length / elevs.length) | 0, coords.length - 1);
          this._navPoints.push({
            type: 'steep',
            index: ci,
            coord: coords[ci],
            slope: Math.round(slope)
          });
        }
      }
    }

    // 3. SAC danger zones from existing markers
    if (PeakflowRoutes._dangerMarkers) {
      PeakflowRoutes._dangerMarkers.forEach(function(m) {
        var lngLat = m.getLngLat();
        var title = m.getElement().title || '';
        this._navPoints.push({
          type: 'danger',
          coord: [lngLat.lng, lngLat.lat],
          label: title
        });
      }.bind(this));
    }

    // 4. Water sources
    if (PeakflowRoutes._waterMarkers) {
      PeakflowRoutes._waterMarkers.forEach(function(m) {
        var lngLat = m.getLngLat();
        var popup = m.getPopup();
        var name = popup ? popup.getElement()?.textContent || 'Wasserquelle' : 'Wasserquelle';
        this._navPoints.push({
          type: 'water',
          coord: [lngLat.lng, lngLat.lat],
          name: name
        });
      }.bind(this));
    }

    // 5. POIs near route
    if (this.pois) {
      var routeCoords = this.routeCoords;
      this.pois.forEach(function(poi) {
        if (!poi.lat || !poi.lng) return;
        // Check if POI is near route (within ~200m)
        for (var ci = 0; ci < routeCoords.length; ci += 10) {
          var d = Math.pow(routeCoords[ci][0] - poi.lng, 2) + Math.pow(routeCoords[ci][1] - poi.lat, 2);
          if (d < 0.000004) { // ~200m
            this._navPoints.push({
              type: 'poi',
              coord: [poi.lng, poi.lat],
              name: poi.name || 'Punkt',
              elevation: poi.elevation
            });
            break;
          }
        }
      }.bind(this));
    }

    // 6. Summit reached (highest point)
    if (elevs.length > 0) {
      var maxElev = 0, maxIdx = 0;
      for (var i = 0; i < elevs.length; i++) {
        if (elevs[i] > maxElev) { maxElev = elevs[i]; maxIdx = i; }
      }
      var ci = Math.min(maxIdx * (coords.length / elevs.length) | 0, coords.length - 1);
      this._navPoints.push({
        type: 'summit',
        index: ci,
        coord: coords[ci],
        elevation: Math.round(maxElev)
      });
    }

    // 7. Finish
    this._navPoints.push({
      type: 'finish',
      coord: coords[coords.length - 1]
    });

    console.log('[Nav] Built ' + this._navPoints.length + ' navigation points');
  },

  _onPosition(pos) {
    if (!this.active) return;

    var lat = pos.coords.latitude;
    var lng = pos.coords.longitude;
    var accuracy = pos.coords.accuracy;

    // Update marker position
    if (this.marker) {
      this.marker.setLngLat([lng, lat]);
    }

    // Find nearest route point
    var minDist = Infinity, nearestIdx = 0;
    for (var i = Math.max(0, this.currentIndex - 20); i < Math.min(this.routeCoords.length, this.currentIndex + 100); i++) {
      var d = Math.pow(this.routeCoords[i][0] - lng, 2) + Math.pow(this.routeCoords[i][1] - lat, 2);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }

    // Update current position on route
    if (nearestIdx > this.currentIndex) {
      this.currentIndex = nearestIdx;
    }

    // Calculate progress
    var progress = (this.currentIndex / this.routeCoords.length * 100).toFixed(0);
    var elapsed = ((Date.now() - this.startTime) / 60000).toFixed(0);

    // Update nav UI
    this._updateNavUI(progress, elapsed, accuracy);

    // Check for off-route (>100m from nearest route point)
    var offRouteDistM = Math.sqrt(minDist) * 111000;
    if (offRouteDistM > 100) {
      this._speakOnce('offroute', 'Achtung! Du bist vom Weg abgekommen. ' + Math.round(offRouteDistM) + ' Meter neben der Route.');
    }

    // Check upcoming nav points
    this._checkNavPoints(lng, lat);

    // Calculate bearing in direction of travel along route
    var lookAhead = Math.min(this.currentIndex + 15, this.routeCoords.length - 1);
    if (lookAhead > this.currentIndex) {
      var newBearing = this._bearing(this.routeCoords[this.currentIndex], this.routeCoords[lookAhead]);
      // Smooth bearing changes
      var diff = newBearing - this._lastBearing;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      this._lastBearing += diff * 0.3; // smooth interpolation

      // Rotate direction arrow on marker
      var arrow = document.getElementById('navDirArrow');
      if (arrow) {
        arrow.style.transform = 'translateX(-50%) rotate(' + Math.round(this._lastBearing) + 'deg)';
      }
    }

    // Center map on position, rotated in travel direction
    if (this.map) {
      this.map.easeTo({
        center: [lng, lat],
        bearing: this._lastBearing || 0,
        pitch: 45,
        duration: 1000
      });
    }
  },

  _checkNavPoints(lng, lat) {
    var now = Date.now();
    if (now - this.lastSpokenTime < 4000) return; // Min 4s between announcements

    for (var i = 0; i < this._navPoints.length; i++) {
      var np = this._navPoints[i];
      var key = np.type + '_' + i;

      var dist = this._distBetween([lng, lat], np.coord) * 1000; // meters

      // Two-stage announcements for turns: 200m preview + 50m instruction
      if (np.type === 'turn') {
        if (dist < 200 && dist > 60 && !np.announced200) {
          var msg = this._getAnnouncement(np, dist, 'preview');
          if (msg) { this._speak(msg); np.announced200 = true; }
          continue;
        }
        if (dist < 60 && !np.announced50) {
          var msg = this._getAnnouncement(np, dist, 'now');
          if (msg) { this._speak(msg); np.announced50 = true; }
          continue;
        }
        continue;
      }

      // Finish: only announce when at least 70% of route completed (prevents false "Ziel erreicht" on round trips)
      if (np.type === 'finish') {
        var progress = this.currentIndex / this.routeCoords.length;
        if (progress < 0.7) continue; // Not far enough yet
      }

      // Other nav points: single announcement
      if (this.announcedPoints.has(key)) continue;
      var announceDistM = np.type === 'danger' ? 200 : 150;

      if (dist < announceDistM) {
        var msg = this._getAnnouncement(np, dist, 'single');
        if (msg) {
          this._speak(msg);
          this.announcedPoints.add(key);
        }
      }
    }
  },

  _getAnnouncement(np, distM, phase) {
    // Build turn instruction text based on turnType
    if (np.type === 'turn') {
      var turnText = this._getTurnText(np);
      if (phase === 'preview') {
        return 'In ' + Math.round(distM) + ' Metern ' + turnText;
      } else {
        // 'now' phase
        return 'Jetzt ' + turnText;
      }
    }

    // Other nav point types
    var distText = distM < 30 ? '' : 'In ' + Math.round(distM) + ' Metern, ';

    switch (np.type) {
      case 'steep':
        return distText + 'Achtung, steiler Abschnitt! ' + np.slope + ' Grad Steigung. Tempo anpassen!';
      case 'danger':
        return 'Hey, Vorsicht! Gef\u00e4hrlicher Abschnitt voraus. ' + (np.label || 'Trittsicherheit erforderlich!');
      case 'water':
        return distText + 'Super, eine Wasserquelle! ' + (np.name || 'Perfekt zum Auff\u00fcllen.');
      case 'poi':
        return distText + (np.name || 'Sehenswürdigkeit') + (np.elevation ? ' auf ' + np.elevation + ' Metern!' : '.');
      case 'summit':
        return 'Yesss, Gipfel erreicht! ' + np.elevation + ' Meter! Du bist der Bergk\u00f6nig! Herzlichen Gl\u00fcckwunsch!';
      case 'finish':
        return 'Geschafft! Du hast dein Ziel erreicht! Starke Leistung, Tour beendet!';
      default:
        return null;
    }
  },

  _getTurnText(np) {
    var dir = np.direction; // 'rechts' oder 'links'
    switch (np.turnType) {
      case 'fork':
        return 'an der Abzweigung ' + dir + ' halten.';
      case 'turn':
        return dir + ' abbiegen.';
      case 'sharp':
        return 'scharf ' + dir + ' abbiegen.';
      case 'uturn':
        return 'Kehre ' + dir + '.';
      default:
        return dir + ' abbiegen.';
    }
  },

  _speak(text) {
    if (!text || text === this.lastSpoken) return;
    if (!('speechSynthesis' in window)) return;

    speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this._voiceLang;
    utterance.rate = 1.0;   // Natural speed
    utterance.pitch = 1.15; // Slightly higher = more energetic
    utterance.volume = 1.0;

    // Try to find the best German voice (prefer female voices — sound friendlier)
    var voices = speechSynthesis.getVoices();
    var bestVoice = null;
    // Priority: Google DE female > any DE female > any DE voice
    for (var vi = 0; vi < voices.length; vi++) {
      var v = voices[vi];
      if (!v.lang.startsWith('de')) continue;
      if (!bestVoice) bestVoice = v;
      if (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('anna') ||
          v.name.toLowerCase().includes('petra') || v.name.toLowerCase().includes('marlene')) {
        bestVoice = v;
        break;
      }
      if (v.name.includes('Google')) bestVoice = v;
    }
    if (bestVoice) utterance.voice = bestVoice;

    speechSynthesis.speak(utterance);
    this.lastSpoken = text;
    this.lastSpokenTime = Date.now();

    console.log('[Nav] 🔊 ' + text);
  },

  _speakOnce(key, text) {
    if (this.announcedPoints.has(key)) return;
    this.announcedPoints.add(key);
    this._speak(text);
  },

  _wakeLock: null,

  async _requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this._wakeLock = await navigator.wakeLock.request('screen');
        console.log('[Nav] Wake Lock active — screen stays on');
        // Re-acquire if page becomes visible again (e.g. after tab switch)
        var self = this;
        document.addEventListener('visibilitychange', function onVisChange() {
          if (document.visibilityState === 'visible' && self.active) {
            navigator.wakeLock.request('screen').then(function(wl) {
              self._wakeLock = wl;
              console.log('[Nav] Wake Lock re-acquired');
            }).catch(function() {});
          }
          if (!self.active) document.removeEventListener('visibilitychange', onVisChange);
        });
      } else {
        console.log('[Nav] Wake Lock API not supported');
      }
    } catch(e) {
      console.warn('[Nav] Wake Lock failed:', e.message);
    }
  },

  _releaseWakeLock() {
    if (this._wakeLock) {
      this._wakeLock.release().catch(function() {});
      this._wakeLock = null;
      console.log('[Nav] Wake Lock released');
    }
  },

  _avgBearing(coords, fromIdx, toIdx) {
    // Average bearing over multiple points for more stable direction
    var fromI = Math.max(0, fromIdx);
    var toI = Math.min(coords.length - 1, toIdx);
    if (fromI >= toI) return 0;
    // Use endpoints of the range for overall direction
    return this._bearing(coords[fromI], coords[toI]);
  },

  _bearing(from, to) {
    var dLng = (to[0] - from[0]) * Math.PI / 180;
    var lat1 = from[1] * Math.PI / 180;
    var lat2 = to[1] * Math.PI / 180;
    var y = Math.sin(dLng) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return Math.atan2(y, x) * 180 / Math.PI;
  },

  _distBetween(a, b) {
    var dLat = (b[1] - a[1]) * 111;
    var dLng = (b[0] - a[0]) * 111 * Math.cos(a[1] * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  },

  _createMarker() {
    if (this.marker) this.marker.remove();

    var el = document.createElement('div');
    el.style.cssText = 'width:32px;height:32px;position:relative;';
    // Blue circle
    el.innerHTML = '<div style="width:24px;height:24px;border-radius:50%;background:#3b82f6;border:3px solid white;' +
      'box-shadow:0 0 15px rgba(59,130,246,0.6);animation:navPulse 2s ease-in-out infinite;position:absolute;top:4px;left:4px;"></div>' +
      // Direction arrow (triangle pointing up, rotated via JS)
      '<div id="navDirArrow" style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);' +
      'width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:12px solid #3b82f6;' +
      'filter:drop-shadow(0 0 3px rgba(59,130,246,0.8));transition:transform 0.3s ease;"></div>';

    this.marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
      .setLngLat([0, 0])
      .addTo(this.map);
    this._lastBearing = 0;
  },

  _showNavUI() {
    // Hide sidebar
    var sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.display = 'none';

    // Create navigation overlay
    var ui = document.createElement('div');
    ui.id = 'navUI';
    ui.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(26,26,26,0.95);' +
      'backdrop-filter:blur(12px);color:#f0ece2;padding:16px 20px;z-index:800;font-family:Inter,sans-serif;' +
      'border-top:2px solid var(--color-primary,#c9a84c);';

    ui.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
        '<div style="font-size:18px;font-weight:700;">🧭 Navigation aktiv</div>' +
        '<button id="navStopBtn" style="padding:8px 16px;background:#dc2626;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">⏹ Beenden</button>' +
      '</div>' +
      '<div id="navStats" style="display:flex;gap:12px;font-size:13px;flex-wrap:wrap;">' +
        '<span id="navRemaining" style="color:#c9a84c;font-weight:600;">⏱ --</span>' +
        '<span id="navDistLeft">📏 --</span>' +
        '<span id="navProgress">📍 0%</span>' +
        '<span id="navAccuracy">📡 --m</span>' +
      '</div>' +
      '<div id="navNextTurn" style="margin-top:10px;display:flex;align-items:center;gap:12px;padding:10px 12px;background:rgba(201,168,76,0.12);border-radius:10px;border:1px solid rgba(201,168,76,0.25);">' +
        '<div id="navTurnArrow" style="font-size:28px;min-width:36px;text-align:center;">↑</div>' +
        '<div><div id="navTurnText" style="font-size:15px;font-weight:600;color:#c9a84c;">Geradeaus</div>' +
        '<div id="navTurnDist" style="font-size:12px;color:rgba(240,236,226,0.6);margin-top:2px;"></div></div>' +
      '</div>' +
      '<div id="navInstruction" style="margin-top:8px;font-size:13px;font-weight:500;color:rgba(240,236,226,0.7);">Folge der Route...</div>' +
      '<div style="margin-top:8px;display:flex;gap:8px;">' +
        '<button id="navMuteBtn" style="padding:6px 12px;background:rgba(255,255,255,0.1);color:white;border:1px solid rgba(255,255,255,0.2);border-radius:6px;font-size:12px;cursor:pointer;">🔊 Ton an</button>' +
        '<button id="navCenterBtn" style="padding:6px 12px;background:rgba(255,255,255,0.1);color:white;border:1px solid rgba(255,255,255,0.2);border-radius:6px;font-size:12px;cursor:pointer;">📍 Zentrieren</button>' +
      '</div>';

    document.body.appendChild(ui);

    var self = this;
    document.getElementById('navStopBtn').addEventListener('click', function() { self.stop(); });

    var muted = false;
    document.getElementById('navMuteBtn').addEventListener('click', function() {
      muted = !muted;
      this.textContent = muted ? '🔇 Ton aus' : '🔊 Ton an';
      if (muted) speechSynthesis.cancel();
      self._muted = muted;
    });

    document.getElementById('navCenterBtn').addEventListener('click', function() {
      if (self.marker) {
        var pos = self.marker.getLngLat();
        self.map.flyTo({ center: [pos.lng, pos.lat], zoom: 16, duration: 500 });
      }
    });
  },

  _updateNavUI(progress, elapsed, accuracy) {
    var el;
    el = document.getElementById('navProgress');
    if (el) el.textContent = '\uD83D\uDCCD ' + progress + '%';
    el = document.getElementById('navAccuracy');
    if (el) el.textContent = '\uD83D\uDCE1 ' + Math.round(accuracy) + 'm';

    // Remaining distance
    var progressFrac = this.currentIndex / this.routeCoords.length;
    var distDone = this._cumDist ? (this._cumDist[this.currentIndex] || 0) : 0;
    var distLeft = Math.max(0, this.totalDistance - distDone);
    el = document.getElementById('navDistLeft');
    if (el) {
      el.textContent = '\uD83D\uDCCF ' + (distLeft >= 1 ? distLeft.toFixed(1) + ' km' : Math.round(distLeft * 1000) + ' m');
    }

    // Remaining time estimate
    el = document.getElementById('navRemaining');
    if (el) {
      if (this._totalEstMinutes > 0) {
        var remainMin = Math.round(this._totalEstMinutes * (1 - progressFrac));
        if (remainMin >= 60) {
          el.textContent = '\u23F1 noch ' + Math.floor(remainMin / 60) + ':' + String(remainMin % 60).padStart(2, '0') + ' h';
        } else {
          el.textContent = '\u23F1 noch ' + remainMin + ' min';
        }
      } else {
        el.textContent = '\u23F1 ' + elapsed + ' min';
      }
    }

    // Update next turn display
    this._updateNextTurnUI();
  },

  _updateNextTurnUI() {
    if (!this._navPoints || !this.marker) return;
    var pos = this.marker.getLngLat();
    var userCoord = [pos.lng, pos.lat];

    // Find next unannounced turn
    var nextTurn = null;
    var nextDist = Infinity;
    for (var i = 0; i < this._navPoints.length; i++) {
      var np = this._navPoints[i];
      if (np.type !== 'turn' || np.announced50) continue;
      var d = this._distBetween(userCoord, np.coord) * 1000;
      if (d < nextDist) { nextDist = d; nextTurn = np; }
    }

    var arrowEl = document.getElementById('navTurnArrow');
    var textEl = document.getElementById('navTurnText');
    var distEl = document.getElementById('navTurnDist');
    if (!arrowEl || !textEl || !distEl) return;

    if (!nextTurn || nextDist > 2000) {
      arrowEl.textContent = '↑';
      textEl.textContent = 'Geradeaus';
      distEl.textContent = '';
      return;
    }

    // Arrow based on turn type + direction
    var arrow = '↑';
    if (nextTurn.direction === 'rechts') {
      if (nextTurn.turnType === 'fork') arrow = '↗';
      else if (nextTurn.turnType === 'sharp' || nextTurn.turnType === 'uturn') arrow = '↩';
      else arrow = '→';
    } else {
      if (nextTurn.turnType === 'fork') arrow = '↖';
      else if (nextTurn.turnType === 'sharp' || nextTurn.turnType === 'uturn') arrow = '↪';
      else arrow = '←';
    }

    arrowEl.textContent = arrow;
    textEl.textContent = this._getTurnText(nextTurn).replace(/\.$/, '');

    if (nextDist >= 1000) {
      distEl.textContent = (nextDist / 1000).toFixed(1) + ' km';
    } else {
      distEl.textContent = Math.round(nextDist) + ' m';
    }
  },

  _speak(text) {
    if (!text || this._muted) return;
    if (!('speechSynthesis' in window)) return;

    // Update instruction display
    var instrEl = document.getElementById('navInstruction');
    if (instrEl) instrEl.textContent = text;

    speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this._voiceLang;
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    var voices = speechSynthesis.getVoices();
    var germanVoice = voices.find(function(v) { return v.lang.startsWith('de'); });
    if (germanVoice) utterance.voice = germanVoice;

    speechSynthesis.speak(utterance);
    this.lastSpoken = text;
    this.lastSpokenTime = Date.now();

    console.log('[Nav] 🔊 ' + text);
  }
};
