/**
 * Peakflow Route Finder v2
 * Generates round-trip hiking routes using OpenRouteService
 */
const PeakflowRouteFinder = {
  map: null,
  previewLayers: [],
  selectedDuration: 60,
  selectedHM: 500,
  ORS_KEY: 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjlkOGIyMmY0YjcyYTQzOTM4ZWE5OTgyYjUwMTQ4YzNjIiwiaCI6Im11cm11cjY0In0=',
  ROUTE_COLORS: ['#e63946', '#457b9d', '#2a9d8f'],
  ROUTE_NAMES: [],

  init(map) {
    this.map = map;
    this.setupEvents();
  },

  setupEvents() {
    const toggle = document.getElementById('routeFinderToggle');
    const panel = document.getElementById('routeFinderPanel');
    const searchBtn = document.getElementById('rfSearchBtn');

    if (toggle) {
      toggle.addEventListener('click', () => {
        panel.classList.toggle('hidden');
        toggle.classList.toggle('active');
      });
    }

    document.querySelectorAll('#rfDuration .rf-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#rfDuration .rf-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.selectedDuration = parseInt(chip.dataset.min);
      });
    });

    document.querySelectorAll('#rfElevation .rf-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#rfElevation .rf-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.selectedHM = parseInt(chip.dataset.hm);
      });
    });

    if (searchBtn) {
      searchBtn.addEventListener('click', () => this.searchRoutes());
    }
  },

  _getSpeed() {
    // Match user's activity profile
    const sel = document.getElementById('activityProfile');
    const profile = sel ? sel.value : 'hiker';
    const speeds = {
      'hiker_slow': 3, 'hiker': 4, 'hiker_fast': 5,
      'runner': 8, 'runner_fast': 14
    };
    return speeds[profile] || 4;
  },

  _getDirection(coords) {
    if (coords.length < 10) return 'Rundweg';
    // Find the point furthest from start to determine direction
    const start = coords[0];
    let maxDist = 0, furthest = coords[0];
    for (let i = 0; i < coords.length; i++) {
      const d = Math.pow(coords[i][0] - start[0], 2) + Math.pow(coords[i][1] - start[1], 2);
      if (d > maxDist) { maxDist = d; furthest = coords[i]; }
    }
    const angle = Math.atan2(furthest[0] - start[0], furthest[1] - start[1]) * 180 / Math.PI;
    if (angle > -22.5 && angle <= 22.5) return 'Rundweg Nord';
    if (angle > 22.5 && angle <= 67.5) return 'Rundweg Nord-Ost';
    if (angle > 67.5 && angle <= 112.5) return 'Rundweg Ost';
    if (angle > 112.5 && angle <= 157.5) return 'Rundweg Süd-Ost';
    if (angle > 157.5 || angle <= -157.5) return 'Rundweg Süd';
    if (angle > -157.5 && angle <= -112.5) return 'Rundweg Süd-West';
    if (angle > -112.5 && angle <= -67.5) return 'Rundweg West';
    return 'Rundweg Nord-West';
  },

  async searchRoutes() {
    const results = document.getElementById('rfResults');
    const loading = document.getElementById('rfLoading');
    const list = document.getElementById('rfResultsList');
    const searchBtn = document.getElementById('rfSearchBtn');

    // Find start location from all possible sources
    let startLoc = null;
    if (typeof Peakflow !== 'undefined') {
      // 1. User's active location
      startLoc = Peakflow._userLocation;
      // 2. First saved location from settings
      if (!startLoc && Peakflow._settingsLocations && Peakflow._settingsLocations.length > 0) {
        const loc = Peakflow._settingsLocations[0];
        startLoc = { lat: loc.lat, lng: loc.lng };
      }
      // 3. Cached location from localStorage
      if (!startLoc) startLoc = Peakflow.getCachedLocation();
      // 4. Current map center as last resort
      if (!startLoc && this.map) {
        const center = this.map.getCenter();
        startLoc = { lat: center.lat, lng: center.lng };
      }
    }

    if (!startLoc) {
      alert('Bitte zuerst einen Standort wählen!');
      return;
    }

    results.classList.remove('hidden');
    loading.classList.remove('hidden');
    list.innerHTML = '';
    searchBtn.disabled = true;
    searchBtn.textContent = '🔍 Suche Rundwege...';

    this.clearPreviews();

    try {
      const speed = this._getSpeed();
      const lengthM = Math.round((this.selectedDuration / 60) * speed * 1000);

      console.log('[RouteFinder] Searching round trips: ' + lengthM + 'm, ' + this.selectedHM + 'Hm, speed=' + speed + 'km/h');

      // Try seeds 1-9, collect best 3 matching routes
      const allRoutes = [];

      // Fetch 3 routes in parallel (seeds 1, 2, 3)
      const batch1 = await Promise.allSettled([
        this._fetchRoundTrip(startLoc, lengthM, 1),
        this._fetchRoundTrip(startLoc, lengthM, 2),
        this._fetchRoundTrip(startLoc, lengthM, 3)
      ]);

      for (const result of batch1) {
        if (result.status === 'fulfilled' && result.value) {
          allRoutes.push(result.value);
        }
      }

      // If we need more routes, try seeds 4-6
      if (allRoutes.length < 3) {
        const batch2 = await Promise.allSettled([
          this._fetchRoundTrip(startLoc, lengthM, 4),
          this._fetchRoundTrip(startLoc, lengthM, 5),
          this._fetchRoundTrip(startLoc, lengthM, 6)
        ]);
        for (const result of batch2) {
          if (result.status === 'fulfilled' && result.value) {
            allRoutes.push(result.value);
          }
        }
      }

      // Filter by elevation preference (±50% tolerance)
      const minHM = this.selectedHM * 0.5;
      const maxHM = this.selectedHM * 1.5;
      let matched = allRoutes.filter(r => r.ascent >= minHM && r.ascent <= maxHM);

      // If no exact match, take all and sort by closest HM
      if (matched.length === 0) {
        matched = allRoutes.sort((a, b) =>
          Math.abs(a.ascent - this.selectedHM) - Math.abs(b.ascent - this.selectedHM)
        );
      }

      // Take top 3
      const routes = matched.slice(0, 3);

      loading.classList.add('hidden');

      if (routes.length === 0) {
        list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-secondary);font-size:13px;">' +
          'Keine Rundwege gefunden. Versuche andere Einstellungen.</div>';
      } else {
        // Assign colors and names
        routes.forEach((route, i) => {
          route.color = this.ROUTE_COLORS[i];
          route.name = this._getDirection(route.coords);
          // Avoid duplicate names
          if (i > 0 && route.name === routes[i-1].name) {
            route.name += ' ' + (i + 1);
          }
        });

        // Draw on map
        routes.forEach((route, i) => this.drawPreviewRoute(route, i));

        // Show results list
        list.innerHTML = routes.map((route, i) => {
          const dH = Math.floor(route.duration / 60);
          const dM = Math.round(route.duration % 60);
          return '<div class="rf-result" data-index="' + i + '" style="border-left:4px solid ' + route.color + ';">' +
            '<div class="rf-result__header">' +
            '<div class="rf-result__color" style="background:' + route.color + ';"></div>' +
            '<span class="rf-result__name">' + route.name + '</span>' +
            '</div>' +
            '<div class="rf-result__stats">' +
            '<span>📏 ' + route.distance.toFixed(1) + ' km</span>' +
            '<span>⬆ ' + Math.round(route.ascent) + ' Hm</span>' +
            '<span>⬇ ' + Math.round(route.descent) + ' Hm</span>' +
            '<span>⏱ ' + dH + ':' + (dM < 10 ? '0' : '') + dM + ' h</span>' +
            '</div>' +
            '<button class="rf-result__btn" data-index="' + i + '">Diese Route wählen →</button>' +
            '</div>';
        }).join('');

        // Event handlers
        list.querySelectorAll('.rf-result__btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectRoute(routes[parseInt(btn.dataset.index)]);
          });
        });

        list.querySelectorAll('.rf-result').forEach(card => {
          card.addEventListener('mouseenter', () => this.highlightRoute(parseInt(card.dataset.index)));
          card.addEventListener('mouseleave', () => this.resetHighlight());
        });

        // Fit map to show all routes
        const allCoords = routes.flatMap(r => r.coords);
        if (allCoords.length > 0) {
          const lngs = allCoords.map(c => c[0]);
          const lats = allCoords.map(c => c[1]);
          this.map.fitBounds([
            [Math.min(...lngs) - 0.005, Math.min(...lats) - 0.005],
            [Math.max(...lngs) + 0.005, Math.max(...lats) + 0.005]
          ], { padding: 50, duration: 1000 });
        }
      }
    } catch(e) {
      console.error('[RouteFinder] Error:', e);
      list.innerHTML = '<div style="padding:12px;color:#e63946;font-size:13px;">Fehler: ' + e.message + '</div>';
      loading.classList.add('hidden');
    }

    searchBtn.disabled = false;
    searchBtn.textContent = '🔍 Routen suchen';
  },

  async _fetchRoundTrip(startLoc, lengthM, seed) {
    const body = {
      coordinates: [[startLoc.lng, startLoc.lat]],
      options: {
        round_trip: {
          length: lengthM,
          points: 5,
          seed: seed
        }
      },
      elevation: true,
      instructions: false
    };

    const resp = await fetch('https://api.openrouteservice.org/v2/directions/foot-hiking/geojson', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.ORS_KEY
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.warn('[RouteFinder] ORS seed ' + seed + ' failed: ' + resp.status, errText.substring(0, 100));
      return null;
    }

    const data = await resp.json();
    const feature = data.features?.[0];
    if (!feature) return null;

    const coords = feature.geometry?.coordinates;
    const summary = feature.properties?.summary;
    if (!coords || coords.length < 5 || !summary) return null;

    // Extract ascent/descent from segments
    const segments = feature.properties?.segments || [];
    let ascent = 0, descent = 0;
    for (const seg of segments) {
      ascent += seg.ascent || 0;
      descent += seg.descent || 0;
    }

    // If no segment data, estimate from coordinates (they include elevation as 3rd value)
    if (ascent === 0 && coords[0].length >= 3) {
      for (let i = 1; i < coords.length; i++) {
        const diff = coords[i][2] - coords[i-1][2];
        if (diff > 0) ascent += diff;
        else descent += Math.abs(diff);
      }
    }

    const distKm = (summary.distance || 0) / 1000;
    const durationMin = (summary.duration || 0) / 60;

    console.log('[RouteFinder] Seed ' + seed + ': ' + distKm.toFixed(1) + 'km, ' + Math.round(ascent) + 'Hm, ' + Math.round(durationMin) + 'min');

    return {
      coords: coords.map(c => [c[0], c[1]]), // [lng, lat] without elevation
      elevations: coords.map(c => c[2] || 0),
      distance: distKm,
      ascent: ascent,
      descent: descent,
      duration: durationMin,
      seed: seed
    };
  },

  drawPreviewRoute(route, index) {
    if (!this.map) return;

    const sourceId = 'rf-preview-' + index;
    const layerId = 'rf-preview-line-' + index;
    const outlineId = 'rf-preview-outline-' + index;

    const addLayers = () => {
      try {
        const geojson = {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: route.coords }
        };

        if (this.map.getSource(sourceId)) {
          this.map.getSource(sourceId).setData(geojson);
        } else {
          this.map.addSource(sourceId, { type: 'geojson', data: geojson });
          this.map.addLayer({
            id: outlineId, type: 'line', source: sourceId,
            paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.6 },
            layout: { 'line-cap': 'round', 'line-join': 'round' }
          });
          this.map.addLayer({
            id: layerId, type: 'line', source: sourceId,
            paint: { 'line-color': route.color, 'line-width': 4, 'line-opacity': 0.85 },
            layout: { 'line-cap': 'round', 'line-join': 'round' }
          });
        }
        this.previewLayers.push(sourceId, layerId, outlineId);

        // Number marker at the "furthest point" of the route
        let maxDist = 0, furthestIdx = 0;
        const s = route.coords[0];
        for (let i = 0; i < route.coords.length; i++) {
          const d = Math.pow(route.coords[i][0] - s[0], 2) + Math.pow(route.coords[i][1] - s[1], 2);
          if (d > maxDist) { maxDist = d; furthestIdx = i; }
        }
        const markerCoord = route.coords[furthestIdx];

        const el = document.createElement('div');
        el.style.cssText = 'width:26px;height:26px;border-radius:50%;background:' + route.color +
          ';border:2px solid white;display:flex;align-items:center;justify-content:center;' +
          'font-size:12px;color:white;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;';
        el.textContent = (index + 1);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(markerCoord)
          .setPopup(new maplibregl.Popup({ offset: 15 }).setHTML(
            '<strong>' + route.name + '</strong><br>' +
            route.distance.toFixed(1) + ' km • ' + Math.round(route.ascent) + ' Hm ⬆'
          ))
          .addTo(this.map);
        this.previewLayers.push(marker);
      } catch(e) {
        setTimeout(addLayers, 500);
      }
    };

    addLayers();
  },

  highlightRoute(index) {
    for (let i = 0; i < 3; i++) {
      try {
        const lid = 'rf-preview-line-' + i;
        if (this.map.getLayer(lid)) {
          this.map.setPaintProperty(lid, 'line-opacity', i === index ? 1 : 0.25);
          this.map.setPaintProperty(lid, 'line-width', i === index ? 6 : 2);
        }
      } catch(e) {}
    }
  },

  resetHighlight() {
    for (let i = 0; i < 3; i++) {
      try {
        const lid = 'rf-preview-line-' + i;
        if (this.map.getLayer(lid)) {
          this.map.setPaintProperty(lid, 'line-opacity', 0.85);
          this.map.setPaintProperty(lid, 'line-width', 4);
        }
      } catch(e) {}
    }
  },

  clearPreviews() {
    if (!this.map) return;
    this.previewLayers.forEach(item => {
      if (typeof item === 'string') {
        try { this.map.removeLayer(item); } catch(e) {}
        try { this.map.removeSource(item); } catch(e) {}
      } else if (item && item.remove) {
        item.remove();
      }
    });
    this.previewLayers = [];
  },

  selectRoute(route) {
    this.clearPreviews();

    // Close finder panel
    document.getElementById('routeFinderPanel')?.classList.add('hidden');
    document.getElementById('routeFinderToggle')?.classList.remove('active');

    // IMPORTANT: Clear old route, then DISABLE planning so addWaypoint doesn't trigger BRouter
    var R = PeakflowRoutes;
    R.clearRoute();
    R.isPlanning = false; // Prevent updateRoute from being called

    // Set the pre-calculated ORS route data directly
    R.routeCoords = route.coords;
    R.elevations = route.elevations;

    // Add waypoint markers manually (without triggering updateRoute)
    var startCoord = route.coords[0];
    var startMarker = new maplibregl.Marker({ color: '#22c55e' })
      .setLngLat([startCoord[0], startCoord[1]])
      .addTo(R.map);
    R.markers.push(startMarker);
    R.waypoints.push({ lng: startCoord[0], lat: startCoord[1], name: 'Start' });

    // Find furthest point for turnaround marker
    var maxDist = 0, furthestIdx = 0;
    for (var i = 0; i < route.coords.length; i++) {
      var d = Math.pow(route.coords[i][0] - startCoord[0], 2) + Math.pow(route.coords[i][1] - startCoord[1], 2);
      if (d > maxDist) { maxDist = d; furthestIdx = i; }
    }
    var furthest = route.coords[furthestIdx];
    var turnMarker = new maplibregl.Marker({ color: '#e63946' })
      .setLngLat([furthest[0], furthest[1]])
      .addTo(R.map);
    R.markers.push(turnMarker);
    R.waypoints.push({ lng: furthest[0], lat: furthest[1], name: route.name });

    // Update display
    R.updateWaypointList();
    R.drawRouteLine(route.coords);
    R.updateStats();

    // Elevation profile
    var elevEl = document.getElementById('elevationProfile');
    if (elevEl) elevEl.classList.remove('hidden');
    setTimeout(function() { R.drawElevationProfile(); }, 150);

    // Re-enable planning for further edits
    R.isPlanning = true;
    if (R.map) R.map.getCanvas().style.cursor = 'crosshair';

    // Load additional data in background
    R.loadSACDataForRoute(route.coords).catch(function() {});
    R.analyzeSnowOnRoute().catch(function() {});
    R.loadRouteWeather(route.coords).catch(function() {});
    R.loadWaterSources(route.coords).catch(function() {});
    R.loadSunAnalysis(route.coords, route.elevations);

    // Collapse sidebar on mobile
    var sidebar = document.querySelector('.sidebar');
    if (sidebar && window.innerWidth < 768) {
      sidebar.classList.remove('expanded', 'fully-expanded');
      sidebar.classList.add('collapsed');
    }

    console.log('[RouteFinder] Route loaded: ' + route.name + ' (' + route.distance.toFixed(1) + 'km, ' + Math.round(route.ascent) + 'Hm, ' + route.coords.length + ' pts)');
  }
};
