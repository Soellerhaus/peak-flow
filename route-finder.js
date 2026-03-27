/**
 * Peakflow Route Finder
 * Suggests routes based on duration + elevation preferences
 */
const PeakflowRouteFinder = {
  map: null,
  previewLayers: [],
  selectedDuration: 60,
  selectedHM: 500,
  ROUTE_COLORS: ['#e63946', '#457b9d', '#2a9d8f'], // Red, Blue, Teal

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

    // Duration chips
    document.querySelectorAll('#rfDuration .rf-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#rfDuration .rf-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.selectedDuration = parseInt(chip.dataset.min);
      });
    });

    // Elevation chips
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

  async searchRoutes() {
    const results = document.getElementById('rfResults');
    const loading = document.getElementById('rfLoading');
    const list = document.getElementById('rfResultsList');
    const searchBtn = document.getElementById('rfSearchBtn');

    // Get start location
    const startLoc = Peakflow._userLocation || Peakflow.getCachedLocation();
    if (!startLoc) {
      alert('Bitte zuerst einen Standort wählen!');
      return;
    }

    results.classList.remove('hidden');
    loading.classList.remove('hidden');
    list.innerHTML = '';
    searchBtn.disabled = true;
    searchBtn.textContent = '🔍 Suche läuft...';

    // Clear old preview routes
    this.clearPreviews();

    try {
      // Calculate search radius based on duration + speed
      const speedKmh = 4; // Average hiking speed
      const maxDistKm = (this.selectedDuration / 60) * speedKmh;
      const radiusDeg = maxDistKm / 111; // ~111km per degree

      // Find peaks from Supabase within radius that match elevation criteria
      const peaks = await this.findMatchingPeaks(startLoc, radiusDeg, this.selectedHM);

      if (peaks.length === 0) {
        list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-secondary);font-size:13px;">Keine passenden Gipfel in der Nähe gefunden. Versuche andere Einstellungen.</div>';
        loading.classList.add('hidden');
        searchBtn.disabled = false;
        searchBtn.textContent = '🔍 Routen suchen';
        return;
      }

      // Calculate routes to top 3 peaks
      const routes = [];
      for (let i = 0; i < Math.min(3, peaks.length); i++) {
        const peak = peaks[i];
        const route = await this.calculateRoute(startLoc, peak);
        if (route) {
          route.color = this.ROUTE_COLORS[i];
          route.peak = peak;
          routes.push(route);
        }
      }

      loading.classList.add('hidden');

      if (routes.length === 0) {
        list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-secondary);font-size:13px;">Keine Wanderwege gefunden. Versuche eine andere Dauer.</div>';
      } else {
        // Draw preview routes on map
        routes.forEach((route, i) => this.drawPreviewRoute(route, i));

        // Show results
        list.innerHTML = routes.map((route, i) => {
          const durationH = Math.floor(route.duration / 60);
          const durationM = Math.round(route.duration % 60);
          return '<div class="rf-result" data-index="' + i + '" style="border-left:4px solid ' + route.color + ';">' +
            '<div class="rf-result__header">' +
            '<div class="rf-result__color" style="background:' + route.color + ';"></div>' +
            '<span class="rf-result__name">' + (route.peak.name || 'Gipfel ' + (i+1)) + ' (' + Math.round(route.peak.elevation) + 'm)</span>' +
            '</div>' +
            '<div class="rf-result__stats">' +
            '<span>📏 ' + route.distance.toFixed(1) + ' km</span>' +
            '<span>⬆ ' + route.ascent + ' Hm</span>' +
            '<span>⏱ ' + durationH + ':' + (durationM < 10 ? '0' : '') + durationM + ' h</span>' +
            '</div>' +
            '<button class="rf-result__btn" data-index="' + i + '">Diese Route wählen →</button>' +
            '</div>';
        }).join('');

        // Event handlers for "Diese Route wählen"
        list.querySelectorAll('.rf-result__btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index);
            this.selectRoute(routes[idx]);
          });
        });

        // Hover highlights
        list.querySelectorAll('.rf-result').forEach(card => {
          card.addEventListener('mouseenter', () => {
            const idx = parseInt(card.dataset.index);
            this.highlightRoute(idx);
          });
        });

        // Fit map to show all routes
        const allCoords = routes.flatMap(r => r.coords);
        if (allCoords.length > 0) {
          const lngs = allCoords.map(c => c[0]);
          const lats = allCoords.map(c => c[1]);
          this.map.fitBounds([
            [Math.min(...lngs) - 0.01, Math.min(...lats) - 0.01],
            [Math.max(...lngs) + 0.01, Math.max(...lats) + 0.01]
          ], { padding: 60, duration: 1000 });
        }
      }
    } catch(e) {
      console.error('[RouteFinder] Error:', e);
      list.innerHTML = '<div style="padding:12px;color:#e63946;">Fehler beim Suchen: ' + e.message + '</div>';
      loading.classList.add('hidden');
    }

    searchBtn.disabled = false;
    searchBtn.textContent = '🔍 Routen suchen';
  },

  async findMatchingPeaks(startLoc, radiusDeg, targetHM) {
    // Calculate target elevation: start elevation + target HM
    const startElevResp = await fetch('https://api.open-meteo.com/v1/elevation?latitude=' + startLoc.lat + '&longitude=' + startLoc.lng);
    const startElevData = await startElevResp.json();
    const startElev = startElevData.elevation?.[0] || 800;

    const targetElev = startElev + targetHM;
    const minElev = targetElev - (targetHM * 0.3); // 30% tolerance below
    const maxElev = targetElev + (targetHM * 0.3); // 30% tolerance above

    // Query Supabase for peaks
    const url = 'https://wbrvkweezbeakfphssxp.supabase.co/rest/v1/peaks' +
      '?latitude=gte.' + (startLoc.lat - radiusDeg) +
      '&latitude=lte.' + (startLoc.lat + radiusDeg) +
      '&longitude=gte.' + (startLoc.lng - radiusDeg) +
      '&longitude=lte.' + (startLoc.lng + radiusDeg) +
      '&elevation=gte.' + Math.round(minElev) +
      '&elevation=lte.' + Math.round(maxElev) +
      '&select=id,name,latitude,longitude,elevation' +
      '&order=elevation.desc' +
      '&limit=10';

    const resp = await fetch(url, {
      headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE' }
    });
    const peaks = await resp.json();

    if (!Array.isArray(peaks)) return [];

    // Sort by distance from start and pick diverse ones
    const withDist = peaks.map(p => ({
      ...p,
      dist: Math.sqrt(Math.pow(p.latitude - startLoc.lat, 2) + Math.pow(p.longitude - startLoc.lng, 2))
    })).sort((a, b) => a.dist - b.dist);

    // Pick 3 diverse peaks (different directions)
    const selected = [];
    const usedAngles = [];

    for (const peak of withDist) {
      const angle = Math.atan2(peak.longitude - startLoc.lng, peak.latitude - startLoc.lat) * 180 / Math.PI;
      const tooClose = usedAngles.some(a => Math.abs(a - angle) < 40); // At least 40° apart
      if (!tooClose || selected.length < 1) {
        selected.push(peak);
        usedAngles.push(angle);
      }
      if (selected.length >= 3) break;
    }

    console.log('[RouteFinder] Found ' + peaks.length + ' peaks, selected ' + selected.length + ' diverse ones');
    return selected;
  },

  async calculateRoute(startLoc, peak) {
    const coords = startLoc.lng + ',' + startLoc.lat + '|' + peak.longitude + ',' + peak.latitude;

    // Try BRouter
    const profiles = ['hiking-mountain', 'hiking-beta', 'shortest'];
    for (const profile of profiles) {
      try {
        const url = 'https://brouter.de/brouter?lonlats=' + coords +
          '&profile=' + profile + '&alternativeidx=0&format=geojson';
        const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok) continue;

        const data = await resp.json();
        const routeCoords = data.features?.[0]?.geometry?.coordinates;
        if (!routeCoords || routeCoords.length < 2) continue;

        // Get elevations
        const elevResp = await fetch('https://api.open-meteo.com/v1/elevation?latitude=' +
          routeCoords.filter((_, i) => i % 10 === 0).map(c => c[1]).join(',') +
          '&longitude=' + routeCoords.filter((_, i) => i % 10 === 0).map(c => c[0]).join(','));
        const elevData = await elevResp.json();
        const elevations = elevData.elevation || [];

        // Calculate stats
        let ascent = 0, descent = 0, distance = 0;
        for (let i = 1; i < elevations.length; i++) {
          const diff = elevations[i] - elevations[i-1];
          if (diff > 0) ascent += diff;
          else descent += Math.abs(diff);
        }
        for (let i = 1; i < routeCoords.length; i++) {
          const dLat = (routeCoords[i][1] - routeCoords[i-1][1]) * 111;
          const dLng = (routeCoords[i][0] - routeCoords[i-1][0]) * 111 * Math.cos(routeCoords[i][1] * Math.PI / 180);
          distance += Math.sqrt(dLat * dLat + dLng * dLng);
        }

        // Calculate duration (DIN 33466)
        const flatTime = distance / 4;
        const ascentTime = ascent / 300;
        const descentTime = descent / 500;
        const verticalTime = ascentTime + descentTime;
        const duration = (Math.max(verticalTime, flatTime) + Math.min(verticalTime, flatTime) / 2) * 60;

        return {
          coords: routeCoords,
          elevations,
          distance: distance * 2, // Round trip estimate
          ascent: Math.round(ascent),
          descent: Math.round(descent),
          duration: duration * 1.8, // Round trip factor
          profile
        };
      } catch(e) {
        continue;
      }
    }
    return null;
  },

  drawPreviewRoute(route, index) {
    if (!this.map) return;

    const sourceId = 'rf-preview-' + index;
    const layerId = 'rf-preview-line-' + index;
    const outlineId = 'rf-preview-outline-' + index;

    // Wait for style if needed
    const addLayers = () => {
      try {
        if (this.map.getSource(sourceId)) {
          this.map.getSource(sourceId).setData({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: route.coords }
          });
        } else {
          this.map.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: route.coords } }
          });
          this.map.addLayer({
            id: outlineId, type: 'line', source: sourceId,
            paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.2 }
          });
          this.map.addLayer({
            id: layerId, type: 'line', source: sourceId,
            paint: { 'line-color': route.color, 'line-width': 3, 'line-opacity': 0.8 },
            layout: { 'line-cap': 'round', 'line-join': 'round' }
          });
        }
        this.previewLayers.push(sourceId, layerId, outlineId);

        // Add peak marker
        const peakCoord = [route.peak.longitude, route.peak.latitude];
        const el = document.createElement('div');
        el.style.cssText = 'width:24px;height:24px;border-radius:50%;background:' + route.color + ';border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:11px;color:white;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.3);';
        el.textContent = (index + 1);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(peakCoord)
          .setPopup(new maplibregl.Popup({ offset: 15 }).setHTML(
            '<strong>' + (route.peak.name || 'Gipfel') + '</strong><br>' +
            Math.round(route.peak.elevation) + 'm • ' + route.distance.toFixed(1) + 'km • ' + route.ascent + 'Hm'
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
      const layerId = 'rf-preview-line-' + i;
      try {
        if (this.map.getLayer(layerId)) {
          this.map.setPaintProperty(layerId, 'line-opacity', i === index ? 1 : 0.3);
          this.map.setPaintProperty(layerId, 'line-width', i === index ? 5 : 2);
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
    // Clear previews
    this.clearPreviews();

    // Close finder panel
    document.getElementById('routeFinderPanel').classList.add('hidden');
    document.getElementById('routeFinderToggle').classList.remove('active');

    // Set waypoints in route planner
    PeakflowRoutes.clearRoute();

    // Add start + peak as waypoints
    const startLoc = Peakflow._userLocation || Peakflow.getCachedLocation();
    if (startLoc) {
      PeakflowRoutes.addWaypoint({ lng: startLoc.lng, lat: startLoc.lat, name: 'Start' });
    }
    PeakflowRoutes.addWaypoint({
      lng: route.peak.longitude,
      lat: route.peak.latitude,
      name: route.peak.name || 'Gipfel'
    });

    // Collapse sidebar on mobile
    var sidebar = document.querySelector('.sidebar');
    if (sidebar && window.innerWidth < 768) {
      sidebar.classList.remove('expanded', 'fully-expanded');
      sidebar.classList.add('collapsed');
    }
  }
};
