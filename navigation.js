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
    this.totalDistance = 0;
    this.startTime = Date.now();
    this.announcedPoints.clear();
    this.active = true;

    // Precalculate navigation points (turns, POIs, dangers, water)
    this._buildNavPoints();

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
    this._speak('Navigation gestartet. Folge der Route.');

    console.log('[Nav] Started with ' + routeCoords.length + ' points, ' + this._navPoints.length + ' nav points');
  },

  stop() {
    this.active = false;

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

    // 1. Direction changes (turns)
    for (var i = 10; i < coords.length - 10; i += 5) {
      var bearingBefore = this._bearing(coords[i - 5], coords[i]);
      var bearingAfter = this._bearing(coords[i], coords[i + 5]);
      var turn = bearingAfter - bearingBefore;
      if (turn > 180) turn -= 360;
      if (turn < -180) turn += 360;

      if (Math.abs(turn) > 35) {
        this._navPoints.push({
          type: 'turn',
          index: i,
          coord: coords[i],
          direction: turn > 0 ? 'rechts' : 'links',
          angle: Math.abs(turn)
        });
      }
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

    // Center map on position
    if (this.map) {
      this.map.easeTo({
        center: [lng, lat],
        duration: 1000
      });
    }
  },

  _checkNavPoints(lng, lat) {
    var now = Date.now();
    if (now - this.lastSpokenTime < 5000) return; // Min 5s between announcements

    for (var i = 0; i < this._navPoints.length; i++) {
      var np = this._navPoints[i];
      var key = np.type + '_' + i;
      if (this.announcedPoints.has(key)) continue;

      var dist = this._distBetween([lng, lat], np.coord) * 1000; // meters

      // Announce at different distances based on type
      var announceDistM = np.type === 'danger' ? 200 : np.type === 'turn' ? 100 : 150;

      if (dist < announceDistM) {
        var msg = this._getAnnouncement(np, dist);
        if (msg) {
          this._speak(msg);
          this.announcedPoints.add(key);
        }
      }
    }
  },

  _getAnnouncement(np, distM) {
    var distText = distM < 30 ? '' : 'In ' + Math.round(distM) + ' Metern, ';

    switch (np.type) {
      case 'turn':
        return distText + (np.angle > 70 ? 'scharf ' : '') + np.direction + ' abbiegen.';
      case 'steep':
        return distText + 'steiler Abschnitt. ' + np.slope + ' Grad Steigung.';
      case 'danger':
        return 'Vorsicht! Gefährlicher Abschnitt. ' + (np.label || 'Trittsicherheit erforderlich.');
      case 'water':
        return distText + 'Wasserquelle. ' + (np.name || '');
      case 'poi':
        return distText + (np.name || 'Sehenswürdigkeit') + (np.elevation ? ', ' + np.elevation + ' Meter.' : '.');
      case 'summit':
        return 'Gipfel erreicht! ' + np.elevation + ' Meter über dem Meer. Herzlichen Glückwunsch!';
      case 'finish':
        return 'Du hast dein Ziel erreicht! Tour beendet.';
      default:
        return null;
    }
  },

  _speak(text) {
    if (!text || text === this.lastSpoken) return;
    if (!('speechSynthesis' in window)) return;

    speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this._voiceLang;
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to use a German voice
    var voices = speechSynthesis.getVoices();
    var germanVoice = voices.find(function(v) { return v.lang.startsWith('de'); });
    if (germanVoice) utterance.voice = germanVoice;

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
    el.style.cssText = 'width:24px;height:24px;border-radius:50%;background:#3b82f6;border:3px solid white;' +
      'box-shadow:0 0 15px rgba(59,130,246,0.6);animation:navPulse 2s ease-in-out infinite;';

    this.marker = new maplibregl.Marker({ element: el })
      .setLngLat([0, 0])
      .addTo(this.map);
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
      '<div id="navStats" style="display:flex;gap:16px;font-size:14px;">' +
        '<span id="navProgress">📍 0%</span>' +
        '<span id="navTime">⏱ 0 min</span>' +
        '<span id="navAccuracy">📡 --m</span>' +
      '</div>' +
      '<div id="navInstruction" style="margin-top:8px;font-size:15px;font-weight:500;color:#c9a84c;">Folge der Route...</div>' +
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
    if (el) el.textContent = '📍 ' + progress + '%';
    el = document.getElementById('navTime');
    if (el) el.textContent = '⏱ ' + elapsed + ' min';
    el = document.getElementById('navAccuracy');
    if (el) el.textContent = '📡 ' + Math.round(accuracy) + 'm';
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
