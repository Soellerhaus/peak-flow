/* ============================================
   PEAKFLOW - Route Walkthrough v2
   Relive-Style mit Story Cards & flüssiger Kamera
   ============================================ */

const PeakflowWalkthrough = {

  map: null,
  isPlaying: false,
  currentIndex: 0,
  speed: 1,
  animationFrame: null,
  marker: null,
  routeCoords: [],
  elevations: [],
  allPOIs: [],
  segments: [],         // Pre-computed route segments
  currentSegment: null,
  smoothBearing: 0,     // Interpolated bearing for smooth camera
  totalDistance: 0,      // Total route distance in km
  cumulativeDistances: [], // Distance at each point

  init(map) {
    this.map = map;
  },

  // ─── START ────────────────────────────────────────
  start(routeCoords, elevations, pois) {
    if (!routeCoords || routeCoords.length < 2) return;

    this.routeCoords = routeCoords;
    this.elevations = elevations || routeCoords.map(c => c[2] || 0);
    this.allPOIs = pois || [];
    this.currentIndex = 0;
    this._fractionalIndex = 0;
    this.currentSegment = null;
    this.smoothBearing = 0;
    this.smoothCenter = null;
    this.startContext = null; // Will be set by reverse geocode

    // Pre-compute cumulative distances
    this.computeDistances();

    // Detect start context (city/village/mountain) via reverse geocode
    this.detectStartContext(routeCoords[0]);

    // Pre-compute segments
    this.computeSegments();

    // Create animated marker (hiker dot)
    if (this.marker) this.marker.remove();
    const el = document.createElement('div');
    el.className = 'wt-marker';
    el.innerHTML = `<div class="wt-marker__dot"></div><div class="wt-marker__pulse"></div>`;
    this.marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([routeCoords[0][0], routeCoords[0][1]])
      .addTo(this.map);

    // Show controls + story card container
    document.getElementById('walkthroughControls').classList.remove('hidden');
    document.getElementById('wtProgress').max = routeCoords.length - 1;
    document.getElementById('wtProgress').value = 0;
    this.ensureStoryCardUI();
    this.showStoryCard(this.segments[0]);

    // Hide sidebar during walkthrough
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.add('wt-hidden');

    // Camera: NORTH UP, no rotation, bird's eye view
    this.smoothBearing = 0; // Always north

    this.map.flyTo({
      center: [routeCoords[0][0], routeCoords[0][1]],
      zoom: 15,
      pitch: 0,
      bearing: 0,  // ALWAYS NORTH
      duration: 2000,
      easing: t => t * (2 - t)
    });

    // Start playing after fly animation
    setTimeout(() => this.play(), 2200);
  },

  // ─── COMPUTE DISTANCES ────────────────────────────
  computeDistances() {
    this.cumulativeDistances = [0];
    let total = 0;
    for (let i = 1; i < this.routeCoords.length; i++) {
      const prev = this.routeCoords[i - 1];
      const curr = this.routeCoords[i];
      total += PeakflowUtils.haversineDistance(prev[1], prev[0], curr[1], curr[0]);
      this.cumulativeDistances.push(total);
    }
    this.totalDistance = total;
  },

  // ─── DETECT START CONTEXT ─────────────────────────
  async detectStartContext(startCoord) {
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${startCoord[1]}&lon=${startCoord[0]}&format=json&zoom=14&accept-language=de`
      );
      const data = await resp.json();
      const addr = data.address || {};
      const startElev = this.elevations[0] || 0;

      this.startContext = {
        place: addr.village || addr.town || addr.city || addr.hamlet || '',
        isCity: !!(addr.city || addr.town),
        isVillage: !!(addr.village || addr.hamlet),
        region: addr.state || addr.county || '',
        startElev
      };

      // Re-generate descriptions now that we have context
      for (const seg of this.segments) {
        seg.description = this.generateDescription(
          seg.type, seg.distance, seg.elevGain, seg.startElev, seg.endElev, seg.poi
        );
      }
      // Update current story card if visible
      if (this.currentSegment) this.showStoryCard(this.currentSegment);
    } catch (e) {
      // Fallback: no context, use elevation-based descriptions
      this.startContext = { place: '', isCity: false, isVillage: false, region: '', startElev: this.elevations[0] || 0 };
    }
  },

  // ─── COMPUTE SEGMENTS ─────────────────────────────
  computeSegments() {
    this.segments = [];
    const coords = this.routeCoords;
    const elevs = this.elevations;
    const n = coords.length;
    if (n < 2) return;

    // Find highest point
    let maxElev = 0, maxElevIdx = 0;
    for (let i = 0; i < elevs.length; i++) {
      if ((elevs[i] || 0) > maxElev) { maxElev = elevs[i]; maxElevIdx = i; }
    }

    // Find nearby POIs mapped to route indices
    const poiAtIndex = new Map();
    for (const poi of this.allPOIs) {
      let bestIdx = -1, bestDist = Infinity;
      // Sample every 5th point for speed
      for (let i = 0; i < n; i += 5) {
        const d = PeakflowUtils.haversineDistance(coords[i][1], coords[i][0], poi.lat, poi.lng);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      if (bestDist < 0.5) { // within 500m of route
        poiAtIndex.set(bestIdx, poi);
      }
    }

    // Classify each point
    const pointTypes = [];
    for (let i = 0; i < n; i++) {
      const elev = elevs[i] || 0;
      // Slope: look ±15 points
      const back = Math.max(0, i - 15);
      const fwd = Math.min(n - 1, i + 15);
      const elevDiff = (elevs[fwd] || 0) - (elevs[back] || 0);
      const dist = this.cumulativeDistances[fwd] - this.cumulativeDistances[back];
      const slopePct = dist > 0 ? Math.abs(elevDiff / (dist * 1000)) * 100 : 0;
      const ascending = elevDiff > 5;
      const descending = elevDiff < -5;

      // Is near summit?
      const nearSummit = Math.abs(i - maxElevIdx) < 20;

      let type;
      if (nearSummit && elev > 1800) type = 'gipfel';
      else if (poiAtIndex.has(i)) {
        const poi = poiAtIndex.get(i);
        type = poi.type === 'hut' ? 'huette' : poi.type === 'pass' ? 'pass' : 'gipfel';
      }
      else if (slopePct > 25) type = descending ? 'steilabstieg' : 'steilaufstieg';
      else if (elev > 2200) type = 'hochalpin';
      else if (elev > 1800) type = descending ? 'abstieg_alm' : 'almwiese';
      else if (elev > 1400) type = descending ? 'abstieg_wald' : 'bergwald';
      else type = descending ? 'abstieg_tal' : 'tal_weg';

      pointTypes.push(type);
    }

    // Merge consecutive same-type points into segments (min 30 points)
    let segStart = 0;
    let segType = pointTypes[0];
    for (let i = 1; i <= n; i++) {
      const sameType = i < n && pointTypes[i] === segType;
      const tooShort = (i - segStart) < 30;
      if (sameType || tooShort) continue;

      // Create segment
      const startDist = this.cumulativeDistances[segStart];
      const endDist = this.cumulativeDistances[i - 1];
      const segDist = endDist - startDist;
      const startElev = elevs[segStart] || 0;
      const endElev = elevs[i - 1] || 0;
      const elevGain = endElev - startElev;

      // Check for POI in segment
      let segPOI = null;
      for (const [idx, poi] of poiAtIndex) {
        if (idx >= segStart && idx < i) { segPOI = poi; break; }
      }

      this.segments.push({
        startIdx: segStart,
        endIdx: i - 1,
        type: segType,
        distance: segDist,
        elevGain,
        startElev,
        endElev,
        poi: segPOI,
        description: this.generateDescription(segType, segDist, elevGain, startElev, endElev, segPOI)
      });

      segStart = i;
      if (i < n) segType = pointTypes[i];
    }

    // Handle last segment if any
    if (segStart < n - 1) {
      const segDist = this.cumulativeDistances[n - 1] - this.cumulativeDistances[segStart];
      this.segments.push({
        startIdx: segStart,
        endIdx: n - 1,
        type: segType,
        distance: segDist,
        elevGain: (elevs[n - 1] || 0) - (elevs[segStart] || 0),
        startElev: elevs[segStart] || 0,
        endElev: elevs[n - 1] || 0,
        poi: null,
        description: this.generateDescription(segType, segDist, 0, elevs[segStart] || 0, elevs[n - 1] || 0, null)
      });
    }

    // If no segments, add a default
    if (this.segments.length === 0) {
      this.segments.push({
        startIdx: 0, endIdx: n - 1, type: 'tal_weg',
        distance: this.totalDistance, elevGain: 0,
        startElev: elevs[0] || 0, endElev: elevs[n - 1] || 0, poi: null,
        description: 'Die Wanderung beginnt.'
      });
    }
  },

  // ─── GENERATE DESCRIPTION (context-aware) ─────────
  generateDescription(type, dist, elevGain, startElev, endElev, poi) {
    const km = dist.toFixed(1);
    const hm = Math.abs(Math.round(elevGain));
    const ctx = this.startContext || {};
    const place = ctx.place || '';
    const isLowland = startElev < 800;
    const isMidMountain = startElev >= 800 && startElev < 1500;

    // Context-aware location word
    const lowStart = isLowland
      ? (ctx.isCity ? `durch ${place}` : ctx.isVillage ? `ab ${place}` : 'vom Startpunkt')
      : '';

    const templates = {
      tal_weg: isLowland ? [
        `${km} km ${ctx.isCity ? 'durch die Ortschaft' : 'auf dem Weg'} ${place ? 'bei ' + place : ''}. Ein gemütlicher Einstieg.`,
        `Der Weg führt ${km} km ${ctx.isCity ? 'am Ortsrand entlang' : 'durch offenes Gelände'}. Langsam gewinnen wir an Höhe.`,
      ] : [
        `${km} km auf einem ${isMidMountain ? 'Wanderweg' : 'Bergweg'} auf ${Math.round(startElev)}m.`,
        `Über ${km} km führt der Weg ${hm > 50 ? 'stetig bergauf' : 'relativ flach dahin'}.`
      ],
      bergwald: [
        `Durch ${startElev > 1200 ? 'lichten Bergwald' : 'schattigen Wald'} steigt der Weg ${km} km und ${hm} Hm an.`,
        `Der Pfad schlängelt sich ${km} km durch den Wald. ${hm > 100 ? 'Wurzeln und Steine erfordern Aufmerksamkeit.' : ''}`,
        `${km} km ${startElev > 1200 ? 'durch Nadelwald' : 'durch Mischwald'} bergauf.`
      ],
      almwiese: [
        `Über offene Bergwiesen geht es ${km} km weiter. Der Blick wird frei!`,
        `Die Baumgrenze liegt hinter uns. ${km} km über offene Flächen mit herrlichem Panorama.`,
        `${km} km über grüne Wiesen auf ${Math.round(startElev)}m. ${hm > 100 ? 'Stetig bergauf.' : 'Sanft ansteigend.'}`
      ],
      hochalpin: [
        `Hochalpines Gelände auf ${Math.round(startElev)}m. ${km} km durch Fels und Geröll.`,
        `Die Luft wird dünner. ${km} km im hochalpinen Bereich.`,
        `${km} km durch karge Felslandschaft. Schneefelder sind möglich.`
      ],
      steilaufstieg: [
        `Steiler Aufstieg! ${hm} Höhenmeter auf ${km} km. Trittsicherheit gefragt.`,
        `Jetzt wird es steil: ${hm} Hm auf ${km} km. Gut durchatmen!`
      ],
      steilabstieg: [
        `Steiler Abstieg! ${hm} Hm bergab auf ${km} km. Vorsicht bei Nässe!`,
        `${hm} Höhenmeter bergab. Die Knie werden gefordert.`
      ],
      gipfel: poi ? [
        `${poi.name} (${poi.elevation}m) – ${poi.description || 'Gipfel erreicht! Zeit für die Aussicht.'}`,
      ] : [
        `Höchster Punkt auf ${Math.round(endElev)}m erreicht! Rundumblick über die Bergwelt.`,
      ],
      huette: poi ? [
        `🏠 ${poi.name} (${poi.elevation}m) – Einkehr! ${poi.beds ? poi.beds + ' Schlafplätze. ' : ''}${poi.description || 'Kaiserschmarrn und warme Suppe!'}`,
      ] : [
        `Eine Hütte am Weg lädt zur Rast ein.`
      ],
      pass: poi ? [
        `${poi.name} (${poi.elevation}m) – ${poi.description || 'Die Scharte ist erreicht.'}`,
      ] : [
        `Scharte auf ${Math.round(endElev)}m. Übergang ins nächste Tal.`
      ],
      abstieg_alm: [
        `${km} km Abstieg über Bergwiesen. ${place ? place + ' wird sichtbar.' : 'Die Hütten werden sichtbar.'}`,
        `Sanfter Abstieg über ${km} km. Die Tour neigt sich dem Ende zu.`
      ],
      abstieg_wald: [
        `Durch den Wald geht es ${km} km bergab. Konzentration auf dem Wurzelpfad.`,
        `${km} km Abstieg durch ${startElev > 1400 ? 'Nadelwald' : 'Wald'}.`
      ],
      abstieg_tal: [
        `Die letzten ${km} km ${place ? 'zurück nach ' + place : 'zum Ausgangspunkt'}. Schöne Tour!`,
        `${km} km zum Ziel. Zeit, die Eindrücke nachwirken zu lassen.`
      ]
    };

    const options = templates[type] || [`${km} km Wegstrecke.`];
    const idx = Math.floor((dist * 100 + type.length) % options.length);
    return options[idx];
  },

  // ─── STORY CARD UI ────────────────────────────────
  ensureStoryCardUI() {
    if (document.getElementById('wtStoryCard')) return;

    const card = document.createElement('div');
    card.id = 'wtStoryCard';
    card.className = 'wt-story-card';
    card.innerHTML = `
      <div class="wt-story-card__progress">
        <span class="wt-story-card__km" id="wtKm">0.0 km</span>
        <span class="wt-story-card__sep">/</span>
        <span class="wt-story-card__total" id="wtTotalKm">${this.totalDistance.toFixed(1)} km</span>
        <span class="wt-story-card__elev" id="wtElev">0m</span>
      </div>
      <div class="wt-story-card__body">
        <div class="wt-story-card__icon" id="wtStoryIcon"></div>
        <div class="wt-story-card__text" id="wtStoryText"></div>
      </div>
    `;
    document.querySelector('main') ?.appendChild(card) ||
    document.querySelector('.map-container')?.appendChild(card) ||
    document.body.appendChild(card);
  },

  showStoryCard(segment) {
    if (!segment) return;
    const card = document.getElementById('wtStoryCard');
    if (!card) return;

    const icons = {
      tal_weg: '🚶', bergwald: '🌲', almwiese: '🌿', hochalpin: '🏔️',
      steilaufstieg: '⬆️', steilabstieg: '⬇️', gipfel: '⛰️',
      huette: '🏠', pass: '🔀', abstieg_alm: '🌿', abstieg_wald: '🌲', abstieg_tal: '🚶'
    };

    document.getElementById('wtStoryIcon').textContent = icons[segment.type] || '🥾';
    document.getElementById('wtStoryText').textContent = segment.description;

    // Animate in
    card.classList.remove('wt-story-card--hidden');
    card.classList.add('wt-story-card--visible');
  },

  // ─── PLAY / PAUSE / STOP ─────────────────────────
  play() {
    this.isPlaying = true;
    this.updatePlayButton();
    this.lastFrameTime = performance.now();
    this.animate();
  },

  pause() {
    this.isPlaying = false;
    this.updatePlayButton();
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  },

  togglePlayPause() {
    if (this.isPlaying) this.pause();
    else this.play();
  },

  stop() {
    this.pause();
    if (this.marker) { this.marker.remove(); this.marker = null; }

    document.getElementById('walkthroughControls').classList.add('hidden');
    document.getElementById('poiInfoCard').classList.add('hidden');

    const storyCard = document.getElementById('wtStoryCard');
    if (storyCard) storyCard.remove();

    // Restore sidebar
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.remove('wt-hidden');

    this.smoothCenter = null;
    this.map.easeTo({ pitch: 0, bearing: 0, duration: 1000 });
  },

  // ─── SMOOTH ANIMATION LOOP ───────────────────────
  // Key insight: NO overlapping easeTo calls!
  // Marker moves every frame, camera follows with smooth lerp via jumpTo (instant).
  smoothCenter: null, // smoothed camera center [lng, lat]

  animate() {
    if (!this.isPlaying || this.currentIndex >= this.routeCoords.length - 1) {
      if (this.currentIndex >= this.routeCoords.length - 1) {
        this.showFinishCard();
        this.pause();
      }
      return;
    }

    const now = performance.now();
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;

    // Advance position: constant 1 point per frame at 1x (smooth, no jumps)
    // Accumulate fractional progress for consistent speed
    if (!this._fractionalIndex) this._fractionalIndex = this.currentIndex;
    this._fractionalIndex += this.speed * (dt / 50); // 1 point per 50ms at 1x
    this.currentIndex = Math.min(Math.floor(this._fractionalIndex), this.routeCoords.length - 1);

    const coord = this.routeCoords[this.currentIndex];
    this.marker.setLngLat([coord[0], coord[1]]);

    // Update progress bar (throttled)
    if (this.currentIndex % 5 === 0) {
      document.getElementById('wtProgress').value = this.currentIndex;
    }

    // Update km + elevation (throttled)
    if (this.currentIndex % 10 === 0) {
      const km = this.cumulativeDistances[this.currentIndex] || 0;
      const elev = this.elevations[this.currentIndex] || 0;
      const kmEl = document.getElementById('wtKm');
      const elevEl = document.getElementById('wtElev');
      if (kmEl) kmEl.textContent = `${km.toFixed(1)} km`;
      if (elevEl) elevEl.textContent = `${Math.round(elev)}m`;
    }

    // ── SMOOTH CAMERA: North-up, only center follows marker ──
    // Lerp factor 0.12 = smooth but responsive (no lag, no jerk)
    if (!this.smoothCenter) this.smoothCenter = [coord[0], coord[1]];
    const lerpFactor = 0.12;
    this.smoothCenter[0] += (coord[0] - this.smoothCenter[0]) * lerpFactor;
    this.smoothCenter[1] += (coord[1] - this.smoothCenter[1]) * lerpFactor;

    // jumpTo = instant update, 60fps smooth, ALWAYS north-up
    this.map.jumpTo({
      center: this.smoothCenter,
      bearing: 0,
      pitch: 0
    });

    // ── CHECK SEGMENT CHANGE ──
    const seg = this.getSegmentAt(this.currentIndex);
    if (seg && seg !== this.currentSegment) {
      this.currentSegment = seg;
      this.showStoryCard(seg);
    }

    // ── CHECK POIs ──
    this.checkNearbyPOIs(coord);

    // Next frame at native 60fps
    this.animationFrame = requestAnimationFrame(() => this.animate());
  },

  // ─── BEARING INTERPOLATION (prevents 360° jumps) ──
  interpolateBearing(current, target, factor) {
    let diff = target - current;
    // Normalize to -180..180
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return (current + diff * factor + 360) % 360;
  },

  // ─── GET SEGMENT AT INDEX ─────────────────────────
  getSegmentAt(idx) {
    for (const seg of this.segments) {
      if (idx >= seg.startIdx && idx <= seg.endIdx) return seg;
    }
    return this.segments[this.segments.length - 1];
  },

  // ─── CHECK NEARBY POIs ────────────────────────────
  checkNearbyPOIs(coord) {
    for (const poi of this.allPOIs) {
      const key = poi.id + poi.name;
      if (this._shownPOIKeys && this._shownPOIKeys.has(key)) continue;

      const dist = PeakflowUtils.haversineDistance(coord[1], coord[0], poi.lat, poi.lng);
      if (dist < 0.3) {
        if (!this._shownPOIKeys) this._shownPOIKeys = new Set();
        this._shownPOIKeys.add(key);
        this.showPOICard(poi, dist);
      }
    }
  },

  showPOICard(poi, distance) {
    const card = document.getElementById('poiInfoCard');
    if (!card) return;
    const iconMap = { summit: '⛰️', hut: '🏠', pass: '🔀' };

    document.getElementById('poiCardIcon').textContent = iconMap[poi.type] || '📍';
    document.getElementById('poiCardDistance').textContent =
      distance < 0.1 ? 'Hier!' : `In ${distance.toFixed(1)} km`;
    document.getElementById('poiCardName').textContent =
      `${poi.name} (${poi.elevation}m)`;

    card.classList.remove('hidden');
    setTimeout(() => card.classList.add('hidden'), 5000);
  },

  showFinishCard() {
    const card = document.getElementById('wtStoryCard');
    if (!card) return;
    document.getElementById('wtStoryIcon').textContent = '🏁';
    document.getElementById('wtStoryText').textContent =
      `Tour geschafft! ${this.totalDistance.toFixed(1)} km Wanderung abgeschlossen. Glückwunsch!`;
    card.classList.add('wt-story-card--visible');
  },

  // ─── SEEK / SKIP ─────────────────────────────────
  seekTo(index) {
    this.currentIndex = Math.max(0, Math.min(index, this.routeCoords.length - 1));
    this._fractionalIndex = this.currentIndex;
    const coord = this.routeCoords[this.currentIndex];
    if (this.marker) this.marker.setLngLat([coord[0], coord[1]]);

    const seg = this.getSegmentAt(this.currentIndex);
    if (seg && seg !== this.currentSegment) {
      this.currentSegment = seg;
      this.showStoryCard(seg);
    }

    this.map.easeTo({ center: [coord[0], coord[1]], duration: 500 });
  },

  nextPOI() {
    for (let i = this.currentIndex + 20; i < this.routeCoords.length; i += 5) {
      for (const poi of this.allPOIs) {
        const d = PeakflowUtils.haversineDistance(
          this.routeCoords[i][1], this.routeCoords[i][0], poi.lat, poi.lng
        );
        if (d < 0.3) { this.seekTo(i); return; }
      }
    }
    // No more POIs, go to end
    this.seekTo(this.routeCoords.length - 1);
  },

  prevPOI() {
    for (let i = this.currentIndex - 20; i >= 0; i -= 5) {
      for (const poi of this.allPOIs) {
        const d = PeakflowUtils.haversineDistance(
          this.routeCoords[i][1], this.routeCoords[i][0], poi.lat, poi.lng
        );
        if (d < 0.3) { this.seekTo(i); return; }
      }
    }
    this.seekTo(0);
  },

  // ─── UI HELPERS ───────────────────────────────────
  updatePlayButton() {
    const btn = document.getElementById('wtPlayPause');
    if (!btn) return;
    if (this.isPlaying) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
      </svg>`;
    } else {
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5,3 19,12 5,21 5,3"/>
      </svg>`;
    }
  },

  calculateBearing(start, end) {
    const startLat = PeakflowUtils.toRad(start[1]);
    const startLng = PeakflowUtils.toRad(start[0]);
    const endLat = PeakflowUtils.toRad(end[1]);
    const endLng = PeakflowUtils.toRad(end[0]);
    const dLng = endLng - startLng;
    const x = Math.sin(dLng) * Math.cos(endLat);
    const y = Math.cos(startLat) * Math.sin(endLat) -
      Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);
    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  },

  setSpeed(speed) {
    this.speed = parseFloat(speed) || 1;
  }
};
