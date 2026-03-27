/* ============================================
   PEAKFLOW - Main Application
   ============================================ */

const Peakflow = {

  map: null,
  allPOIs: [],
  summits: [],
  huts: [],
  passes: [],

  // Map tile styles
  STYLES: {
    topo: {
      version: 8,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenTopoMap, © OpenStreetMap contributors'
        }
      },
      layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm-tiles' }]
    },
    satellite: {
      version: 8,
      sources: {
        'satellite-tiles': {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: '© Esri'
        }
      },
      layers: [{ id: 'satellite-tiles', type: 'raster', source: 'satellite-tiles' }]
    },
    standard: {
      version: 8,
      sources: {
        'osm-standard': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors'
        }
      },
      layers: [{ id: 'osm-standard', type: 'raster', source: 'osm-standard' }]
    }
  },

  currentStyle: 'topo',
  terrainEnabled: false,
  _peaksVisible: true,

  /**
   * Initialize the app
   */
  async init() {
    console.log('[Peakflow] Initializing...');

    // Restore location: cached > IP geolocation (no GPS prompt ever on startup)
    const cached = this.getCachedLocation();
    if (cached) {
      this._userLocation = cached;
    } else {
      // Get approximate location from IP address (no permission needed)
      await this.detectLocationByIP();
    }

    // Init Supabase
    PeakflowData.init();

    // Init Map
    this.initMap();

    // Setup event listeners
    this.setupEvents();

    // Load POI data
    await this.loadPOIs();

    // If logged in user has home location, use that
    this.loadUserHomeLocation();

    // Ensure sidebar has content on first load
    this.map.once('idle', () => {
      this.updateDiscoverList();
      this.loadViewportPeaks();
    });

    console.log('[Peakflow] Ready!');
  },

  /**
   * Initialize MapLibre GL map
   */
  initMap() {
    // Use cached location if available
    const cached = this.getCachedLocation();
    const startCenter = cached ? [cached.lng, cached.lat] : [11.0, 47.3];
    const startZoom = cached ? 13 : 10;

    this.map = new maplibregl.Map({
      container: 'map',
      style: this.STYLES.topo,
      center: startCenter,
      zoom: startZoom,
      pitch: 0,
      bearing: 0,
      maxPitch: 85,
      antialias: true
    });

    // Navigation controls
    this.map.addControl(new maplibregl.NavigationControl({
      visualizePitch: true
    }), 'bottom-right');

    // Scale
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    // Pass map reference immediately
    PeakflowRoutes.init(this.map);
    PeakflowWalkthrough.init(this.map);

    // When map loads
    this.map.on('load', () => {
      // Terrain is loaded on-demand via the 3D button (to avoid slow tile loading)

      // Map click for route planning
      this.map.on('click', (e) => {
        if (PeakflowRoutes.isPlanning) {
          PeakflowRoutes.addWaypoint(e.lngLat);
        }
      });
    });
  },

  /**
   * Enable/disable 3D terrain
   */
  enableTerrain() {
    try {
      if (!this.map.getSource('terrain-dem')) {
        this.map.addSource('terrain-dem', {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          tileSize: 256,
          encoding: 'terrarium'
        });
      }
      this.map.setTerrain({ source: 'terrain-dem', exaggeration: 1.3 });
      this.terrainEnabled = true;
    } catch (e) {
      console.warn('[Peakflow] Terrain setup failed', e);
    }
  },

  toggleTerrain() {
    this.terrainEnabled = !this.terrainEnabled;
    if (this.terrainEnabled) {
      // Switch to satellite view for 3D
      if (this.currentStyle !== 'satellite') {
        this._preTerrainStyle = this.currentStyle;
        this.switchMapStyle('satellite');
      }
      this.enableTerrain();
      this.map.easeTo({ pitch: 45, duration: 800 });
    } else {
      this.map.setTerrain(null);
      this.map.easeTo({ pitch: 0, duration: 800 });
      // Restore previous map style
      if (this._preTerrainStyle) {
        this.switchMapStyle(this._preTerrainStyle);
        this._preTerrainStyle = null;
      }
    }
    document.getElementById('terrainToggleBtn').classList.toggle('active', this.terrainEnabled);
  },

  /**
   * Load POI data (summits, huts, passes)
   */
  async loadPOIs() {
    const [summits, huts, passes] = await Promise.all([
      PeakflowData.getSummits(),
      PeakflowData.getHuts(),
      PeakflowData.getPasses()
    ]);

    this.summits = summits;
    this.huts = huts;
    this.passes = passes;

    // Build combined POI list
    this.allPOIs = [
      ...summits.map(s => ({ ...s, type: 'summit' })),
      ...huts.map(h => ({ ...h, type: 'hut' })),
      ...passes.map(p => ({ ...p, type: 'pass' }))
    ];

    // Add markers to map
    this.addPOIMarkers();

    // Populate sidebar lists
    this.populateSidebar();
  },

  /**
   * Add POI markers to map
   */
  _poiMarkers: [],

  addPOIMarkers() {
    // Clear old markers
    this._poiMarkers.forEach(m => m.remove());
    this._poiMarkers = [];

    // Dark circle + gold triangle (like Bergkönig)
    const iconMap = {
      summit: { icon: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#2a2a2a" stroke="rgba(201,168,76,0.3)" stroke-width="0.5"/><path d="M12 5L5 18h14L12 5z" fill="#c9a84c"/><path d="M12 5L14.5 10H9.5L12 5z" fill="#fff"/></svg>' },
      hut: { icon: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#2a2a2a" stroke="rgba(201,168,76,0.3)" stroke-width="0.5"/><path d="M6 18V11l6-5 6 5v7H6z" fill="#c9a84c"/></svg>' },
      pass: { icon: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#2a2a2a" stroke="rgba(201,168,76,0.3)" stroke-width="0.5"/><path d="M4 16L8 9l4 4 4-4 4 7H4z" fill="#c9a84c"/></svg>' }
    };

    // Add all markers but control visibility by zoom
    this.allPOIs.forEach(poi => {
      const { icon, bg } = iconMap[poi.type] || { icon: '📍', bg: '#666' };

      const el = document.createElement('div');
      el.className = 'poi-marker';
      el.dataset.type = poi.type;
      el.dataset.elevation = poi.elevation;
      el.style.cssText = `
        width: 22px; height: 22px; background: transparent;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
        transition: filter 0.15s ease;
      `;
      el.innerHTML = icon;
      el.addEventListener('mouseenter', () => el.style.filter = 'drop-shadow(0 2px 6px rgba(201,168,76,0.6))');
      el.addEventListener('mouseleave', () => el.style.filter = 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))');

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([poi.lng, poi.lat])
        .addTo(this.map);

      marker._peakflowPoi = poi;
      this._poiMarkers.push(marker);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showPOIPopup(poi);
        this.showPOIDetail(poi);
      });
    });

    // Update visibility based on zoom
    this.updateMarkerVisibility();
    this.map.on('zoomend', () => {
      this.updateMarkerVisibility();
      this.loadViewportPeaks();
    });
    this.map.on('moveend', () => {
      this.updateMarkerVisibility();
      this.loadViewportPeaks();
      this.updateDiscoverList();
    });
  },

  /**
   * Show/hide markers based on zoom level and viewport
   */
  updateMarkerVisibility() {
    if (!this._peaksVisible) return; // All hidden
    const zoom = this.map.getZoom();
    const bounds = this.map.getBounds();

    this._poiMarkers.forEach(marker => {
      const poi = marker._peakflowPoi;
      const el = marker.getElement();
      const inBounds = bounds.contains([poi.lng, poi.lat]);

      // Visibility rules:
      // zoom < 9: only peaks > 3500m
      // zoom 9-10: peaks > 2500m + huts + passes
      // zoom 10-12: peaks > 1500m + huts + passes
      // zoom 12+: show all
      let visible = false;
      if (!inBounds) {
        visible = false;
      } else if (zoom >= 12) {
        visible = true;
      } else if (zoom >= 10) {
        visible = poi.type !== 'summit' || poi.elevation >= 1500;
      } else if (zoom >= 9) {
        visible = poi.type === 'hut' || poi.type === 'pass' || poi.elevation >= 2500;
      } else {
        visible = poi.type === 'summit' && poi.elevation >= 3500;
      }

      el.style.display = visible ? 'flex' : 'none';
    });
  },

  _loadedBounds: null,
  _loadingPeaks: false,

  /**
   * Load peaks for the current viewport from Supabase
   */
  async loadViewportPeaks() {
    if (!PeakflowData.isConnected || this._loadingPeaks) return;
    const zoom = this.map.getZoom();
    if (zoom < 10) return; // Only load detail peaks when zoomed in

    const bounds = this.map.getBounds();
    const key = `${bounds._sw.lat.toFixed(2)},${bounds._sw.lng.toFixed(2)},${bounds._ne.lat.toFixed(2)},${bounds._ne.lng.toFixed(2)}`;
    if (this._loadedBounds === key) return; // Already loaded this area

    this._loadingPeaks = true;
    this._loadedBounds = key;

    // Min elevation based on zoom
    const minElev = zoom >= 13 ? 500 : zoom >= 11 ? 1000 : 1500;

    const newPeaks = await PeakflowData.getSummitsInBounds(
      bounds._sw.lat, bounds._sw.lng,
      bounds._ne.lat, bounds._ne.lng,
      minElev
    );

    // Add only peaks we don't already have
    const existingIds = new Set(this.allPOIs.map(p => p.id));
    let added = 0;

    const iconMap = {
      summit: { icon: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#2a2a2a" stroke="rgba(201,168,76,0.3)" stroke-width="0.5"/><path d="M12 5L5 18h14L12 5z" fill="#c9a84c"/><path d="M12 5L14.5 10H9.5L12 5z" fill="#fff"/></svg>' },
      hut: { icon: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#2a2a2a" stroke="rgba(201,168,76,0.3)" stroke-width="0.5"/><path d="M6 18V11l6-5 6 5v7H6z" fill="#c9a84c"/></svg>' },
      pass: { icon: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#2a2a2a" stroke="rgba(201,168,76,0.3)" stroke-width="0.5"/><path d="M4 16L8 9l4 4 4-4 4 7H4z" fill="#c9a84c"/></svg>' }
    };

    for (const peak of newPeaks) {
      if (existingIds.has(peak.id)) continue;

      const poi = { ...peak, type: 'summit' };
      this.allPOIs.push(poi);
      this.summits.push(peak);

      // Create marker (Bergkönig-style)
      const { icon, bg } = iconMap.summit;
      const el = document.createElement('div');
      el.className = 'poi-marker';
      el.dataset.type = 'summit';
      el.dataset.elevation = poi.elevation;
      el.style.cssText = `
        width: 22px; height: 22px; background: transparent;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
        transition: filter 0.15s ease;
      `;
      el.innerHTML = icon;
      el.addEventListener('mouseenter', () => el.style.filter = 'drop-shadow(0 2px 6px rgba(201,168,76,0.6))');
      el.addEventListener('mouseleave', () => el.style.filter = 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))');

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([poi.lng, poi.lat])
        .addTo(this.map);

      marker._peakflowPoi = poi;
      this._poiMarkers.push(marker);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showPOIPopup(poi);
        this.showPOIDetail(poi);
      });

      added++;
    }

    if (added > 0) {
      console.log(`[Peakflow] Loaded ${added} new peaks for viewport (total: ${this.allPOIs.length})`);
      this.updateMarkerVisibility();
      this.updateDiscoverList(); // Refresh sidebar with newly loaded peaks
    }

    this._loadingPeaks = false;
  },

  /**
   * Show popup on map
   */
  async showPOIPopup(poi) {
    const typeLabels = { summit: 'Gipfel', hut: 'Hütte', pass: 'Pass/Scharte' };

    // Close existing popups
    document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());

    // Check reachability for summits (with error handling)
    let reachInfo = { reachable: true, warning: null, lastTrailPoint: null };
    if (poi.type === 'summit') {
      try {
        reachInfo = await PeakflowData.checkSummitReachability(poi);
      } catch (e) {
        console.warn('[Peakflow] Reachability check failed for popup:', e);
      }
    }

    const warningHtml = reachInfo.warning
      ? `<div style="margin-top:6px;padding:4px 6px;background:rgba(220,38,38,0.1);border-radius:4px;font-size:10px;color:#dc2626;line-height:1.3;">
          ⚠️ ${reachInfo.warning}
        </div>` : '';

    const btnLabel = !reachInfo.reachable && reachInfo.lastTrailPoint
      ? 'Route zum letzten Wegpunkt'
      : '+ Zur Route hinzufügen';

    const btnColor = reachInfo.reachable
      ? 'var(--primary, #c9a84c)'
      : '#e67e22';

    const popup = new maplibregl.Popup({ offset: 20, closeOnClick: true })
      .setLngLat([poi.lng, poi.lat])
      .setHTML(`
        <div class="popup-content">
          <div class="popup-content__type">${typeLabels[poi.type] || poi.type}</div>
          <div class="popup-content__name">${poi.name}</div>
          <div class="popup-content__elevation">${poi.elevation}m</div>
          ${warningHtml}
          <button class="popup-add-route-btn" id="popupAddRoute"
            style="margin-top:8px;width:100%;padding:6px 10px;background:${btnColor};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">
            ${btnLabel}
          </button>
        </div>
      `)
      .addTo(this.map);

    // Quick "add to route" button in popup
    setTimeout(() => {
      const btn = document.getElementById('popupAddRoute');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          popup.remove();
          document.getElementById('poiDetail').classList.add('hidden');

          // Ensure planning mode
          if (!PeakflowRoutes.isPlanning) PeakflowRoutes.togglePlanning();

          // Switch to routes tab
          document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
          document.querySelector('[data-tab="routes"]')?.classList.add('active');
          document.getElementById('panel-routes')?.classList.add('active');

          // Add start location if first waypoint
          if (PeakflowRoutes.waypoints.length === 0 && this._userLocation) {
            PeakflowRoutes.addWaypoint({ lng: this._userLocation.lng, lat: this._userLocation.lat });
          }

          // If unreachable, route to last trail point instead of summit
          if (!reachInfo.reachable && reachInfo.lastTrailPoint) {
            PeakflowRoutes.addWaypoint({
              lng: reachInfo.lastTrailPoint[0],
              lat: reachInfo.lastTrailPoint[1],
              name: `${poi.name} (letzter Wegpunkt)`
            });
          } else {
            PeakflowRoutes.addWaypoint({ lng: poi.lng, lat: poi.lat, name: poi.name });
          }
        });
      }
    }, 100);

    // DON'T move the map - user wants to stay where they are
  },

  /**
   * Show POI detail in sidebar
   */
  async showPOIDetail(poi) {
    this._currentPoi = poi; // Save for "Route hierhin" button
    const detail = document.getElementById('poiDetail');
    const typeLabels = { summit: 'Gipfel', hut: 'Hütte', pass: 'Pass/Scharte' };
    const typeClasses = { summit: 'poi-detail__type--summit', hut: 'poi-detail__type--hut', pass: 'poi-detail__type--pass' };

    // Set type badge
    const typeEl = document.getElementById('poiType');
    typeEl.textContent = typeLabels[poi.type];
    typeEl.className = `poi-detail__type ${typeClasses[poi.type] || ''}`;

    // Basic info
    document.getElementById('poiName').textContent = poi.name;
    document.getElementById('poiElevation').textContent = `${poi.elevation} m ü.M.`;
    document.getElementById('poiDescription').textContent = poi.description || '';

    // Difficulty (for summits) - show SAC scale badge
    const diffEl = document.getElementById('poiDifficulty');
    if (poi.type === 'summit') {
      const sacLabels = { 1: 'Schwierigkeitsgrad T1 Wandern', 2: 'Schwierigkeitsgrad T2 Bergwandern', 3: 'Schwierigkeitsgrad T3 Anspruchsvoll', 4: 'Schwierigkeitsgrad T4 Alpinwandern', 5: 'Schwierigkeitsgrad T5 Alpinklettern' };
      const sacColors = { 1: '#0d9488', 2: '#d97706', 3: '#ea580c', 4: '#dc2626', 5: '#7f1d1d' };
      const level = poi.difficulty || 2;
      const label = poi.sacScale || sacLabels[level] || `T${level}`;
      const color = sacColors[level] || '#666';
      diffEl.innerHTML = `
        <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;background:${color}15;color:${color};border:1px solid ${color}30;">
          <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>
          ${typeof label === 'string' && label.startsWith('T') ? label : sacLabels[level]}
        </span>`;
      diffEl.classList.remove('hidden');

      // Check reachability and show warning
      PeakflowData.checkSummitReachability(poi).then(reach => {
        const reachEl = document.getElementById('poiReachability') || (() => {
          const el = document.createElement('div');
          el.id = 'poiReachability';
          diffEl.parentNode.insertBefore(el, diffEl.nextSibling);
          return el;
        })();

        if (!reach.reachable) {
          reachEl.innerHTML = `
            <div style="margin:8px 0;padding:8px 12px;background:rgba(220,38,38,0.08);border-left:3px solid #dc2626;border-radius:4px;font-size:12px;color:#dc2626;line-height:1.4;">
              ⚠️ <strong>Nicht auf Wanderweg erreichbar!</strong><br>
              ${reach.warning || 'Kein begehbarer Weg zum Gipfel.'}
              ${reach.lastTrailPoint ? '<br>Route wird zum letzten Wegpunkt geführt.' : ''}
            </div>`;
          // Update button text
          const routeBtn = document.getElementById('routeToPoiBtn');
          if (routeBtn) {
            routeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;vertical-align:middle;">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>Route zum letzten Wegpunkt`;
            routeBtn.style.background = '#e67e22';
          }
          // Save reach info for route button
          this._currentPoiReach = reach;
        } else {
          reachEl.innerHTML = '';
          const routeBtn = document.getElementById('routeToPoiBtn');
          if (routeBtn) {
            routeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;vertical-align:middle;">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>Zur Route hinzufügen`;
            routeBtn.style.background = '';
          }
          this._currentPoiReach = null;
        }
      });
    } else {
      diffEl.classList.add('hidden');
      this._currentPoiReach = null;
    }

    // Hut info
    const hutInfoEl = document.getElementById('hutInfo');
    if (poi.type === 'hut') {
      hutInfoEl.classList.remove('hidden');
      document.getElementById('hutBeds').textContent = poi.beds || '-';
      document.getElementById('hutSeason').textContent =
        poi.open_from && poi.open_to ? `${poi.open_from} - ${poi.open_to}` : 'Ganzjährig';
      document.getElementById('hutPhone').textContent = poi.phone || '-';
      const websiteBtn = document.getElementById('hutWebsite');
      if (poi.website_url) {
        websiteBtn.href = poi.website_url;
        websiteBtn.classList.remove('hidden');
      } else {
        websiteBtn.classList.add('hidden');
      }
    } else {
      hutInfoEl.classList.add('hidden');
    }

    // Pass info
    const passInfoEl = document.getElementById('passInfo');
    if (poi.type === 'pass' && poi.connects_from && poi.connects_to) {
      passInfoEl.classList.remove('hidden');
      document.getElementById('passConnects').textContent =
        `Verbindet ${poi.connects_from} ↔ ${poi.connects_to}`;
    } else {
      passInfoEl.classList.add('hidden');
    }

    // Sunrise/Sunset
    const sunTimes = PeakflowUtils.calculateSunTimes(poi.lat, poi.lng);
    document.getElementById('poiSun').innerHTML = `
      <div class="sun-item">☀️ Aufgang: <strong>${sunTimes.sunrise}</strong></div>
      <div class="sun-item">🌅 Untergang: <strong>${sunTimes.sunset}</strong></div>
    `;

    // Show detail panel
    detail.classList.remove('hidden');

    // Load weather async
    const weatherEl = document.getElementById('poiWeather');
    weatherEl.innerHTML = '<h4>Aktuelles Wetter</h4><div class="weather-loading">Wetter wird geladen...</div>';

    const weather = await PeakflowWeather.getCurrentWeather(poi.lat, poi.lng);
    let weatherHTML = '<h4 style="font-size:14px;font-weight:700;margin-bottom:6px;">Aktuelles Wetter</h4>' + PeakflowWeather.renderWeatherHTML(weather);

    // Load forecast for today + tomorrow
    const forecast = await PeakflowWeather.getDetailedForecast(poi.lat, poi.lng);

    // Snow info
    if (forecast && forecast.snow_depth) {
      const currentHour = new Date().getHours();
      const snowDepth = Math.round((forecast.snow_depth[currentHour] || 0) * 100);
      const freezingLevel = Math.round(forecast.freezing_level_height[currentHour] || 0);
      if (snowDepth > 0 || freezingLevel < poi.elevation) {
        weatherHTML += `<div style="margin-top:8px;padding:8px 12px;background:rgba(147,197,253,0.15);border-radius:8px;font-size:12px;">
          \u2744\uFE0F Schneeh\u00f6he: <strong>${snowDepth}cm</strong> | Nullgradgrenze: <strong>${freezingLevel}m</strong>
        </div>`;
      }
    }

    // Tomorrow weather (always visible)
    if (forecast) {
      weatherHTML += PeakflowWeather.renderNextDayHTML(forecast);
    }

    // Buttons for stündlich / 7-day
    if (forecast) {
      weatherHTML += `<div style="display:flex;gap:8px;margin-top:10px;">
        <button id="btnHourlyForecast" style="flex:1;padding:8px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">\u23F1 St\u00fcndlich</button>
        <button id="btnWeeklyForecast" style="flex:1;padding:8px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">\uD83D\uDCC5 7 Tage</button>
      </div>`;
    }

    weatherEl.innerHTML = weatherHTML;

    // Attach popup handlers
    if (forecast) {
      document.getElementById('btnHourlyForecast')?.addEventListener('click', () => {
        this._showWeatherPopup('St\u00fcndliche Vorhersage', PeakflowWeather.renderForecastHTML(forecast));
      });
      document.getElementById('btnWeeklyForecast')?.addEventListener('click', async () => {
        const weekly = await PeakflowWeather.getWeeklyForecast(poi.lat, poi.lng);
        this._showWeatherPopup('7-Tage Vorhersage', weekly ? PeakflowWeather.renderWeeklyHTML(weekly) : '<p>Vorhersage nicht verf\u00fcgbar</p>');
      });
    }
  },

  /**
   * Populate sidebar lists
   */
  populateSidebar() {
    this.updateDiscoverList();
    this.loadSavedRoutes();
  },

  /**
   * Update Entdecken tab with top 10 peaks visible in current map viewport
   */
  updateDiscoverList() {
    if (!this.map) return;
    const bounds = this.map.getBounds();

    // Filter ALL known summits (initial + dynamically loaded) visible in viewport
    const allSummits = this.allPOIs.filter(p => p.type === 'summit');
    let visibleSummits = allSummits
      .filter(s => bounds.contains([s.lng, s.lat]))
      .sort((a, b) => b.elevation - a.elevation)
      .slice(0, 15); // Fetch more, then filter by reachability

    // If no visible summits in viewport, don't show random 4000ers - wait for viewport peaks
    if (visibleSummits.length === 0) {
      this.populatePOIList('summitList', [], 'summit');
      return;
    }

    // Filter huts & passes in viewport
    const visibleHuts = this.huts
      .filter(h => bounds.contains([h.lng, h.lat]))
      .sort((a, b) => b.elevation - a.elevation)
      .slice(0, 5);

    const visiblePasses = this.passes
      .filter(p => bounds.contains([p.lng, p.lat]))
      .sort((a, b) => b.elevation - a.elevation)
      .slice(0, 5);

    // Show summits immediately, then filter unreachable in background
    this.populatePOIList('summitList', visibleSummits.slice(0, 10), 'summit');
    this.populatePOIList('hutList', visibleHuts, 'hut');
    this.populatePOIList('passList', visiblePasses, 'pass');

    // Background: check reachability and filter out unreachable summits
    this._filterReachableSummits(visibleSummits);
  },

  async _filterReachableSummits(summits) {
    try {
      const reachable = [];
      const unreachable = [];

      for (const summit of summits.slice(0, 12)) {
        try {
          const reach = await PeakflowData.checkSummitReachability(summit);
          if (reach.reachable) {
            reachable.push(summit);
          } else {
            summit._unreachable = true;
            summit._reachWarning = reach.warning;
            unreachable.push(summit);
          }
        } catch (e) {
          // If reachability check fails, still show but mark as unchecked
          reachable.push(summit);
        }
        // Rate limit: wait 200ms between Overpass calls
        await new Promise(r => setTimeout(r, 200));
        if (reachable.length >= 10) break;
      }

      // Only show reachable summits - unreachable ones are dangerous to recommend!
      this.populatePOIList('summitList', reachable.slice(0, 10), 'summit');
    } catch (e) {
      console.warn('[Peakflow] Reachability filter failed:', e);
      // Fallback: show all summits without filtering
      this.populatePOIList('summitList', summits.slice(0, 10), 'summit');
    }
  },

  populatePOIList(containerId, items, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const iconMap = {
      summit: '<svg viewBox="0 0 24 24" width="32" height="32"><circle cx="12" cy="12" r="11.5" fill="#2a2a2a"/><path d="M12 5L5 18h14L12 5z" fill="#c9a84c"/><path d="M12 5L14.5 10H9.5L12 5z" fill="#fff"/></svg>',
      hut: '<svg viewBox="0 0 24 24" width="32" height="32"><circle cx="12" cy="12" r="11.5" fill="#2a2a2a"/><path d="M6 18V11l6-5 6 5v7H6z" fill="#c9a84c"/></svg>',
      pass: '<svg viewBox="0 0 24 24" width="32" height="32"><circle cx="12" cy="12" r="11.5" fill="#2a2a2a"/><path d="M4 16L8 9l4 4 4-4 4 7H4z" fill="#c9a84c"/></svg>'
    };

    if (items.length === 0) {
      container.innerHTML = '<p class="sidebar__empty" style="font-size:13px;color:#94a3b8;padding:8px 0;">Zoom näher ran um Gipfel zu sehen</p>';
      return;
    }

    container.innerHTML = items.map(item => {
      const isUnreachable = item._unreachable;
      const opacity = isUnreachable ? 'opacity:0.5;' : '';
      const warning = isUnreachable ? `<div style="font-size:10px;color:#dc2626;">⚠️ Kein Wanderweg</div>` : '';
      const meta = type === 'hut' ? (item.beds ? `${item.beds} Betten` : '') :
                   type === 'pass' && item.connects_from ? `${item.connects_from} ↔ ${item.connects_to}` : '';

      return `<div class="poi-item" data-id="${item.id}" data-type="${type}" style="${opacity}">
        <div class="poi-item__icon poi-item__icon--${type}">${iconMap[type]}</div>
        <div class="poi-item__info">
          <div class="poi-item__name">${item.name}</div>
          <div class="poi-item__meta">${meta}${warning}</div>
        </div>
        <div class="poi-item__elevation">${item.elevation}m</div>
      </div>`;
    }).join('');

    // Click handlers
    container.querySelectorAll('.poi-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.id);
        const poiType = el.dataset.type;
        const poi = this.allPOIs.find(p => p.id === id && p.type === poiType);
        if (poi) {
          this.showPOIPopup(poi);
          this.showPOIDetail(poi);
        }
      });
    });
  },

  /**
   * Load and display saved routes
   */
  async loadSavedRoutes() {
    const routes = await PeakflowData.getSavedRoutes();
    const container = document.getElementById('savedRoutesList');

    if (routes.length === 0) {
      container.innerHTML = '<p class="sidebar__empty">Noch keine Routen gespeichert.</p>';
      return;
    }

    container.innerHTML = routes.map(r => `
      <div class="saved-route" data-id="${r.id}">
        <div class="saved-route__actions">
          <button class="saved-route__edit" data-id="${r.id}" title="Bearbeiten">✏️</button>
          <button class="saved-route__delete" data-id="${r.id}" title="Löschen">✕</button>
        </div>
        <div class="saved-route__name">${r.name}</div>
        <div class="saved-route__meta">
          <span>${r.distance || '?'} km</span>
          <span>${r.duration || '?'}</span>
          <span>${r.ascent || '?'} m ↑</span>
        </div>
      </div>
    `).join('');

    // Click to view route
    container.querySelectorAll('.saved-route').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.saved-route__delete') || e.target.closest('.saved-route__edit')) return;
        const route = routes.find(r => r.id === el.dataset.id || r.id === parseInt(el.dataset.id));
        if (route && route.coords) {
          this.loadRoute(route);
        }
      });
    });

    // Edit buttons - load route into planner for modification
    container.querySelectorAll('.saved-route__edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const route = routes.find(r => r.id === btn.dataset.id || r.id === parseInt(btn.dataset.id));
        if (route && route.coords) {
          this.loadRoute(route, true); // edit mode
        }
      });
    });

    // Delete buttons
    container.querySelectorAll('.saved-route__delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Route wirklich löschen?')) return;
        await PeakflowData.deleteRoute(btn.dataset.id);
        this.loadSavedRoutes();
      });
    });
  },

  /**
   * Load a saved route onto the map
   */
  /**
   * Load a saved route for viewing OR editing
   */
  loadRoute(route, editMode = false) {
    PeakflowRoutes.clearRoute();

    if (route.coords) {
      PeakflowRoutes.routeCoords = route.coords;
      PeakflowRoutes.elevations = route.coords.map(c => c[2] || 0);
      PeakflowRoutes.drawRouteLine(route.coords);
      PeakflowRoutes.updateStats();
      // Show elevation panel FIRST (so canvas has dimensions), then draw
      document.getElementById('elevationProfile').classList.remove('hidden');
      // Small delay to let the browser layout the now-visible canvas
      setTimeout(() => PeakflowRoutes.drawElevationProfile(), 100);

      // Fit map to route
      const bounds = new maplibregl.LngLatBounds();
      route.coords.forEach(c => bounds.extend([c[0], c[1]]));
      this.map.fitBounds(bounds, { padding: 80 });

      // If edit mode: reconstruct waypoints from route endpoints
      if (editMode && route.waypoints) {
        PeakflowRoutes.isPlanning = true;
        if (this.map) this.map.getCanvas().style.cursor = 'crosshair';
        document.getElementById('routePlanBtn').classList.add('active');

        // Re-add waypoint markers
        route.waypoints.forEach(wp => {
          const waypoint = { lng: wp.lng || wp[0], lat: wp.lat || wp[1], index: PeakflowRoutes.waypoints.length };
          PeakflowRoutes.waypoints.push(waypoint);

          const el = document.createElement('div');
          el.innerHTML = `<span>${PeakflowRoutes.waypoints.length}</span>`;
          el.style.cssText = `
            width: 28px; height: 28px; background: var(--color-primary, #c9a84c);
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            color: white; font-size: 12px; font-weight: 700; border: 2px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3); cursor: grab; font-family: Inter, sans-serif;
          `;
          const marker = new maplibregl.Marker({ element: el, draggable: true })
            .setLngLat([waypoint.lng, waypoint.lat])
            .addTo(this.map);

          marker.on('dragend', () => {
            const pos = marker.getLngLat();
            PeakflowRoutes.waypoints[waypoint.index].lng = pos.lng;
            PeakflowRoutes.waypoints[waypoint.index].lat = pos.lat;
            PeakflowRoutes.updateRoute();
          });

          el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            PeakflowRoutes.removeWaypoint(waypoint.index);
          });

          PeakflowRoutes.markers.push(marker);
        });

        PeakflowRoutes.updateWaypointList();

        // Switch to routes tab
        document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-tab="routes"]').classList.add('active');
        document.getElementById('panel-routes').classList.add('active');
      }
    }
  },

  /**
   * Show a weather popup (hourly or weekly forecast)
   */
  _showWeatherPopup(title, contentHTML) {
    document.getElementById('weatherPopup')?.remove();
    document.getElementById('weatherPopupBackdrop')?.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'weatherPopupBackdrop';
    backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:999;';

    const popup = document.createElement('div');
    popup.id = 'weatherPopup';
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg-secondary,#242424);border:1px solid var(--border-color,#3a3632);border-radius:16px;padding:20px;z-index:1000;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.4);';
    popup.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#f0ece2);">${title}</h3>
        <button id="closeWeatherPopup" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:20px;">&times;</button>
      </div>
      <div>${contentHTML}</div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(popup);

    const close = () => { popup.remove(); backdrop.remove(); };
    document.getElementById('closeWeatherPopup').addEventListener('click', close);
    backdrop.addEventListener('click', close);
  },

  /**
   * Show a popup to pick from saved locations
   */
  _showLocationPicker(locations) {
    // Remove existing picker
    document.getElementById('locationPicker')?.remove();

    const picker = document.createElement('div');
    picker.id = 'locationPicker';
    picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg-secondary,#242424);border:1px solid var(--border-color,#3a3632);border-radius:12px;padding:16px;z-index:1000;min-width:260px;box-shadow:0 20px 60px rgba(0,0,0,0.4);';

    let html = '<div style="font-weight:700;font-size:15px;margin-bottom:12px;color:var(--text-primary,#f0ece2);">Standort w\u00e4hlen</div>';
    locations.forEach(function(loc, i) {
      var bg = i === 0 ? 'var(--color-primary,#c9a84c)' : 'var(--bg-tertiary,#2e2e2e)';
      var color = i === 0 ? '#fff' : 'var(--text-primary,#f0ece2)';
      var fw = i === 0 ? '700' : '500';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
        '<button class="loc-pick-btn" data-index="' + i + '" style="flex:1;padding:10px 14px;border:1px solid var(--border-color,#3a3632);border-radius:8px;background:' + bg + ';color:' + color + ';font-size:14px;font-weight:' + fw + ';cursor:pointer;text-align:left;font-family:inherit;">' + (loc.name || 'Standort ' + (i + 1)) + '</button>' +
        '<button class="loc-delete-btn" data-index="' + i + '" style="width:32px;height:38px;border:1px solid rgba(239,68,68,0.3);border-radius:8px;background:transparent;color:var(--color-danger,#ef4444);font-size:16px;cursor:pointer;" title="L\u00f6schen">&times;</button>' +
      '</div>';
    });
    html += '<button id="locPickerGps" style="display:block;width:100%;padding:10px 14px;margin-bottom:6px;border:1px dashed var(--border-color,#3a3632);border-radius:8px;background:transparent;color:var(--text-secondary,#a09a8c);font-size:13px;cursor:pointer;font-family:inherit;">📍 GPS-Standort verwenden</button>';
    html += '<button id="locPickerClose" style="display:block;width:100%;padding:8px;border:none;background:transparent;color:var(--text-tertiary,#6b6560);font-size:12px;cursor:pointer;font-family:inherit;">Abbrechen</button>';

    picker.innerHTML = html;
    document.body.appendChild(picker);

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'locationPickerBackdrop';
    backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:999;';
    document.body.appendChild(backdrop);

    const self = this;
    const closePicker = function() {
      picker.remove();
      backdrop.remove();
    };

    // Location buttons
    picker.querySelectorAll('.loc-pick-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const idx = parseInt(btn.dataset.index);
        const loc = locations[idx];
        self._userLocation = { lat: loc.lat, lng: loc.lng };
        localStorage.setItem('peakflow_location', JSON.stringify(self._userLocation));
        localStorage.setItem('peakflow_city', loc.name);
        self.map.flyTo({ center: [loc.lng, loc.lat], zoom: 13, duration: 1500 });
        closePicker();
      });
    });

    // Delete location buttons
    picker.querySelectorAll('.loc-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        if (confirm('Standort "' + (locations[idx].name || 'Standort') + '" l\u00f6schen?')) {
          locations.splice(idx, 1);
          self._settingsLocations = locations;
          // Save to Supabase
          if (PeakflowData.currentUser) {
            PeakflowData.updateProfile({ locations: locations });
          }
          closePicker();
          // Re-open with updated list if still locations left
          if (locations.length > 1) {
            self._showLocationPicker(locations);
          } else if (locations.length === 1) {
            // Only one left, use it directly
            var loc = locations[0];
            self._userLocation = { lat: loc.lat, lng: loc.lng };
            localStorage.setItem('peakflow_location', JSON.stringify(self._userLocation));
            localStorage.setItem('peakflow_city', loc.name);
            self.map.flyTo({ center: [loc.lng, loc.lat], zoom: 13, duration: 1500 });
          }
        }
      });
    });

    // GPS button
    document.getElementById('locPickerGps').addEventListener('click', function() {
      closePicker();
      self.locateUser();
    });

    // Close
    document.getElementById('locPickerClose').addEventListener('click', closePicker);
    backdrop.addEventListener('click', closePicker);
  },

  /**
   * Locate user via GPS and show on map
   */
  locateUser() {
    const btn = document.getElementById('locateBtn');
    btn.classList.add('active');

    // Use saved/IP location first (no GPS prompt on desktop)
    const loc = this._userLocation || this.getCachedLocation();

    if (loc) {
      if (this._gpsMarker) this._gpsMarker.remove();
      const el = document.createElement('div');
      el.className = 'gps-marker';
      el.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><circle cx="12" cy="12" r="11" fill="#c9a84c" stroke="white" stroke-width="2"/><path d="M12 6L6 12v6h4v-3h4v3h4v-6L12 6z" fill="white"/></svg>';
      el.style.cssText = 'width:28px;height:28px;cursor:pointer;';
      this._gpsMarker = new maplibregl.Marker({ element: el })
        .setLngLat([loc.lng, loc.lat])
        .addTo(this.map);
      this.map.flyTo({ center: [loc.lng, loc.lat], zoom: 14, duration: 1200 });
      btn.classList.remove('active');

      // Try GPS silently in background to improve accuracy (won't prompt if already denied)
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            localStorage.setItem('peakflow_last_location', JSON.stringify(gps));
            this._userLocation = gps;
            // Update marker to precise GPS
            if (this._gpsMarker) this._gpsMarker.setLngLat([gps.lng, gps.lat]);
          },
          () => { /* GPS denied/failed - keep IP/cached location */ },
          { enableHighAccuracy: true, timeout: 5000 }
        );
      }
    } else if (navigator.geolocation) {
      // No cached/IP location at all - must ask GPS
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          localStorage.setItem('peakflow_last_location', JSON.stringify({ lat, lng }));
          this._userLocation = { lat, lng };

          if (this._gpsMarker) this._gpsMarker.remove();
          const el = document.createElement('div');
          el.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><circle cx="12" cy="12" r="11" fill="#c9a84c" stroke="white" stroke-width="2"/><path d="M12 6L6 12v6h4v-3h4v3h4v-6L12 6z" fill="white"/></svg>';
          el.style.cssText = 'width:28px;height:28px;cursor:pointer;';
          this._gpsMarker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(this.map);
          this.map.flyTo({ center: [lng, lat], zoom: 14, duration: 1200 });
          btn.classList.remove('active');
        },
        () => {
          btn.classList.remove('active');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      btn.classList.remove('active');
    }
  },

  /**
   * Detect location by IP address (approximate, no permission needed)
   */
  async detectLocationByIP() {
    try {
      const resp = await fetch('http://ip-api.com/json/?fields=lat,lon,city,regionName,country');
      const data = await resp.json();
      if (data.lat && data.lon) {
        this._userLocation = { lat: data.lat, lng: data.lon };
        this._userCity = data.city || '';
        localStorage.setItem('peakflow_last_location', JSON.stringify(this._userLocation));
        localStorage.setItem('peakflow_city', data.city || '');
        console.log(`[Peakflow] IP location: ${data.city}, ${data.regionName} (${data.lat}, ${data.lon})`);
      }
    } catch (e) {
      console.warn('[Peakflow] IP geolocation failed', e);
    }
  },

  /**
   * Load logged-in user's home location from Supabase profile
   */
  async loadUserHomeLocation() {
    if (!PeakflowData.currentUser || !PeakflowData.authClient) return;
    try {
      const { data } = await PeakflowData.authClient
        .from('user_profiles')
        .select('home_lat, home_lng, home_name')
        .eq('user_id', PeakflowData.currentUser.id)
        .single();

      if (data && data.home_lat && data.home_lng) {
        this._userLocation = { lat: data.home_lat, lng: data.home_lng };
        localStorage.setItem('peakflow_last_location', JSON.stringify(this._userLocation));
        console.log(`[Peakflow] User home location: ${data.home_name || ''} (${data.home_lat}, ${data.home_lng})`);

        // Fly to home location
        this.map.flyTo({ center: [data.home_lng, data.home_lat], zoom: 12, duration: 1000 });
      }
    } catch (e) {
      // Table might not exist yet - that's fine
      console.log('[Peakflow] No user profile found (table may not exist yet)');
    }
  },

  /**
   * Get cached location from localStorage
   */
  getCachedLocation() {
    try {
      const cached = JSON.parse(localStorage.getItem('peakflow_last_location'));
      if (cached && cached.lat && cached.lng) return cached;
    } catch (e) { /* ignore */ }
    return null;
  },

  /**
   * Get user location (already set → cached → GPS only as last resort → null)
   */
  getUserLocation() {
    return new Promise((resolve) => {
      // 1. Already have a location (from search or previous GPS)
      if (this._userLocation) {
        resolve(this._userLocation);
        return;
      }
      // 2. Cached in localStorage
      const cached = this.getCachedLocation();
      if (cached) {
        this._userLocation = cached;
        resolve(cached);
        return;
      }
      // 3. Last resort: ask GPS (only if nothing else available)
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            localStorage.setItem('peakflow_last_location', JSON.stringify(loc));
            this._userLocation = loc;
            resolve(loc);
          },
          () => resolve(null),
          { timeout: 5000, enableHighAccuracy: true }
        );
      } else {
        resolve(this.getCachedLocation());
      }
    });
  },

  /**
   * Show a marker for cached (not live) location
   */
  _showCachedLocationMarker(loc) {
    if (this._gpsMarker) this._gpsMarker.remove();
    const el = document.createElement('div');
    el.className = 'gps-marker';
    el.style.opacity = '0.6'; // Dimmed to indicate it's not live
    this._gpsMarker = new maplibregl.Marker({ element: el })
      .setLngLat([loc.lng, loc.lat])
      .addTo(this.map);
  },

  /**
   * Setup all event listeners
   */
  setupEvents() {
    // Peaks toggle (on/off)
    document.getElementById('peaksToggleBtn').addEventListener('click', () => {
      this._peaksVisible = !this._peaksVisible;
      document.getElementById('peaksToggleBtn').classList.toggle('active', this._peaksVisible);
      this._poiMarkers.forEach(m => {
        if (this._peaksVisible) {
          this.updateMarkerVisibility(); // re-apply zoom-based rules
        } else {
          m.getElement().style.display = 'none';
        }
      });
    });

    // Zoom buttons
    document.getElementById('zoomInBtn').addEventListener('click', () => {
      this.map.zoomIn();
    });
    document.getElementById('zoomOutBtn').addEventListener('click', () => {
      this.map.zoomOut();
    });

    // Locate / GPS button - show location picker if multiple saved
    document.getElementById('locateBtn').addEventListener('click', () => {
      const locs = this._settingsLocations || [];
      if (locs.length > 1) {
        this._showLocationPicker(locs);
      } else {
        this.locateUser();
      }
    });

    // Dark mode toggle
    document.getElementById('darkModeToggle').addEventListener('click', () => {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    });

    // Emergency modal
    document.getElementById('emergencyBtn').addEventListener('click', () => {
      document.getElementById('emergencyModal').classList.remove('hidden');
    });
    document.getElementById('closeEmergencyModal').addEventListener('click', () => {
      document.getElementById('emergencyModal').classList.add('hidden');
    });
    document.querySelector('.modal__backdrop')?.addEventListener('click', () => {
      document.getElementById('emergencyModal').classList.add('hidden');
    });

    // Sidebar tabs - switch content WITHOUT closing sidebar on mobile
    const sidebar = document.querySelector('.sidebar');
    document.querySelectorAll('.sidebar__tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');

        // Mobile: always expand when tab clicked (don't close)
        if (window.innerWidth <= 768 && sidebar && !sidebar.classList.contains('expanded')) {
          sidebar.classList.add('expanded');
        }
      });
    });

    // Mobile toggle button (open/close)
    const mobileToggle = document.getElementById('mobileToggle');
    if (mobileToggle && sidebar) {
      mobileToggle.addEventListener('click', () => {
        if (sidebar.classList.contains('fully-expanded')) {
          sidebar.classList.remove('fully-expanded', 'expanded');
        } else if (sidebar.classList.contains('expanded')) {
          sidebar.classList.remove('expanded');
        } else {
          sidebar.classList.add('expanded');
        }
      });
    }

    // Mobile: swipe up/down
    if (sidebar) {
      let startY = 0;
      sidebar.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
      }, { passive: true });
      sidebar.addEventListener('touchend', (e) => {
        const dy = startY - e.changedTouches[0].clientY;
        if (dy > 50) {
          // Swipe up → expand
          if (sidebar.classList.contains('expanded')) {
            sidebar.classList.add('fully-expanded');
          } else {
            sidebar.classList.add('expanded');
          }
        } else if (dy < -50) {
          // Swipe down → collapse
          if (sidebar.classList.contains('fully-expanded')) {
            sidebar.classList.remove('fully-expanded');
          } else {
            sidebar.classList.remove('expanded');
          }
        }
      }, { passive: true });
    }

    // Close POI detail
    document.getElementById('closePoiDetail').addEventListener('click', () => {
      document.getElementById('poiDetail').classList.add('hidden');
    });

    // Route to POI button - add peak as waypoint to route
    document.getElementById('routeToPoiBtn').addEventListener('click', async () => {
      const poi = this._currentPoi;
      if (!poi) return;
      document.getElementById('poiDetail').classList.add('hidden');

      // Ensure planning mode is active
      if (!PeakflowRoutes.isPlanning) {
        PeakflowRoutes.togglePlanning();
      }

      // Switch to routes tab
      document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="routes"]').classList.add('active');
      document.getElementById('panel-routes').classList.add('active');

      // If no waypoints yet and we have a location, add location as start first
      if (PeakflowRoutes.waypoints.length === 0) {
        const loc = this._userLocation;
        if (loc) {
          PeakflowRoutes.addWaypoint({ lng: loc.lng, lat: loc.lat });
        }
      }

      // If unreachable summit, route to last trail point instead
      const reach = this._currentPoiReach;
      if (reach && !reach.reachable && reach.lastTrailPoint) {
        PeakflowRoutes.addWaypoint({
          lng: reach.lastTrailPoint[0],
          lat: reach.lastTrailPoint[1],
          name: `${poi.name} (letzter Wegpunkt)`
        });
      } else {
        PeakflowRoutes.addWaypoint({ lng: poi.lng, lat: poi.lat, name: poi.name });
      }
    });

    // Route planning button
    document.getElementById('routePlanBtn').addEventListener('click', () => {
      PeakflowRoutes.togglePlanning();
    });

    // Clear route
    document.getElementById('clearRouteBtn').addEventListener('click', () => {
      PeakflowRoutes.clearRoute();
    });

    // Save route - require login
    document.getElementById('saveRouteBtn').addEventListener('click', async () => {
      if (!PeakflowData.currentUser) {
        document.getElementById('authModal').classList.remove('hidden');
        return;
      }
      const name = prompt('Route benennen:', `Route ${new Date().toLocaleDateString('de-DE')}`);
      if (!name) return;

      const distance = PeakflowUtils.routeDistance(PeakflowRoutes.routeCoords);
      const { ascent } = PeakflowUtils.calculateElevationGain(PeakflowRoutes.elevations);
      const time = PeakflowUtils.calculateTime(distance, ascent, 0);

      await PeakflowData.saveRoute({
        name,
        coords: PeakflowRoutes.routeCoords,
        waypoints: PeakflowRoutes.waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng })),
        distance: distance.toFixed(1),
        ascent: ascent,
        duration: PeakflowUtils.formatDuration(time.hours, time.minutes),
        created_at: new Date().toISOString()
      });

      // Reload saved routes list (await to ensure data is loaded before tab switch)
      await PeakflowApp.loadSavedRoutes();

      // Switch to Gespeichert tab
      document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
      const savedTab = document.querySelector('.sidebar__tab[data-tab="saved"]');
      const savedPanel = document.getElementById('panel-saved');
      if (savedTab) savedTab.classList.add('active');
      if (savedPanel) savedPanel.classList.add('active');
    });

    // Finish route planning - switch back to Entdecken
    document.getElementById('finishRouteBtn').addEventListener('click', () => {
      if (PeakflowRoutes.isPlanning) {
        PeakflowRoutes.togglePlanning();
      }
      // Switch to Entdecken tab
      document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
      document.querySelector('.sidebar__tab[data-tab="discover"]').classList.add('active');
      document.getElementById('panel-discover').classList.add('active');
    });

    // GPX Export - requires login
    document.getElementById('exportGpxBtn').addEventListener('click', () => {
      if (!PeakflowData.currentUser) {
        alert('Bitte melde dich kostenlos an um GPX-Daten zu exportieren.');
        document.getElementById('authModal').classList.remove('hidden');
        return;
      }
      const routeData = PeakflowRoutes.getRouteData('Peakflow Route');
      PeakflowExport.downloadGPX(routeData);
    });

    // Share to watch - requires login
    document.getElementById('shareWatchBtn').addEventListener('click', async () => {
      if (!PeakflowData.currentUser) {
        alert('Bitte melde dich kostenlos an um die Route an deine Uhr zu senden.');
        document.getElementById('authModal').classList.remove('hidden');
        return;
      }
      const routeData = PeakflowRoutes.getRouteData('Peakflow Route');
      const result = await PeakflowExport.shareToWatch(routeData);
      if (result.method === 'download') {
        alert('GPX-Datei heruntergeladen. Öffne sie mit deiner Garmin Connect, Suunto oder Polar App um sie auf die Uhr zu übertragen.');
      }
    });

    // ============================================
    // AUTH HANDLERS
    // ============================================
    let isLoginMode = true;

    // Open auth modal OR settings (if logged in)
    document.getElementById('loginBtn').addEventListener('click', () => {
      if (PeakflowData.currentUser) {
        this.openSettings();
      } else {
        document.getElementById('authModal').classList.remove('hidden');
      }
    });

    // Close auth modal
    document.getElementById('closeAuthModal').addEventListener('click', () => {
      document.getElementById('authModal').classList.add('hidden');
    });
    document.querySelector('.auth-modal__backdrop').addEventListener('click', () => {
      document.getElementById('authModal').classList.add('hidden');
    });

    // Switch between login/register
    document.getElementById('authSwitchBtn').addEventListener('click', () => {
      isLoginMode = !isLoginMode;
      document.getElementById('authTitle').textContent = isLoginMode ? 'Anmelden' : 'Registrieren';
      document.getElementById('authSubmit').textContent = isLoginMode ? 'Anmelden' : 'Konto erstellen';
      document.getElementById('authSwitchText').textContent = isLoginMode ? 'Noch kein Konto?' : 'Bereits registriert?';
      document.getElementById('authSwitchBtn').textContent = isLoginMode ? 'Registrieren' : 'Anmelden';
      document.getElementById('authError').classList.add('hidden');
    });

    // Auth form submit
    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('authEmail').value;
      const password = document.getElementById('authPassword').value;
      const errorEl = document.getElementById('authError');
      const submitBtn = document.getElementById('authSubmit');

      submitBtn.disabled = true;
      submitBtn.textContent = 'Bitte warten...';
      errorEl.classList.add('hidden');

      let result;
      if (isLoginMode) {
        result = await PeakflowData.signIn(email, password);
      } else {
        result = await PeakflowData.signUp(email, password);
      }

      submitBtn.disabled = false;
      submitBtn.textContent = isLoginMode ? 'Anmelden' : 'Konto erstellen';

      if (result.error) {
        errorEl.textContent = result.error.message;
        errorEl.classList.remove('hidden');
      } else {
        document.getElementById('authModal').classList.add('hidden');
        document.getElementById('authForm').reset();
        PeakflowApp.loadSavedRoutes(); // Reload routes for logged-in user

        if (!isLoginMode) {
          // Registration: create profile and show onboarding settings
          await PeakflowData.createProfile();
          Peakflow.openSettings(true); // true = onboarding mode
        } else {
          // Login: load and apply saved profile
          await Peakflow.loadAndApplyProfile();
        }
      }
    });

    // User menu button → open settings directly
    document.getElementById('userMenuBtn')?.addEventListener('click', () => {
      this.openSettings();
    });

    // Layer switcher
    document.getElementById('layerBtn').addEventListener('click', () => {
      document.getElementById('layerPicker').classList.toggle('hidden');
    });

    document.querySelectorAll('.layer-picker__option').forEach(opt => {
      opt.addEventListener('click', () => {
        const style = opt.dataset.style;
        this.switchMapStyle(style);
        document.querySelectorAll('.layer-picker__option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        document.getElementById('layerPicker').classList.add('hidden');
      });
    });

    // Terrain toggle
    document.getElementById('terrainToggleBtn').addEventListener('click', () => {
      this.toggleTerrain();
    });

    // Fit route to view
    document.getElementById('fitRouteBtn')?.addEventListener('click', () => {
      const coords = PeakflowRoutes.routeCoords;
      if (!coords || coords.length < 2) return;
      const bounds = new maplibregl.LngLatBounds();
      for (const c of coords) {
        bounds.extend([c[0], c[1]]);
      }
      this.map.fitBounds(bounds, { padding: 60, duration: 1000 });
    });

    // Close elevation profile
    document.getElementById('closeElevation').addEventListener('click', () => {
      document.getElementById('elevationProfile').classList.add('hidden');
    });

    // Profile selector (5 levels)
    const profileSelect = document.getElementById('profileSelect');
    if (profileSelect) {
      profileSelect.addEventListener('change', () => {
        PeakflowUtils.currentProfile = profileSelect.value;
        // Recalculate stats if route exists
        if (PeakflowRoutes.waypoints.length >= 2) {
          PeakflowRoutes.updateStats();
        }
      });
    }

    // Walkthrough controls
    document.getElementById('walkthroughBtn').addEventListener('click', () => {
      PeakflowWalkthrough.start(
        PeakflowRoutes.routeCoords,
        PeakflowRoutes.elevations,
        this.allPOIs
      );
    });

    document.getElementById('wtPlayPause').addEventListener('click', () => {
      PeakflowWalkthrough.togglePlayPause();
    });

    document.getElementById('wtClose').addEventListener('click', () => {
      PeakflowWalkthrough.stop();
    });

    document.getElementById('wtNext').addEventListener('click', () => {
      PeakflowWalkthrough.nextPOI();
    });

    document.getElementById('wtPrev').addEventListener('click', () => {
      PeakflowWalkthrough.prevPOI();
    });

    document.getElementById('wtProgress').addEventListener('input', (e) => {
      PeakflowWalkthrough.seekTo(parseInt(e.target.value));
    });

    document.getElementById('wtSpeed').addEventListener('change', (e) => {
      PeakflowWalkthrough.setSpeed(e.target.value);
    });

    // Search with debounce + dropdown
    let searchTimeout = null;
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => this.showSearchResults(e.target.value), 400);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(searchTimeout);
        this.showSearchResults(searchInput.value);
      }
      if (e.key === 'Escape') {
        this.hideSearchDropdown();
      }
    });
    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.header__search')) {
        this.hideSearchDropdown();
      }
    });

    // Click outside layer picker to close
    document.addEventListener('click', (e) => {
      const picker = document.getElementById('layerPicker');
      const btn = document.getElementById('layerBtn');
      if (!picker.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        picker.classList.add('hidden');
      }
    });

    // Settings modal events
    this.initSettingsEvents();
  },

  /**
   * Switch map tile style
   */
  switchMapStyle(styleName) {
    if (!this.STYLES[styleName]) return;
    this.currentStyle = styleName;

    // We need to preserve markers and layers
    // MapLibre doesn't support hot-swapping styles well, so we reconstruct
    this.map.setStyle(this.STYLES[styleName]);

    this.map.once('style.load', () => {
      if (this.terrainEnabled) this.enableTerrain();

      // Re-add route if exists - force re-add by clearing source reference first
      if (PeakflowRoutes.routeCoords && PeakflowRoutes.routeCoords.length > 0) {
        // Style change destroys all sources/layers, so drawRouteLine will re-create them
        PeakflowRoutes.drawRouteLine(PeakflowRoutes.routeCoords);
      }

      // Re-add POI markers
      if (typeof this.addPOIMarkers === 'function') {
        this.addPOIMarkers();
      }
    });
  },

  /**
   * Handle search - first check local POIs, then Nominatim for places
   */
  /**
   * Show search dropdown with results
   */
  async showSearchResults(query) {
    if (!query || query.length < 2) {
      this.hideSearchDropdown();
      return;
    }

    const q = query.toLowerCase();
    const results = [];

    // 1. Local POI results
    const localResults = this.allPOIs
      .filter(poi => poi.name.toLowerCase().includes(q))
      .slice(0, 5);

    localResults.forEach(poi => {
      const icons = { summit: '⛰️', hut: '🏠', pass: '🔀' };
      results.push({
        type: 'poi',
        icon: icons[poi.type] || '📍',
        name: poi.name,
        detail: `${poi.elevation}m`,
        data: poi
      });
    });

    // 2. Nominatim results (if query long enough)
    if (query.length >= 3) {
      try {
        const params = new URLSearchParams({
          q: query, format: 'json', limit: 5, addressdetails: 1,
          viewbox: '5.8,47.8,17.2,46.3', bounded: 0
        });
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
          headers: { 'Accept-Language': 'de' }
        });
        const places = await resp.json();

        places.forEach(place => {
          // Skip administrative/boundary results
          if (['administrative', 'boundary', 'political'].includes(place.type)) return;
          if (place.class === 'boundary') return;
          // Skip if already in local results
          if (results.some(r => r.name === place.display_name.split(',')[0])) return;
          results.push({
            type: 'place',
            icon: '📍',
            name: place.display_name.split(',').slice(0, 2).join(', '),
            detail: place.type === 'village' ? 'Ort' : place.type === 'town' ? 'Stadt' : place.type === 'peak' ? 'Gipfel' : place.type || '',
            data: { lat: parseFloat(place.lat), lng: parseFloat(place.lon), placeType: place.type }
          });
        });
      } catch (e) { /* ignore */ }
    }

    // Render dropdown
    this.renderSearchDropdown(results);
  },

  renderSearchDropdown(results) {
    let dropdown = document.getElementById('searchDropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'searchDropdown';
      dropdown.style.cssText = `
        position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px;
        background: var(--bg-card, white); border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.15); max-height: 300px;
        overflow-y: auto; z-index: 1000;
      `;
      document.querySelector('.header__search').style.position = 'relative';
      document.querySelector('.header__search').appendChild(dropdown);
    }

    if (results.length === 0) {
      dropdown.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:#94a3b8;">Keine Ergebnisse</div>';
      dropdown.classList.remove('hidden');
      return;
    }

    dropdown.innerHTML = results.map((r, i) => `
      <div class="search-result" data-index="${i}" style="
        display: flex; align-items: center; gap: 10px; padding: 10px 16px;
        cursor: pointer; transition: background 0.15s;
        ${i > 0 ? 'border-top: 1px solid rgba(0,0,0,0.06);' : ''}
      " onmouseover="this.style.background='rgba(0,0,0,0.04)'" onmouseout="this.style.background='transparent'">
        <span style="font-size:16px;">${r.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.name}</div>
          <div style="font-size:11px;color:var(--text-secondary);">${r.detail}</div>
        </div>
      </div>
    `).join('');
    dropdown.classList.remove('hidden');

    // Click handlers
    dropdown.querySelectorAll('.search-result').forEach((el, i) => {
      el.addEventListener('click', () => {
        this.selectSearchResult(results[i]);
        this.hideSearchDropdown();
        document.getElementById('searchInput').value = results[i].name;
      });
    });
  },

  selectSearchResult(result) {
    let lat, lng;

    if (result.type === 'poi') {
      const poi = result.data;
      lat = poi.lat;
      lng = poi.lng;
      this.map.flyTo({ center: [lng, lat], zoom: 13, duration: 1000 });
      this.showPOIPopup(poi);
      this.showPOIDetail(poi);
    } else {
      lat = result.data.lat;
      lng = result.data.lng;
      const placeType = result.data.placeType;
      const zoom = placeType === 'city' || placeType === 'town' ? 12 :
                   placeType === 'village' ? 14 : 13;

      if (this._searchMarker) this._searchMarker.remove();

      const el = document.createElement('div');
      el.style.cssText = `
        width: 24px; height: 24px; background: #8b5cf6; border: 3px solid white;
        border-radius: 50%; box-shadow: 0 2px 8px rgba(139,92,246,0.4);
      `;
      this._searchMarker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(this.map);

      this.map.flyTo({ center: [lng, lat], zoom, duration: 1200 });
    }

    // Save selected location as user's current position (startpoint for routes)
    this._userLocation = { lat, lng };
    localStorage.setItem('peakflow_last_location', JSON.stringify({ lat, lng }));

    // If no route planned yet, auto-set this as startpoint
    if (result.type !== 'poi' && PeakflowRoutes.waypoints.length === 0) {
      // Ensure planning mode
      if (!PeakflowRoutes.isPlanning) PeakflowRoutes.togglePlanning();

      // Switch to routes tab
      document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="routes"]')?.classList.add('active');
      document.getElementById('panel-routes')?.classList.add('active');

      // Add as startpoint
      PeakflowRoutes.addWaypoint({ lng, lat, name: result.name });

      // Remove search marker (waypoint marker replaces it)
      if (this._searchMarker) {
        this._searchMarker.remove();
        this._searchMarker = null;
      }
    }
  },

  hideSearchDropdown() {
    const dropdown = document.getElementById('searchDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  },

  // ============================================
  // SETTINGS MODAL
  // ============================================

  _settingsProfile: null, // cached profile data

  /**
   * Open settings modal, optionally in onboarding mode
   */
  async openSettings(onboarding) {
    const modal = document.getElementById('settingsModal');
    const welcome = document.getElementById('settingsWelcome');

    if (onboarding) {
      welcome.classList.remove('hidden');
    } else {
      welcome.classList.add('hidden');
    }

    // Load profile from Supabase
    let profile = await PeakflowData.getProfile();
    if (!profile && PeakflowData.currentUser) {
      // No profile yet, create one
      const result = await PeakflowData.createProfile();
      profile = result.data;
    }
    this._settingsProfile = profile;

    // Populate fields
    if (profile) {
      document.getElementById('settingsName').value = profile.display_name || '';
      document.getElementById('settingsProfile').value = profile.activity_profile || 'hiker';
      document.getElementById('settingsMapStyle').value = profile.map_style || 'topo';
      document.getElementById('settingsShowPeaks').checked = profile.show_peaks !== false;
      document.getElementById('settingsShowElevation').checked = profile.show_elevation !== false;
      document.getElementById('settingsWatch').value = profile.watch_brand || 'none';

      // Avatar picker
      document.querySelectorAll('.avatar-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.avatar === (profile.avatar || 'hiker'));
      });

      // Color picker
      document.querySelectorAll('.color-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.color === (profile.route_color || '#39ff14'));
      });

      // Locations
      this.renderSettingsLocations(profile.locations || []);
    } else {
      // Defaults for new user
      document.getElementById('settingsName').value = PeakflowData.currentUser ? PeakflowData.currentUser.email.split('@')[0] : '';
      document.getElementById('settingsProfile').value = 'hiker';
      document.getElementById('settingsMapStyle').value = 'topo';
      document.getElementById('settingsShowPeaks').checked = true;
      document.getElementById('settingsWatch').value = 'none';
      document.querySelectorAll('.avatar-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.avatar === 'hiker');
      });
      document.querySelectorAll('.color-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.color === '#39ff14');
      });
      this.renderSettingsLocations([]);
    }

    // Clear password field
    document.getElementById('settingsNewPassword').value = '';

    modal.classList.remove('hidden');
  },

  /**
   * Render saved locations list with delete buttons
   */
  renderSettingsLocations(locations) {
    const container = document.getElementById('settingsLocations');
    if (!locations || locations.length === 0) {
      container.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);padding:4px 0;">Noch keine Standorte gespeichert.</div>';
      this._settingsLocations = [];
      return;
    }
    container.innerHTML = locations.map(function(loc, i) {
      var isActive = (i === 0);
      var bg = isActive ? 'var(--color-primary)' : 'var(--bg-secondary)';
      var color = isActive ? '#fff' : 'var(--text-primary)';
      var badge = isActive ? '<span style="font-size:9px;background:rgba(255,255,255,0.25);padding:1px 6px;border-radius:4px;margin-left:6px;">AKTIV</span>' : '';
      var arrows = '';
      if (i > 0) arrows += '<button class="loc-move-btn" data-index="' + i + '" data-dir="up" style="background:none;border:none;cursor:pointer;font-size:12px;color:' + color + ';padding:2px;" title="Nach oben">&#9650;</button>';
      if (i < locations.length - 1) arrows += '<button class="loc-move-btn" data-index="' + i + '" data-dir="down" style="background:none;border:none;cursor:pointer;font-size:12px;color:' + color + ';padding:2px;" title="Nach unten">&#9660;</button>';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:' + bg + ';color:' + color + ';border-radius:6px;margin-bottom:4px;">' +
        '<span style="font-size:13px;font-weight:' + (isActive ? '700' : '400') + ';">' + (loc.name || ('Standort ' + (i + 1))) + badge + '</span>' +
        '<span style="display:flex;align-items:center;gap:2px;">' + arrows +
        '<button class="delete-location-btn" data-index="' + i + '" style="background:none;border:none;cursor:pointer;font-size:14px;color:' + color + ';opacity:0.7;">&#10005;</button>' +
        '</span></div>';
    }).join('');

    // Delete buttons
    container.querySelectorAll('.delete-location-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.index);
        locations.splice(idx, 1);
        Peakflow.renderSettingsLocations(locations);
        Peakflow._settingsLocations = locations;
      });
    });
    // Move buttons (reorder)
    container.querySelectorAll('.loc-move-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.index);
        var dir = btn.dataset.dir;
        if (dir === 'up' && idx > 0) {
          var tmp = locations[idx - 1];
          locations[idx - 1] = locations[idx];
          locations[idx] = tmp;
        } else if (dir === 'down' && idx < locations.length - 1) {
          var tmp = locations[idx + 1];
          locations[idx + 1] = locations[idx];
          locations[idx] = tmp;
        }
        Peakflow.renderSettingsLocations(locations);
        Peakflow._settingsLocations = locations;
      });
    });
    this._settingsLocations = locations;
  },

  /**
   * Initialize settings modal event listeners (called once from setupEvents)
   */
  initSettingsEvents() {
    var self = this;

    // Close settings
    document.getElementById('closeSettings').addEventListener('click', function() {
      document.getElementById('settingsModal').classList.add('hidden');
    });

    // Avatar picker
    document.querySelectorAll('.avatar-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.avatar-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    // Color picker
    document.querySelectorAll('.color-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.color-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    // Location search field
    var locSearchInput = document.getElementById('locationSearchInput');
    var locSearchResults = document.getElementById('locationSearchResults');
    var locSearchTimeout = null;

    locSearchInput.addEventListener('input', function() {
      clearTimeout(locSearchTimeout);
      var q = locSearchInput.value.trim();
      if (q.length < 2) { locSearchResults.classList.add('hidden'); return; }
      locSearchTimeout = setTimeout(async function() {
        try {
          var resp = await fetch('https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(q) + '&format=json&limit=5&addressdetails=1&viewbox=5.5,45.5,17.5,48.5&bounded=0');
          var results = await resp.json();
          if (results.length === 0) {
            locSearchResults.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:var(--text-tertiary);">Kein Ergebnis</div>';
          } else {
            locSearchResults.innerHTML = results.map(function(r) {
              return '<div class="loc-search-item" data-lat="' + r.lat + '" data-lng="' + r.lon + '" data-name="' + (r.display_name.split(',')[0]) + '" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border-color);">' +
                '<div style="font-weight:600;">' + r.display_name.split(',')[0] + '</div>' +
                '<div style="font-size:11px;color:var(--text-tertiary);">' + r.display_name.split(',').slice(1, 3).join(',') + '</div>' +
              '</div>';
            }).join('');

            locSearchResults.querySelectorAll('.loc-search-item').forEach(function(item) {
              item.addEventListener('click', function() {
                var locations = self._settingsLocations || [];
                if (locations.length >= 5) {
                  alert('Maximal 5 Standorte. Lösche zuerst einen.');
                  return;
                }
                locations.push({
                  name: item.dataset.name,
                  lat: parseFloat(item.dataset.lat),
                  lng: parseFloat(item.dataset.lng)
                });
                self.renderSettingsLocations(locations);
                locSearchInput.value = '';
                locSearchResults.classList.add('hidden');
              });
              item.addEventListener('mouseover', function() { item.style.background = 'var(--bg-tertiary)'; });
              item.addEventListener('mouseout', function() { item.style.background = ''; });
            });
          }
          locSearchResults.classList.remove('hidden');
        } catch(e) { console.warn('Location search failed:', e); }
      }, 400);
    });

    // Close dropdown on outside click
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#locationSearchInput') && !e.target.closest('#locationSearchResults')) {
        locSearchResults.classList.add('hidden');
      }
    });

    // Change password
    document.getElementById('changePasswordBtn').addEventListener('click', async function() {
      var newPw = document.getElementById('settingsNewPassword').value;
      if (!newPw || newPw.length < 6) {
        alert('Passwort muss mindestens 6 Zeichen lang sein.');
        return;
      }
      if (!PeakflowData.authClient) return;
      try {
        var result = await PeakflowData.authClient.auth.updateUser({ password: newPw });
        if (result.error) {
          alert('Fehler: ' + result.error.message);
        } else {
          alert('Passwort erfolgreich geändert!');
          document.getElementById('settingsNewPassword').value = '';
        }
      } catch (e) {
        alert('Fehler beim Passwort ändern: ' + e.message);
      }
    });

    // Save settings
    document.getElementById('saveSettingsBtn').addEventListener('click', async function() {
      var activeAvatar = document.querySelector('.avatar-btn.active');
      var activeColor = document.querySelector('.color-btn.active');

      var updates = {
        display_name: document.getElementById('settingsName').value || 'Wanderer',
        avatar: activeAvatar ? activeAvatar.dataset.avatar : 'hiker',
        activity_profile: document.getElementById('settingsProfile').value,
        route_color: activeColor ? activeColor.dataset.color : '#39ff14',
        map_style: document.getElementById('settingsMapStyle').value,
        show_peaks: document.getElementById('settingsShowPeaks').checked,
        show_elevation: document.getElementById('settingsShowElevation').checked,
        locations: self._settingsLocations || [],
        watch_brand: document.getElementById('settingsWatch').value
      };

      var result = await PeakflowData.updateProfile(updates);
      if (result.error) {
        alert('Fehler beim Speichern: ' + result.error.message);
        return;
      }

      // Apply settings immediately
      self.applyProfileSettings(updates);

      // Set top location as active start point
      var locs = updates.locations || [];
      if (locs.length > 0) {
        var topLoc = locs[0];
        self._userLocation = { lat: topLoc.lat, lng: topLoc.lng };
        localStorage.setItem('peakflow_location', JSON.stringify(self._userLocation));
        localStorage.setItem('peakflow_city', topLoc.name);
        // Fly to the active location
        if (self.map) {
          self.map.flyTo({ center: [topLoc.lng, topLoc.lat], zoom: 13, duration: 1500 });
        }
      }

      document.getElementById('settingsModal').classList.add('hidden');
      document.getElementById('settingsWelcome').classList.add('hidden');
    });

    // Logout button in settings
    document.getElementById('logoutBtn').addEventListener('click', async function() {
      document.getElementById('settingsModal').classList.add('hidden');
      await PeakflowData.signOut();
      self.loadSavedRoutes();
    });
  },

  /**
   * Apply profile settings to the UI
   */
  applyProfileSettings(profile) {
    if (!profile) return;

    // Activity profile
    if (profile.activity_profile) {
      PeakflowUtils.currentProfile = profile.activity_profile;
      var profileSelect = document.getElementById('profileSelect');
      if (profileSelect) profileSelect.value = profile.activity_profile;
      // Recalculate stats if route exists
      if (PeakflowRoutes.waypoints.length >= 2) {
        PeakflowRoutes.updateStats();
      }
    }

    // Route color - set globally so all future routes use this color
    if (profile.route_color) {
      PeakflowRoutes.routeColor = profile.route_color;
      document.documentElement.style.setProperty('--route-color', profile.route_color);
      // Update existing route line if visible
      if (PeakflowRoutes.routeCoords && PeakflowRoutes.routeCoords.length > 0 && this.map) {
        try {
          if (this.map.getLayer('route-line')) {
            this.map.setPaintProperty('route-line', 'line-color', profile.route_color);
          }
        } catch (e) { /* layer may not exist */ }
      }
    }

    // Map style
    if (profile.map_style && profile.map_style !== this.currentStyle) {
      this.switchMapStyle(profile.map_style);
      // Update layer picker active state
      document.querySelectorAll('.layer-picker__option').forEach(function(opt) {
        opt.classList.toggle('active', opt.dataset.style === profile.map_style);
      });
    }

    // Peaks visibility
    if (typeof profile.show_peaks === 'boolean') {
      this._peaksVisible = profile.show_peaks;
      document.getElementById('peaksToggleBtn').classList.toggle('active', profile.show_peaks);
      this._poiMarkers.forEach(function(m) {
        if (!profile.show_peaks) {
          m.getElement().style.display = 'none';
        }
      });
      if (profile.show_peaks) {
        this.updateMarkerVisibility();
      }
    }

    // Elevation profile visibility
    if (typeof profile.show_elevation === 'boolean') {
      this._showElevation = profile.show_elevation;
      var elevEl = document.getElementById('elevationProfile');
      if (elevEl) {
        if (!profile.show_elevation) {
          elevEl.style.display = 'none';
        } else {
          elevEl.style.display = '';
          elevEl.style.opacity = '0.7'; // halbtransparent
        }
      }
      var settingsEl = document.getElementById('settingsShowElevation');
      if (settingsEl) settingsEl.checked = profile.show_elevation;
    }

    // Update user display name in header (userMenu, NOT loginBtn)
    if (PeakflowData.currentUser) {
      var userName = document.getElementById('userName');
      if (userName) {
        userName.textContent = profile.display_name || PeakflowData.currentUser.email.split('@')[0] || 'Angemeldet';
      }
      // Ensure correct visibility: loginBtn hidden, userMenu visible
      var loginBtn = document.getElementById('loginBtn');
      var userMenu = document.getElementById('userMenu');
      if (loginBtn) loginBtn.classList.add('hidden');
      if (userMenu) userMenu.classList.remove('hidden');
    }

    // Save locations list and set top one as active start point
    if (profile.locations && profile.locations.length > 0) {
      this._settingsLocations = profile.locations;
      var topLoc = profile.locations[0];
      this._userLocation = { lat: topLoc.lat, lng: topLoc.lng };
      localStorage.setItem('peakflow_location', JSON.stringify(this._userLocation));
      localStorage.setItem('peakflow_city', topLoc.name);
    }
  },

  /**
   * Load profile from Supabase and apply all settings
   */
  async loadAndApplyProfile() {
    if (!PeakflowData.currentUser) return;

    var profile = await PeakflowData.getProfile();
    if (!profile) {
      // Try creating one
      var result = await PeakflowData.createProfile();
      profile = result.data;
    }

    if (profile) {
      this.applyProfileSettings(profile);
    } else if (PeakflowData.currentUser) {
      // No profile yet, just show email in userMenu
      var userName = document.getElementById('userName');
      if (userName) userName.textContent = PeakflowData.currentUser.email.split('@')[0] || 'Angemeldet';
      var loginBtn2 = document.getElementById('loginBtn');
      var userMenu2 = document.getElementById('userMenu');
      if (loginBtn2) loginBtn2.classList.add('hidden');
      if (userMenu2) userMenu2.classList.remove('hidden');
    }
  }
};

// Alias for backward compatibility (routes.js uses PeakflowApp)
const PeakflowApp = Peakflow;

// ============================================
// BOOT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  Peakflow.init();
});
