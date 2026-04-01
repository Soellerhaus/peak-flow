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
          maxzoom: 17,
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
  _waterVisible: true,

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

    // Show start picker with saved locations on initial load
    PeakflowRoutes._showStartPointPicker();

    // Ensure sidebar has content on first load
    this.map.once('idle', () => {
      this.updateDiscoverList();
      this.loadViewportPeaks();
      this.loadViewportHutsAndPasses();
    });

    console.log('[Peakflow] Ready!');

    // Auto-activate planning mode on start with first saved location as start point
    setTimeout(() => {
      if (!PeakflowRoutes.isPlanning) {
        PeakflowRoutes.isPlanning = true;
        const btn = document.getElementById('routePlanBtn');
        if (btn) btn.classList.add('active');
        if (this.map) this.map.getCanvas().style.cursor = 'crosshair';
        // Switch to routes tab
        document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
        const routeTab = document.querySelector('[data-tab="routes"]');
        if (routeTab) routeTab.classList.add('active');
        const routePanel = document.getElementById('panel-routes');
        if (routePanel) routePanel.classList.add('active');
        // Auto-set first saved location as start point
        const locs = this._settingsLocations || [];
        if (locs.length > 0) {
          PeakflowRoutes.addWaypoint({ lng: locs[0].lng, lat: locs[0].lat, name: locs[0].name });
        } else {
          PeakflowRoutes._showStartPointPicker();
        }
      }
    }, 500);
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

    // Navigation controls removed - using custom toolbar buttons instead

    // Scale
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    // Pass map reference immediately
    PeakflowRoutes.init(this.map);
    PeakflowRoutes.enableRouteDrag();
    PeakflowRouteFinder.init(this.map);
    PeakflowNavigation.init(this.map);
    PeakflowWalkthrough.init(this.map);

    // When map loads
    this.map.on('load', () => {
      // Terrain is loaded on-demand via the 3D button (to avoid slow tile loading)

      // Map click for route planning
      this.map.on('click', (e) => {
        // Skip if route-line click already handled this (prevents double waypoint)
        if (PeakflowRoutes._skipNextMapClick) {
          PeakflowRoutes._skipNextMapClick = false;
          return;
        }
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
      this.loadViewportHutsAndPasses();
    });
    this.map.on('moveend', () => {
      this.updateMarkerVisibility();
      this.loadViewportPeaks();
      this.loadViewportHutsAndPasses();
      this.updateDiscoverList();
      // Refresh POI markers for active categories (debounced)
      clearTimeout(this._poiRefreshTimer);
      this._poiRefreshTimer = setTimeout(() => this._refreshPOIMarkers(), 500);
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
   * Dynamically load huts and passes for current viewport from Supabase
   */
  async loadViewportHutsAndPasses() {
    if (!PeakflowData.isConnected || this._loadingHutsPasses) return;
    const zoom = this.map.getZoom();
    if (zoom < 10) return;

    const bounds = this.map.getBounds();
    const key = `${bounds._sw.lat.toFixed(2)},${bounds._sw.lng.toFixed(2)},${bounds._ne.lat.toFixed(2)},${bounds._ne.lng.toFixed(2)}`;
    if (this._loadedHutsPassesBounds === key) return;

    this._loadingHutsPasses = true;
    this._loadedHutsPassesBounds = key;

    const iconMap = {
      hut: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#2a2a2a" stroke="rgba(201,168,76,0.3)" stroke-width="0.5"/><path d="M6 18V11l6-5 6 5v7H6z" fill="#c9a84c"/></svg>',
      pass: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="#2a2a2a" stroke="rgba(201,168,76,0.3)" stroke-width="0.5"/><path d="M4 16L8 9l4 4 4-4 4 7H4z" fill="#c9a84c"/></svg>'
    };

    const [huts, passes] = await Promise.all([
      PeakflowData.getHutsInBounds(bounds._sw.lat, bounds._sw.lng, bounds._ne.lat, bounds._ne.lng),
      PeakflowData.getPassesInBounds(bounds._sw.lat, bounds._sw.lng, bounds._ne.lat, bounds._ne.lng)
    ]);

    const existingNames = new Set(this.allPOIs.map(p => p.name));
    let added = 0;

    // Helper to create a POI marker
    const addPOI = (item, type, icon) => {
      const name = item.name_de || item.name;
      if (existingNames.has(name)) return;
      existingNames.add(name);

      const poi = {
        name: name,
        lat: item.lat,
        lng: item.lng,
        elevation: item.elevation || 0,
        type: type,
        beds: item.beds,
        website: item.website,
        website_url: item.website,   // normalized for detail panel
        phone: item.phone,
        operator: item.operator,
        description: type === 'hut'
          ? (name + (item.elevation ? ' (' + item.elevation + 'm)' : '') + (item.beds ? ' • ' + item.beds + ' Betten' : ''))
          : (name + (item.elevation ? ' (' + item.elevation + 'm)' : ''))
      };

      this.allPOIs.push(poi);

      const el = document.createElement('div');
      el.className = 'poi-marker';
      el.dataset.type = type;
      el.dataset.elevation = poi.elevation;
      el.style.cssText = 'width:22px;height:22px;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.4));transition:filter 0.15s ease;';
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
    };

    (huts || []).forEach(h => addPOI(h, 'hut', iconMap.hut));
    (passes || []).forEach(p => addPOI(p, 'pass', iconMap.pass));

    if (added > 0) {
      console.log(`[Peakflow] Loaded ${added} new huts/passes for viewport (total: ${this.allPOIs.length})`);
      this.updateMarkerVisibility();
    }

    this._loadingHutsPasses = false;
  },

  /**
   * Fire confetti particles on the map
   */
  _fireConfetti() {
    var container = this.map.getContainer();
    var colors = ['#c9a84c', '#22c55e', '#3b82f6', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899'];
    var particles = [];

    for (var i = 0; i < 80; i++) {
      var el = document.createElement('div');
      var color = colors[Math.floor(Math.random() * colors.length)];
      var size = 4 + Math.random() * 6;
      var isRect = Math.random() > 0.5;
      el.style.cssText = 'position:absolute;z-index:200;pointer-events:none;' +
        'width:' + (isRect ? size * 2 : size) + 'px;height:' + size + 'px;' +
        'background:' + color + ';border-radius:' + (isRect ? '2px' : '50%') + ';' +
        'left:50%;top:40%;opacity:1;';
      container.appendChild(el);
      particles.push({
        el: el, x: 0, y: 0,
        vx: (Math.random() - 0.5) * 16,
        vy: -8 - Math.random() * 12,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 15,
        gravity: 0.3 + Math.random() * 0.2
      });
    }

    var frame = 0;
    var maxFrames = 120;
    function animate() {
      frame++;
      for (var j = 0; j < particles.length; j++) {
        var p = particles[j];
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        p.vx *= 0.98;
        var opacity = Math.max(0, 1 - frame / maxFrames);
        p.el.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px) rotate(' + p.rotation + 'deg)';
        p.el.style.opacity = opacity;
      }
      if (frame < maxFrames) {
        requestAnimationFrame(animate);
      } else {
        particles.forEach(function(p) { p.el.remove(); });
      }
    }
    requestAnimationFrame(animate);
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

    // Determine if peak can be added to route
    const isBlocked = poi.type === 'summit' && !reachInfo.reachable && !reachInfo.lastTrailPoint;

    const warningHtml = isBlocked
      ? '<div style="margin-top:6px;padding:6px 8px;background:rgba(220,38,38,0.15);border:1px solid rgba(220,38,38,0.3);border-radius:6px;font-size:11px;color:#dc2626;line-height:1.4;text-align:center;">' +
        '<strong>\u26D4 Nicht erreichbar</strong><br>Dieser Gipfel ist zu Fu\u00DF / per Trailrun nicht erreichbar. Kein Wanderweg f\u00fchrt zum Gipfel.</div>'
      : reachInfo.warning
        ? '<div style="margin-top:6px;padding:4px 6px;background:rgba(220,38,38,0.1);border-radius:4px;font-size:10px;color:#dc2626;line-height:1.3;">\u26A0\uFE0F ' + reachInfo.warning + '</div>'
        : '';

    const btnLabel = isBlocked
      ? '\u26D4 Nicht zur Route hinzuf\u00fcgbar'
      : !reachInfo.reachable && reachInfo.lastTrailPoint
        ? 'Route zum letzten Wegpunkt'
        : '+ Zur Route hinzuf\u00fcgen';

    const btnColor = isBlocked
      ? '#78716c'
      : reachInfo.reachable
        ? 'var(--primary, #c9a84c)'
        : '#e67e22';

    const websiteLinkHtml = (poi.type === 'hut' && poi.website)
      ? '<a href="' + poi.website + '" target="_blank" rel="noopener" style="display:block;margin-top:6px;font-size:11px;color:#c9a84c;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" onclick="event.stopPropagation()">🌐 ' + poi.website.replace(/^https?:\/\/(www\.)?/, '') + '</a>'
      : '';

    const popup = new maplibregl.Popup({ offset: 20, closeOnClick: true })
      .setLngLat([poi.lng, poi.lat])
      .setHTML(
        '<div class="popup-content">' +
          '<div class="popup-content__type">' + (typeLabels[poi.type] || poi.type) + '</div>' +
          '<div class="popup-content__name">' + poi.name + '</div>' +
          '<div class="popup-content__elevation">' + poi.elevation + 'm</div>' +
          websiteLinkHtml +
          warningHtml +
          '<button class="popup-add-route-btn" id="popupAddRoute"' +
            ' style="margin-top:8px;width:100%;padding:6px 10px;background:' + btnColor + ';color:#fff;border:none;border-radius:6px;cursor:' + (isBlocked ? 'not-allowed' : 'pointer') + ';font-size:12px;font-weight:600;' + (isBlocked ? 'opacity:0.6;' : '') + '"' +
            (isBlocked ? ' disabled' : '') + '>' +
            btnLabel +
          '</button>' +
        '</div>'
      )
      .addTo(this.map);

    // Quick "add to route" button in popup
    setTimeout(() => {
      const btn = document.getElementById('popupAddRoute');
      if (btn && !isBlocked) {
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
          var isFullyBlocked = !reach.lastTrailPoint;
          reachEl.innerHTML = isFullyBlocked
            ? '<div style="margin:8px 0;padding:10px 12px;background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.3);border-radius:8px;font-size:13px;color:#dc2626;line-height:1.5;text-align:center;">' +
              '<strong>\u26D4 Nicht erreichbar</strong><br>' +
              'Dieser Gipfel ist zu Fu\u00DF / per Trailrun nicht erreichbar.<br>Kein Wanderweg f\u00fchrt zum Gipfel.</div>'
            : '<div style="margin:8px 0;padding:8px 12px;background:rgba(220,38,38,0.08);border-left:3px solid #dc2626;border-radius:4px;font-size:12px;color:#dc2626;line-height:1.4;">' +
              '\u26A0\uFE0F <strong>Eingeschr\u00e4nkt erreichbar</strong><br>' +
              (reach.warning || 'Kein begehbarer Weg zum Gipfel.') +
              '<br>Route wird zum letzten Wegpunkt gef\u00fchrt.</div>';
          // Update button
          var routeBtn = document.getElementById('routeToPoiBtn');
          if (routeBtn) {
            if (isFullyBlocked) {
              routeBtn.innerHTML = '\u26D4 Nicht zur Route hinzuf\u00fcgbar';
              routeBtn.style.background = '#78716c';
              routeBtn.style.opacity = '0.6';
              routeBtn.style.cursor = 'not-allowed';
              routeBtn.disabled = true;
            } else {
              routeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Route zum letzten Wegpunkt';
              routeBtn.style.background = '#e67e22';
              routeBtn.style.opacity = '';
              routeBtn.style.cursor = '';
              routeBtn.disabled = false;
            }
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
        const route = routes.find(r => String(r.id) === String(btn.dataset.id));
        console.log('[Peakflow] Edit route:', route ? route.name : 'NOT FOUND', 'id:', btn.dataset.id, 'coords:', route?.coords?.length);
        if (route && route.coords) {
          this.loadRoute(route, true); // edit mode
        } else {
          console.warn('[Peakflow] Route not found or no coords for id:', btn.dataset.id);
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

  // ─── Race Routes ────────────────────────────────────────────────────────────

  _raceRoutesCache: null,        // Cached race data from Supabase
  _raceMapLayers: {},            // { raceSlug+edition: [layerIds...] }
  _raceMapVisible: {},           // { raceSlug+edition: bool }

  async loadRaceRoutes() {
    const list = document.getElementById('raceRoutesList');
    if (!list) return;

    list.innerHTML = '<div class="race-loading">Lade Rennen...</div>';

    try {
      const races = await PeakflowData.getCommunityRaces();
      if (!races || races.length === 0) {
        list.innerHTML = '<div class="race-loading" style="text-align:center;padding:20px;color:var(--text-tertiary);">Noch keine Rennen eingetragen.<br>Sei der Erste! 🏁</div>';
        return;
      }
      // Get user's peaks
      const raceIds = races.map(r => r.id);
      const userPeaks = await PeakflowData.getUserPeaks(raceIds);
      this._renderCommunityRaces(races, userPeaks);
    } catch(e) {
      console.warn('[Peakflow] Race load failed:', e);
      list.innerHTML = '<div class="race-loading">Rennen konnten nicht geladen werden.</div>';
    }
  },

  _handleLogoFile(file) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      this._raceLogoDataUrl = e.target.result;
      const preview = document.getElementById('raceLogoPreview');
      if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
    };
    reader.readAsDataURL(file);
  },

  _renderCommunityRaces(races, userPeaks) {
    const list = document.getElementById('raceRoutesList');
    if (!list) return;

    // ── Group races by organizer (extracted from parenthetical in name) ────────
    const groups = new Map();
    for (const r of races) {
      if (!r.coords || r.coords.length < 2) continue;
      const m = r.race_name.match(/\(([^)]+)\)/);
      const orgName = m ? m[1].trim() : r.race_name;
      const displayName = r.race_name.replace(/\s*\([^)]+\)\s*/g, '').trim();
      if (!groups.has(orgName)) {
        groups.set(orgName, { races: [], logo: r.logo_url, website: r.website_url });
      }
      groups.get(orgName).races.push(Object.assign({}, r, { _displayName: displayName }));
    }

    // ── Date formatter ────────────────────────────────────────────────────────
    const fmtDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
    };
    const fmtDateShort = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
    };
    const fmtYear = (iso) => iso ? new Date(iso).getFullYear() : '';

    // ── Difficulty label based on distance ────────────────────────────────────
    const diffLabel = (km) => {
      if (!km) return '';
      const k = parseFloat(km);
      if (k < 20) return '<span class="race-diff race-diff--easy">Einsteiger</span>';
      if (k < 40) return '<span class="race-diff race-diff--medium">Trail</span>';
      return '<span class="race-diff race-diff--hard">Ultra</span>';
    };

    // ── Build HTML ────────────────────────────────────────────────────────────
    let html = '';
    let groupIdx = 0;
    const autoOpen = groups.size === 1; // auto-expand if only 1 organizer

    for (const [orgName, group] of groups) {
      const orgId = 'org' + groupIdx++;
      const sortedRaces = group.races.slice().sort((a, b) => (a.race_date || '').localeCompare(b.race_date || ''));
      const dates = sortedRaces.map(r => r.race_date).filter(Boolean).sort();
      const dateMin = dates[0], dateMax = dates[dates.length - 1];
      let dateRangeStr = '';
      if (dateMin && dateMax && dateMin !== dateMax) {
        const d1 = new Date(dateMin), d2 = new Date(dateMax);
        dateRangeStr = d1.toLocaleDateString('de-DE', { day:'numeric', month:'long' }) + ' – ' +
                       d2.toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' });
      } else if (dateMin) {
        dateRangeStr = fmtDate(dateMin) + ' ' + fmtYear(dateMin);
      }

      html += `
      <div class="org-group" data-org-id="${orgId}">
        <div class="org-header${autoOpen ? ' open' : ''}" data-org-id="${orgId}">
          <div class="org-header__logo">
            ${group.logo ? `<img src="${group.logo}" alt="${orgName}" loading="lazy">` : '<span class="org-header__logo-icon">🏁</span>'}
          </div>
          <div class="org-header__info">
            <div class="org-header__name">${orgName}</div>
            <div class="org-header__meta">${dateRangeStr}${dateRangeStr ? ' · ' : ''}${sortedRaces.length} Strecke${sortedRaces.length !== 1 ? 'n' : ''}</div>
          </div>
          <svg class="org-header__chevron${autoOpen ? ' rotated' : ''}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6,9 12,15 18,9"/>
          </svg>
        </div>
        <div class="org-races${autoOpen ? '' : ' collapsed'}" id="${orgId}-races">`;

      for (const r of sortedRaces) {
        const peaked = userPeaks.includes(r.id);
        const dist = r.distance ? parseFloat(r.distance).toFixed(1) : '?';
        html += `
          <div class="race-item" data-race-id="${r.id}">
            <div class="race-item__header">
              <span class="race-item__name">${r._displayName}</span>
              ${diffLabel(r.distance)}
            </div>
            <div class="race-item__stats">
              ${r.race_date ? `<span>📅 ${fmtDateShort(r.race_date)}</span>` : ''}
              <span>📏 ${dist} km</span>
              ${r.ascent ? `<span>⬆ ${r.ascent} m</span>` : ''}
              ${r.descent ? `<span>⬇ ${r.descent} m</span>` : ''}
            </div>
            ${r.description ? `<div class="race-item__desc">${r.description}</div>` : ''}
            <div class="race-item__actions">
              <button class="race-show-btn btn btn--sm btn--primary" data-race-id="${r.id}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
                Auf Karte
              </button>
              ${group.website ? `<a href="${group.website}" target="_blank" rel="noopener" class="btn btn--sm btn--outline">🔗 Website</a>` : ''}
              <button class="peak-btn race-peak-btn ${peaked ? 'peaked' : ''}" data-race-id="${r.id}" title="Peak vergeben">
                ⛰ <span class="peak-count">${r.peaks_count || 0}</span>
              </button>
            </div>
          </div>`;
      }

      html += `</div></div>`; // close org-races + org-group
    }

    if (!html) {
      html = '<div style="text-align:center;padding:24px 12px;color:var(--text-tertiary);font-size:13px;">Noch keine Rennen eingetragen.<br>Sei der Erste! 🏁</div>';
    }

    list.innerHTML = html;

    // ── Accordion toggle ──────────────────────────────────────────────────────
    list.querySelectorAll('.org-header').forEach(header => {
      header.addEventListener('click', () => {
        const orgId = header.dataset.orgId;
        const racesEl = document.getElementById(orgId + '-races');
        const isOpen = !racesEl.classList.contains('collapsed');
        // Close all
        list.querySelectorAll('.org-races').forEach(el => el.classList.add('collapsed'));
        list.querySelectorAll('.org-header').forEach(el => el.classList.remove('open'));
        list.querySelectorAll('.org-header__chevron').forEach(el => el.classList.remove('rotated'));
        if (!isOpen) { // was closed → open it
          racesEl.classList.remove('collapsed');
          header.classList.add('open');
          header.querySelector('.org-header__chevron')?.classList.add('rotated');
        }
      });
    });

    // ── "Auf Karte" → show route WITHOUT tab switch ───────────────────────────
    list.querySelectorAll('.race-show-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const race = races.find(r => r.id === btn.dataset.raceId);
        if (!race) return;
        // Mark this button active, reset others
        list.querySelectorAll('.race-show-btn').forEach(b => {
          b.classList.remove('active');
          b.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg> Auf Karte';
        });
        btn.classList.add('active');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg> Wird gezeigt';
        this.loadRaceOnMap(race);
      });
    });

    // ── Peak buttons ──────────────────────────────────────────────────────────
    list.querySelectorAll('.race-peak-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!PeakflowData.currentUser) { document.getElementById('authModal').classList.remove('hidden'); return; }
        const raceId = btn.dataset.raceId;
        const result = await PeakflowData.toggleRacePeak(raceId);
        if (result.error) return;
        btn.classList.toggle('peaked', result.peaked);
        const countEl = btn.querySelector('.peak-count');
        let c = parseInt(countEl.textContent) || 0;
        countEl.textContent = result.peaked ? c + 1 : Math.max(0, c - 1);
      });
    });
  },

  // ── Load race route on map — stays in Entdecken/Rennen tab ────────────────
  async loadRaceOnMap(race) {
    if (!race.coords || race.coords.length < 2) return;
    const R = PeakflowRoutes;

    // Clear previous race overlays
    if (this._raceMapLayers) {
      Object.keys(this._raceMapLayers).forEach(key => {
        (this._raceMapLayers[key] || []).forEach(id => {
          try { R.map.removeLayer(id); } catch(e) {}
          try { R.map.removeSource(id); } catch(e) {}
        });
      });
      this._raceMapLayers = {};
    }
    // Clear old route markers + line
    R.markers.forEach(m => m.remove());
    R.markers = [];
    R.routeCoords = race.coords;
    R.elevations = race.coords.map(c => c[2] || 0);

    // Draw route line
    R.drawRouteLine(race.coords);

    // Start + finish markers
    const startC = race.coords[0];
    const endC   = race.coords[race.coords.length - 1];
    new maplibregl.Marker({ color: '#22c55e' }).setLngLat([startC[0], startC[1]]).addTo(R.map);
    new maplibregl.Marker({ color: '#e63946' }).setLngLat([endC[0], endC[1]]).addTo(R.map);

    // Fit map to route
    const lngs = race.coords.map(c => c[0]);
    const lats  = race.coords.map(c => c[1]);
    R.map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: { top: 60, bottom: 180, left: 260, right: 60 }, duration: 900 }
    );

    // Show elevation profile at bottom
    const elevEl = document.getElementById('elevationProfile');
    if (elevEl) elevEl.classList.remove('hidden');
    setTimeout(() => R.drawElevationProfile(), 200);

    // Background analysis (snow, weather etc.)
    R.loadSACDataForRoute(race.coords).catch(() => {});
    R.analyzeSnowOnRoute().catch(() => {});
    R.loadRouteWeather(race.coords).catch(() => {});
    R.loadWaterSources(race.coords).catch(() => {});
  },

  _toggleRaceOnMap(key, stages, btn) {
    const map = PeakflowRoutes.map;
    if (!map) return;

    if (this._raceMapVisible[key]) {
      // Hide: remove layers
      (this._raceMapLayers[key] || []).forEach(id => {
        try { map.removeLayer(id); } catch(e) {}
        try { map.removeSource(id); } catch(e) {}
      });
      delete this._raceMapLayers[key];
      this._raceMapVisible[key] = false;
      btn.classList.remove('active');
      btn.textContent = '🗺 Auf Karte';
    } else {
      // Show all stages
      const layers = [];
      stages.forEach((st, i) => {
        if (!st.coords || st.coords.length < 2) return;
        const srcId = `race-${key}-${i}`;
        const lineId = `race-line-${key}-${i}`;
        const color = st.stage_color || '#888';
        try {
          map.addSource(srcId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: st.coords } } });
          map.addLayer({ id: lineId, type: 'line', source: srcId, paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.85 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
          layers.push(srcId, lineId);
        } catch(e) { console.warn('[Race] Layer error:', e.message); }
      });
      this._raceMapLayers[key] = layers;
      this._raceMapVisible[key] = true;
      btn.classList.add('active');
      btn.textContent = '🗺 Ausblenden';

      // Fit map to all stages
      const allCoords = stages.flatMap(st => st.coords || []);
      if (allCoords.length > 0) {
        const lngs = allCoords.map(c => c[0]), lats = allCoords.map(c => c[1]);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 40, duration: 1000 });
      }
    }
  },

  async loadRaceStage(stage) {
    if (!stage.coords || stage.coords.length < 2) return;

    const R = PeakflowRoutes;
    // Clear ALL previous race map overlays
    if (this._raceMapLayers) {
      Object.keys(this._raceMapLayers).forEach(key => {
        (this._raceMapLayers[key] || []).forEach(id => {
          try { R.map.removeLayer(id); } catch(e) {}
          try { R.map.removeSource(id); } catch(e) {}
        });
        this._raceMapVisible[key] = false;
      });
      this._raceMapLayers = {};
      // Reset all "Auf Karte" buttons
      document.querySelectorAll('.race-map-btn.active').forEach(b => {
        b.classList.remove('active');
        b.textContent = '🗺 Auf Karte';
      });
    }
    R.clearRoute();
    R.isPlanning = false;
    R.routeCoords = stage.coords;
    R.elevations = stage.coords.map(c => c[2] || 0);

    // Start marker
    const startCoord = stage.coords[0];
    const startMarker = new maplibregl.Marker({ color: '#22c55e' })
      .setLngLat([startCoord[0], startCoord[1]]).addTo(R.map);
    R.markers.push(startMarker);
    R.waypoints.push({ lng: startCoord[0], lat: startCoord[1], name: stage.start_name || stage.stage_name || 'Start' });

    // End marker
    const endCoord = stage.coords[stage.coords.length - 1];
    const endMarker = new maplibregl.Marker({ color: '#e63946' })
      .setLngLat([endCoord[0], endCoord[1]]).addTo(R.map);
    R.markers.push(endMarker);
    R.waypoints.push({ lng: endCoord[0], lat: endCoord[1], name: stage.finish_name || stage.stage_name || 'Ziel' });

    R.updateWaypointList();
    R.drawRouteLine(stage.coords);

    // For race stages: use stored ascent/descent if available (more accurate than GPS recalc)
    if (stage.ascent && stage.descent) {
      R._raceOverrideStats = { ascent: stage.ascent, descent: stage.descent };
    } else {
      R._raceOverrideStats = null;
    }
    R.updateStats();
    R._raceOverrideStats = null; // Clear after use

    const elevEl = document.getElementById('elevationProfile');
    if (elevEl) elevEl.classList.remove('hidden');
    setTimeout(() => R.drawElevationProfile(), 150);

    R.isPlanning = false; // Don't allow editing race routes
    if (R.map) R.map.getCanvas().style.cursor = '';

    // Fit map to stage
    const lngs = stage.coords.map(c => c[0]), lats = stage.coords.map(c => c[1]);
    R.map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 40, duration: 800 });

    // Background analysis
    R.loadSACDataForRoute(stage.coords).catch(() => {});
    R.analyzeSnowOnRoute().catch(() => {});
    R.loadRouteWeather(stage.coords).catch(() => {});
    R.loadWaterSources(stage.coords).catch(() => {});
    Promise.resolve().then(() => R.loadSunAnalysis(stage.coords, R.elevations)).catch(() => {});

    // Switch to route planner tab
    document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.sidebar__tab[data-tab="routes"]')?.classList.add('active');
    document.getElementById('panel-routes')?.classList.add('active');

    // Hide Routenvorschläge, show Zurück button
    const routeFinder = document.getElementById('routeFinderPanel');
    if (routeFinder) routeFinder.classList.add('hidden');
    const routeInfo = document.getElementById('routeInfo');
    if (routeInfo) {
      routeInfo.innerHTML = '<button id="backToRaces" style="width:100%;padding:10px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;color:var(--text-primary);">← Zurück zu den Rennen</button>';
      document.getElementById('backToRaces').addEventListener('click', () => {
        R.clearRoute();
        routeInfo.innerHTML = '';
        if (routeFinder) routeFinder.classList.remove('hidden');
        // Switch to Entdecken → Rennen tab
        document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
        document.querySelector('.sidebar__tab[data-tab="discover"]')?.classList.add('active');
        document.getElementById('panel-discover')?.classList.add('active');
        // Activate Rennen sub-tab
        document.querySelectorAll('.dtab').forEach(d => d.classList.remove('dtab--active'));
        document.querySelector('.dtab[data-dtab="races"]')?.classList.add('dtab--active');
        document.getElementById('dtab-peaks')?.classList.add('hidden');
        document.getElementById('dtab-races')?.classList.remove('hidden');
      });
    }

    console.log(`[Peakflow] Race stage loaded: ${stage.race_name} ${stage.edition} E${stage.stage} — ${stage.coords.length} pts`);
  },

  // ─── End Race Routes ─────────────────────────────────────────────────────────

  /**
   * Load a saved route onto the map
   */
  /**
   * Load a saved route for viewing OR editing
   */
  loadRoute(route, editMode = false) {
    PeakflowRoutes.clearRoute();
    // Parse coords if string (Supabase JSONB sometimes returns string)
    if (typeof route.coords === 'string') {
      try { route.coords = JSON.parse(route.coords); } catch(e) { console.error('Invalid coords', e); return; }
    }
    if (typeof route.waypoints === 'string') {
      try { route.waypoints = JSON.parse(route.waypoints); } catch(e) { route.waypoints = null; }
    }

    if (route.coords && Array.isArray(route.coords) && route.coords.length > 1) {
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

      // Set temporary waypoints so analyzeSnowOnRoute works
      if (!PeakflowRoutes.waypoints || PeakflowRoutes.waypoints.length === 0) {
        PeakflowRoutes.waypoints = [
          { lat: route.coords[0][1], lng: route.coords[0][0], index: 0 },
          { lat: route.coords[route.coords.length-1][1], lng: route.coords[route.coords.length-1][0], index: 1 }
        ];
      }
      // Load route analysis (all non-async wrapped in Promise.resolve)
      const coords = route.coords;
      const elevations = PeakflowRoutes.elevations;
      Promise.all([
        PeakflowRoutes.loadSACDataForRoute(coords).catch(e => console.warn('[Peakflow] SAC:', e)),
        PeakflowRoutes.analyzeSnowOnRoute().catch(e => console.warn('[Peakflow] Snow:', e)),
        PeakflowRoutes.loadRouteWeather(coords).catch(e => console.warn('[Peakflow] Weather:', e)),
        PeakflowRoutes.loadWaterSources(coords).catch(e => console.warn('[Peakflow] Water:', e)),
        Promise.resolve().then(() => PeakflowRoutes.loadSunAnalysis(coords, elevations)).catch(e => console.warn('[Peakflow] Sun:', e))
      ]).then(() => console.log('[Peakflow] Saved route analysis complete'));

      // If edit mode: reconstruct waypoints
      if (editMode) {
        // Use saved waypoints, or reconstruct from route start/end
        if (!route.waypoints || route.waypoints.length === 0) {
          route.waypoints = [
            { lng: route.coords[0][0], lat: route.coords[0][1], name: 'Start' },
            { lng: route.coords[route.coords.length-1][0], lat: route.coords[route.coords.length-1][1], name: 'Ziel' }
          ];
        }
        PeakflowRoutes.isPlanning = true;
        if (this.map) this.map.getCanvas().style.cursor = 'crosshair';
        document.getElementById('routePlanBtn').classList.add('active');

        // Re-add waypoint markers
        route.waypoints.forEach(wp => {
          const waypoint = { lng: wp.lng || wp[0], lat: wp.lat || wp[1], index: PeakflowRoutes.waypoints.length, name: wp.name || null };
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
      const resp = await fetch('https://ipapi.co/json/');
      const data = await resp.json();
      const lat = data.latitude || data.lat;
      const lon = data.longitude || data.lon;
      if (lat && lon) {
        this._userLocation = { lat, lng: lon };
        this._userCity = data.city || '';
        localStorage.setItem('peakflow_last_location', JSON.stringify(this._userLocation));
        localStorage.setItem('peakflow_city', data.city || '');
        console.log(`[Peakflow] IP location: ${data.city}, ${data.region} (${lat}, ${lon})`);
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
        .select('locations')
        .eq('id', PeakflowData.currentUser.id)
        .single();

      if (data && data.locations && data.locations.length > 0) {
        const home = data.locations[0]; // First location is the active one
        this._userLocation = { lat: home.lat, lng: home.lng };
        this._settingsLocations = data.locations;
        localStorage.setItem('peakflow_last_location', JSON.stringify(this._userLocation));
        console.log(`[Peakflow] User home: ${home.name || ''} (${home.lat}, ${home.lng})`);
        this.map.flyTo({ center: [home.lng, home.lat], zoom: 13, duration: 1000 });
      }
    } catch (e) {
      console.log('[Peakflow] No user profile found');
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

    // Water toggle — ON: show all in viewport, OFF: hide all
    document.getElementById('waterToggleBtn').addEventListener('click', async () => {
      this._waterVisible = !this._waterVisible;
      document.getElementById('waterToggleBtn').classList.toggle('active', this._waterVisible);

      if (this._waterVisible) {
        // Load ALL water sources in current viewport
        await this._loadViewportWaterSources();
      } else {
        // Hide all water markers
        if (PeakflowRoutes._waterMarkers) {
          PeakflowRoutes._waterMarkers.forEach(m => m.remove());
          PeakflowRoutes._waterMarkers = [];
        }
      }
    });

    // POI Filter button + panel
    this._poiFilterMarkers = {};
    document.getElementById('poiFilterBtn')?.addEventListener('click', () => {
      const panel = document.getElementById('poiFilter');
      if (panel) panel.classList.toggle('hidden');
    });
    // Close POI filter on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#poiFilter') && !e.target.closest('#poiFilterBtn')) {
        const panel = document.getElementById('poiFilter');
        if (panel) panel.classList.add('hidden');
      }
    });
    // Handle POI checkbox changes
    document.querySelectorAll('#poiFilter input[data-poi]').forEach(cb => {
      cb.addEventListener('change', () => {
        const cat = cb.dataset.poi;
        if (cb.checked) {
          this._loadPOICategory(cat);
        } else {
          this._removePOICategory(cat);
        }
        // Save to localStorage
        const active = Array.from(document.querySelectorAll('#poiFilter input:checked')).map(c => c.dataset.poi);
        localStorage.setItem('peakflow_poi_filters', JSON.stringify(active));
      });
    });
    // Restore saved filters
    try {
      const saved = JSON.parse(localStorage.getItem('peakflow_poi_filters') || '[]');
      saved.forEach(cat => {
        const cb = document.querySelector(`#poiFilter input[data-poi="${cat}"]`);
        if (cb) { cb.checked = true; this._loadPOICategory(cat); }
      });
    } catch(e) {}

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
    // Dark mode toggle (now in settings)
    var darkBtn = document.getElementById('darkModeToggle');
    if (darkBtn) {
      darkBtn.addEventListener('click', () => {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme');
        html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
      });
    }
    var settingsDark = document.getElementById('settingsDarkMode');
    if (settingsDark) {
      settingsDark.checked = document.documentElement.getAttribute('data-theme') === 'dark';
      settingsDark.addEventListener('change', () => {
        document.documentElement.setAttribute('data-theme', settingsDark.checked ? 'dark' : 'light');
      });
    }

    // Emergency modal (now in settings, but keep modal handler if button exists)
    var emergBtn = document.getElementById('emergencyBtn');
    if (emergBtn) {
      emergBtn.addEventListener('click', () => {
        document.getElementById('emergencyModal').classList.remove('hidden');
      });
    }
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

        // Load race routes when Entdecken tab is opened
        if (tab.dataset.tab === 'discover') {
          this.loadRaceRoutes();
        }

        // Mobile: always expand when tab clicked (don't close)
        if (window.innerWidth <= 768 && sidebar && !sidebar.classList.contains('expanded')) {
          sidebar.classList.add('expanded');
        }
      });
    });

    // Discover sub-tabs: Rennen / Touren / Gipfel
    document.querySelectorAll('.dtab[data-dtab]').forEach(dtab => {
      dtab.addEventListener('click', () => {
        const parent = dtab.closest('.discover-tabs');
        parent.querySelectorAll('.dtab').forEach(d => d.classList.remove('dtab--active'));
        dtab.classList.add('dtab--active');
        const target = dtab.dataset.dtab;
        ['peaks', 'races', 'tours'].forEach(t => {
          const el = document.getElementById('dtab-' + t);
          if (el) el.classList.toggle('hidden', target !== t);
        });
        if (target === 'races') this.loadRaceRoutes();
        if (target === 'tours') { this.loadGroupTours(); this.loadSeasonalSuggestions(); }
      });
    });

    // Saved sub-tabs: Routen / Watchlist
    document.querySelectorAll('.dtab[data-stab]').forEach(stab => {
      stab.addEventListener('click', () => {
        const parent = stab.closest('.discover-tabs');
        parent.querySelectorAll('.dtab').forEach(d => d.classList.remove('dtab--active'));
        stab.classList.add('dtab--active');
        const target = stab.dataset.stab;
        ['routes', 'watchlist'].forEach(t => {
          const el = document.getElementById('stab-' + t);
          if (el) el.classList.toggle('hidden', target !== t);
        });
        if (target === 'watchlist') this.loadWatchlist();
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

    // Watchlist button on POI detail
    document.getElementById('watchlistPoiBtn').addEventListener('click', async () => {
      const poi = this._currentPoi;
      if (!poi) return;
      if (!PeakflowData.currentUser) { alert('Bitte zuerst anmelden um die Watchlist zu nutzen!'); return; }
      const already = await PeakflowData.isOnWatchlist(poi.lat, poi.lng);
      if (already) { alert(poi.name + ' ist bereits auf deiner Watchlist!'); return; }
      const result = await PeakflowData.addToWatchlist({
        name: poi.name, lat: poi.lat, lng: poi.lng, elevation: poi.elevation
      });
      if (result.error) { alert('Fehler: ' + (result.error.message || result.error)); return; }
      document.getElementById('watchlistPoiBtn').textContent = '✅ Auf Watchlist';
      document.getElementById('watchlistPoiBtn').disabled = true;
    });

    // Group Tour button (after route planning)
    var groupTourActionBtn = document.createElement('button');
    groupTourActionBtn.className = 'btn btn--sm btn--outline';
    groupTourActionBtn.innerHTML = '👥 Gruppen-Tour';
    groupTourActionBtn.title = 'Als Gruppen-Tour teilen';
    groupTourActionBtn.style.cssText = 'margin-top:8px;';
    groupTourActionBtn.addEventListener('click', function() { Peakflow.openGroupTourModal(); });
    var routeActions = document.getElementById('routeActions');
    if (routeActions) routeActions.appendChild(groupTourActionBtn);

    // Route planning button
    document.getElementById('routePlanBtn').addEventListener('click', () => {
      PeakflowRoutes.togglePlanning();
    });

    // Clear route
    document.getElementById('clearRouteBtn').addEventListener('click', () => {
      PeakflowRoutes.clearRoute();
      PeakflowRouteFinder.clearPreviews();
      // Reset finder panel
      var rfPanel = document.getElementById('routeFinderPanel');
      var rfToggle = document.getElementById('routeFinderToggle');
      var rfResults = document.getElementById('rfResults');
      var rfList = document.getElementById('rfResultsList');
      if (rfPanel) rfPanel.classList.add('hidden');
      if (rfToggle) rfToggle.classList.remove('active');
      if (rfResults) rfResults.classList.add('hidden');
      if (rfList) rfList.innerHTML = '';
      // Show start picker again
      PeakflowRoutes._showStartPointPicker();
    });

    // Add Race Modal
    const addRaceBtn = document.getElementById('addRaceBtn');
    const addRaceModal = document.getElementById('addRaceModal');
    const closeRaceModal = document.getElementById('closeRaceModal');
    if (addRaceBtn && addRaceModal) {
      addRaceBtn.addEventListener('click', () => {
        if (!PeakflowData.currentUser) { document.getElementById('authModal').classList.remove('hidden'); return; }
        addRaceModal.classList.remove('hidden');
        this._raceCoords = null; // Reset race coords
        this._raceLogoDataUrl = null;
        document.getElementById('raceRouteInfo').style.display = 'none';
      });
      closeRaceModal.addEventListener('click', () => addRaceModal.classList.add('hidden'));
    }

    // "Aktuelle Route" button in race modal
    const useCurrentBtn = document.getElementById('raceUseCurrentRoute');
    if (useCurrentBtn) {
      useCurrentBtn.addEventListener('click', () => {
        if (PeakflowRoutes.routeCoords.length < 2) { alert('Erst eine Route planen!'); return; }
        this._raceCoords = PeakflowRoutes.routeCoords;
        this._raceWaypoints = PeakflowRoutes.waypoints;
        const dist = PeakflowUtils.routeDistance(this._raceCoords);
        const { ascent } = PeakflowUtils.calculateElevationGain(PeakflowRoutes.elevations);
        const info = document.getElementById('raceRouteInfo');
        const stats = document.getElementById('raceRouteStats');
        if (info) info.style.display = '';
        if (stats) stats.innerHTML = '✅ Route übernommen: <strong>' + dist.toFixed(1) + ' km · ' + ascent + ' Hm</strong>';
      });
    }

    // GPX upload in race modal
    const gpxInput = document.getElementById('raceGPXInput');
    if (gpxInput) {
      gpxInput.addEventListener('change', () => {
        const file = gpxInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(e.target.result, 'text/xml');
            const trkpts = doc.querySelectorAll('trkpt');
            if (trkpts.length === 0) { alert('Keine Trackpunkte in der GPX-Datei'); return; }
            const coords = Array.from(trkpts).map(pt => {
              const ele = pt.querySelector('ele');
              return [parseFloat(pt.getAttribute('lon')), parseFloat(pt.getAttribute('lat')), ele ? parseFloat(ele.textContent) : 0];
            });
            this._raceCoords = coords;
            this._raceWaypoints = [{ lat: coords[0][1], lng: coords[0][0], name: 'Start' }, { lat: coords[coords.length-1][1], lng: coords[coords.length-1][0], name: 'Ziel' }];
            const dist = PeakflowUtils.routeDistance(coords);
            const elevs = coords.map(c => c[2]);
            const { ascent } = PeakflowUtils.calculateElevationGain(elevs);
            const info = document.getElementById('raceRouteInfo');
            const stats = document.getElementById('raceRouteStats');
            if (info) info.style.display = '';
            if (stats) stats.innerHTML = '✅ GPX geladen: <strong>' + dist.toFixed(1) + ' km · ' + ascent + ' Hm · ' + coords.length + ' Punkte</strong>';
          } catch(err) { alert('GPX-Datei konnte nicht gelesen werden'); }
        };
        reader.readAsText(file);
      });
    }

    // Logo upload + drag & drop
    const logoArea = document.getElementById('raceLogoArea');
    const logoInput = document.getElementById('raceLogoInput');
    const logoPreview = document.getElementById('raceLogoPreview');
    if (logoArea && logoInput) {
      logoArea.addEventListener('click', (e) => { if (e.target !== logoInput) logoInput.click(); });
      logoArea.addEventListener('dragover', (e) => { e.preventDefault(); logoArea.style.borderColor = 'var(--color-primary)'; });
      logoArea.addEventListener('dragleave', () => { logoArea.style.borderColor = 'var(--border-color)'; });
      logoArea.addEventListener('drop', (e) => {
        e.preventDefault(); logoArea.style.borderColor = 'var(--border-color)';
        if (e.dataTransfer.files[0]) this._handleLogoFile(e.dataTransfer.files[0]);
      });
      logoInput.addEventListener('change', () => { if (logoInput.files[0]) this._handleLogoFile(logoInput.files[0]); });
    }

    // Publish race
    const publishBtn = document.getElementById('publishRaceBtn');
    if (publishBtn) {
      publishBtn.addEventListener('click', async () => {
        const name = document.getElementById('raceNameInput').value.trim();
        const organizer = document.getElementById('raceOrganizerInput').value.trim();
        const date = document.getElementById('raceDateInput').value;
        const time = document.getElementById('raceTimeInput').value;
        const start = document.getElementById('raceStartInput').value.trim();
        const finish = document.getElementById('raceFinishInput').value.trim();
        const website = document.getElementById('raceWebsiteInput').value.trim();
        const coords = this._raceCoords;
        if (!name) { alert('Bitte Rennname eingeben'); return; }
        if (!start) { alert('Bitte Start-Ort eingeben'); return; }
        if (!coords || coords.length < 2) { alert('Bitte Route laden (GPX oder aktuelle Route)'); return; }
        // Confirmation
        const msg = '🏁 ' + name + (organizer ? '\n🏢 ' + organizer : '') + '\n📅 ' + (date || 'Kein Datum') + (time ? ' ⏰ ' + time : '') + '\n📍 ' + start + (finish ? ' → ' + finish : '') + '\n\nDatum und Uhrzeit korrekt?';
        if (!confirm(msg)) return;
        publishBtn.textContent = 'Wird veröffentlicht...';
        publishBtn.disabled = true;
        const dist = PeakflowUtils.routeDistance(coords);
        const elevs = coords.map(c => c[2] || 0);
        const { ascent, descent } = PeakflowUtils.calculateElevationGain(elevs);
        const result = await PeakflowData.saveCommunityRace({
          race_name: name + (organizer ? ' (' + organizer + ')' : ''),
          race_date: date || null, start_time: time || null,
          start_name: start, finish_name: finish || null,
          distance: dist.toFixed(1), ascent, descent,
          coords: coords,
          waypoints: this._raceWaypoints || null,
          description: document.getElementById('raceDescInput').value.trim() || null,
          logo_url: this._raceLogoDataUrl || null,
          website_url: website || null
        });
        publishBtn.textContent = '🏁 Rennen veröffentlichen';
        publishBtn.disabled = false;
        if (result.error) { alert('Fehler: ' + result.error); return; }
        addRaceModal.classList.add('hidden');
        // Reset form
        ['raceNameInput','raceDateInput','raceTimeInput','raceStartInput','raceFinishInput','raceDescInput','raceWebsiteInput'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        if (logoPreview) { logoPreview.style.display = 'none'; }
        this._raceLogoDataUrl = null;
        // Reload races
        this.loadRaceRoutes();
        // Switch to Entdecken → Rennen
        document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
        document.querySelector('.sidebar__tab[data-tab="discover"]')?.classList.add('active');
        document.getElementById('panel-discover')?.classList.add('active');
        alert('🏁 Rennen veröffentlicht! Andere Trailrunner können es jetzt sehen.');
      });
    }

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
        waypoints: PeakflowRoutes.waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng, name: wp.name || null })),
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
      if (PeakflowRoutes.waypoints.length < 2) return;

      if (PeakflowRoutes.isPlanning) {
        PeakflowRoutes.togglePlanning();
      }

      // Calculate stats
      const coords = PeakflowRoutes.routeCoords;
      const elevs = PeakflowRoutes.elevations;
      const distance = PeakflowUtils.routeDistance(coords);
      const { ascent, descent } = PeakflowUtils.calculateElevationGain(elevs);
      const time = PeakflowUtils.calculateTime(distance, ascent, descent);
      const durationStr = PeakflowUtils.formatDuration(time.hours, time.minutes);

      // Fit route on map
      if (coords.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        coords.forEach(c => bounds.extend([c[0], c[1]]));
        this.map.fitBounds(bounds, { padding: { top: 80, bottom: 120, left: 60, right: 60 }, duration: 800 });
      }

      // Show route summary overlay on map
      var existing = document.getElementById('routeSummaryOverlay');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.id = 'routeSummaryOverlay';
      overlay.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;background:rgba(26,26,26,0.92);backdrop-filter:blur(12px);border-radius:20px;padding:28px 36px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.3);pointer-events:auto;animation:summaryFadeIn 0.5s ease;';

      overlay.innerHTML = '<style>@keyframes summaryFadeIn{from{opacity:0;transform:translate(-50%,-50%) scale(0.8);}to{opacity:1;transform:translate(-50%,-50%) scale(1);}}</style>' +
        '<div style="font-size:14px;color:#94a3b8;margin-bottom:4px;">Route fertig! 🎉</div>' +
        '<div style="display:flex;gap:24px;margin:16px 0;">' +
          '<div><div style="font-size:28px;font-weight:800;color:#c9a84c;">' + distance.toFixed(1) + '</div><div style="font-size:11px;color:#94a3b8;">km</div></div>' +
          '<div><div style="font-size:28px;font-weight:800;color:#f0ece2;">' + durationStr + '</div><div style="font-size:11px;color:#94a3b8;">Dauer</div></div>' +
          '<div><div style="font-size:28px;font-weight:800;color:#22c55e;">' + ascent + '</div><div style="font-size:11px;color:#94a3b8;">m ↑</div></div>' +
          '<div><div style="font-size:28px;font-weight:800;color:#ef4444;">' + descent + '</div><div style="font-size:11px;color:#94a3b8;">m ↓</div></div>' +
        '</div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:8px;">Tippe auf die Karte um fortzufahren</div>';

      this.map.getContainer().appendChild(overlay);

      // Confetti burst 🎊
      this._fireConfetti();

      // Remove overlay on click
      var removeOverlay = () => {
        if (overlay.parentNode) {
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 0.3s';
          setTimeout(() => overlay.remove(), 300);
        }
        this.map.getContainer().removeEventListener('click', removeOverlay);
      };
      setTimeout(() => {
        this.map.getContainer().addEventListener('click', removeOverlay);
      }, 500);

      // Auto-remove after 8s
      setTimeout(removeOverlay, 8000);
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

    // GPX Import
    document.getElementById('importGpxBtn').addEventListener('click', () => {
      document.getElementById('gpxFileInput').click();
    });
    document.getElementById('gpxFileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Confirm if route exists
      if (PeakflowRoutes.waypoints.length > 0) {
        if (!confirm('Bestehende Route ersetzen?')) {
          e.target.value = '';
          return;
        }
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const gpxData = PeakflowExport.parseGPX(evt.target.result);
          PeakflowRoutes.loadFromGPX(gpxData);
          // Switch to routes tab
          document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
          document.querySelector('[data-tab="routes"]')?.classList.add('active');
          document.getElementById('panel-routes')?.classList.add('active');
          console.log('[Peakflow] GPX file loaded: ' + file.name);
        } catch (err) {
          alert('GPX-Datei konnte nicht gelesen werden: ' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = ''; // Reset so same file can be re-imported
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

    // Snow overlay toggle
    document.getElementById('snowOverlayBtn')?.addEventListener('click', () => {
      Peakflow.toggleSnowOverlay();
      document.getElementById('snowOverlayBtn').classList.toggle('active');
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

    // Save route from toolbar button (same as sidebar save)
    document.getElementById('saveRouteToolbarBtn')?.addEventListener('click', () => {
      document.getElementById('saveRouteBtn')?.click();
    });

    // Compass — rotates with map bearing, click resets north
    const _compassRose = document.getElementById('compassRose');
    const _compassBtn = document.getElementById('compassBtn');
    const _syncCompass = () => {
      if (_compassRose) {
        const bearing = this.map.getBearing();
        _compassRose.style.transform = `rotate(${-bearing}deg)`;
        _compassRose.style.transition = 'transform 0.15s linear';
      }
    };
    this.map.on('rotate', _syncCompass);
    this.map.on('load', _syncCompass);
    _compassBtn?.addEventListener('click', () => {
      this.map.resetNorth({ duration: 500 });
    });

    // Route start CTA is rendered inside _showStartPointPicker() (routes.js)

    // Undo last waypoint
    document.getElementById('undoWaypointBtn')?.addEventListener('click', () => {
      PeakflowRoutes.undoLastWaypoint();
    });

    // Close elevation profile
    document.getElementById('closeElevation').addEventListener('click', () => {
      document.getElementById('elevationProfile').classList.add('hidden');
      PeakflowRoutes._elevationVisible = false;
      const toggleBtn = document.getElementById('elevationToggleBtn');
      if (toggleBtn) toggleBtn.classList.remove('active');
    });

    // Toggle elevation profile button — user explicitly shows/hides
    document.getElementById('elevationToggleBtn')?.addEventListener('click', () => {
      const profile = document.getElementById('elevationProfile');
      const btn = document.getElementById('elevationToggleBtn');
      if (profile) {
        const isHidden = profile.classList.toggle('hidden');
        PeakflowRoutes._elevationVisible = !isHidden;
        btn.classList.toggle('active', !isHidden);
      }
    });

    // Profile selector (hiking, running, cycling)
    const profileSelect = document.getElementById('profileSelect');
    if (profileSelect) {
      // Restore saved profile from localStorage
      const savedProfile = localStorage.getItem('peakflow_profile');
      if (savedProfile && PeakflowUtils.PROFILES[savedProfile]) {
        profileSelect.value = savedProfile;
        PeakflowUtils.currentProfile = savedProfile;
      }

      profileSelect.addEventListener('change', () => {
        const oldType = PeakflowUtils.PROFILES[PeakflowUtils.currentProfile]?.type;
        PeakflowUtils.currentProfile = profileSelect.value;
        const newType = PeakflowUtils.PROFILES[PeakflowUtils.currentProfile]?.type;
        localStorage.setItem('peakflow_profile', profileSelect.value);

        // Update route color
        PeakflowRoutes.updateRouteColor();

        if (PeakflowRoutes.routeCoords && PeakflowRoutes.routeCoords.length >= 2) {
          // If activity TYPE changed (hike↔bike), re-route with different BRouter profile
          if (oldType !== newType) {
            console.log('[Peakflow] Activity type changed:', oldType, '→', newType, '— re-routing');
            PeakflowRoutes._segmentCache = {}; // Clear cache, different profile needs different routes
            PeakflowRoutes.updateRoute();
          } else {
            // Same type, just recalculate stats (speed/time)
            PeakflowRoutes.updateStats();
            PeakflowRoutes.drawElevationProfile();
          }
        }
        console.log('[Peakflow] Activity changed to:', profileSelect.value);
      });
    }

    // Offline save - cache map tiles for current route area
    document.getElementById('offlineSaveBtn').addEventListener('click', () => {
      const coords = PeakflowRoutes.routeCoords;
      if (!coords || coords.length < 2) {
        alert('Bitte zuerst eine Route planen!');
        return;
      }

      const btn = document.getElementById('offlineSaveBtn');
      btn.disabled = true;
      btn.innerHTML = '⏳ Wird gespeichert...';

      // Calculate tile URLs for zoom levels 12-16 around the route
      const lngs = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      const pad = 0.01;
      const bounds = {
        minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad,
        minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad
      };

      const tileUrls = [];
      for (let z = 12; z <= 15; z++) {
        const minX = Math.floor((bounds.minLng + 180) / 360 * Math.pow(2, z));
        const maxX = Math.floor((bounds.maxLng + 180) / 360 * Math.pow(2, z));
        const minY = Math.floor((1 - Math.log(Math.tan(bounds.maxLat * Math.PI / 180) + 1 / Math.cos(bounds.maxLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
        const maxY = Math.floor((1 - Math.log(Math.tan(bounds.minLat * Math.PI / 180) + 1 / Math.cos(bounds.minLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));

        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            tileUrls.push('https://tile.opentopomap.org/' + z + '/' + x + '/' + y + '.png');
          }
        }
      }

      console.log('[Peakflow] Caching ' + tileUrls.length + ' tiles for offline use');

      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'CACHE_TILES',
          urls: tileUrls
        });

        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = '✅ Offline gespeichert (' + tileUrls.length + ' Tiles)';
          setTimeout(() => {
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v14m0 0l-4-4m4 4l4-4M4 18h16"/></svg> Offline speichern';
          }, 3000);
        }, Math.min(tileUrls.length * 50, 5000));
      } else {
        btn.disabled = false;
        btn.innerHTML = 'Offline nicht verfügbar (nur HTTPS)';
      }
    });

    // Voice navigation
    document.getElementById('navStartBtn').addEventListener('click', () => {
      PeakflowNavigation.start(
        PeakflowRoutes.routeCoords,
        PeakflowRoutes.elevations,
        this.allPOIs
      );
    });

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
    // Aggressively prevent Chrome email autofill
    searchInput.value = '';
    setTimeout(() => { searchInput.value = ''; }, 100);
    setTimeout(() => { searchInput.value = ''; }, 500);
    setTimeout(() => { searchInput.value = ''; }, 1000);
    // Expand search on focus — hide activity select to make room
    var searchContainer = document.querySelector('.header__search');
    var _profSel = document.getElementById('profileSelect');
    searchInput.addEventListener('focus', () => {
      searchContainer.classList.add('header__search--expanded');
      if (_profSel) _profSel.style.display = 'none';
    });
    searchInput.addEventListener('blur', () => {
      setTimeout(() => {
        searchContainer.classList.remove('header__search--expanded');
        if (_profSel) _profSel.style.display = '';
      }, 200);
    });

    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const q = e.target.value.trim();
      if (q.includes('@')) return; // Ignore email autofill
      searchTimeout = setTimeout(() => this.showSearchResults(q), 400);
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

    // Re-add layers after style loads — use both event + delayed fallback for mobile reliability
    var routeRedrawn = false;
    var self = this;
    var redrawAfterStyleChange = function() {
      if (routeRedrawn) return;
      routeRedrawn = true;
      if (self.terrainEnabled) self.enableTerrain();

      // Re-add route if exists - force re-add by clearing source reference first
      if (PeakflowRoutes.routeCoords && PeakflowRoutes.routeCoords.length > 0) {
        // Style change destroys all sources/layers, so drawRouteLine will re-create them
        PeakflowRoutes.drawRouteLine(PeakflowRoutes.routeCoords);
      }

      // Re-add POI markers
      if (typeof self.addPOIMarkers === 'function') {
        self.addPOIMarkers();
      }
    };
    this.map.once('style.load', redrawAfterStyleChange);
    // Fallback: if style.load doesn't fire within 2s (mobile issue), force redraw
    setTimeout(redrawAfterStyleChange, 2000);
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
    const icons = { summit: '⛰️', hut: '🏠', pass: '🔀' };

    // 1. Local POI results (instant)
    if (this.allPOIs) {
      this.allPOIs
        .filter(poi => poi.name && poi.name.toLowerCase().includes(q))
        .slice(0, 5)
        .forEach(poi => {
          results.push({
            type: 'poi', icon: icons[poi.type] || '📍',
            name: poi.name, detail: `${poi.elevation}m`, data: poi
          });
        });
    }

    // Show local results immediately, or loading indicator
    if (results.length > 0) this.renderSearchDropdown(results);

    // 2. Supabase peaks + sightseeing (fast, no rate limit)
    const safeQuery = query.replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '');
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE';
    try {
      const [peakResults, sightseeingResults, placesResults] = await Promise.all([
        fetch('https://wbrvkweezbeakfphssxp.supabase.co/rest/v1/peaks?name=ilike.*' + encodeURIComponent(safeQuery) + '*&select=name,lat,lng,elevation&order=elevation.desc&limit=5', {
          headers: { 'apikey': supabaseKey }
        }).then(r => r.json()).catch(() => []),
        fetch('https://wbrvkweezbeakfphssxp.supabase.co/rest/v1/pois_sightseeing?name=ilike.*' + encodeURIComponent(safeQuery) + '*&select=name,lat,lng,category&limit=3', {
          headers: { 'apikey': supabaseKey }
        }).then(r => r.json()).catch(() => []),
        fetch('https://wbrvkweezbeakfphssxp.supabase.co/rest/v1/places?or=(name.ilike.*' + encodeURIComponent(safeQuery) + '*,name_de.ilike.*' + encodeURIComponent(safeQuery) + '*)&select=name,name_de,lat,lng,type,population&order=population.desc.nullslast&limit=5', {
          headers: { 'apikey': supabaseKey }
        }).then(r => r.json()).catch(() => [])
      ]);

      // Add places (cities, towns, villages) — these show first in results
      var placeTypeLabels = { 'city': 'Stadt', 'town': 'Stadt', 'village': 'Dorf', 'hamlet': 'Weiler', 'suburb': 'Ortsteil' };
      (placesResults || []).forEach(p => {
        if (!p.name || results.some(r => r.name === p.name)) return;
        var displayName = p.name_de || p.name;
        var detail = placeTypeLabels[p.type] || p.type || '';
        if (p.population) detail += ' • ' + p.population.toLocaleString() + ' Einw.';
        results.push({
          type: 'place', icon: '📍', name: displayName,
          detail: detail,
          data: { lat: p.lat, lng: p.lng, placeType: p.type }
        });
      });

      // Add peaks
      (peakResults || []).forEach(p => {
        if (!p.name || results.some(r => r.name === p.name)) return;
        results.push({
          type: 'poi', icon: '⛰️', name: p.name,
          detail: Math.round(p.elevation) + 'm',
          data: { lat: p.lat, lng: p.lng, elevation: p.elevation, name: p.name, type: 'summit' }
        });
      });

      // Add sightseeing
      (sightseeingResults || []).forEach(s => {
        if (!s.name || results.some(r => r.name === s.name)) return;
        results.push({
          type: 'poi', icon: '🏛️', name: s.name,
          detail: s.category || 'Sehenswürdigkeit',
          data: { lat: s.lat, lng: s.lng, name: s.name, type: 'sightseeing' }
        });
      });
    } catch(e) {}

    // 3. Nominatim (with 3s timeout) — wait for it so places come first
    var typeLabels = {
      'village': 'Dorf', 'town': 'Stadt', 'city': 'Stadt', 'hamlet': 'Weiler',
      'peak': 'Gipfel', 'saddle': 'Pass', 'hotel': 'Hotel', 'hostel': 'Hostel',
      'alpine_hut': 'Hütte', 'restaurant': 'Restaurant', 'station': 'Bahnhof',
      'bus_stop': 'Bushaltestelle', 'parking': 'Parkplatz', 'waterfall': 'Wasserfall'
    };
    try {
      const nominatimPromise = fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
        q: query, format: 'json', limit: 5, addressdetails: 1,
        viewbox: '5.5,44.0,17.0,48.5', bounded: 0, 'accept-language': 'de'
      }), { headers: { 'User-Agent': 'PeakFlow/1.0 (https://www.peak-flow.app)' } }).then(r => r.json());
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve([]), 3000));
      const places = await Promise.race([nominatimPromise, timeoutPromise]);

      if (document.getElementById('searchInput').value.trim() === query) {
        (places || []).forEach(place => {
          if (place.class === 'boundary' && place.type === 'administrative' && !place.address?.town && !place.address?.city && !place.address?.village) return;
          var placeName = place.display_name.split(',')[0].trim();
          if (results.some(r => r.name.startsWith(placeName))) return;
          var detail = typeLabels[place.type] || place.type || '';
          var region = place.address ? (place.address.county || place.address.state || '') : '';
          if (region) detail += ' • ' + region;
          results.push({
            type: 'place',
            icon: place.type === 'peak' ? '⛰️' : place.type === 'hotel' || place.type === 'hostel' ? '🏨' : place.type === 'alpine_hut' ? '🏔️' : '📍',
            name: place.display_name.split(',').slice(0, 2).join(', '),
            detail: detail,
            data: { lat: parseFloat(place.lat), lng: parseFloat(place.lon), placeType: place.type }
          });
        });
      }
    } catch(e) {}

    // Final render with all results (sorted by renderSearchDropdown)
    this.renderSearchDropdown(results);
    console.log('[Search] "' + query + '": ' + results.length + ' results');
  },

  renderSearchDropdown(unsortedResults) {
    // Sort: places first, then peaks/mountains, then sightseeing, then rest
    const sortOrder = (r) => {
      if (r.type === 'place') return 0;
      if (r.type === 'loading') return 0;
      if (r.data && r.data.type === 'summit') return 1;
      if (r.data && (r.data.type === 'hut' || r.data.type === 'pass')) return 2;
      if (r.data && r.data.type === 'sightseeing') return 3;
      return 2;
    };
    const results = [...unsortedResults].sort((a, b) => sortOrder(a) - sortOrder(b));
    let dropdown = document.getElementById('searchDropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'searchDropdown';
      dropdown.style.cssText = `
        position: absolute; top: 100%; left: 0; margin-top: 4px;
        min-width: 320px; width: max-content; max-width: 90vw;
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

  // POI category icons
  _poiIcons: {
    viewpoint: '👁️', waterfall: '💦', parking: '🅿️', cable_car: '🚡',
    camp_site: '⛺', picnic_site: '🧺', castle: '🏰', cave: '🕳️'
  },

  // Load POI category markers on map
  async _loadPOICategory(category) {
    try {
      const bounds = this.map.getBounds();
      const south = bounds.getSouth().toFixed(4);
      const north = bounds.getNorth().toFixed(4);
      const west = bounds.getWest().toFixed(4);
      const east = bounds.getEast().toFixed(4);

      // Map UI categories to Supabase categories
      const catMap = { cable_car: 'aerialway' };
      const dbCat = catMap[category] || category;

      const url = 'https://wbrvkweezbeakfphssxp.supabase.co/rest/v1/pois_sightseeing' +
        '?category=eq.' + dbCat +
        '&lat=gte.' + south + '&lat=lte.' + north +
        '&lng=gte.' + west + '&lng=lte.' + east +
        '&name=not.is.null' +
        '&select=name,lat,lng,category&limit=200';

      const resp = await fetch(url, {
        headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE' }
      });
      if (!resp.ok) return;
      const pois = await resp.json();
      console.log('[Peakflow] POI ' + category + ': ' + pois.length + ' loaded');

      // Remove old markers for this category
      this._removePOICategory(category);

      const icon = this._poiIcons[category] || '📍';
      const markers = [];

      pois.forEach(poi => {
        const el = document.createElement('div');
        el.style.cssText = 'width:26px;height:26px;border-radius:50%;background:rgba(26,26,26,0.8);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;z-index:5;';
        el.innerHTML = icon;
        el.title = poi.name;
        const marker = new maplibregl.Marker({ element: el }).setLngLat([poi.lng, poi.lat]).addTo(this.map);
        const popup = new maplibregl.Popup({ offset: 20, maxWidth: '220px' })
          .setHTML('<div style="padding:4px;font-family:Inter,sans-serif;"><strong>' + icon + ' ' + poi.name + '</strong></div>');
        marker.setPopup(popup);
        markers.push(marker);
      });

      this._poiFilterMarkers[category] = markers;
    } catch(e) {
      console.warn('[Peakflow] POI load failed:', category, e);
    }
  },

  // Remove POI markers for a category
  _removePOICategory(category) {
    if (this._poiFilterMarkers && this._poiFilterMarkers[category]) {
      this._poiFilterMarkers[category].forEach(m => m.remove());
      delete this._poiFilterMarkers[category];
    }
  },

  // Reload visible POI categories when map moves
  _refreshPOIMarkers() {
    const active = Array.from(document.querySelectorAll('#poiFilter input:checked')).map(c => c.dataset.poi);
    active.forEach(cat => this._loadPOICategory(cat));
  },

  // Load all water sources in current map viewport
  async _loadViewportWaterSources() {
    try {
      const bounds = this.map.getBounds();
      const south = bounds.getSouth().toFixed(4);
      const north = bounds.getNorth().toFixed(4);
      const west = bounds.getWest().toFixed(4);
      const east = bounds.getEast().toFixed(4);

      const url = 'https://wbrvkweezbeakfphssxp.supabase.co/rest/v1/water_sources' +
        '?lat=gte.' + south + '&lat=lte.' + north +
        '&lng=gte.' + west + '&lng=lte.' + east +
        '&select=osm_id,name,type,lat,lng&limit=500';

      const resp = await fetch(url, {
        headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE' }
      });
      if (!resp.ok) return;
      const nodes = await resp.json();
      console.log('[Peakflow] Viewport water sources: ' + nodes.length);

      // Remove old viewport markers
      if (PeakflowRoutes._waterMarkers) {
        PeakflowRoutes._waterMarkers.forEach(m => m.remove());
      }
      PeakflowRoutes._waterMarkers = [];

      nodes.forEach(node => {
        const type = node.type === 'spring' ? '🏔️ Quelle' : node.type === 'water_well' ? '🪣 Brunnen' : '🚰 Trinkwasser';
        const el = document.createElement('div');
        el.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#3b82f6;border:2px solid white;box-shadow:0 0 6px rgba(59,130,246,0.4);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;z-index:5;';
        el.innerHTML = '💧';
        el.title = (node.name || type);
        const marker = new maplibregl.Marker({ element: el }).setLngLat([node.lng, node.lat]).addTo(this.map);
        const popup = new maplibregl.Popup({ offset: 20, maxWidth: '200px' })
          .setHTML('<div style="padding:4px;font-family:Inter,sans-serif;"><strong>💧 ' + (node.name || 'Wasserquelle') + '</strong><div style="font-size:12px;color:#666;">' + type + '</div></div>');
        marker.setPopup(popup);
        PeakflowRoutes._waterMarkers.push(marker);
      });
    } catch(e) {
      console.warn('[Peakflow] Viewport water load failed:', e);
    }
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
      document.getElementById('settingsShowWater').checked = profile.show_water !== false;
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
      document.getElementById('settingsShowWater').checked = true;
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
        show_water: document.getElementById('settingsShowWater').checked,
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
    if (profile.activity_profile && PeakflowUtils.PROFILES[profile.activity_profile]) {
      PeakflowUtils.currentProfile = profile.activity_profile;
      var profileSelect = document.getElementById('profileSelect');
      if (profileSelect) profileSelect.value = profile.activity_profile;
      localStorage.setItem('peakflow_profile', profile.activity_profile);
      PeakflowRoutes.updateRouteColor();
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

    // Water sources visibility
    if (typeof profile.show_water === 'boolean') {
      this._waterVisible = profile.show_water;
      document.getElementById('waterToggleBtn').classList.toggle('active', profile.show_water);
      if (PeakflowRoutes._waterMarkers) {
        PeakflowRoutes._waterMarkers.forEach(function(m) {
          m.getElement().style.display = profile.show_water ? '' : 'none';
        });
      }
    }

    // Elevation profile: sync user preference to the flag routes.js reads
    // Guests always start hidden (flag stays undefined/false)
    // Logged-in users with show_elevation:true get it auto-shown after routing
    PeakflowRoutes._elevationVisible = profile.show_elevation === true;
    var elevToggleBtn = document.getElementById('elevationToggleBtn');
    if (elevToggleBtn) elevToggleBtn.classList.toggle('active', profile.show_elevation === true);
    var settingsEl = document.getElementById('settingsShowElevation');
    if (settingsEl) settingsEl.checked = profile.show_elevation === true;

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

    // Save locations list and fly to top one as active start point
    if (profile.locations && profile.locations.length > 0) {
      this._settingsLocations = profile.locations;
      PeakflowRoutes._showStartPointPicker();
      var topLoc = profile.locations[0];
      this._userLocation = { lat: topLoc.lat, lng: topLoc.lng };
      localStorage.setItem('peakflow_location', JSON.stringify(this._userLocation));
      localStorage.setItem('peakflow_city', topLoc.name);
      // Fly to first saved location
      if (this.map) {
        this.map.flyTo({ center: [topLoc.lng, topLoc.lat], zoom: 13, duration: 1500 });
      }
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

// ============================================
// WATCHLIST, WEATHER WINDOW, TOUR BUDGET, SEASONAL, GROUP TOURS
// ============================================

// ─── WATCHLIST ─────────────────────────────────────────────────────────
Peakflow.loadWatchlist = async function() {
  const container = document.getElementById('watchlistCards');
  const empty = document.getElementById('watchlistEmpty');
  if (!container) return;

  const list = await PeakflowData.getWatchlist();
  if (!list || list.length === 0) {
    container.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Get conditions for all peaks
  const conditions = await PeakflowWeather.getWatchlistConditions(list);

  let html = '';
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const c = conditions[i] || {};
    const statusColors = { go: '#22c55e', maybe: '#f59e0b', no: '#ef4444' };
    const statusLabels = { go: '🟢 Go!', maybe: '🟡 Bedingt', no: '🔴 Nicht möglich' };
    const statusBg = { go: 'rgba(34,197,94,0.1)', maybe: 'rgba(245,158,11,0.1)', no: 'rgba(239,68,68,0.1)' };

    html += '<div class="watchlist-card" style="background:' + (statusBg[c.status] || statusBg.maybe) + ';border:1px solid ' + (statusColors[c.status] || '#888') + '33;border-radius:10px;padding:12px;margin-bottom:8px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<div>' +
          '<div style="font-weight:700;font-size:14px;">' + (p.peak_name || 'Gipfel') + '</div>' +
          '<div style="font-size:12px;color:var(--text-tertiary);">' + (p.elevation || '?') + 'm</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-weight:700;color:' + (statusColors[c.status] || '#888') + ';">' + (statusLabels[c.status] || '❓') + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:12px;margin-top:8px;font-size:12px;color:var(--text-secondary);">' +
        '<span>❄️ ' + (c.snowCm >= 0 ? c.snowCm + 'cm' : '?') + '</span>' +
        '<span>' + (c.weatherIcon || '?') + ' ' + (c.temp || '?') + '°</span>' +
        '<span>💨 ' + (c.wind || '?') + ' km/h</span>' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-top:8px;">' +
        '<button class="btn btn--sm btn--primary watchlist-window-btn" data-lat="' + p.lat + '" data-lng="' + p.lng + '" data-name="' + (p.peak_name || '') + '">🌤 Wetter-Fenster</button>' +
        '<button class="btn btn--sm btn--outline watchlist-route-btn" data-lat="' + p.lat + '" data-lng="' + p.lng + '" data-name="' + (p.peak_name || '') + '">🗺 Route</button>' +
        '<button class="btn btn--sm watchlist-remove-btn" data-id="' + p.id + '" style="background:none;color:#ef4444;border:1px solid #ef4444;">✕</button>' +
      '</div>' +
    '</div>';
  }
  container.innerHTML = html;

  // Event: Best Window
  container.querySelectorAll('.watchlist-window-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      Peakflow.showBestWindow(parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lng), btn.dataset.name);
    });
  });

  // Event: Route to peak
  container.querySelectorAll('.watchlist-route-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      PeakflowRoutes.clearRoute();
      PeakflowRoutes.isPlanning = true;
      if (PeakflowRoutes.map) {
        PeakflowRoutes.map.flyTo({ center: [parseFloat(btn.dataset.lng), parseFloat(btn.dataset.lat)], zoom: 13, duration: 1000 });
      }
      // Switch to route tab
      document.querySelectorAll('.sidebar__tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.sidebar__panel').forEach(function(p) { p.classList.remove('active'); });
      document.querySelector('.sidebar__tab[data-tab="routes"]').classList.add('active');
      document.getElementById('panel-routes').classList.add('active');
    });
  });

  // Event: Remove from watchlist
  container.querySelectorAll('.watchlist-remove-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      await PeakflowData.removeFromWatchlist(btn.dataset.id);
      Peakflow.loadWatchlist();
    });
  });
};

// ─── BEST WEATHER WINDOW ───────────────────────────────────────────────
Peakflow.showBestWindow = async function(lat, lng, name) {
  var modal = document.getElementById('bestWindowModal');
  var content = document.getElementById('bestWindowContent');
  var peakEl = document.getElementById('bestWindowPeak');
  if (!modal || !content) return;
  modal.classList.remove('hidden');
  peakEl.textContent = name ? '📍 ' + name + (lat ? ' (' + lat.toFixed(2) + ', ' + lng.toFixed(2) + ')' : '') : '';
  content.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">⏳ Lade 7-Tage-Wetterdaten...</div>';

  var windowData = await PeakflowWeather.calculateBestWindow(lat, lng);
  if (!windowData) {
    content.innerHTML = '<p style="color:#ef4444;">Wetterdaten nicht verfügbar.</p>';
    return;
  }
  content.innerHTML = PeakflowWeather.renderBestWindowHTML(windowData);
};

// ─── TOUR BUDGET ───────────────────────────────────────────────────────
Peakflow.calculateTourBudget = async function() {
  var resultsEl = document.getElementById('tourBudgetResults');
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-tertiary);">⏳ Berechne erreichbare Gipfel...</div>';

  var hours = parseFloat(document.getElementById('tourBudgetTime').value) || 4;
  var profile = PeakflowUtils.PROFILES[PeakflowUtils.currentProfile];
  var speed = profile ? profile.flatSpeed : 4;
  // Max reachable distance (round trip): speed × hours / 2 (hin und zurück)
  var maxDistKm = speed * hours / 2;
  // Convert to rough lat/lng degree offset (~111km per degree)
  var degOffset = maxDistKm / 111;

  // Get user's current map center as start point
  var center = PeakflowRoutes.map ? PeakflowRoutes.map.getCenter() : null;
  if (!center) { resultsEl.innerHTML = '<p>Karte nicht geladen.</p>'; return; }

  // Query peaks within radius from Supabase
  try {
    var url = PeakflowData.SUPABASE_URL + '/rest/v1/peaks?select=name,lat,lng,elevation' +
      '&lat=gte.' + (center.lat - degOffset) + '&lat=lte.' + (center.lat + degOffset) +
      '&lng=gte.' + (center.lng - degOffset) + '&lng=lte.' + (center.lng + degOffset) +
      '&elevation=gt.0&limit=50&order=elevation.desc';
    var resp = await fetch(url, {
      headers: { 'apikey': PeakflowData.SUPABASE_KEY, 'Authorization': 'Bearer ' + PeakflowData.SUPABASE_KEY }
    });
    var peaks = await resp.json();

    if (!peaks || peaks.length === 0) {
      resultsEl.innerHTML = '<p class="sidebar__empty">Keine Gipfel im Umkreis von ' + maxDistKm.toFixed(0) + 'km gefunden.</p>';
      return;
    }

    // Calculate estimated time for each peak
    var results = [];
    for (var i = 0; i < peaks.length; i++) {
      var p = peaks[i];
      var distKm = PeakflowUtils.haversineDistance(center.lat, center.lng, p.lat, p.lng);
      if (distKm > maxDistKm) continue;
      var ascentEstimate = Math.max(0, (p.elevation || 0) - (center.lat > 0 ? 800 : 500)); // rough valley elevation
      var time = PeakflowUtils.calculateTime(distKm * 2, ascentEstimate, ascentEstimate);
      if (time.totalMinutes <= hours * 60) {
        results.push({ name: p.name, elevation: p.elevation, dist: distKm, time: time, lat: p.lat, lng: p.lng });
      }
    }

    results.sort(function(a, b) { return (b.elevation || 0) - (a.elevation || 0); });

    if (results.length === 0) {
      resultsEl.innerHTML = '<p class="sidebar__empty">In ' + hours + 'h leider kein Gipfel erreichbar.</p>';
      return;
    }

    var html = '';
    for (var j = 0; j < Math.min(results.length, 8); j++) {
      var r = results[j];
      html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color);cursor:pointer;" class="budget-peak" data-lat="' + r.lat + '" data-lng="' + r.lng + '">' +
        '<span style="font-size:18px;">⛰</span>' +
        '<div style="flex:1;">' +
          '<div style="font-weight:600;font-size:13px;">' + (r.name || 'Gipfel') + '</div>' +
          '<div style="font-size:11px;color:var(--text-tertiary);">' + r.elevation + 'm · ' + r.dist.toFixed(1) + 'km · ' + PeakflowUtils.formatDuration(r.time.hours, r.time.minutes) + '</div>' +
        '</div>' +
        '<span style="font-size:11px;color:#22c55e;">✓</span>' +
      '</div>';
    }
    resultsEl.innerHTML = html;

    // Click to fly to peak
    resultsEl.querySelectorAll('.budget-peak').forEach(function(el) {
      el.addEventListener('click', function() {
        if (PeakflowRoutes.map) {
          PeakflowRoutes.map.flyTo({ center: [parseFloat(el.dataset.lng), parseFloat(el.dataset.lat)], zoom: 14, duration: 1000 });
        }
      });
    });
  } catch (e) {
    resultsEl.innerHTML = '<p style="color:#ef4444;">Fehler beim Laden: ' + e.message + '</p>';
  }
};

// ─── SEASONAL SUGGESTIONS ──────────────────────────────────────────────
Peakflow.loadSeasonalSuggestions = async function() {
  var container = document.getElementById('seasonalSuggestions');
  if (!container) return;

  var center = PeakflowRoutes.map ? PeakflowRoutes.map.getCenter() : { lat: 47.3, lng: 10.15 };
  var month = new Date().getMonth() + 1;
  var maxElev, label;
  if (month >= 3 && month <= 5) { maxElev = 1800; label = '🌱 Frühling: Schneefrei unter 1800m'; }
  else if (month >= 6 && month <= 8) { maxElev = 4000; label = '☀️ Sommer: Hochtouren möglich'; }
  else if (month >= 9 && month <= 10) { maxElev = 2500; label = '🍂 Herbst: Goldene Tage'; }
  else { maxElev = 1500; label = '❄️ Winter: Winterwanderungen'; }

  container.innerHTML = '<p style="font-weight:600;font-size:13px;margin-bottom:8px;">' + label + '</p><div style="text-align:center;color:var(--text-tertiary);">⏳ Lade...</div>';

  try {
    var degOffset = 0.5; // ~55km radius
    var url = PeakflowData.SUPABASE_URL + '/rest/v1/peaks?select=name,lat,lng,elevation' +
      '&lat=gte.' + (center.lat - degOffset) + '&lat=lte.' + (center.lat + degOffset) +
      '&lng=gte.' + (center.lng - degOffset) + '&lng=lte.' + (center.lng + degOffset) +
      '&elevation=gt.500&elevation=lte.' + maxElev + '&limit=5&order=elevation.desc';
    var resp = await fetch(url, {
      headers: { 'apikey': PeakflowData.SUPABASE_KEY, 'Authorization': 'Bearer ' + PeakflowData.SUPABASE_KEY }
    });
    var peaks = await resp.json();

    if (!peaks || peaks.length === 0) {
      container.innerHTML = '<p style="font-weight:600;font-size:13px;">' + label + '</p><p class="sidebar__empty">Keine passenden Gipfel in der Nähe.</p>';
      return;
    }

    var html = '<p style="font-weight:600;font-size:13px;margin-bottom:8px;">' + label + '</p>';
    for (var i = 0; i < peaks.length; i++) {
      var p = peaks[i];
      html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color);cursor:pointer;" class="seasonal-peak" data-lat="' + p.lat + '" data-lng="' + p.lng + '">' +
        '<span style="font-size:16px;">⛰</span>' +
        '<div style="flex:1;"><span style="font-weight:600;font-size:13px;">' + (p.name || 'Gipfel') + '</span> <span style="font-size:11px;color:var(--text-tertiary);">' + p.elevation + 'm</span></div>' +
      '</div>';
    }
    container.innerHTML = html;

    container.querySelectorAll('.seasonal-peak').forEach(function(el) {
      el.addEventListener('click', function() {
        if (PeakflowRoutes.map) {
          PeakflowRoutes.map.flyTo({ center: [parseFloat(el.dataset.lng), parseFloat(el.dataset.lat)], zoom: 14, duration: 1000 });
        }
      });
    });
  } catch (e) {
    container.innerHTML = '<p style="font-weight:600;font-size:13px;">' + label + '</p><p class="sidebar__empty">Fehler beim Laden.</p>';
  }
};

// ─── GROUP TOURS ───────────────────────────────────────────────────────
Peakflow.loadGroupTours = async function() {
  var container = document.getElementById('groupToursList');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-tertiary);">⏳ Lade Touren...</div>';

  var tours = await PeakflowData.getGroupTours();
  if (!tours || tours.length === 0) {
    container.innerHTML = '<p class="sidebar__empty">Keine kommenden Touren.<br><br>' +
      (PeakflowData.currentUser ? '<button class="btn btn--primary" id="createTourFromList" style="width:100%;">👥 Erste Tour erstellen</button>' : 'Melde dich an um eine Tour zu erstellen.') + '</p>';
    var createBtn = document.getElementById('createTourFromList');
    if (createBtn) createBtn.addEventListener('click', function() { Peakflow.openGroupTourModal(); });
    return;
  }

  var html = '';
  if (PeakflowData.currentUser) {
    html += '<button class="btn btn--primary btn--full" id="createTourBtn" style="margin-bottom:12px;">👥 Tour erstellen</button>';
  }
  var fmtDate = function(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  for (var i = 0; i < tours.length; i++) {
    var t = tours[i];
    var partCount = t.group_tour_participants?.[0]?.count || 0;
    var diffColors = { leicht: '#22c55e', mittel: '#f59e0b', schwer: '#ef4444', experte: '#dc2626' };
    html += '<div class="group-tour-card" style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;padding:12px;margin-bottom:8px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<div style="font-weight:700;font-size:14px;">' + (t.title || 'Tour') + '</div>' +
        '<span style="font-size:11px;padding:2px 8px;border-radius:12px;background:' + (diffColors[t.difficulty] || '#888') + '22;color:' + (diffColors[t.difficulty] || '#888') + ';font-weight:600;">' + (t.difficulty || 'mittel') + '</span>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">' +
        '📅 ' + fmtDate(t.tour_date) + (t.start_time ? ' · ⏰ ' + t.start_time.substring(0, 5) : '') +
        (t.meeting_point ? ' · 📍 ' + t.meeting_point : '') +
      '</div>' +
      (t.distance ? '<div style="font-size:12px;color:var(--text-tertiary);margin-top:2px;">📏 ' + parseFloat(t.distance).toFixed(1) + 'km' + (t.ascent ? ' · ↑' + t.ascent + 'm' : '') + '</div>' : '') +
      (t.description ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">' + t.description + '</div>' : '') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">' +
        '<span style="font-size:12px;">👥 ' + partCount + '/' + (t.max_participants || 10) + ' Plätze</span>' +
        '<button class="btn btn--sm btn--primary tour-join-btn" data-tour-id="' + t.id + '">🙋 Ich bin dabei!</button>' +
      '</div>' +
    '</div>';
  }
  container.innerHTML = html;

  var createBtn2 = document.getElementById('createTourBtn');
  if (createBtn2) createBtn2.addEventListener('click', function() { Peakflow.openGroupTourModal(); });

  container.querySelectorAll('.tour-join-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!PeakflowData.currentUser) { alert('Bitte zuerst anmelden!'); return; }
      var result = await PeakflowData.joinGroupTour(btn.dataset.tourId);
      if (result.error) { alert('Fehler: ' + result.error); return; }
      btn.textContent = '✅ Angemeldet';
      btn.disabled = true;
      Peakflow.loadGroupTours();
    });
  });
};

Peakflow.openGroupTourModal = function() {
  if (!PeakflowData.currentUser) { alert('Bitte zuerst anmelden!'); return; }
  var modal = document.getElementById('groupTourModal');
  if (modal) modal.classList.remove('hidden');
  // Pre-fill date with next Saturday
  var next = new Date();
  next.setDate(next.getDate() + (6 - next.getDay() + 7) % 7);
  var dateInput = document.getElementById('gtDate');
  if (dateInput) dateInput.value = next.toISOString().split('T')[0];
};

Peakflow.saveGroupTour = async function() {
  var title = document.getElementById('gtTitle').value.trim();
  var date = document.getElementById('gtDate').value;
  if (!title || !date) { alert('Bitte Tour-Name und Datum eingeben!'); return; }

  var coords = PeakflowRoutes.routeCoords || [];
  var waypoints = PeakflowRoutes.waypoints || [];
  var distance = coords.length > 1 ? PeakflowUtils.routeDistance(coords) : 0;
  var elevData = coords.length > 1 ? PeakflowUtils.calculateElevationGain(coords.map(function(c) { return c[2] || 0; })) : { ascent: 0, descent: 0 };
  var startWp = waypoints[0] || {};

  var tour = {
    title: title,
    description: document.getElementById('gtDescription').value.trim() || null,
    route_coords: coords,
    waypoints: waypoints,
    distance: Math.round(distance * 10) / 10,
    ascent: elevData.ascent,
    descent: elevData.descent,
    tour_date: date,
    start_time: document.getElementById('gtTime').value || null,
    meeting_point: document.getElementById('gtMeetingPoint').value.trim() || null,
    meeting_lat: startWp.lat || null,
    meeting_lng: startWp.lng || null,
    max_participants: parseInt(document.getElementById('gtMaxPart').value) || 10,
    difficulty: document.getElementById('gtDifficulty').value || 'mittel',
    activity_type: PeakflowUtils.isBikeProfile() ? 'bike' : 'hike'
  };

  var result = await PeakflowData.createGroupTour(tour);
  if (result.error) { alert('Fehler: ' + (result.error.message || result.error)); return; }

  document.getElementById('groupTourModal').classList.add('hidden');
  alert('Tour erstellt! 🎉 Teile den Link mit Freunden.');
  Peakflow.loadGroupTours();
};

// ─── SNOW CONDITIONS OVERLAY ───────────────────────────────────────────
Peakflow._snowOverlayVisible = false;
Peakflow._snowOverlayCache = {};

Peakflow.toggleSnowOverlay = async function() {
  var map = PeakflowRoutes.map;
  if (!map) return;

  if (this._snowOverlayVisible) {
    // Remove overlay
    if (map.getLayer('snow-grid')) map.removeLayer('snow-grid');
    if (map.getSource('snow-grid')) map.removeSource('snow-grid');
    this._snowOverlayVisible = false;
    return;
  }

  // Build snow grid for current viewport
  var bounds = map.getBounds();
  var step = 0.05; // ~5km grid cells
  var features = [];
  var fetches = [];

  for (var lat = bounds.getSouth(); lat < bounds.getNorth(); lat += step) {
    for (var lng = bounds.getWest(); lng < bounds.getEast(); lng += step) {
      var key = lat.toFixed(2) + ',' + lng.toFixed(2);
      if (this._snowOverlayCache[key]) {
        features.push(this._createSnowFeature(lat, lng, step, this._snowOverlayCache[key]));
      } else {
        (function(lat2, lng2, key2) {
          fetches.push(
            PeakflowWeather._rateLimitedFetch(
              PeakflowWeather.BASE_URL + '/forecast?latitude=' + lat2.toFixed(3) + '&longitude=' + lng2.toFixed(3) + '&hourly=snow_depth&forecast_days=1&timezone=auto'
            ).then(function(r) { return r.json(); })
            .then(function(data) {
              var snow = data.hourly?.snow_depth?.[new Date().getHours()] || 0;
              var snowCm = Math.round(snow * 100);
              Peakflow._snowOverlayCache[key2] = snowCm;
              features.push(Peakflow._createSnowFeature(lat2, lng2, step, snowCm));
            }).catch(function() {})
          );
        })(lat, lng, key);
      }
      if (fetches.length >= 30) break; // Max 30 API calls
    }
    if (fetches.length >= 30) break;
  }

  if (fetches.length > 0) await Promise.all(fetches);

  var geojson = { type: 'FeatureCollection', features: features };
  if (map.getSource('snow-grid')) {
    map.getSource('snow-grid').setData(geojson);
  } else {
    map.addSource('snow-grid', { type: 'geojson', data: geojson });
    map.addLayer({
      id: 'snow-grid',
      type: 'fill',
      source: 'snow-grid',
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.35
      }
    }, 'route-outline'); // Below route line
  }
  this._snowOverlayVisible = true;
};

Peakflow._createSnowFeature = function(lat, lng, step, snowCm) {
  var color = '#22c55e'; // green = snow free
  if (snowCm > 50) color = '#ffffff';
  else if (snowCm > 20) color = '#f97316';
  else if (snowCm > 5) color = '#facc15';
  return {
    type: 'Feature',
    properties: { snowCm: snowCm, color: color },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng, lat], [lng + step, lat], [lng + step, lat + step], [lng, lat + step], [lng, lat]
      ]]
    }
  };
};

// ─── EVENT LISTENERS FOR NEW FEATURES ──────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Tour Budget button
  var budgetBtn = document.getElementById('tourBudgetBtn');
  if (budgetBtn) budgetBtn.addEventListener('click', function() { Peakflow.calculateTourBudget(); });

  // Group Tour modal
  var closeGT = document.getElementById('closeGroupTourModal');
  if (closeGT) closeGT.addEventListener('click', function() { document.getElementById('groupTourModal').classList.add('hidden'); });
  var saveGT = document.getElementById('saveGroupTour');
  if (saveGT) saveGT.addEventListener('click', function() { Peakflow.saveGroupTour(); });

  // Best Window modal
  var closeBW = document.getElementById('closeBestWindowModal');
  if (closeBW) closeBW.addEventListener('click', function() { document.getElementById('bestWindowModal').classList.add('hidden'); });

  // Deep-link: ?tour=ID
  var urlParams = new URLSearchParams(window.location.search);
  var tourId = urlParams.get('tour');
  if (tourId) {
    setTimeout(async function() {
      var tour = await PeakflowData.getGroupTourById(tourId);
      if (tour && tour.route_coords) {
        PeakflowRoutes.clearRoute();
        PeakflowRoutes.routeCoords = tour.route_coords;
        PeakflowRoutes.elevations = tour.route_coords.map(function(c) { return c[2] || 0; });
        PeakflowRoutes.drawRouteLine(tour.route_coords);
        // Fit map
        var lngs = tour.route_coords.map(function(c) { return c[0]; });
        var lats = tour.route_coords.map(function(c) { return c[1]; });
        if (PeakflowRoutes.map) {
          PeakflowRoutes.map.fitBounds([[Math.min.apply(null, lngs), Math.min.apply(null, lats)], [Math.max.apply(null, lngs), Math.max.apply(null, lats)]], { padding: 40 });
        }
        alert('👥 Gruppen-Tour: ' + tour.title + '\n📅 ' + tour.tour_date + (tour.start_time ? ' ⏰ ' + tour.start_time : '') + (tour.meeting_point ? '\n📍 ' + tour.meeting_point : ''));
      }
    }, 2000);
  }
});

// Alias for backward compatibility (routes.js uses PeakflowApp)
const PeakflowApp = Peakflow;

// ============================================
// BOOT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  Peakflow.init();
});
