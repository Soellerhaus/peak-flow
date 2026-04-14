/* ============================================
   PEAKFLOW - Route Planning & Elevation Profile
   ============================================ */

const PeakflowRoutes = {

  map: null,
  waypoints: [],
  routeCoords: [],
  elevations: [],
  markers: [],
  isPlanning: false,
  elevationCanvas: null,
  elevationCtx: null,
  routeColor: '#39ff14', // neon green for hiking, blue for bike
  ROUTE_COLORS: { hike: '#39ff14', bike: '#00b4d8' },

  updateRouteColor() {
    const isBike = PeakflowUtils.isBikeProfile();
    this.routeColor = isBike ? this.ROUTE_COLORS.bike : this.ROUTE_COLORS.hike;
    if (this.map && this.map.getLayer('route-line')) {
      this.map.setPaintProperty('route-line', 'line-color', this.routeColor);
    }
  },
  _routingController: null,  // AbortController for cancelling in-flight requests
  _routeDebounce: null,      // Debounce timer

  // BRouter private server via HTTPS (Contabo VPS, fast & reliable)
  BROUTER_URL: 'https://routing.peak-flow.app/brouter',
  OVERPASS_URL: 'https://overpass-api.de/api/interpreter',
  // OSRM fallback
  OSRM_URL: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',

  /**
   * Initialize route planning
   */
  init(map) {
    this.map = map;
    this.elevationCanvas = document.getElementById('elevationCanvas');
    if (this.elevationCanvas) {
      this.elevationCtx = this.elevationCanvas.getContext('2d');
    }
    // On mobile, hide elevation profile by default (saves screen space)
    if (window.innerWidth <= 768) {
      this._elevationHidden = true;
    }
    this.setupElevationHover();
  },

  /**
   * Toggle planning mode
   */
  togglePlanning() {
    this.isPlanning = !this.isPlanning;
    const btn = document.getElementById('routePlanBtn');
    if (btn) btn.classList.toggle('active', this.isPlanning);

    if (this.isPlanning) {
      if (this.map) this.map.getCanvas().style.cursor = 'crosshair';
      // Switch to routes tab
      document.querySelectorAll('.sidebar__tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sidebar__panel').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="routes"]').classList.add('active');
      document.getElementById('panel-routes').classList.add('active');

      // Show simple hint if no waypoints yet
      if (this.waypoints.length === 0) {
        const info = document.getElementById('routeInfo');
        if (info) {
          info.innerHTML = '<div style="text-align:center;padding:20px 12px;color:var(--text-secondary);font-size:14px;">' +
            '<div style="font-size:32px;margin-bottom:8px;">\uD83D\uDCCD</div>' +
            '<div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;">Tippe auf die Karte</div>' +
            '<div>um deinen Startpunkt zu setzen</div></div>';
        }
      }
    } else {
      if (this.map) this.map.getCanvas().style.cursor = '';
    }
    return this.isPlanning;
  },

  /**
   * Add a waypoint on map click
   */
  _showStartPointPicker() {
    const info = document.getElementById('routeInfo');
    if (!info) return;

    const locs = (typeof Peakflow !== 'undefined' ? Peakflow._settingsLocations : null) || [];
    const isLoggedIn = !!(typeof Peakflow !== 'undefined' && Peakflow.currentUser);

    let html = '<div class="route-start-screen">';

    // Visual header
    html += '<div class="route-start-screen__visual">';
    html += '<svg viewBox="0 0 64 40" width="68" height="43" fill="none">';
    html += '<path d="M0 38 L16 12 L28 26 L38 8 L52 28 L64 18 L64 40 Z" fill="var(--color-primary)" opacity="0.16"/>';
    html += '<path d="M0 38 L16 12 L28 26 L38 8 L52 28 L64 18" stroke="var(--color-primary)" stroke-width="2" stroke-linejoin="round" fill="none" opacity="0.65"/>';
    html += '<circle cx="38" cy="8" r="3" fill="var(--color-primary)" opacity="0.85"/>';
    html += '<circle cx="16" cy="12" r="2" fill="var(--color-primary)" opacity="0.5"/>';
    html += '</svg></div>';

    // Saved locations (if any)
    if (locs.length > 0) {
      html += '<div style="width:100%;margin-bottom:8px;">';
      locs.forEach(function(loc, i) {
        const isPrimary = i === 0;
        html += '<button class="start-loc-btn" data-index="' + i + '" style="display:block;width:100%;padding:9px 12px;margin-bottom:5px;border:1px solid ' + (isPrimary ? 'var(--color-primary)' : 'var(--border-color)') + ';border-radius:8px;background:' + (isPrimary ? 'var(--color-primary)' : 'var(--bg-tertiary)') + ';color:' + (isPrimary ? '#fff' : 'var(--text-primary)') + ';font-size:12px;font-weight:' + (isPrimary ? '700' : '500') + ';cursor:pointer;text-align:left;font-family:inherit;">';
        html += '<span style="margin-right:6px;">🏠</span>' + (loc.name || 'Standort ' + (i + 1));
        html += '</button>';
      });
      html += '</div>';
    }

    // Search field
    html += '<div style="position:relative;width:100%;margin-bottom:6px;">';
    html += '<input type="text" id="startSearchInput" placeholder="🔍 Ort als Startpunkt suchen..." style="width:100%;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);color:var(--text-primary);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;">';
    html += '<div id="startSearchResults" class="hidden" style="position:absolute;top:100%;left:0;right:0;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:0 0 8px 8px;max-height:200px;overflow-y:auto;z-index:20;"></div>';
    html += '</div>';

    // Map click hint
    html += '<p class="route-start-screen__sub" style="margin-top:4px;">📍 oder direkt auf die Karte tippen</p>';

    // Login CTA (only for guests)
    if (!isLoggedIn) {
      html += '<div class="route-signup-card" id="routeStartCta">';
      html += '<div class="route-signup-card__title">Kostenlos registrieren</div>';
      html += '<ul class="route-signup-card__features">';
      html += '<li><span class="route-signup-card__check">✓</span>5 Startpunkte speichern</li>';
      html += '<li><span class="route-signup-card__check">✓</span>Routenfarben anpassen</li>';
      html += '<li><span class="route-signup-card__check">✓</span>Einstellungen speichern</li>';
      html += '<li><span class="route-signup-card__check">✓</span>Bergkönig tracken</li>';
      html += '<li><span class="route-signup-card__check">✓</span>GPX exportieren & teilen</li>';
      html += '<li><span class="route-signup-card__check">✓</span>Routen speichern</li>';
      html += '</ul>';
      html += '<button class="route-signup-card__btn">Jetzt kostenlos anmelden →</button>';
      html += '</div>';
    }

    html += '</div>';
    info.innerHTML = html;

    // CTA click → open auth modal
    const cta = info.querySelector('#routeStartCta');
    if (cta) cta.addEventListener('click', () => {
      const m = document.getElementById('authModal');
      if (m) m.classList.remove('hidden');
    });

    const self = this;

    // Saved location buttons
    info.querySelectorAll('.start-loc-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const idx = parseInt(btn.dataset.index);
        const loc = locs[idx];
        self.addWaypoint({ lng: loc.lng, lat: loc.lat, name: loc.name });
        // Ensure planning mode is active for next waypoint
        self.isPlanning = true;
        if (self.map) self.map.getCanvas().style.cursor = 'crosshair';
        var planBtn = document.getElementById('routePlanBtn');
        if (planBtn) planBtn.classList.add('active');
        // Collapse sidebar on mobile so user can pick next waypoint on map
        var sidebar = document.querySelector('.sidebar');
        if (sidebar && window.innerWidth < 768) {
          sidebar.classList.remove('expanded', 'fully-expanded');
          sidebar.classList.add('collapsed');
        }
        // Fly to location
        if (self.map) self.map.flyTo({ center: [loc.lng, loc.lat], zoom: 14, duration: 800 });
      });
    });

    // Search field with Nominatim
    const searchInput = document.getElementById('startSearchInput');
    const searchResults = document.getElementById('startSearchResults');
    let searchTimeout = null;

    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      const q = searchInput.value.trim();
      if (q.length < 2) { searchResults.classList.add('hidden'); return; }
      searchTimeout = setTimeout(async function() {
        try {
          const resp = await fetch('https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(q) + '&format=json&limit=5&viewbox=5.5,45.5,17.5,48.5&bounded=0');
          const results = await resp.json();
          if (results.length === 0) {
            searchResults.innerHTML = '<div style="padding:8px;font-size:12px;color:var(--text-tertiary);">Kein Ergebnis</div>';
          } else {
            searchResults.innerHTML = results.map(function(r) {
              return '<div class="start-search-item" data-lat="' + r.lat + '" data-lng="' + r.lon + '" data-name="' + r.display_name.split(',')[0] + '" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border-color);">' + r.display_name.split(',').slice(0, 2).join(', ') + '</div>';
            }).join('');
            searchResults.querySelectorAll('.start-search-item').forEach(function(item) {
              item.addEventListener('click', function() {
                self.addWaypoint({ lng: parseFloat(item.dataset.lng), lat: parseFloat(item.dataset.lat), name: item.dataset.name });
                searchResults.classList.add('hidden');
                // Collapse sidebar on mobile
                var sidebar = document.querySelector('.sidebar');
                if (sidebar && window.innerWidth < 768) {
                  sidebar.classList.remove('expanded', 'fully-expanded');
                  sidebar.classList.add('collapsed');
                }
                if (self.map) self.map.flyTo({ center: [parseFloat(item.dataset.lng), parseFloat(item.dataset.lat)], zoom: 14, duration: 800 });
              });
              item.addEventListener('mouseover', function() { item.style.background = 'var(--bg-tertiary)'; });
              item.addEventListener('mouseout', function() { item.style.background = ''; });
            });
          }
          searchResults.classList.remove('hidden');
        } catch(e) { console.warn('Start search failed:', e); }
      }, 400);
    });
  },

  /**
   * Add a waypoint on map click
   */
  async addWaypoint(lngLat) {
    if (!this.isPlanning) return;

    // If insert mode is active, insert at specific position
    if (this._insertAfterIndex != null) {
      const idx = this._insertAfterIndex;
      this._insertAfterIndex = null;
      const hint = document.getElementById('routeInfo');
      if (hint) hint.innerHTML = '';
      this.insertWaypointAt(idx, lngLat);
      return;
    }

    const wp = { lng: lngLat.lng, lat: lngLat.lat, index: this.waypoints.length, name: lngLat.name || null };
    this.waypoints.push(wp);

    // Add marker — first marker gets 🏁 flag icon
    const isFirst = this.waypoints.length === 1;
    const el = document.createElement('div');
    el.className = 'route-marker';
    el.innerHTML = isFirst ? '<span>🏁</span>' : `<span>${this.waypoints.length}</span>`;
    el.style.cssText = `
      width: 28px; height: 28px; background: var(--color-primary, #c9a84c);
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      color: white; font-size: ${isFirst ? '15px' : '12px'}; font-weight: 700; border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3); cursor: ${isFirst ? 'pointer' : 'grab'}; font-family: Inter, sans-serif;
    `;

    const marker = new maplibregl.Marker({ element: el, draggable: !isFirst })
      .setLngLat([wp.lng, wp.lat])
      .addTo(this.map);

    // First marker: click to close the loop (return to start)
    if (isFirst) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.waypoints.length < 3) return; // Need at least 3 points for a loop
        // Add start point as final waypoint → closes the loop
        const start = this.waypoints[0];
        this._fitAfterRoute = true;
        this.addWaypoint({ lng: start.lng, lat: start.lat, name: start.name || '🏁 Ziel' });
      });
    }

    // Drag handler (not for first marker)
    if (!isFirst) {
      marker.on('dragend', () => {
        const pos = marker.getLngLat();
        this.waypoints[wp.index].lng = pos.lng;
        this.waypoints[wp.index].lat = pos.lat;
        this.updateRoute();
      });
    }

    // Right-click to remove
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.removeWaypoint(wp.index);
    });

    this.markers.push(marker);

    // Update hint text based on waypoint count
    const info = document.getElementById('routeInfo');
    if (info) {
      if (this.waypoints.length === 1) {
        info.innerHTML = '<p class="route-planner__hint">📍 Klicke auf die Karte oder wähle einen Gipfel als nächsten Wegpunkt</p>';
      } else {
        info.innerHTML = ''; // Hide hint after 2+ waypoints
      }
    }

    this.updateWaypointList();
    this._updateUndoButton();

    // Update route if we have 2+ waypoints
    if (this.waypoints.length >= 2) {
      // Debounce: cancel pending timer + abort in-flight request, then wait 250ms
      // No straight-line preview — only real trail routes are drawn
      clearTimeout(this._routeDebounce);
      if (this._routingController) this._routingController.abort();
      this._routeDebounce = setTimeout(() => this.updateRoute(), 250);
    } else {
      this.updateStats();
    }
  },

  /**
   * Insert a waypoint at a specific position in the route
   */
  insertWaypointAt(position, lngLat) {
    const wp = { lng: lngLat.lng, lat: lngLat.lat, index: position, name: lngLat.name || null };
    this.waypoints.splice(position, 0, wp);
    // Re-index all waypoints
    this.waypoints.forEach((w, i) => w.index = i);
    // Rebuild all markers (simpler than inserting mid-array)
    this.markers.forEach(m => m.remove());
    this.markers = [];
    this.waypoints.forEach((w, i) => {
      const el = document.createElement('div');
      el.className = 'route-marker';
      el.innerHTML = `<span>${i + 1}</span>`;
      el.style.cssText = `width:28px;height:28px;background:var(--color-primary,#c9a84c);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:700;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);cursor:grab;font-family:Inter,sans-serif;`;
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([w.lng, w.lat]).addTo(this.map);
      marker.on('dragend', () => {
        // Use current index (w.index is kept up-to-date by re-indexing)
        const idx = this.markers.indexOf(marker);
        if (idx >= 0 && this.waypoints[idx]) {
          const pos = marker.getLngLat();
          this.waypoints[idx].lng = pos.lng;
          this.waypoints[idx].lat = pos.lat;
          this.updateRoute();
        }
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const idx = this.markers.indexOf(marker);
        if (idx >= 0) this.removeWaypoint(idx);
      });
      // Long-press to delete on mobile
      let longPressTimer;
      el.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
          const idx = this.markers.indexOf(marker);
          if (idx >= 0) {
            navigator.vibrate && navigator.vibrate(50);
            this.removeWaypoint(idx);
          }
        }, 600);
      }, { passive: true });
      el.addEventListener('touchend', () => clearTimeout(longPressTimer));
      el.addEventListener('touchmove', () => clearTimeout(longPressTimer));
      this.markers.push(marker);
    });
    this.updateWaypointList();
    clearTimeout(this._routeDebounce);
    if (this._routingController) this._routingController.abort();
    this._routeDebounce = setTimeout(() => this.updateRoute(), 250);
  },

  /**
   * Enable route dragging - click on route line to add intermediate waypoint
   */
  enableRouteDrag() {
    if (!this.map || this._routeDragEnabled) return;
    this._routeDragEnabled = true;

    // Click on route line → insert waypoint at nearest segment
    this.map.on('click', 'route-line', (e) => {
      if (!this.isPlanning || this.waypoints.length < 2) return;
      // Prevent the map click handler from ALSO adding a waypoint
      this._skipNextMapClick = true;
      const clickLng = e.lngLat.lng, clickLat = e.lngLat.lat;
      let bestSeg = 0, bestDist = Infinity;
      for (let i = 0; i < this.waypoints.length - 1; i++) {
        const midLat = (this.waypoints[i].lat + this.waypoints[i+1].lat) / 2;
        const midLng = (this.waypoints[i].lng + this.waypoints[i+1].lng) / 2;
        const d = Math.pow(clickLat - midLat, 2) + Math.pow(clickLng - midLng, 2);
        if (d < bestDist) { bestDist = d; bestSeg = i + 1; }
      }
      this.insertWaypointAt(bestSeg, e.lngLat);
    });

    // Change cursor on route hover
    this.map.on('mouseenter', 'route-line', () => {
      if (this.isPlanning) this.map.getCanvas().style.cursor = 'copy';
    });
    this.map.on('mouseleave', 'route-line', () => {
      if (this.isPlanning) this.map.getCanvas().style.cursor = 'crosshair';
    });
  },

  /**
   * Render the waypoint list in sidebar
   */
  updateWaypointList() {
    const container = document.getElementById('waypointList');
    if (!container) return;

    // Show/hide waypoint accordion
    var wpAccordion = document.getElementById('waypointAccordion');
    if (this.waypoints.length === 0) {
      container.innerHTML = '';
      if (wpAccordion) wpAccordion.classList.add('hidden');
      return;
    }

    if (wpAccordion) {
      wpAccordion.classList.remove('hidden');
      // Update accordion title with count
      var titleEl = document.getElementById('waypointAccordionTitle');
      if (titleEl) titleEl.textContent = '\uD83D\uDCCD ' + this.waypoints.length + ' Wegpunkte';
    }
    const MAX_VISIBLE = 5;
    const collapsed = this.waypoints.length > MAX_VISIBLE && !this._wpExpanded;
    let html = '';
    this.waypoints.forEach((wp, i) => {
      const hidden = collapsed && i >= 3 && i < this.waypoints.length - 2 ? ' style="display:none;" data-wp-hidden="1"' : '';
      if (collapsed && i === 3) {
        html += `<div class="waypoint-expand" id="wpExpandBtn" style="text-align:center;padding:6px;cursor:pointer;font-size:12px;font-weight:600;color:var(--color-primary);border:1px dashed var(--border-color);border-radius:6px;margin:2px 0;">▼ Alle ${this.waypoints.length} Wegpunkte anzeigen</div>`;
      }
      html += `<div class="waypoint-item" data-index="${i}"${hidden}>
        <div class="waypoint-item__num">${i + 1}</div>
        <div class="waypoint-item__coords" id="wp-name-${i}">${wp.name || wp.lat.toFixed(4) + ', ' + wp.lng.toFixed(4)}</div>
        <button class="waypoint-item__delete" data-index="${i}" title="Wegpunkt löschen">✕</button>
      </div>`;
      // "+" button between waypoints (hidden when collapsed)
      if (i < this.waypoints.length - 1) {
        const insertHidden = collapsed && i >= 3 && i < this.waypoints.length - 2 ? ' style="display:none;" data-wp-hidden="1"' : '';
        html += `<div class="waypoint-insert" data-after="${i}"${insertHidden}>
          <span class="waypoint-insert__line"></span>
          <button class="waypoint-insert__btn" title="Zwischenstopp">+</button>
          <span class="waypoint-insert__line"></span>
        </div>`;
      }
    });
    container.innerHTML = html;

    // Reverse geocode ONLY waypoints that don't have names yet AND haven't been tried
    this.waypoints.forEach((wp, i) => {
      if (!wp.name && !wp._geocodePending && !wp._geocodeFailed) {
        wp._geocodePending = true;
        this.reverseGeocode(wp, i);
      }
    });

    // Delete handlers
    container.querySelectorAll('.waypoint-item__delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeWaypoint(parseInt(btn.dataset.index));
      });
    });

    // Expand collapsed waypoints
    const expandBtn = document.getElementById('wpExpandBtn');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        this._wpExpanded = true;
        this.updateWaypointList();
      });
    }

    // Insert waypoint buttons
    container.querySelectorAll('.waypoint-insert__btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const afterIdx = parseInt(btn.parentElement.dataset.after);
        // Prompt user to click on map for the new waypoint
        this._insertAfterIndex = afterIdx + 1;
        this.map.getCanvas().style.cursor = 'crosshair';
        const hint = document.getElementById('routeInfo');
        if (hint) hint.innerHTML = '<p style="text-align:center;color:var(--color-primary);font-weight:600;padding:8px;">📍 Klicke auf die Karte für den Zwischenstopp</p>';
      });
    });

    // Click to fly to waypoint
    container.querySelectorAll('.waypoint-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('waypoint-item__delete')) return;
        const idx = parseInt(item.dataset.index);
        const wp = this.waypoints[idx];
        if (wp && this.map) {
          this.map.flyTo({ center: [wp.lng, wp.lat], zoom: 14, duration: 600 });
        }
      });
    });

    // Show "Zurück zum Start" buttons if 2+ waypoints and last != first
    const returnBtns = document.getElementById('returnToStartBtns');
    if (this.waypoints.length >= 2) {
      const first = this.waypoints[0];
      const last = this.waypoints[this.waypoints.length - 1];
      const isAlreadyLoop = PeakflowUtils.haversineDistance(first.lat, first.lng, last.lat, last.lng) < 0.5;

      if (!isAlreadyLoop && returnBtns) {
        const mapOverlay = document.getElementById('mapRouteActions');
        const target = mapOverlay || returnBtns;
        target.classList.remove('hidden');
        if (mapOverlay) returnBtns.classList.add('hidden');
        const btnStyle = 'padding:5px 8px;border:1px solid var(--color-primary,#c9a84c);background:rgba(26,26,26,0.72);color:var(--color-primary,#c9a84c);border-radius:6px;cursor:pointer;font-size:10px;font-weight:600;backdrop-filter:blur(8px);white-space:nowrap;';
        const resetStyle = 'padding:5px 8px;border:1px solid rgba(120,113,108,0.6);background:rgba(26,26,26,0.72);color:#a8a29e;border-radius:6px;cursor:pointer;font-size:10px;font-weight:600;backdrop-filter:blur(8px);white-space:nowrap;';
        target.innerHTML = `
          <div style="display:flex;gap:3px;flex-wrap:nowrap;">
            <button id="btnRoundTrip" style="${btnStyle}">🔄 Rundweg</button>
            <button id="btnSameWayBack" style="${btnStyle}">↩️ Gleicher Weg</button>
            <button id="btnRouteToStart" style="${btnStyle}">📍 Zum Start</button>
            <button id="btnNewRoute" style="${resetStyle}">✕ Neu</button>
          </div>
        `;

        const hideRouteActions = () => {
          returnBtns.classList.add('hidden');
          if (mapOverlay) mapOverlay.classList.add('hidden');
        };

        document.getElementById('btnRoundTrip').addEventListener('click', () => {
          this._fitAfterRoute = true;
          const n = this.waypoints.length;

          // Direction of overall route (first → last)
          const dLat = last.lat - first.lat;
          const dLng = last.lng - first.lng;
          const dist = Math.sqrt(dLat * dLat + dLng * dLng);

          // Perpendicular offset: at least 1.2 km (~0.011°), or 40% of route span
          const OFFSET = Math.max(0.011, dist * 0.4);
          const perpLat = dist > 0 ? (-dLng / dist) * OFFSET : OFFSET;
          const perpLng = dist > 0 ? (dLat / dist) * OFFSET : 0;

          // Take existing waypoints at 2/3 and 1/3 of the route (reversed)
          // and shift them perpendicularly → forces BRouter onto a different path
          const idx2 = Math.min(n - 1, Math.max(1, Math.round(n * 0.66)));
          const idx1 = Math.min(idx2 - 1, Math.max(1, Math.round(n * 0.33)));
          const wpA = this.waypoints[idx2];
          const wpB = this.waypoints[idx1];

          // Route: existing path → offset-A → offset-B → start (proper loop)
          this.addWaypoint({ lat: wpA.lat + perpLat, lng: wpA.lng + perpLng, name: 'Rundweg' });
          this.addWaypoint({ lat: wpB.lat + perpLat, lng: wpB.lng + perpLng, name: 'Rundweg' });
          this.addWaypoint({ lng: first.lng, lat: first.lat, name: first.name || 'Start' });
          hideRouteActions();
        });

        document.getElementById('btnSameWayBack').addEventListener('click', () => {
          this._fitAfterRoute = true;
          const reversed = [...this.waypoints].reverse().slice(1);
          for (const wp of reversed) {
            this.waypoints.push({ lng: wp.lng, lat: wp.lat, name: wp.name, index: this.waypoints.length });
            const el = document.createElement('div');
            el.className = 'waypoint-marker';
            el.innerHTML = `<span>${this.waypoints.length}</span>`;
            const marker = new maplibregl.Marker({ element: el, draggable: true })
              .setLngLat([wp.lng, wp.lat])
              .addTo(this.map);
            this.markers.push(marker);
          }
          this.updateWaypointList();
          this.updateRoute();
          hideRouteActions();
        });

        document.getElementById('btnRouteToStart').addEventListener('click', () => {
          this._fitAfterRoute = true;
          this.addWaypoint({ lng: first.lng, lat: first.lat, name: first.name || 'Start' });
          hideRouteActions();
        });

        document.getElementById('btnNewRoute').addEventListener('click', () => {
          hideRouteActions();
          this.clearRoute();
          // Trigger the clearRouteBtn logic (resets UI state)
          const clearBtn = document.getElementById('clearRouteBtn');
          if (clearBtn) clearBtn.click();
        });
      } else if (returnBtns) {
        returnBtns.classList.add('hidden');
        if (typeof mapOverlay !== 'undefined' && mapOverlay) mapOverlay.classList.add('hidden');
      }
    } else if (returnBtns) {
      returnBtns.classList.add('hidden');
      var mapOvl = document.getElementById('mapRouteActions');
      if (mapOvl) mapOvl.classList.add('hidden');
    }
  },

  /**
   * Reverse geocode a waypoint to get a readable name
   */
  // Geocode cache shared across all waypoints
  _geocodeCache: {},

  async reverseGeocode(wp, index) {
    try {
      // First check if near a known POI (free, no API call)
      if (window.PeakflowApp && PeakflowApp.allPOIs) {
        for (const poi of PeakflowApp.allPOIs) {
          const dist = PeakflowUtils.haversineDistance(wp.lat, wp.lng, poi.lat, poi.lng);
          if (dist < 0.3) { // within 300m
            wp.name = poi.name;
            wp._geocodePending = false;
            const el = document.getElementById(`wp-name-${index}`);
            if (el) el.textContent = poi.name;
            return;
          }
        }
      }

      // Check cache (round to 3 decimals ~111m accuracy for cache hits)
      const cacheKey = wp.lat.toFixed(3) + ',' + wp.lng.toFixed(3);
      if (this._geocodeCache[cacheKey]) {
        wp.name = this._geocodeCache[cacheKey];
        wp._geocodePending = false;
        const el = document.getElementById(`wp-name-${index}`);
        if (el) el.textContent = wp.name;
        return;
      }

      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${wp.lat}&lon=${wp.lng}&format=json&zoom=14&addressdetails=1`,
        { headers: { 'Accept-Language': 'de', 'User-Agent': 'Peakflow/1.0 (https://www.peak-flow.app)' } }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data && data.address) {
        const a = data.address;
        const name = a.hamlet || a.village || a.town || a.city || a.suburb || a.peak || a.mountain || a.locality || '';
        if (name) {
          wp.name = name;
          this._geocodeCache[cacheKey] = name;
          wp._geocodePending = false;
          const el = document.getElementById(`wp-name-${index}`);
          if (el) el.textContent = name;
          return;
        }
      }
      // No name found - mark as failed to avoid retrying
      wp._geocodeFailed = true;
      wp._geocodePending = false;
    } catch (e) {
      wp._geocodeFailed = true;
      wp._geocodePending = false;
      // Show coords as fallback, don't retry
    }
  },

  /**
   * Remove a waypoint
   */
  async removeWaypoint(index) {
    if (index < 0 || index >= this.waypoints.length) return;
    if (this.markers[index]) this.markers[index].remove();
    if (index < this.markers.length) this.markers.splice(index, 1);
    this.waypoints.splice(index, 1);

    // Re-index
    this.waypoints.forEach((wp, i) => {
      wp.index = i;
      if (this.markers[i]) {
        this.markers[i].getElement().querySelector('span').textContent = i + 1;
      }
    });

    this.updateWaypointList();
    this._updateUndoButton();

    if (this.waypoints.length >= 2) {
      await this.updateRoute();
    } else {
      this.clearRouteLine();
      PeakflowSnow.removeSnowOverlay(this.map);
      this.routeCoords = [];
      this.elevations = [];
      this.updateStats();
      document.getElementById('elevationProfile').classList.add('hidden');
      document.getElementById('snowWarning').classList.add('hidden');
      document.getElementById('packingList').classList.add('hidden');
      var saveBtn = document.getElementById('saveRouteToolbarBtn');
      if (saveBtn) saveBtn.classList.add('hidden');
    }
  },

  /**
   * Calculate route using BRouter (hiking trails) → OSRM fallback → straight line
   */
  async updateRoute() {
    if (this.waypoints.length < 2) return;

    // Reset any failed markers from previous routing
    this._resetFailedMarkers();

    // Cancel any previous in-flight routing request
    if (this._routingController) this._routingController.abort();
    this._routingController = new AbortController();
    const routeSignal = this._routingController.signal;

    let coords = [];
    let elevations = [];
    this._hideRoutingWarning(); // Clear old warnings

    // Round trips are now handled by segment routing with cache (no special case needed)
    // The last segment back to start uses the normal routing
    const isRoundTrip = false; // Disabled: was re-routing ALL segments and ignoring cache

    if (false) { // Keep old round-trip code but never execute it
      // ROUND TRIP: Route the return leg via alternative to avoid same path back
      // Strategy: Split into outbound (start → furthest) and return (furthest → start)
      // Use alternativeidx=1 for return leg to get a different path
      console.log('[Peakflow] Round trip detected! Routing as loop...');

      // Find the waypoint furthest from start (= turnaround point)
      let maxDist = 0, turnaroundIdx = 1;
      for (let i = 1; i < this.waypoints.length - 1; i++) {
        const d = PeakflowUtils.haversineDistance(first.lat, first.lng, this.waypoints[i].lat, this.waypoints[i].lng);
        if (d > maxDist) { maxDist = d; turnaroundIdx = i; }
      }

      // Split into outbound + return, fetch BOTH in parallel for speed
      const outbound = this.waypoints.slice(0, turnaroundIdx + 1);
      const returnLeg = this.waypoints.slice(turnaroundIdx);
      const outLonlats = outbound.map(wp => `${wp.lng},${wp.lat}`).join('|');
      const retLonlats = returnLeg.map(wp => `${wp.lng},${wp.lat}`).join('|');

      // Parallel fetch: outbound (normal) + return (alternative route)
      // Both legs get a 20s timeout so we fall through to segment routing if BRouter hangs
      const rtSig = (typeof AbortSignal.any === 'function')
        ? AbortSignal.any([routeSignal, AbortSignal.timeout(20000)])
        : routeSignal;
      try {
        const [outResp, retResp] = await Promise.all([
          fetch(`${this.BROUTER_URL}?lonlats=${outLonlats}&profile=${PeakflowUtils.getBrouterProfile()}&alternativeidx=0&format=geojson`, { signal: rtSig }),
          fetch(`${this.BROUTER_URL}?lonlats=${retLonlats}&profile=${PeakflowUtils.getBrouterProfile()}&alternativeidx=1&format=geojson`, { signal: rtSig })
        ]);
        const [outData, retData] = await Promise.all([outResp.json(), retResp.json()]);

        let outCoords = outData.features?.[0]?.geometry?.coordinates || [];
        let retCoords = retData.features?.[0]?.geometry?.coordinates || [];

        // Fallback: if alternative return failed, try normal return
        if (retCoords.length === 0) {
          const fb = await fetch(`${this.BROUTER_URL}?lonlats=${retLonlats}&profile=${PeakflowUtils.getBrouterProfile()}&alternativeidx=0&format=geojson`, { signal: rtSig });
          retCoords = (await fb.json()).features?.[0]?.geometry?.coordinates || [];
        }

        if (outCoords.length > 0 && retCoords.length > 0) {
          coords = [...outCoords, ...retCoords.slice(1)];
          elevations = coords.map(c => c[2] || 0);
          const routeDist = PeakflowUtils.routeDistance(coords);
          console.log(`[Peakflow] ✓ Round trip: ${coords.length}pts, ${routeDist.toFixed(1)}km`);
          this._analyzeRouteDanger(coords, elevations, routeDist);
        }
      } catch (e) {
        if (routeSignal.aborted) return; // Newer request cancelled us — stop silently
        console.warn('[Peakflow] Round trip routing failed, falling through to segment routing:', e.message);
        // coords stays empty → segment-by-segment routing below picks it up
      }
    }

    // Direct distance = sum of all consecutive segments (not just first→last!)
    // Used by both BRouter and OSRM detour checks
    let directDist = 0;
    for (let i = 1; i < this.waypoints.length; i++) {
      directDist += PeakflowUtils.haversineDistance(
        this.waypoints[i-1].lat, this.waypoints[i-1].lng,
        this.waypoints[i].lat, this.waypoints[i].lng
      );
    }
    const MAX_DETOUR = 6; // reject route if > 6× direct distance (mountains have switchbacks)

    // Non-round-trip or round-trip failed: normal routing
    if (coords.length === 0) {
      // Route each segment independently and concatenate.
      // Race: first valid response wins (fastest profile)
      // Dynamic BRouter profile based on activity (hiking, bike, etc.)
      // For hiking: compare hiking-mountain + shortest, pick closest to target
      // For bike: only use bike profile (no shortest fallback — don't route bikes on hiking trails)
      const brouterProfile = PeakflowUtils.getBrouterProfile();
      const isBike = PeakflowUtils.isBikeProfile();
      const profiles = isBike ? [brouterProfile] : [brouterProfile, 'shortest'];
      const failedSegments = [];

      // Cache segments so adding new waypoints doesn't re-route existing segments
      if (!this._segmentCache) this._segmentCache = {};

      const routeSegment = async (from, to) => {
        // Check cache: same start+end coords → reuse result (round to 4 decimals ~11m accuracy)
        const cacheKey = from.lat.toFixed(4) + ',' + from.lng.toFixed(4) + '→' + to.lat.toFixed(4) + ',' + to.lng.toFixed(4);
        if (this._segmentCache[cacheKey]) {
          console.log(`[Peakflow] ${from.name||'WP'}→${to.name||'WP'}: cached`);
          return this._segmentCache[cacheKey];
        }

        const segDirect = PeakflowUtils.haversineDistance(from.lat, from.lng, to.lat, to.lng);
        const lonlats = `${from.lng},${from.lat}|${to.lng},${to.lat}`;

        const fetchProfile = (profile) => {
          // Skip profiles that consistently fail for this area (reduces 400 spam)
          if (!this._failedProfiles) this._failedProfiles = {};
          const areaKey = Math.round(from.lat * 10) + ',' + Math.round(from.lng * 10) + ':' + profile;
          if (this._failedProfiles[areaKey] >= 3) return Promise.reject(new Error('skipped'));
          const tSig = AbortSignal.timeout(8000);
          const sig = (typeof AbortSignal.any === 'function')
            ? AbortSignal.any([routeSignal, tSig]) : tSig;
          return fetch(
            `${this.BROUTER_URL}?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`,
            { signal: sig }
          )
            .then(r => {
              if (!r.ok) {
                this._failedProfiles[areaKey] = (this._failedProfiles[areaKey] || 0) + 1;
                throw new Error(`HTTP ${r.status}`);
              }
              return r.json();
            })
            .then(data => {
              const rc = data.features?.[0]?.geometry?.coordinates;
              if (!rc || rc.length === 0) throw new Error('No route');
              const dist = PeakflowUtils.routeDistance(rc);
              // No detour check for 'shortest' - it must find ANY path
              if (profile !== 'shortest') {
                const detour = segDirect > 0.05 ? dist / segDirect : 1;
                if (detour > MAX_DETOUR) throw new Error(`Detour ×${detour.toFixed(1)}`);
              }
              // Bike gradient validation: two checks
              // 1) Average gradient per segment
              // 2) Rolling window: steepest 500m section (catches ridges hidden in long segments)
              if (isBike && dist > 0.3) {
                const elevs = rc.map(c => c[2] || 0);
                let segAscent = 0;
                for (let ei = 1; ei < elevs.length; ei++) {
                  if (elevs[ei] > elevs[ei - 1]) segAscent += elevs[ei] - elevs[ei - 1];
                }
                const avgGradient = (segAscent / (dist * 1000)) * 100;
                const maxAvg = { fastbike: 8, gravel: 10, mtb: 12, trekking: 10 };
                const avgLimit = maxAvg[brouterProfile] || 10;
                if (avgGradient > avgLimit) {
                  throw new Error(`Avg gradient ${avgGradient.toFixed(0)}% > ${avgLimit}% for ${brouterProfile}`);
                }
                // Rolling 500m window: reject if any section is too steep (T3+ hiking trail)
                const maxSection = { fastbike: 12, gravel: 15, mtb: 20, trekking: 15 };
                const secLimit = maxSection[brouterProfile] || 15;
                let runDist = 0, runAscent = 0, windowStart = 0;
                for (let ei = 1; ei < rc.length; ei++) {
                  const d = PeakflowUtils.haversineDistance(rc[ei-1][1], rc[ei-1][0], rc[ei][1], rc[ei][0]) * 1000;
                  const eleDiff = (rc[ei][2] || 0) - (rc[ei-1][2] || 0);
                  runDist += d;
                  if (eleDiff > 0) runAscent += eleDiff;
                  // Slide window: keep ~500m
                  while (runDist > 500 && windowStart < ei - 1) {
                    const wd = PeakflowUtils.haversineDistance(rc[windowStart][1], rc[windowStart][0], rc[windowStart+1][1], rc[windowStart+1][0]) * 1000;
                    const we = (rc[windowStart+1][2] || 0) - (rc[windowStart][2] || 0);
                    runDist -= wd;
                    if (we > 0) runAscent -= we;
                    windowStart++;
                  }
                  if (runDist > 200) {
                    const secGrad = (runAscent / runDist) * 100;
                    if (secGrad > secLimit) {
                      throw new Error(`Section gradient ${secGrad.toFixed(0)}% > ${secLimit}% for ${brouterProfile}`);
                    }
                  }
                }
              }
              return { profile, coords: rc, dist };
            });
        };

        // Try all profiles, prefer hiking over shortest (shortest uses roads)
        try {
          const results = await Promise.allSettled(profiles.map(p => fetchProfile(p)));
          const valid = results.filter(r => r.status === 'fulfilled').map(r => r.value);
          if (valid.length === 0) {
            // Fallback: try nudging on own server (has T5/T6 profile), then public
            // Only 4 cardinal nudges per server to avoid spam
            const nudges = [[0.005, 0], [-0.005, 0], [0, 0.005], [0, -0.005]];
            const servers = [this.BROUTER_URL, 'https://brouter.de/brouter'];
            for (const server of servers) {
              const timeout = server === this.BROUTER_URL ? 3000 : 8000;
              for (const [dlat, dlng] of nudges) {
                try {
                  const sr = await fetch(
                    `${server}?lonlats=${from.lng+dlng},${from.lat+dlat}|${to.lng+dlng},${to.lat+dlat}&profile=${PeakflowUtils.getBrouterProfile()}&alternativeidx=0&format=geojson`,
                    { signal: AbortSignal.timeout(timeout) }
                  );
                  if (sr.ok) {
                    const sd = await sr.json();
                    const rc = sd.features?.[0]?.geometry?.coordinates;
                    if (rc && rc.length > 2) {
                      console.log(`[Peakflow] ${from.name||'WP'}→${to.name||'WP'}: nudged ${PeakflowUtils.routeDistance(rc).toFixed(1)}km`);
                      this._segmentCache[cacheKey] = rc;
                      return rc;
                    }
                  }
                } catch (_) {}
              }
            }

            console.warn(`[Peakflow] No route found for ${from.name||'WP'}→${to.name||'WP'}` + (isBike ? ' (kein befahrbarer Weg)' : '') + ', skipping segment');
            return null;
          }
          // Pick the route that passes closest to the target waypoint
          // This ensures the route follows the trail the user intended
          const best = valid.length === 1 ? valid[0] :
            valid.reduce((a, b) => {
              // Find closest point in each route to the target waypoint
              const closestDist = (coords) => {
                let min = Infinity;
                for (const c of coords) {
                  const d = Math.pow(c[0] - to.lng, 2) + Math.pow(c[1] - to.lat, 2);
                  if (d < min) min = d;
                }
                return min;
              };
              return closestDist(a.coords) <= closestDist(b.coords) ? a : b;
            });
          // Snap-check: if BRouter snapped waypoint >500m away, the point is off-trail
          // Only check 'to' waypoint (start snapping is OK — user walks from road to trail)
          var endSnap = PeakflowUtils.haversineDistance(
            best.coords[best.coords.length-1][1], best.coords[best.coords.length-1][0], to.lat, to.lng
          );
          if (endSnap > 0.5) { // >500m
            console.warn(`[Peakflow] ${from.name||'WP'}→${to.name||'WP'}: endpoint snapped ${(endSnap*1000).toFixed(0)}m away — rejecting`);
            return null;
          }

          console.log(`[Peakflow] ${from.name||'WP'}→${to.name||'WP'}: ${best.profile} ${best.dist.toFixed(1)}km`);
          this._segmentCache[cacheKey] = best.coords;
          return best.coords;
        } catch(e) {
          // On exception, skip segment instead of straight line
          console.warn('[Peakflow] Route exception, skipping segment');
          return null;
        }
      };

      try {
        // Route ALL segments in parallel (not sequentially!)
        const segmentPromises = [];
        for (let i = 0; i < this.waypoints.length - 1; i++) {
          segmentPromises.push(routeSegment(this.waypoints[i], this.waypoints[i + 1]).then(c => ({ i, coords: c })));
        }
        const segResults = await Promise.all(segmentPromises);
        if (routeSignal.aborted) return;
        // Collect connected coordinate chains; start a new chain after each gap
        // This prevents straight lines across failed segments
        const lineChains = [[]]; // array of arrays
        for (const { i, coords: segCoords } of segResults.sort((a, b) => a.i - b.i)) {
          const currentChain = lineChains[lineChains.length - 1];
          // Check if segment is real trail vs straight-line/near-straight from BRouter
          // A real trail has many points (switchbacks, curves); a straight line has very few
          var isRealTrail = false;
          if (segCoords && segCoords.length > 2) {
            var sDist = PeakflowUtils.routeDistance(segCoords);
            var dDist = PeakflowUtils.haversineDistance(segCoords[0][1], segCoords[0][0], segCoords[segCoords.length-1][1], segCoords[segCoords.length-1][0]);
            var ptDensity = segCoords.length / (sDist || 0.01); // points per km
            // Real trails: >10 pts/km, straight lines: <10 pts/km for distances >0.3km
            isRealTrail = dDist < 0.3 || ptDensity > 10 || segCoords.length > 20;
          }
          if (isRealTrail) {
            if (currentChain.length > 0) {
              currentChain.push(...segCoords.slice(1)); // append, skip duplicate start
            } else {
              currentChain.push(...segCoords);
            }
          } else {
            // Failed or degenerate segment → start a new chain (no straight-line bridge!)
            failedSegments.push(`${this.waypoints[i].name || (i+1)} → ${this.waypoints[i+1].name || (i+2)}`);
            this._markWaypointFailed(i);
            this._markWaypointFailed(i + 1);
            lineChains.push([]); // new chain starts after gap
          }
        }
        const validChains = lineChains.filter(c => c.length > 1);
        // Flatten all chains for elevation/stats; draw as MultiLineString to avoid gaps
        const allSegCoords = validChains.flat();
        if (validChains.length > 0) {
          coords = allSegCoords;
          elevations = allSegCoords.map(c => c[2] || 0);
          const totalDist = PeakflowUtils.routeDistance(coords);
          this._analyzeRouteDanger(coords, elevations, totalDist);
          // Draw each chain separately (MultiLineString) to avoid connecting across gaps
          this._routeLineChains = validChains;
          if (failedSegments.length > 0) {
            this._showRoutingWarning(`⚠️ Kein Trail für: ${failedSegments.join(', ')}. Restliche Segmente wurden geroutet.`);
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('[Peakflow] Routing error:', e.message || e);
      }
    }

    // 2. No route found at all — show error, draw nothing
    if (coords.length === 0) {
      this._showRoutingWarning('⚠️ Kein Wanderweg gefunden. BRouter findet keinen markierten Trail. Zwischenpunkt direkt auf einen sichtbaren Weg setzen.');
      return;
    }

    this.routeCoords = coords;
    this.elevations = elevations;

    // PRIORITY 1: Route sofort zeichnen (kein API-Call)
    this.drawRouteLine(coords);
    this.updateStats();
    // Elevation profile: only show if user explicitly activated it
    // Default = hidden; user opens it via the toggle button in the toolbar
    this.drawElevationProfile();
    if (this._elevationVisible) {
      document.getElementById('elevationProfile').classList.remove('hidden');
      var elevBtn = document.getElementById('elevationToggleBtn');
      if (elevBtn) elevBtn.classList.add('active');
    }
    // Show save button in toolbar
    var saveBtn = document.getElementById('saveRouteToolbarBtn');
    if (saveBtn) saveBtn.classList.remove('hidden');

    // Auto-fit only when route is finalized (flag set by return-to-start buttons)
    if (this._fitAfterRoute && this.map && coords.length > 1) {
      this._fitAfterRoute = false;
      const bounds = new maplibregl.LngLatBounds();
      coords.forEach(c => bounds.extend([c[0], c[1]]));
      this.map.fitBounds(bounds, { padding: 60, duration: 600 });
    }

    // Debounce secondary data (weather/snow get 429'd if called every waypoint click)
    clearTimeout(this._secondaryDataTimer);
    // SAC + Water load immediately (from Supabase, no rate limit)
    // Skip SAC analysis for bike profiles (irrelevant for cycling)
    if (!PeakflowUtils.isBikeProfile()) {
      this.loadSACDataForRoute(coords).catch(e => console.warn('[Peakflow] SAC:', e));
    } else {
      // Clear SAC markers and accordion for bike mode
      if (this._dangerMarkers) { this._dangerMarkers.forEach(m => m.remove()); this._dangerMarkers = []; }
      if (this._closureMarkers) { this._closureMarkers.forEach(m => m.remove()); this._closureMarkers = []; }
      const sacTitle = document.getElementById('sacAccordionTitle');
      if (sacTitle) sacTitle.innerHTML = '';
      const sacBody = document.getElementById('sacAccordionBody');
      if (sacBody) sacBody.innerHTML = '';
    }
    this.loadWaterSources(coords).catch(e => console.warn('[Peakflow] Water:', e));
    this._loadSurfaceData(coords).catch(e => console.warn('[Peakflow] Surface:', e));
    this._loadTrailClosures(coords).catch(e => console.warn('[Peakflow] Closures:', e));
    // Weather/Snow/Sun delayed 2s (only fires for the final route, not intermediate)
    this._secondaryDataTimer = setTimeout(() => {
      Promise.all([
        this.analyzeSnowOnRoute().catch(e => console.warn('[Peakflow] Snow:', e)),
        this.loadRouteWeather(coords).catch(e => console.warn('[Peakflow] Weather:', e)),
        Promise.resolve().then(() => this.loadSunAnalysis(coords, elevations)).catch(e => console.warn('[Peakflow] Sun:', e))
      ]).then(() => console.log('[Peakflow] All route data loaded'));
    }, 2000);

    // Auto-cache tiles along route for offline use (logged-in users only)
    this._autoCacheRouteTiles(coords);
  },

  /**
   * Load trail closures from Swiss API + Supabase user reports
   */
  async _loadTrailClosures(coords) {
    if (!coords || coords.length < 2 || !this.map) return;

    // Remove old closure markers
    if (this._closureMarkers) { this._closureMarkers.forEach(m => m.remove()); }
    this._closureMarkers = [];

    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const pad = 0.01;
    const south = Math.min(...lats) - pad, west = Math.min(...lngs) - pad;
    const north = Math.max(...lats) + pad, east = Math.max(...lngs) + pad;

    const closures = [];

    // 1. Swiss official trail closures (geo.admin.ch API)
    try {
      const swissUrl = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify' +
        '?geometryType=esriGeometryEnvelope&geometry=' + west + ',' + south + ',' + east + ',' + north +
        '&layers=all:ch.astra.wanderland-sperrungen_umleitungen' +
        '&tolerance=0&mapExtent=' + west + ',' + south + ',' + east + ',' + north +
        '&imageDisplay=1,1,1&sr=4326&returnGeometry=true&lang=de';

      const resp = await fetch(swissUrl);
      if (resp.ok) {
        const data = await resp.json();
        if (data.results) {
          data.results.forEach(function(r) {
            var attrs = r.attributes || {};
            var geom = r.geometry;
            if (geom && (geom.x || (geom.paths && geom.paths[0]))) {
              var lat = geom.y || (geom.paths ? geom.paths[0][0][1] : 0);
              var lng = geom.x || (geom.paths ? geom.paths[0][0][0] : 0);
              closures.push({
                lat: lat, lng: lng,
                reason: attrs.sperrung_text || attrs.beschreibung || 'Gesperrt',
                source: 'swiss',
                date: attrs.datum_von || ''
              });
            }
          });
          console.log('[Peakflow] Swiss closures: ' + closures.length);
        }
      }
    } catch(e) { console.warn('[Peakflow] Swiss closure API failed:', e.message); }

    // 2. User-reported closures from Supabase
    try {
      if (PeakflowData.authClient) {
        const { data } = await PeakflowData.authClient
          .from('trail_closures')
          .select('*')
          .gte('lat', south).lte('lat', north)
          .gte('lng', west).lte('lng', east);
        if (data && data.length > 0) {
          data.forEach(function(c) {
            // Skip expired closures
            if (c.expires_at && new Date(c.expires_at) < new Date()) return;
            closures.push({
              lat: c.lat, lng: c.lng,
              reason: c.reason || 'Wegsperre (gemeldet)',
              source: 'user',
              date: c.created_at ? c.created_at.split('T')[0] : ''
            });
          });
          console.log('[Peakflow] User-reported closures: ' + data.length);
        }
      }
    } catch(e) { console.warn('[Peakflow] Supabase closures failed:', e.message); }

    if (closures.length === 0) return;

    // Check if closures are near route (within ~500m)
    var nearRoute = [];
    var threshold = 0.005; // ~500m
    var thresholdSq = threshold * threshold;
    var self = this;

    closures.forEach(function(cl) {
      for (var ci = 0; ci < coords.length; ci += 10) {
        var dLat = coords[ci][1] - cl.lat;
        var dLng = coords[ci][0] - cl.lng;
        if (dLat * dLat + dLng * dLng < thresholdSq) {
          nearRoute.push(cl);
          break;
        }
      }
    });

    if (nearRoute.length === 0) return;

    console.log('[Peakflow] ' + nearRoute.length + ' closures near route!');

    // Place closure markers
    nearRoute.forEach(function(cl) {
      var el = document.createElement('div');
      el.innerHTML = '\uD83D\uDEA7';
      el.style.cssText = 'width:28px;height:28px;border-radius:50%;background:#dc2626;border:2px solid white;' +
        'box-shadow:0 0 12px rgba(220,38,38,0.6);display:flex;align-items:center;justify-content:center;' +
        'font-size:14px;cursor:pointer;z-index:10;animation:dangerBlink 2s infinite;';
      el.title = '\u26A0\uFE0F ' + cl.reason;

      var marker = new maplibregl.Marker({ element: el })
        .setLngLat([cl.lng, cl.lat])
        .addTo(self.map);

      var sourceLabel = cl.source === 'swiss' ? '\uD83C\uDDE8\uD83C\uDDED Offizielle Meldung' : '\uD83D\uDC64 Nutzer-Meldung';
      var popup = new maplibregl.Popup({ offset: 15 })
        .setHTML('<div style="padding:6px;max-width:220px;">' +
          '<div style="font-weight:700;color:#dc2626;margin-bottom:4px;">\uD83D\uDEA7 Wegsperrung</div>' +
          '<div style="font-size:13px;margin-bottom:4px;">' + cl.reason + '</div>' +
          '<div style="font-size:11px;color:#888;">' + sourceLabel +
          (cl.date ? ' \u2022 ' + cl.date : '') + '</div></div>');
      marker.setPopup(popup);

      self._closureMarkers.push(marker);
    });

    // Show warning in sidebar
    var sacBody = document.getElementById('sacAccordionBody');
    if (sacBody) {
      sacBody.innerHTML += '<div style="margin-top:8px;padding:6px 8px;background:rgba(220,38,38,0.12);border-radius:6px;border:1px solid rgba(220,38,38,0.3);">' +
        '<span style="color:#dc2626;font-weight:600;">\uD83D\uDEA7 ' + nearRoute.length + ' Wegsperrung' + (nearRoute.length > 1 ? 'en' : '') + ' auf der Route!</span>' +
        '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">' +
        nearRoute.map(function(c) { return c.reason; }).join(', ') + '</div></div>';
    }
  },

  /**
   * Load surface/way type data from Overpass and color-code route segments
   */
  async _loadSurfaceData(coords) {
    if (!coords || coords.length < 10 || !this.map) return;

    // Sample route points for Overpass query (max 8 sample points to keep query small)
    const step = Math.max(1, Math.floor(coords.length / 8));
    const samplePts = [];
    for (let i = 0; i < coords.length; i += step) {
      samplePts.push(coords[i]);
    }

    // Build bounding box
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const pad = 0.002;
    const bbox = [Math.min(...lats) - pad, Math.min(...lngs) - pad, Math.max(...lats) + pad, Math.max(...lngs) + pad].join(',');

    // Overpass query for ways with surface tags around route
    const query = '[out:json][timeout:10];(' +
      'way["highway"]["surface"](' + bbox + ');' +
      'way["highway"]["tracktype"](' + bbox + ');' +
      ');out geom;';

    try {
      console.log('[Peakflow] Loading surface data from Overpass...');
      const resp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (!resp.ok) { console.warn('[Peakflow] Overpass failed:', resp.status); return; }
      const data = await resp.json();

      if (!data.elements || data.elements.length === 0) return;

      // Build surface lookup: for each route point, find nearest way and its surface
      const surfaceSegments = [];
      const segStep = Math.max(1, Math.floor(coords.length / 200)); // max 200 segments

      for (let ci = 0; ci < coords.length - segStep; ci += segStep) {
        const pt = coords[ci];
        let bestDist = Infinity;
        let bestSurface = 'unknown';

        for (const el of data.elements) {
          if (!el.geometry) continue;
          for (const gp of el.geometry) {
            const d = Math.pow(gp.lon - pt[0], 2) + Math.pow(gp.lat - pt[1], 2);
            if (d < bestDist && d < 0.000004) { // ~200m threshold
              bestDist = d;
              const sf = el.tags.surface || '';
              const tt = el.tags.tracktype || '';
              if (['asphalt', 'paved', 'concrete', 'sett', 'paving_stones'].some(s => sf.includes(s))) {
                bestSurface = 'paved';
              } else if (['gravel', 'compacted', 'fine_gravel', 'pebblestone'].some(s => sf.includes(s)) || tt === 'grade1' || tt === 'grade2') {
                bestSurface = 'gravel';
              } else if (sf || tt) {
                bestSurface = 'trail'; // ground, dirt, grass, sand, mud, etc.
              }
            }
          }
        }
        surfaceSegments.push({
          from: ci,
          to: Math.min(ci + segStep, coords.length - 1),
          surface: bestSurface
        });
      }

      // Calculate percentages
      let paved = 0, gravel = 0, trail = 0, unknown = 0;
      surfaceSegments.forEach(s => {
        if (s.surface === 'paved') paved++;
        else if (s.surface === 'gravel') gravel++;
        else if (s.surface === 'trail') trail++;
        else unknown++;
      });
      const total = surfaceSegments.length || 1;
      const pctPaved = Math.round(paved / total * 100);
      const pctGravel = Math.round(gravel / total * 100);
      const pctTrail = Math.round(trail / total * 100);

      console.log('[Peakflow] Surface: ' + pctPaved + '% paved, ' + pctGravel + '% gravel, ' + pctTrail + '% trail');

      // Surface info only in sidebar accordion (not on map — keeps map clean)
      // Show surface legend in sidebar
      this._showSurfaceLegend(pctPaved, pctGravel, pctTrail);

    } catch(e) {
      console.warn('[Peakflow] Surface data failed:', e.message);
    }
  },

  _drawSurfaceOverlay(coords, segments) {
    // Remove existing surface layers
    ['surface-paved', 'surface-gravel', 'surface-trail'].forEach(id => {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
      if (this.map.getSource(id)) this.map.removeSource(id);
    });

    const colorMap = {
      paved: '#94a3b8',   // Grey (slate)
      gravel: '#d97706',  // Amber/Brown
      trail: '#16a34a'    // Green
    };

    // Group consecutive segments by surface type into LineStrings
    ['paved', 'gravel', 'trail'].forEach(surfaceType => {
      const lines = [];
      let currentLine = [];

      segments.forEach(seg => {
        if (seg.surface === surfaceType) {
          if (currentLine.length === 0) {
            currentLine.push(coords[seg.from]);
          }
          currentLine.push(coords[seg.to]);
        } else {
          if (currentLine.length >= 2) {
            lines.push(currentLine);
          }
          currentLine = [];
        }
      });
      if (currentLine.length >= 2) lines.push(currentLine);

      if (lines.length === 0) return;

      this.map.addSource('surface-' + surfaceType, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'MultiLineString', coordinates: lines }
        }
      });

      this.map.addLayer({
        id: 'surface-' + surfaceType,
        type: 'line',
        source: 'surface-' + surfaceType,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': colorMap[surfaceType],
          'line-width': 8,
          'line-opacity': 0.45
        }
      }, 'route-outline'); // Draw below the route line
    });
  },

  _showSurfaceLegend(pctPaved, pctGravel, pctTrail) {
    // Find or create surface info area in sidebar
    let el = document.getElementById('surfaceInfo');
    if (!el) {
      const routeInfo = document.getElementById('routeInfo');
      if (!routeInfo) return;
      el = document.createElement('div');
      el.id = 'surfaceInfo';
      // Insert after stats section
      const statsEl = routeInfo.querySelector('.route-stats') || routeInfo.firstChild;
      if (statsEl && statsEl.nextSibling) {
        routeInfo.insertBefore(el, statsEl.nextSibling);
      } else {
        routeInfo.appendChild(el);
      }
    }

    el.style.cssText = 'margin-top:8px;padding:8px 10px;background:var(--bg-tertiary,#2e2e2e);border-radius:8px;font-size:12px;';
    el.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px;color:var(--text-primary);">\uD83E\uDDF1 Untergrund</div>' +
      '<div style="display:flex;gap:4px;height:8px;border-radius:4px;overflow:hidden;margin-bottom:6px;">' +
        (pctTrail > 0 ? '<div style="width:' + pctTrail + '%;background:#16a34a;" title="Trail"></div>' : '') +
        (pctGravel > 0 ? '<div style="width:' + pctGravel + '%;background:#d97706;" title="Schotter"></div>' : '') +
        (pctPaved > 0 ? '<div style="width:' + pctPaved + '%;background:#94a3b8;" title="Asphalt"></div>' : '') +
      '</div>' +
      '<div style="display:flex;gap:10px;color:var(--text-secondary);">' +
        (pctTrail > 0 ? '<span>\uD83C\uDF3F ' + pctTrail + '% Trail</span>' : '') +
        (pctGravel > 0 ? '<span>\uD83E\uDEA8 ' + pctGravel + '% Schotter</span>' : '') +
        (pctPaved > 0 ? '<span>\u2B1B ' + pctPaved + '% Asphalt</span>' : '') +
      '</div>';
  },

  /**
   * Auto-cache map tiles along route for offline use (only for logged-in users)
   * Debounced — only fires 3s after last route update to avoid caching intermediate states
   */
  _autoCacheRouteTiles(coords) {
    clearTimeout(this._autoCacheTilesTimer);
    this._autoCacheTilesTimer = setTimeout(() => {
      // Only for logged-in users
      if (!PeakflowData.currentUser) return;
      if (!coords || coords.length < 2) return;
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;

      const lngs = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      const pad = 0.01;
      const bounds = {
        minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad,
        minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad
      };

      const tileUrls = [];
      for (var z = 12; z <= 16; z++) {
        var minX = Math.floor((bounds.minLng + 180) / 360 * Math.pow(2, z));
        var maxX = Math.floor((bounds.maxLng + 180) / 360 * Math.pow(2, z));
        var minY = Math.floor((1 - Math.log(Math.tan(bounds.maxLat * Math.PI / 180) + 1 / Math.cos(bounds.maxLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
        var maxY = Math.floor((1 - Math.log(Math.tan(bounds.minLat * Math.PI / 180) + 1 / Math.cos(bounds.minLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
        for (var x = minX; x <= maxX; x++) {
          for (var y = minY; y <= maxY; y++) {
            tileUrls.push('https://tile.opentopomap.org/' + z + '/' + x + '/' + y + '.png');
          }
        }
      }

      console.log('[Peakflow] Auto-caching ' + tileUrls.length + ' route tiles for offline use');
      navigator.serviceWorker.controller.postMessage({ type: 'CACHE_TILES', urls: tileUrls });
    }, 3000);
  },

  /**
   * Load water sources near the route from Supabase (no Overpass needed)
   */
  async loadWaterSources(coords) {
    if (!coords || coords.length < 2 || !this.map) return;

    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const pad = 0.01;
    const south = Math.min(...lats) - pad, west = Math.min(...lngs) - pad;
    const north = Math.max(...lats) + pad, east = Math.max(...lngs) + pad;

    let waterNodes = [];
    try {
      console.log('[Peakflow] Loading water sources from Supabase...');
      const url = 'https://wbrvkweezbeakfphssxp.supabase.co/rest/v1/water_sources' +
        '?lat=gte.' + south + '&lat=lte.' + north +
        '&lng=gte.' + west + '&lng=lte.' + east +
        '&select=osm_id,name,type,lat,lng&limit=200';
      const resp = await fetch(url, {
        headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE' }
      });
      if (resp.ok) {
        waterNodes = await resp.json();
        console.log('[Peakflow] Supabase: ' + waterNodes.length + ' water sources found');
      }
    } catch(e) { console.warn('[Peakflow] Water Supabase failed:', e); }

    if (waterNodes.length === 0) return;

    try {
      // Filter to sources within ~300m of route
      // Sample every 10th point for speed, but cover entire route
      const threshold = 0.003; // ~300m
      const thresholdSq = threshold * threshold;
      const sources = [];
      const sampleStep = Math.max(1, Math.floor(coords.length / 500)); // max 500 samples

      // Pre-compute cumulative distance at sample points
      const sampleIndices = [];
      const sampleDists = [];
      let cumDist = 0;
      sampleIndices.push(0);
      sampleDists.push(0);
      for (let i = 1; i < coords.length; i++) {
        cumDist += PeakflowUtils.haversineDistance(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]);
        if (i % sampleStep === 0 || i === coords.length - 1) {
          sampleIndices.push(i);
          sampleDists.push(cumDist);
        }
      }

      for (const node of waterNodes) {
        let minDistSq = Infinity;
        let bestSampleIdx = -1;
        for (let si = 0; si < sampleIndices.length; si++) {
          const ci = sampleIndices[si];
          const dLat = coords[ci][1] - node.lat;
          const dLng = coords[ci][0] - node.lng;
          const distSq = dLat * dLat + dLng * dLng;
          if (distSq < minDistSq) {
            minDistSq = distSq;
            bestSampleIdx = si;
          }
        }
        if (minDistSq < thresholdSq && bestSampleIdx >= 0) {
          const type = node.type === 'spring' ? 'Quelle' : node.type === 'water_well' ? 'Brunnen' : 'Trinkwasser';
          sources.push({ lat: node.lat, lng: node.lng, name: node.name || type, type: type, distKm: sampleDists[bestSampleIdx] });
        }
      }

      if (sources.length === 0) return;

      console.log('[Peakflow] Found ' + sources.length + ' water sources near route');
      sources.sort((a, b) => a.distKm - b.distKm);

      // Place blue water markers on map with info popup + route button
      // Respect user's water toggle setting
      const waterVisible = typeof Peakflow !== 'undefined' ? Peakflow._waterVisible : true;
      if (!this._waterMarkers) this._waterMarkers = [];
      const self = this;
      sources.forEach(src => {
        const el = document.createElement('div');
        el.style.cssText = 'width:24px;height:24px;border-radius:50%;background:#3b82f6;border:2px solid white;box-shadow:0 0 8px rgba(59,130,246,0.5);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;z-index:5;';
        if (!waterVisible) el.style.display = 'none';
        el.innerHTML = '\uD83D\uDCA7';
        el.title = src.name + ' (' + (src.distKm < 0.1 ? Math.round(src.distKm * 1000) + 'm' : 'km ' + src.distKm.toFixed(1)) + ')';
        const marker = new maplibregl.Marker({ element: el }).setLngLat([src.lng, src.lat]).addTo(this.map);
        // Create popup and bind to marker (ensures correct position)
        const distLabel = src.distKm < 0.1 ? Math.round(src.distKm * 1000) + 'm' : 'km ' + src.distKm.toFixed(1);
        const typeIcon = src.type === 'Quelle' ? '🏔️ Natürliche Quelle' : src.type === 'Brunnen' ? '🪣 Brunnen' : '🚰 Trinkwasser';
        const popupId = 'water-btn-' + Math.random().toString(36).substr(2,6);
        const popup = new maplibregl.Popup({ offset: 25, maxWidth: '220px' })
          .setHTML(
            '<div style="padding:6px;font-family:Inter,sans-serif;">' +
              '<div style="font-size:14px;font-weight:700;margin-bottom:4px;">💧 ' + src.name + '</div>' +
              '<div style="font-size:12px;color:#666;margin-bottom:2px;">' + typeIcon + '</div>' +
              '<div style="font-size:12px;color:#888;margin-bottom:8px;">📍 bei ' + distLabel + ' der Route</div>' +
              '<button id="' + popupId + '" style="width:100%;padding:8px;background:var(--color-primary,#c9a84c);color:white;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">+ Zur Route hinzufügen</button>' +
            '</div>'
          );
        marker.setPopup(popup);
        // When popup opens, bind the route button
        popup.on('open', () => {
          // Close previous popup
          if (self._activeWaterPopup && self._activeWaterPopup !== popup) {
            self._activeWaterPopup.remove();
          }
          self._activeWaterPopup = popup;
          setTimeout(() => {
            const btn = document.getElementById(popupId);
            if (btn) btn.addEventListener('click', () => {
              popup.remove();
              if (!self.isPlanning) {
                self.isPlanning = true;
                const planBtn = document.getElementById('routePlanBtn');
                if (planBtn) planBtn.classList.add('active');
                if (self.map) self.map.getCanvas().style.cursor = 'crosshair';
              }
              self.addWaypoint({ lng: src.lng, lat: src.lat, name: '💧 ' + src.name });
            });
          }, 50);
        });
        this._waterMarkers.push(marker);
      });

      // Update sidebar accordion
      const waterAccordion = document.getElementById('waterAccordion');
      const waterTitle = document.getElementById('waterAccordionTitle');
      const waterBody = document.getElementById('waterAccordionBody');
      if (waterAccordion && waterTitle && waterBody) {
        waterTitle.innerHTML = '\uD83D\uDCA7 ' + sources.length + ' Wasserquelle' + (sources.length > 1 ? 'n' : '') + ' auf der Route';
        waterBody.innerHTML = sources.map(function(s) {
          return '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border-color);">' +
            '<span>' + s.name + '</span><span style="color:var(--text-tertiary);">' + (s.distKm < 0.1 ? Math.round(s.distKm * 1000) + 'm' : 'km ' + s.distKm.toFixed(1)) + '</span></div>';
        }).join('');
        waterAccordion.classList.remove('hidden');
      }
    } catch (e) {
      console.warn('[Peakflow] Water source query failed', e);
    }
  },

  /**
   * Analyze sun position along the route (sunrise, sunset, golden hour, shade tips)
   */
  loadSunAnalysis(coords, elevations) {
    if (!coords || coords.length < 2 || typeof SunCalc === 'undefined') return;

    const startCoord = coords[0];
    const highIdx = elevations ? elevations.indexOf(Math.max(...elevations)) : Math.floor(coords.length / 2);
    const highCoord = coords[Math.min(highIdx, coords.length - 1)];
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    // Sun times at start point
    const startTimes = SunCalc.getTimes(today, startCoord[1], startCoord[0]);
    const highTimes = SunCalc.getTimes(today, highCoord[1], highCoord[0]);
    const tomorrowTimes = SunCalc.getTimes(tomorrow, startCoord[1], startCoord[0]);

    // Golden hour at highest point
    const goldenStart = SunCalc.getTimes(today, highCoord[1], highCoord[0]).goldenHour;

    // Sun position at noon at highest point
    const noonPos = SunCalc.getPosition(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0), highCoord[1], highCoord[0]);
    const sunAltNoon = Math.round(noonPos.altitude * 180 / Math.PI);

    // Format time helper
    const fmt = function(d) { return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0'); };

    // Build analysis
    const maxElev = elevations ? Math.max(...elevations) : 2000;
    let tip = '';
    if (sunAltNoon > 50) {
      tip = '\u2600\uFE0F Starke UV-Strahlung ab 11:00 - Sonnenschutz nicht vergessen!';
    } else if (sunAltNoon > 30) {
      tip = '\u2600\uFE0F M\u00e4\u00dfige Sonne - Sonnencreme empfohlen.';
    } else {
      tip = '\u2601\uFE0F Tiefstehende Sonne - angenehme Lichtverh\u00e4ltnisse.';
    }

    // Suggest best start time (sunrise + 30min for approach)
    const bestStart = new Date(startTimes.sunrise.getTime() + 30 * 60000);

    const sunAccordion = document.getElementById('sunAccordion');
    const sunTitle = document.getElementById('sunAccordionTitle');
    const sunBody = document.getElementById('sunAccordionBody');
    if (sunAccordion && sunTitle && sunBody) {
      sunTitle.innerHTML = '\u2600\uFE0F Sonnenaufgang ' + fmt(startTimes.sunrise) + ' \u2022 Untergang ' + fmt(startTimes.sunset);
      sunBody.innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">' +
          '<div style="padding:6px;background:var(--bg-secondary);border-radius:6px;text-align:center;">' +
            '<div style="font-size:18px;">\uD83C\uDF05</div><div style="font-size:11px;font-weight:600;">Aufgang</div><div style="font-size:13px;font-weight:700;">' + fmt(startTimes.sunrise) + '</div>' +
          '</div>' +
          '<div style="padding:6px;background:var(--bg-secondary);border-radius:6px;text-align:center;">' +
            '<div style="font-size:18px;">\uD83C\uDF07</div><div style="font-size:11px;font-weight:600;">Untergang</div><div style="font-size:13px;font-weight:700;">' + fmt(startTimes.sunset) + '</div>' +
          '</div>' +
          '<div style="padding:6px;background:var(--bg-secondary);border-radius:6px;text-align:center;">' +
            '<div style="font-size:18px;">\uD83C\uDF1F</div><div style="font-size:11px;font-weight:600;">Goldene Stunde</div><div style="font-size:13px;font-weight:700;">' + fmt(goldenStart) + '</div>' +
          '</div>' +
          '<div style="padding:6px;background:var(--bg-secondary);border-radius:6px;text-align:center;">' +
            '<div style="font-size:18px;">\u2600\uFE0F</div><div style="font-size:11px;font-weight:600;">Sonnenh\u00f6he 12:00</div><div style="font-size:13px;font-weight:700;">' + sunAltNoon + '\u00b0</div>' +
          '</div>' +
        '</div>' +
        '<div style="padding:6px;background:rgba(201,168,76,0.1);border-radius:6px;font-size:12px;margin-bottom:6px;">' +
          '\uD83D\uDCA1 <strong>Tipp:</strong> Starte um ' + fmt(bestStart) + ' f\u00fcr optimales Licht am Aufstieg.' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);">' + tip + '</div>' +
        '<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">Morgen: Aufgang ' + fmt(tomorrowTimes.sunrise) + ' | Untergang ' + fmt(tomorrowTimes.sunset) + '</div>';
      sunAccordion.classList.remove('hidden');
    }
  },

  /**
   * Fetch elevation data for coordinates using Open-Meteo
   */
  async fetchElevations(coords) {
    // Sample max 20 points to stay within URL length limits
    const maxSamples = 20;
    const step = Math.max(1, Math.floor(coords.length / maxSamples));
    const sampleIndices = [];
    for (let i = 0; i < coords.length; i += step) sampleIndices.push(i);
    if (sampleIndices[sampleIndices.length - 1] !== coords.length - 1) {
      sampleIndices.push(coords.length - 1);
    }

    const sampleCoords = sampleIndices.map(i => coords[i]);

    try {
      const lats = sampleCoords.map(c => c[1].toFixed(4)).join(',');
      const lngs = sampleCoords.map(c => c[0].toFixed(4)).join(',');

      const resp = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`);
      const data = await resp.json();

      if (data.elevation && data.elevation.length > 0) {
        // Interpolate elevations for all coords from sampled points
        const fullElevations = [];
        for (let i = 0; i < coords.length; i++) {
          // Find surrounding sample points
          let prevIdx = 0, nextIdx = sampleIndices.length - 1;
          for (let j = 0; j < sampleIndices.length - 1; j++) {
            if (i >= sampleIndices[j] && i <= sampleIndices[j + 1]) {
              prevIdx = j;
              nextIdx = j + 1;
              break;
            }
          }
          const range = sampleIndices[nextIdx] - sampleIndices[prevIdx] || 1;
          const t = (i - sampleIndices[prevIdx]) / range;
          const elev = data.elevation[prevIdx] + (data.elevation[nextIdx] - data.elevation[prevIdx]) * t;
          fullElevations.push(Math.round(elev));
        }
        return fullElevations;
      }
    } catch (e) {
      console.warn('[Peakflow] Elevation fetch failed, using estimates', e);
    }

    // Fallback: generate realistic elevation curve
    const baseElev = 1200;
    const peakElev = 2400;
    return coords.map((_, i) => {
      const t = i / (coords.length - 1);
      // Bell curve shape (up then down)
      return Math.round(baseElev + (peakElev - baseElev) * Math.sin(t * Math.PI));
    });
  },

  /**
   * Draw route line on map
   */
  drawRouteLine(coords) {
    if (!this.map) return;
    if (!coords || coords.length < 2) return;

    console.log(`[Peakflow] drawRouteLine: ${coords.length} points`);

    // Use MultiLineString if we have multiple disconnected chains (avoids straight-line bridges)
    const chains = this._routeLineChains;
    const geometry = (chains && chains.length > 1)
      ? { type: 'MultiLineString', coordinates: chains.map(chain => chain.map(c => [c[0], c[1]])) }
      : { type: 'LineString', coordinates: coords.map(c => [c[0], c[1]]) };

    const geojson = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry }]
    };

    // Try to update existing source first
    try {
      const src = this.map.getSource('route');
      if (src && this.map.getLayer('route-line')) {
        src.setData(geojson);
        console.log('[Peakflow] Route data updated');
        return;
      }
    } catch (e) { /* source might be stale after style change */ }

    // Add fresh source + layers
    const addLayers = () => {
      // Remove stale layers/source
      ['route-line', 'route-outline'].forEach(id => {
        try { if (this.map.getLayer(id)) this.map.removeLayer(id); } catch(e) {}
      });
      try { if (this.map.getSource('route')) this.map.removeSource('route'); } catch(e) {}

      this.map.addSource('route', { type: 'geojson', data: geojson });

      this.map.addLayer({
        id: 'route-outline',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#004d00', 'line-width': 7, 'line-opacity': 0.5 }
      });

      this.map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PeakflowRoutes.routeColor, 'line-width': 4, 'line-opacity': 1 }
      });
      console.log('[Peakflow] Route layers added OK');
    };

    // Try immediately, or poll until style is ready
    try {
      addLayers();
    } catch (e) {
      console.warn('[Peakflow] Waiting for style...', e.message);
      // Poll every 500ms until we can add layers (max 60s)
      let attempts = 0;
      const maxAttempts = 120;
      if (this._routeRetryInterval) clearInterval(this._routeRetryInterval);
      this._pendingRouteGeoJSON = geojson;
      this._routeRetryInterval = setInterval(() => {
        attempts++;
        try {
          // Re-read in case new data arrived while waiting
          const gj = this._pendingRouteGeoJSON || geojson;
          // Remove stale
          ['route-line', 'route-outline'].forEach(id => {
            try { if (this.map.getLayer(id)) this.map.removeLayer(id); } catch(e) {}
          });
          try { if (this.map.getSource('route')) this.map.removeSource('route'); } catch(e) {}

          this.map.addSource('route', { type: 'geojson', data: gj });
          this.map.addLayer({
            id: 'route-outline', type: 'line', source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#004d00', 'line-width': 7, 'line-opacity': 0.5 }
          });
          this.map.addLayer({
            id: 'route-line', type: 'line', source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': PeakflowRoutes.routeColor, 'line-width': 4, 'line-opacity': 1 }
          });
          clearInterval(this._routeRetryInterval);
          this._routeRetryInterval = null;
          this._pendingRouteGeoJSON = null;
          console.log(`[Peakflow] Route layers added after ${attempts} retries`);
        } catch (e2) {
          if (attempts >= maxAttempts) {
            clearInterval(this._routeRetryInterval);
            this._routeRetryInterval = null;
            console.error('[Peakflow] Could not add route after 60s');
          }
        }
      }, 500);
    }
  },

  /**
   * Clear route line from map
   */
  clearRouteLine() {
    // Stop any pending retry
    if (this._routeRetryInterval) {
      clearInterval(this._routeRetryInterval);
      this._routeRetryInterval = null;
    }
    this._pendingRouteGeoJSON = null;
    if (!this.map) return;
    try {
      ['route-line', 'route-outline'].forEach(id => {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      });
      if (this.map.getSource('route')) this.map.removeSource('route');
    } catch (e) { /* ignore if style not loaded */ }
  },

  /**
   * Update route statistics
   */
  updateStats() {
    const statsEl = document.getElementById('routeStats');
    const actionsEl = document.getElementById('routeActions');
    const infoEl = document.getElementById('routeInfo');
    const headerEl = document.getElementById('routeHeader');
    const headerCompact = document.getElementById('routeHeaderCompact');

    if (this.waypoints.length < 2) {
      statsEl.classList.add('hidden');
      actionsEl.classList.add('hidden');
      infoEl.classList.remove('hidden');
      // Show full header when no route
      if (headerEl) headerEl.classList.remove('hidden');
      if (headerCompact) headerCompact.style.display = 'none';
      // Hide map finish button
      var mapFinBtn = document.getElementById('mapFinishBtn');
      if (mapFinBtn) mapFinBtn.classList.add('hidden');
      return;
    }

    infoEl.classList.add('hidden');
    statsEl.classList.remove('hidden');
    actionsEl.classList.remove('hidden');

    // Show floating "Route fertig" button on map
    var mapFinBtn = document.getElementById('mapFinishBtn');
    if (mapFinBtn) mapFinBtn.classList.remove('hidden');

    // Hide full header, show compact restart
    if (headerEl) headerEl.classList.add('hidden');
    if (headerCompact) headerCompact.style.display = 'flex';

    // Auto-open user's preferred accordion sections
    this._applyAutoOpenSections();

    // Calculate distance from full route coords
    const distance = PeakflowUtils.routeDistance(this.routeCoords);
    // Use race override stats if available (stored DB values), else calculate from elevation data
    const calcElev = PeakflowUtils.calculateElevationGain(this.elevations);
    const ascent = (this._raceOverrideStats && this._raceOverrideStats.ascent) || calcElev.ascent;
    const descent = (this._raceOverrideStats && this._raceOverrideStats.descent) || calcElev.descent;
    const maxElev = Math.max(...this.elevations);
    const time = PeakflowUtils.calculateTime(distance, ascent, descent);
    const difficulty = PeakflowUtils.calculateDifficulty(distance, ascent, maxElev);

    // Update DOM
    document.getElementById('statDistance').textContent = `${distance.toFixed(1)} km`;
    document.getElementById('statDuration').textContent = PeakflowUtils.formatDuration(time.hours, time.minutes);
    document.getElementById('statAscent').textContent = `${ascent} m ↑`;
    document.getElementById('statDescent').textContent = `${descent} m ↓`;

    // Update elevation profile header with duration
    const elevDur = document.getElementById('elevationDuration');
    if (elevDur) {
      elevDur.textContent = `${ascent}m ↑  ${descent}m ↓  ${PeakflowUtils.formatDuration(time.hours, time.minutes)}`;
    }

    // Store for nutrition calculator + difficulty
    this._currentDifficulty = difficulty;
    this._lastDurationH = time.hours + time.minutes / 60;
    const badge = document.getElementById('difficultyBadge');
    badge.className = `difficulty-badge ${difficulty.class}`;
    badge.querySelector('.difficulty-badge__text').textContent = difficulty.label;
    // Hide badge - difficulty will be shown in SAC accordion title
    badge.classList.add('hidden');
  },

  /**
   * Draw elevation profile on canvas
   */
  drawElevationProfile() {
    if (!this.elevationCtx || this.elevations.length < 2) return;

    const canvas = this.elevationCanvas;
    const ctx = this.elevationCtx;
    const dpr = window.devicePixelRatio || 1;

    // Set actual size in memory
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padding = { top: 10, right: 10, bottom: 25, left: 45 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // Clear
    ctx.clearRect(0, 0, w, h);

    const elevs = this.elevations;
    const minElev = Math.min(...elevs) - 50;
    const maxElev = Math.max(...elevs) + 50;
    const elevRange = maxElev - minElev || 1;

    // Calculate cumulative distances
    const distances = [0];
    for (let i = 1; i < this.routeCoords.length; i++) {
      const d = PeakflowUtils.haversineDistance(
        this.routeCoords[i-1][1], this.routeCoords[i-1][0],
        this.routeCoords[i][1], this.routeCoords[i][0]
      );
      distances.push(distances[i-1] + d);
    }
    const totalDist = distances[distances.length - 1] || 1;

    // Draw grid lines
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-color-light').trim() || '#f1f5f9';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      // Elevation labels
      const elev = Math.round(maxElev - (elevRange / 4) * i);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#94a3b8';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${elev}m`, padding.left - 5, y + 4);
    }

    // Distance labels
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const x = padding.left + (plotW / 4) * i;
      const dist = (totalDist / 4 * i).toFixed(1);
      ctx.fillText(`${dist}km`, x, h - 5);
    }

    // Draw filled area with gradient
    const gradient = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
    const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#c9a84c';
    gradient.addColorStop(0, primaryColor + '40');
    gradient.addColorStop(1, primaryColor + '05');

    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + plotH);

    for (let i = 0; i < elevs.length; i++) {
      const x = padding.left + (distances[i] / totalDist) * plotW;
      const y = padding.top + plotH - ((elevs[i] - minElev) / elevRange) * plotH;

      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.lineTo(padding.left + plotW, padding.top + plotH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw line segments colored by slope
    for (let i = 1; i < elevs.length; i++) {
      const x1 = padding.left + (distances[i-1] / totalDist) * plotW;
      const y1 = padding.top + plotH - ((elevs[i-1] - minElev) / elevRange) * plotH;
      const x2 = padding.left + (distances[i] / totalDist) * plotW;
      const y2 = padding.top + plotH - ((elevs[i] - minElev) / elevRange) * plotH;

      const segDist = distances[i] - distances[i-1];
      const elevDiff = elevs[i] - elevs[i-1];
      const slope = PeakflowUtils.calculateSlope(segDist, elevDiff);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = PeakflowUtils.getSlopeColor(slope);
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Store for hover
    this._profileData = { distances, elevs, totalDist, minElev, elevRange, padding, plotW, plotH };
  },

  /**
   * Setup elevation profile hover interaction
   */
  setupElevationHover() {
    const canvas = this.elevationCanvas;
    if (!canvas) return;

    const tooltip = document.getElementById('elevationTooltip');

    canvas.addEventListener('mousemove', (e) => {
      if (!this._profileData) return;
      const { distances, elevs, totalDist, minElev, elevRange, padding, plotW, plotH } = this._profileData;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const relX = x - padding.left;

      if (relX < 0 || relX > plotW) {
        tooltip.classList.add('hidden');
        return;
      }

      // Find closest point
      const distAtX = (relX / plotW) * totalDist;
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < distances.length; i++) {
        const diff = Math.abs(distances[i] - distAtX);
        if (diff < minDiff) { minDiff = diff; closestIdx = i; }
      }

      const elev = Math.round(elevs[closestIdx]);
      const dist = distances[closestIdx].toFixed(1);

      tooltip.classList.remove('hidden');
      tooltip.textContent = `${elev}m | ${dist}km`;
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${padding.top + plotH - ((elevs[closestIdx] - minElev) / elevRange) * plotH - 30}px`;

      // Move marker on map to this position
      if (this.routeCoords[closestIdx]) {
        this.showHoverMarker(this.routeCoords[closestIdx]);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      tooltip.classList.add('hidden');
      this.hideHoverMarker();
    });
  },

  /**
   * Show/hide hover marker on map
   */
  showHoverMarker(coord) {
    if (!this._hoverMarker) {
      const el = document.createElement('div');
      el.style.cssText = 'width:12px;height:12px;background:#ef4444;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);';
      this._hoverMarker = new maplibregl.Marker({ element: el })
        .setLngLat([coord[0], coord[1]])
        .addTo(this.map);
    } else {
      this._hoverMarker.setLngLat([coord[0], coord[1]]);
    }
  },

  hideHoverMarker() {
    if (this._hoverMarker) {
      this._hoverMarker.remove();
      this._hoverMarker = null;
    }
  },

  /**
   * Load weather for route area and display in sidebar
   */
  async loadRouteWeather(coords) {
    if (!coords || coords.length < 2) return;
    const weatherEl = document.getElementById('routeWeather');
    if (!weatherEl) return;

    // Use highest point of route for weather (most relevant for alpine conditions)
    let maxElev = 0, maxIdx = 0;
    for (let i = 0; i < coords.length; i++) {
      if (coords[i][2] && coords[i][2] > maxElev) { maxElev = coords[i][2]; maxIdx = i; }
    }
    const lat = coords[maxIdx][1];
    const lng = coords[maxIdx][0];

    // Show weather accordion with loading state
    var weatherAccordion = document.getElementById('weatherAccordion');
    if (weatherAccordion) weatherAccordion.classList.remove('hidden');
    var wAccTitleInit = document.getElementById('weatherAccordionTitle');
    if (wAccTitleInit) wAccTitleInit.textContent = '\uD83C\uDF21\uFE0F Wetter wird geladen...';
    weatherEl.innerHTML = '';

    try {
      const weather = await PeakflowWeather.getCurrentWeather(lat, lng);
      const forecast = await PeakflowWeather.getDetailedForecast(lat, lng);

      // Update accordion header with compact temperature
      var wAccTitle = document.getElementById('weatherAccordionTitle');
      if (wAccTitle && weather) {
        wAccTitle.innerHTML = '\uD83C\uDF21\uFE0F ' + Math.round(weather.temperature || 0) + '\u00b0C \u00b7 ' +
          (weather.description || '') + ' \u00b7 \uD83D\uDCA8 ' + Math.round(weather.windSpeed || 0) + 'km/h';
      }

      let html = PeakflowWeather.renderWeatherHTML(weather);

      // Tomorrow
      if (forecast) {
        html += PeakflowWeather.renderNextDayHTML(forecast);
      }

      // Buttons for hourly / 7-day
      if (forecast) {
        html += '<div style="display:flex;gap:8px;margin-top:8px;">' +
          '<button class="route-weather-btn" data-type="hourly" style="flex:1;padding:6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">\u23F1 St\u00fcndlich</button>' +
          '<button class="route-weather-btn" data-type="weekly" style="flex:1;padding:6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">\uD83D\uDCC5 7 Tage</button>' +
        '</div>';
      }

      // Thunderstorm warning - check CAPE (Convective Available Potential Energy)
      try {
        const stormUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng +
          '&hourly=cape,precipitation_probability,weathercode&forecast_days=2&timezone=auto';
        const stormData = await PeakflowWeather.rateLimitedFetch(stormUrl);
        if (stormData.hourly) {
          const times = stormData.hourly.time || [];
          const capes = stormData.hourly.cape || [];
          const precips = stormData.hourly.precipitation_probability || [];
          const codes = stormData.hourly.weathercode || [];

          // Find thunderstorm risk in next 24h
          const now = new Date();
          let maxCape = 0, stormHours = [];

          for (let i = 0; i < Math.min(times.length, 48); i++) {
            const t = new Date(times[i]);
            if (t < now) continue;
            const cape = capes[i] || 0;
            const code = codes[i] || 0;
            const isStormCode = code >= 95; // WMO 95-99 = thunderstorm

            if (cape > maxCape) maxCape = cape;
            if (cape > 500 || isStormCode) {
              stormHours.push({
                time: t.getHours() + ':00',
                date: t.toLocaleDateString('de-DE', { weekday: 'short' }),
                cape: cape,
                precip: precips[i] || 0,
                isStorm: isStormCode
              });
            }
          }

          if (stormHours.length > 0 || maxCape > 300) {
            var level, color, icon, text;
            if (maxCape > 1500 || stormHours.some(function(h) { return h.isStorm; })) {
              level = 'HOCH'; color = '#dc2626'; icon = '🌩️';
              text = 'Starke Gewitter wahrscheinlich! Tour verschieben oder früh starten.';
            } else if (maxCape > 800) {
              level = 'MITTEL'; color = '#ea580c'; icon = '⛈️';
              text = 'Gewitterrisiko am Nachmittag. Gipfel vor 13:00 erreichen!';
            } else {
              level = 'GERING'; color = '#d97706'; icon = '🌤️';
              text = 'Leichtes Gewitterpotenzial. Wetter beobachten.';
            }

            html += '<div style="margin-top:10px;padding:8px 10px;border-radius:8px;border:1px solid ' + color + '40;background:' + color + '10;">' +
              '<div style="font-size:13px;font-weight:700;color:' + color + ';">' + icon + ' Gewitterwarnung: ' + level + '</div>' +
              '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">' + text + '</div>';

            if (stormHours.length > 0) {
              html += '<div style="font-size:11px;margin-top:4px;color:var(--text-tertiary);">Risiko-Zeiten: ' +
                stormHours.slice(0, 5).map(function(h) { return h.date + ' ' + h.time; }).join(', ') + '</div>';
            }
            html += '</div>';
          }
        }
      } catch(e) {
        console.warn('[Peakflow] Storm check failed:', e);
      }

      weatherEl.innerHTML = html;

      // Attach button handlers
      weatherEl.querySelectorAll('.route-weather-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (btn.dataset.type === 'hourly') {
            Peakflow._showWeatherPopup('St\u00fcndliche Vorhersage', PeakflowWeather.renderForecastHTML(forecast));
          } else {
            const weekly = await PeakflowWeather.getWeeklyForecast(lat, lng);
            Peakflow._showWeatherPopup('7-Tage Vorhersage', weekly ? PeakflowWeather.renderWeeklyHTML(weekly) : '<p>Nicht verf\u00fcgbar</p>');
          }
        });
      });
    } catch (e) {
      weatherEl.innerHTML = '<div style="color:var(--text-tertiary);font-size:12px;">Wetter nicht verf\u00fcgbar</div>';
    }
  },

  /**
   * Analyze snow on current route
   */
  async analyzeSnowOnRoute() {
    if (this.routeCoords.length < 2) return;

    // Always generate a basic packing list first
    this.generateBasicPackingList();

    let analysis = null;
    try {
      const coordsWithElev = this.routeCoords.map((c, i) => [c[0], c[1], this.elevations[i] || 0]);
      analysis = await PeakflowSnow.analyzeRoute(coordsWithElev);
    } catch (e) {
      console.warn('[Peakflow] Snow analysis failed, using basic packing list', e);
      return;
    }

    if (analysis && analysis.maxSnowDepth > 0) {
      const text = PeakflowSnow.getWarningText(analysis);

      // Show snow accordion — always when any snow detected
      const snowAccordion = document.getElementById('snowAccordion');
      const snowTitle = document.getElementById('snowAccordionTitle');
      const snowBody = document.getElementById('snowAccordionBody');
      if (snowAccordion) {
        const snow = analysis.maxSnowDepth;
        const color = snow >= 40 ? '#dc2626' : snow >= 10 ? '#ea580c' : '#d97706';
        snowTitle.innerHTML = '<span style="color:' + color + ';">\u2744\uFE0F ' + Math.round(analysis.maxSnowDepth) + 'cm Schnee</span>';
        snowBody.innerHTML = '<div style="color:' + color + ';">' + text + '</div>';
        snowAccordion.classList.remove('hidden');
        snowAccordion.querySelector('.route-accordion__header').style.borderColor = color + '40';
        // Auto-open if dangerous (10cm+)
        if (snow >= 10) snowAccordion.classList.add('open');
      }

      // Also update hidden compat element
      const warningText = document.getElementById('snowWarningText');
      if (warningText && text) warningText.textContent = text;

      PeakflowSnow.applySnowOverlay(this.map, this.routeCoords, analysis);

      // Generate packing list
      const maxElev = Math.max(...this.elevations);
      const { ascent } = PeakflowUtils.calculateElevationGain(this.elevations);
      const weather = await PeakflowWeather.getCurrentWeather(
        this.waypoints[0].lat, this.waypoints[0].lng
      );

      const items = PeakflowUtils.generatePackingList(
        ascent, maxElev,
        analysis.maxSnowDepth,
        weather ? weather.temperature : 10,
        weather ? weather.windSpeed : 15,
        0
      );

      // Show packing accordion
      const packAccordion = document.getElementById('packAccordion');
      const itemsEl = document.getElementById('packingItems');
      if (itemsEl) itemsEl.innerHTML = items.map(function(item) { return '<li style="padding:3px 10px;background:var(--bg-secondary);border-radius:6px;font-size:12px;">' + item + '</li>'; }).join('');
      if (packAccordion) packAccordion.classList.remove('hidden');
      this._updateNutritionPanel(weather ? weather.temperature : 10);
    } else {
      document.getElementById('snowWarning').classList.add('hidden');

      // Still generate basic packing list
      if (this.elevations.length > 0) {
        const maxElev = Math.max(...this.elevations);
        const { ascent } = PeakflowUtils.calculateElevationGain(this.elevations);
        const items = PeakflowUtils.generatePackingList(ascent, maxElev, 0, 10, 15, 0);
        const packAccordion = document.getElementById('packAccordion');
        const itemsEl = document.getElementById('packingItems');
        if (itemsEl) itemsEl.innerHTML = items.map(function(item) { return '<li style="padding:3px 10px;background:var(--bg-secondary);border-radius:6px;font-size:12px;">' + item + '</li>'; }).join('');
        if (packAccordion) packAccordion.classList.remove('hidden');
        this._updateNutritionPanel(10); // default 10°C if no weather
      }
    }
  },

  /**
   * Show routing warning in the sidebar
   */
  _showRoutingWarning(text) {
    // Use a dedicated routing warning element (create if needed)
    let warning = document.getElementById('routingWarning');
    if (!warning) {
      warning = document.createElement('div');
      warning.id = 'routingWarning';
      warning.style.cssText = `
        padding: 10px 14px; border-radius: 10px; font-size: 13px;
        line-height: 1.4; margin: 8px 0; display: flex; align-items: flex-start; gap: 8px;
      `;
      const stats = document.getElementById('routeStats');
      if (stats) stats.insertBefore(warning, document.getElementById('snowWarning'));
    }

    const isNoTrail = text.includes('KEIN WEG') || text.includes('Luftlinie');
    warning.style.background = isNoTrail ? 'rgba(220, 38, 38, 0.1)' : 'rgba(245, 158, 11, 0.1)';
    warning.style.borderLeft = isNoTrail ? '3px solid #dc2626' : '3px solid #d97706';
    warning.style.color = isNoTrail ? '#dc2626' : '#92400e';
    warning.innerHTML = text;
    warning.classList.remove('hidden');
  },

  _hideRoutingWarning() {
    const warning = document.getElementById('routingWarning');
    if (warning) warning.classList.add('hidden');
  },

  /**
   * Load SAC scale data from OpenStreetMap Overpass API for the route area
   * and mark dangerous sections with blinking markers
   */
  async loadSACDataForRoute(coords) {
    if (!coords || coords.length < 2) return;
    if (!this.map) return;

    this._clearDangerMarkers();

    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const pad = 0.003;
    const south = Math.min(...lats) - pad;
    const west = Math.min(...lngs) - pad;
    const north = Math.max(...lats) + pad;
    const east = Math.max(...lngs) + pad;

    const sacMap = {
      'hiking': { level: 'T1', label: 'Wandern', color: null, blink: false },
      'mountain_hiking': { level: 'T2', label: 'Bergwandern', color: null, blink: false },
      'demanding_mountain_hiking': { level: 'T3', label: 'Anspruchsvoll', color: null, blink: false },
      'alpine_hiking': { level: 'T4', label: 'Alpinwandern', color: '#e67e22', blink: true },
      'demanding_alpine_hiking': { level: 'T5', label: 'Alpinklettern', color: '#e74c3c', blink: true },
      'difficult_alpine_hiking': { level: 'T6', label: 'Schwieriges Alpinklettern', color: '#8b0000', blink: true }
    };

    let trails = [];

    // METHOD 1: Try Supabase sac_trails table (instant, reliable)
    try {
      console.log('[Peakflow] Loading SAC data from Supabase...');
      const url = 'https://wbrvkweezbeakfphssxp.supabase.co/rest/v1/sac_trails' +
        '?bbox_max_lat=gte.' + south +
        '&bbox_min_lat=lte.' + north +
        '&bbox_max_lng=gte.' + west +
        '&bbox_min_lng=lte.' + east +
        '&sac_scale=in.(demanding_mountain_hiking,alpine_hiking,demanding_alpine_hiking,difficult_alpine_hiking)' +
        '&select=osm_id,name,sac_scale,geometry' +
        '&limit=500';
      const resp = await fetch(url, {
        headers: {
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE'
        }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.length > 0) {
          console.log('[Peakflow] Supabase: ' + data.length + ' SAC trails found');
          trails = data.map(t => ({
            geometry: t.geometry,
            sac_scale: t.sac_scale,
            name: t.name,
            osm_id: t.osm_id
          }));
        }
      }
    } catch(e) {
      console.warn('[Peakflow] Supabase SAC query failed:', e);
    }

    // No Overpass fallback - Supabase has 181K SAC trails, if query returned empty
    // it means this area has no T3+ trails (which is fine)

    if (trails.length === 0) {
      console.log('[Peakflow] No SAC trail data available');
      return;
    }

    // Find T4+ SAC trails that intersect with our route — place markers ON the route
    const threshold = 0.003; // ~300m
    const thresholdSq = threshold * threshold;
    let maxSac = null;
    let dangerCount = 0;
    const dangerPoints = []; // {routeCoord, sacInfo, trailName}

    for (const trail of trails) {
      const geom = trail.geometry;
      if (!geom || geom.length < 2) continue;
      const sacInfo = sacMap[trail.sac_scale];
      if (!sacInfo) continue;

      // Find the closest route point to this trail
      for (const node of geom) {
        const nLng = Array.isArray(node) ? node[0] : node.lon;
        const nLat = Array.isArray(node) ? node[1] : node.lat;
        let bestDist = Infinity, bestIdx = -1;
        for (let ci = 0; ci < coords.length; ci += 3) {
          const dLat = coords[ci][1] - nLat;
          const dLng = coords[ci][0] - nLng;
          const d = dLat * dLat + dLng * dLng;
          if (d < bestDist) { bestDist = d; bestIdx = ci; }
        }
        if (bestDist < thresholdSq && bestIdx >= 0) {
          if (!maxSac || sacInfo.level > (maxSac.level || '')) maxSac = sacInfo;
          if (sacInfo.blink) {
            dangerCount++;
            dangerPoints.push({
              coord: [coords[bestIdx][0], coords[bestIdx][1]], // ON the route, not on the trail
              sacInfo, name: trail.name, idx: bestIdx
            });
          }
          break; // one match per trail is enough
        }
      }
    }

    // Place max 8 markers ON the route at T4+ danger zones
    if (dangerPoints.length > 0) {
      dangerPoints.sort((a, b) => a.idx - b.idx);
      let markers = dangerPoints;
      if (markers.length > 8) {
        const step = Math.ceil(markers.length / 8);
        markers = markers.filter((_, i) => i % step === 0);
      }
      if (!this._dangerMarkers) this._dangerMarkers = [];
      // Add markers EXACTLY like water sources (which work correctly)
      markers.forEach(pt => {
        if (!pt.coord || pt.coord.length < 2) return;
        const lng = parseFloat(pt.coord[0]);
        const lat = parseFloat(pt.coord[1]);
        if (isNaN(lng) || isNaN(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return;
        console.log('[Peakflow] Danger marker placing at:', lng, lat, pt.sacInfo.level, pt.name);

        const el = document.createElement('div');
        el.innerHTML = '\u26A0';
        el.style.cssText = 'width:22px;height:22px;border-radius:50%;background:' + pt.sacInfo.color +
          ';border:2px solid white;box-shadow:0 0 16px ' + pt.sacInfo.color +
          ';animation:dangerBlink 2.5s ease-in-out infinite;cursor:pointer;z-index:5;' +
          'display:flex;align-items:center;justify-content:center;font-size:12px;color:white;';

        // EXACT same pattern as water source markers (line 829) which work correctly
        const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(this.map);
        const popup = new maplibregl.Popup({ offset: 25 })
          .setHTML('<strong style="color:' + pt.sacInfo.color + ';">⚠ SAC ' + pt.sacInfo.level + ' ' + pt.sacInfo.label + '</strong>' +
            (pt.name ? '<div style="font-size:12px;">' + pt.name + '</div>' : ''));
        marker.setPopup(popup);
        this._dangerMarkers.push(marker);
      });
      console.log('[Peakflow] Placed ' + markers.length + ' SAC danger markers ON route');
    }

    console.log('[Peakflow] SAC results: maxSac=' + (maxSac ? maxSac.level : 'none') + ', dangerCount=' + dangerCount);

    // Update SAC accordion
    if (maxSac && dangerCount > 0) {
      const sacBody = document.getElementById('sacAccordionBody');
      const sacTitle = document.getElementById('sacAccordionTitle');
      const sacAccordion = document.getElementById('sacAccordion');
      if (sacBody && sacTitle && sacAccordion) {
        const levelEmoji = maxSac.level === 'T6' ? '⛔' : maxSac.level === 'T5' ? '🔴' : '🟠';
        var diffLabel = this._currentDifficulty ? this._currentDifficulty.label : '';
        sacTitle.innerHTML = '<span style="color:' + (maxSac.color || '#e67e22') + ';">⚠ ' + diffLabel + ' • SAC ' + maxSac.level + ' ' + maxSac.label + ' • ' + dangerCount + ' Gefahrenstellen</span>';
        // Show danger sections with KM positions
        var dangerKmList = '';
        if (dangerPoints && dangerPoints.length > 0 && this.routeCoords && this.routeCoords.length > 1) {
          var cumDist = 0;
          var routeC = this.routeCoords;
          var distAtIdx = [0];
          for (var di = 1; di < routeC.length; di++) {
            cumDist += PeakflowUtils.haversineDistance(routeC[di-1][1], routeC[di-1][0], routeC[di][1], routeC[di][0]);
            distAtIdx.push(cumDist);
          }
          dangerKmList = '<div style="margin-top:4px;">';
          dangerPoints.slice(0, 5).forEach(function(dp) {
            var km = distAtIdx[Math.min(dp.idx, distAtIdx.length - 1)] || 0;
            dangerKmList += '<div style="font-size:11px;padding:2px 0;">' + levelEmoji + ' km ' + km.toFixed(1) + ' — SAC ' + dp.sacInfo.level + ' ' + dp.sacInfo.label + (dp.name ? ' (' + dp.name + ')' : '') + '</div>';
          });
          dangerKmList += '</div>';
        }
        sacBody.innerHTML += '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-color);font-size:12px;">' +
          levelEmoji + ' <strong>' + dangerCount + '</strong> gef\u00e4hrliche Abschnitte (SAC-best\u00e4tigt).' + dangerKmList + '</div>';
        sacAccordion.classList.remove('hidden');
      }
    }
  },

  _clearDangerMarkers() {
    if (this._dangerMarkers) {
      this._dangerMarkers.forEach(m => m.remove());
      this._dangerMarkers = [];
    }
  },

  /**
   * Analyze route for dangerous sections and estimate SAC scale
   */
  _analyzeRouteDanger(coords, elevations, routeDistKm) {
    const maxElev = Math.max(...elevations);
    const minElev = Math.min(...elevations);
    const { ascent } = PeakflowUtils.calculateElevationGain(elevations);

    // Calculate steepness stats per 100m segment
    let steepSections = 0;  // >20°
    let extremeSections = 0; // >35°
    let maxSlope = 0;
    const segLen = 5; // every 5 points

    for (let i = segLen; i < coords.length; i += segLen) {
      const dist = PeakflowUtils.haversineDistance(
        coords[i - segLen][1], coords[i - segLen][0], coords[i][1], coords[i][0]
      );
      if (dist > 0.005) {
        const slope = Math.abs(Math.atan2(elevations[i] - elevations[i - segLen], dist * 1000) * 180 / Math.PI);
        if (slope > maxSlope) maxSlope = slope;
        if (slope > 20) steepSections++;
        if (slope > 35) extremeSections++;
      }
    }

    // Estimate SAC scale based on terrain analysis
    let sacLevel, sacLabel, sacColor;
    if (extremeSections > 3 || maxSlope > 45) {
      sacLevel = 'T5-T6';
      sacLabel = 'Alpinklettern';
      sacColor = '#7f1d1d';
    } else if (extremeSections > 0 || maxSlope > 35 || (maxElev > 3000 && steepSections > 5)) {
      sacLevel = 'T4-T5';
      sacLabel = 'Alpinwandern / exponiert';
      sacColor = '#dc2626';
    } else if (steepSections > 5 || maxSlope > 25 || maxElev > 2800) {
      sacLevel = 'T3-T4';
      sacLabel = 'Anspruchsvolles Bergwandern';
      sacColor = '#ea580c';
    } else if (steepSections > 2 || maxSlope > 15 || maxElev > 2000) {
      sacLevel = 'T2-T3';
      sacLabel = 'Bergwandern';
      sacColor = '#d97706';
    } else {
      sacLevel = 'T1-T2';
      sacLabel = 'Wandern';
      sacColor = '#0d9488';
    }

    // Show SAC accordion
    const sacAccordion = document.getElementById('sacAccordion');
    const sacTitle = document.getElementById('sacAccordionTitle');
    const sacBody = document.getElementById('sacAccordionBody');

    if (sacAccordion && sacTitle && sacBody) {
      var diffLabel = this._currentDifficulty ? this._currentDifficulty.label : '';
      sacTitle.innerHTML = '<span style="color:' + sacColor + ';">\u26A0 ' + diffLabel + ' \u2022 SAC ' + sacLevel + ' ' + sacLabel + '</span>';
      let bodyHTML = '';
      if (sacLevel.includes('T5') || sacLevel.includes('T6')) {
        bodyHTML = '\uD83D\uDEA8 <strong>GEF\u00c4HRLICH!</strong> Kletterpassagen, exponierte Grate. Nur f\u00fcr erfahrene Alpinisten!<br><span style="color:#e74c3c;">\uD83D\uDD34 Blinkende Abschnitte zeigen Gefahrenstellen.</span>';
      } else if (sacLevel.includes('T4')) {
        bodyHTML = '\u26A0\uFE0F Exponierte Stellen, Absturzgefahr! Steilheit bis ' + Math.round(maxSlope) + '\u00b0.<br><span style="color:#e67e22;">\uD83D\uDFE0 Blinkende Abschnitte zeigen Gefahrenstellen.</span>';
      } else if (sacLevel.includes('T3')) {
        bodyHTML = 'Trittsicherheit empfohlen. Steile Passagen bis ' + Math.round(maxSlope) + '\u00b0.';
      } else {
        bodyHTML = 'Leichte bis mittlere Wanderwege.';
      }
      sacBody.innerHTML = bodyHTML;
      sacAccordion.classList.remove('hidden');
      sacAccordion.querySelector('.route-accordion__header').style.borderColor = sacColor + '40';
    }

    // Place blinking markers at steep sections (works even without Overpass)
    this._placeSteepMarkers(coords, elevations);
  },

  /**
   * Place blinking markers at steep/dangerous sections of the route
   * Works independently of Overpass - uses elevation data we already have
   */
  _placeSteepMarkers(coords, elevations) {
    if (!this.map || !coords || coords.length < 10 || !elevations || elevations.length < 10) return;
    if (!this._dangerMarkers) this._dangerMarkers = [];

    // Use wider window for stable slope calculation (20 points ~ 200-400m)
    const step = 20;
    const allSlopes = [];

    for (let i = step; i < coords.length - step; i += step) {
      const dist = PeakflowUtils.haversineDistance(
        coords[i - step][1], coords[i - step][0], coords[i][1], coords[i][0]
      );
      if (dist < 0.01) continue; // Skip degenerate segments
      const elevDiff = Math.abs(elevations[Math.min(i, elevations.length - 1)] - elevations[Math.min(i - step, elevations.length - 1)]);
      const slope = Math.atan2(elevDiff, dist * 1000) * 180 / Math.PI;
      if (slope > 15) { // Collect all steep-ish sections
        allSlopes.push({ coord: [coords[i][0], coords[i][1]], slope, idx: i });
      }
    }

    // Mark sections based on SAC level:
    // T3+ (>20°) gets orange markers, T4+ (>30°) gets red markers
    let steepPoints = allSlopes.filter(pt => pt.slope > 20);

    // Fallback: if no >20° found but route IS rated T4+, lower threshold
    if (steepPoints.length === 0 && allSlopes.length > 0) {
      steepPoints = allSlopes.filter(pt => pt.slope > 15);
    }

    if (steepPoints.length === 0) {
      console.log('[Peakflow] No steep sections found for markers');
      return;
    }

    // Max 8 markers, spread evenly along the route
    if (steepPoints.length > 8) {
      steepPoints.sort((a, b) => a.idx - b.idx);
      const step2 = Math.ceil(steepPoints.length / 8);
      steepPoints = steepPoints.filter((_, i) => i % step2 === 0);
    }

    console.log('[Peakflow] Steep analysis: ' + allSlopes.length + ' slopes found, ' + steepPoints.length + ' markers to place. Max slope: ' + (allSlopes.length > 0 ? Math.round(Math.max(...allSlopes.map(s => s.slope))) + '\u00b0' : 'none'));

    steepPoints.forEach(pt => {
      const color = pt.slope > 35 ? '#8b0000' : pt.slope > 25 ? '#e74c3c' : '#e67e22';
      const label = pt.slope > 35 ? '\u26A0 T5+ Sehr steil (' + Math.round(pt.slope) + '\u00b0)' :
                    pt.slope > 25 ? '\u26A0 T4 Steil (' + Math.round(pt.slope) + '\u00b0)' :
                    '\u26A0 T3 Steil (' + Math.round(pt.slope) + '\u00b0)';

      const el = document.createElement('div');
      el.innerHTML = '\u26A0';
      el.style.cssText = 'width:22px;height:22px;border-radius:50%;background:' + color +
        ';border:2px solid white;box-shadow:0 0 16px ' + color + ',0 0 8px rgba(0,0,0,0.5)' +
        ';animation:dangerBlink 2.5s ease-in-out infinite;cursor:pointer;z-index:5;' +
        'display:flex;align-items:center;justify-content:center;font-size:12px;color:white;';
      el.title = label;

      if (!pt.coord || Math.abs(pt.coord[0]) > 180) return;
      const lng = parseFloat(pt.coord[0]);
      const lat = parseFloat(pt.coord[1]);
      if (isNaN(lng) || isNaN(lat)) return;
      // EXACT same pattern as water source markers which work correctly
      const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(this.map);
      const popup = new maplibregl.Popup({ offset: 10 })
        .setHTML('<div style="padding:4px;"><strong style="color:' + color + ';">\u26A0\uFE0F ' + label + '</strong></div>');
      marker.setPopup(popup);

      this._dangerMarkers.push(marker);
    });
  },

  _applyAutoOpenSections() {
    var prefs = [];
    try { prefs = JSON.parse(localStorage.getItem('peakflow_auto_open') || '[]'); } catch(e) {}
    var map = {
      'waypoints': 'waypointAccordion',
      'weather': 'weatherAccordion',
      'packing': 'packAccordion',
      'water': 'waterAccordion',
      'sun': 'sunAccordion'
    };
    for (var key in map) {
      var el = document.getElementById(map[key]);
      if (el && prefs.indexOf(key) >= 0) {
        el.classList.add('open');
      }
    }
  },

  _getMaxSlope(coords, elevations) {
    let maxSlope = 0;
    for (let i = 10; i < coords.length; i += 10) {
      const dist = PeakflowUtils.haversineDistance(
        coords[i - 10][1], coords[i - 10][0], coords[i][1], coords[i][0]
      );
      if (dist > 0.01) {
        const slope = Math.abs(Math.atan2(elevations[i] - elevations[i - 10], dist * 1000) * 180 / Math.PI);
        if (slope > maxSlope) maxSlope = slope;
      }
    }
    return maxSlope;
  },

  /**
   * Generate a basic packing list from route stats (no API needed)
   */
  _updateNutritionPanel(tempC) {
    try {
      const panel = document.getElementById('nutritionPanel');
      const grid = document.getElementById('nutritionGrid');
      const tip = document.getElementById('nutritionTip');
      const title = document.getElementById('packAccordionTitle');
      if (!panel || !grid) return;

      const { ascent, descent } = PeakflowUtils.calculateElevationGain(this.elevations);
      const distKm = PeakflowUtils.routeDistance(this.routeCoords);
      const durationH = this._lastDurationH || (distKm / 4); // fallback 4km/h

      // Get profile from select
      var profile = 'hiker';
      var profileSelect = document.getElementById('profileSelect');
      if (profileSelect) profile = profileSelect.value;

      var temp = typeof tempC === 'number' ? tempC : 10;
      var n = PeakflowUtils.calculateNutrition(distKm, ascent, descent, durationH, temp, profile);
      if (!n) { panel.classList.add('hidden'); return; }

      // Update title with summary
      if (title) title.innerHTML = '🎒 Packliste · 💧' + n.waterL + 'L · ⚡' + n.calories + ' kcal';

      // Render grid
      grid.innerHTML =
        '<div style="padding:8px;border-radius:6px;background:rgba(59,130,246,0.1);text-align:center;">' +
          '<div style="font-size:18px;font-weight:800;color:#3b82f6;">💧 ' + n.waterL + 'L</div>' +
          '<div style="font-size:10px;color:var(--text-muted);">' + n.mlPerHour + ' ml/Std</div>' +
        '</div>' +
        '<div style="padding:8px;border-radius:6px;background:rgba(249,115,22,0.1);text-align:center;">' +
          '<div style="font-size:18px;font-weight:800;color:#f97316;">⚡ ' + n.calories + '</div>' +
          '<div style="font-size:10px;color:var(--text-muted);">kcal gesamt</div>' +
        '</div>' +
        '<div style="padding:8px;border-radius:6px;background:rgba(34,197,94,0.1);text-align:center;">' +
          '<div style="font-size:15px;font-weight:700;">🍌 ' + n.bananas + ' · 🍫 ' + n.bars + '</div>' +
          '<div style="font-size:10px;color:var(--text-muted);">Obst · Riegel</div>' +
        '</div>' +
        '<div style="padding:8px;border-radius:6px;background:rgba(168,85,247,0.1);text-align:center;">' +
          '<div style="font-size:15px;font-weight:700;">⚡ ' + n.gels + (n.electroTabs > 0 ? ' · 💊 ' + n.electroTabs : '') + '</div>' +
          '<div style="font-size:10px;color:var(--text-muted);">Gels' + (n.electroTabs > 0 ? ' · Elektrolyt' : '') + '</div>' +
        '</div>';

      // Tip
      var tipText = '';
      if (durationH > 4) tipText = '💡 Ultradistanz: Alle 30 Min essen, alle 15 Min trinken. Feste Nahrung bevorzugen.';
      else if (durationH > 2) tipText = '💡 Alle 30-45 Min einen Snack + regelmäßig trinken, nicht erst bei Durst.';
      else tipText = '💡 Ausreichend vor dem Start frühstücken. Trinkflasche mitnehmen.';
      if (temp > 25) tipText += ' ☀️ Hitze: Extra Elektrolyte einplanen!';
      if (temp < 0) tipText += ' ❄️ Kälte: Warmes Getränk in Thermosflasche.';
      if (tip) tip.textContent = tipText;

      panel.classList.remove('hidden');
    } catch (e) {
      console.log('[Peakflow] Nutrition calc error:', e);
    }
  },

  generateBasicPackingList() {
    if (this.elevations.length === 0) return;
    const maxElev = Math.max(...this.elevations);
    const { ascent } = PeakflowUtils.calculateElevationGain(this.elevations);
    const items = PeakflowUtils.generatePackingList(ascent, maxElev, 0, 10, 15, 0);
    const packingEl = document.getElementById('packingList');
    const itemsEl = document.getElementById('packingItems');
    itemsEl.innerHTML = items.map(item => `<li>${item}</li>`).join('');
    this._updateNutritionPanel(10); // default temp if no weather data
    packingEl.classList.remove('hidden');
  },

  /**
   * Clear entire route
   */
  clearRoute() {
    this.markers.forEach(m => m.remove());
    this.markers = [];
    this.waypoints = [];
    this.routeCoords = [];
    this._segmentCache = {}; // Clear route cache
    this._wpExpanded = false;
    this.elevations = [];
    this.clearRouteLine();
    this._clearDangerMarkers();
    this._hideRoutingWarning();
    PeakflowSnow.removeSnowOverlay(this.map);
    document.getElementById('elevationProfile').classList.add('hidden');
    document.getElementById('snowWarning').classList.add('hidden');
    document.getElementById('packingList').classList.add('hidden');
    // Hide accordions
    // Clear water markers
    if (this._waterMarkers) {
      this._waterMarkers.forEach(m => m.remove());
      this._waterMarkers = [];
    }
    ['sacAccordion', 'snowAccordion', 'packAccordion', 'waterAccordion', 'sunAccordion'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.classList.add('hidden'); el.classList.remove('open'); }
    });
    this.updateWaypointList();
    this.updateStats();

    // Keep planning mode active so user can start fresh
    this.isPlanning = true;
    if (this.map) this.map.getCanvas().style.cursor = 'crosshair';
    const btn = document.getElementById('routePlanBtn');
    if (btn) btn.classList.add('active');

    // Auto-set start from GPS or show hint
    if (typeof Peakflow !== 'undefined' && Peakflow._autoStartFromGPS) {
      Peakflow._autoStartFromGPS();
    } else {
      Peakflow._showStartHint();
    }

    // Hide route weather + accordion + compact
    const weatherEl = document.getElementById('routeWeather');
    if (weatherEl) weatherEl.innerHTML = '';
    var weatherAcc = document.getElementById('weatherAccordion');
    if (weatherAcc) { weatherAcc.classList.add('hidden'); weatherAcc.classList.remove('open'); }
  },

  /**
   * Load route from parsed GPX data
   * @param {Object} gpxData - from PeakflowExport.parseGPX()
   */
  loadFromGPX(gpxData) {
    // Clear existing route
    this.clearRoute();

    // Ensure planning mode
    if (!this.isPlanning) this.togglePlanning();

    // Set route data directly from GPX track
    this.routeCoords = gpxData.coords;
    this.elevations = gpxData.coords.map(c => c[2] || 0);

    // Create waypoints from start + end (+ any GPX waypoints in between)
    const startCoord = gpxData.coords[0];
    const endCoord = gpxData.coords[gpxData.coords.length - 1];

    // Build waypoint list: start, optional GPX waypoints, end
    const wpList = [{ lng: startCoord[0], lat: startCoord[1], name: gpxData.waypoints[0]?.name || 'Start' }];

    // Add GPX waypoints that are between start and end (skip if they match start/end)
    if (gpxData.waypoints.length > 0) {
      for (const wpt of gpxData.waypoints) {
        const distToStart = Math.abs(wpt.lat - startCoord[1]) + Math.abs(wpt.lng - startCoord[0]);
        const distToEnd = Math.abs(wpt.lat - endCoord[1]) + Math.abs(wpt.lng - endCoord[0]);
        if (distToStart > 0.001 && distToEnd > 0.001) {
          wpList.push({ lng: wpt.lng, lat: wpt.lat, name: wpt.name });
        }
      }
    }

    // Check if it's a round trip (start ≈ end)
    const isLoop = Math.abs(startCoord[0] - endCoord[0]) < 0.001 && Math.abs(startCoord[1] - endCoord[1]) < 0.001;
    if (!isLoop) {
      wpList.push({ lng: endCoord[0], lat: endCoord[1], name: gpxData.waypoints[gpxData.waypoints.length - 1]?.name || 'Ziel' });
    }

    // Add markers for each waypoint
    for (let i = 0; i < wpList.length; i++) {
      const wp = wpList[i];
      wp.index = i;
      this.waypoints.push(wp);

      const isFirst = i === 0;
      const el = document.createElement('div');
      el.className = 'route-marker';
      el.innerHTML = isFirst ? '<span>🏁</span>' : `<span>${i + 1}</span>`;
      el.style.cssText = `
        width: 28px; height: 28px; background: var(--color-primary, #c9a84c);
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        color: white; font-size: ${isFirst ? '15px' : '12px'}; font-weight: 700; border: 2px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3); cursor: ${isFirst ? 'pointer' : 'grab'}; font-family: Inter, sans-serif;
      `;

      const marker = new maplibregl.Marker({ element: el, draggable: !isFirst })
        .setLngLat([wp.lng, wp.lat])
        .addTo(this.map);

      // First marker: click to close loop
      if (isFirst) {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.waypoints.length < 3) return;
          const start = this.waypoints[0];
          this._fitAfterRoute = true;
          this.addWaypoint({ lng: start.lng, lat: start.lat, name: start.name || '🏁 Ziel' });
        });
      }

      // Drag → re-route via BRouter for that segment
      if (!isFirst) {
        marker.on('dragend', () => {
          const pos = marker.getLngLat();
          this.waypoints[wp.index].lng = pos.lng;
          this.waypoints[wp.index].lat = pos.lat;
          this._segmentCache = {}; // Clear cache so BRouter re-routes
          this.updateRoute();
        });
      }

      // Right-click to remove
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.removeWaypoint(wp.index);
      });

      this.markers.push(marker);
    }

    // If loop, add start as final waypoint marker
    if (isLoop) {
      const start = this.waypoints[0];
      const loopWp = { lng: start.lng, lat: start.lat, index: this.waypoints.length, name: '🏁 Ziel' };
      this.waypoints.push(loopWp);
    }

    // Draw route and show stats
    this.drawRouteLine(gpxData.coords);
    this.updateStats();
    this.updateWaypointList();
    this._updateUndoButton();

    // Show elevation profile only if user has it enabled
    this.drawElevationProfile();
    if (this._elevationVisible) {
      document.getElementById('elevationProfile').classList.remove('hidden');
      var elevBtn = document.getElementById('elevationToggleBtn');
      if (elevBtn) elevBtn.classList.add('active');
    }

    // Show save button
    var saveBtn = document.getElementById('saveRouteToolbarBtn');
    if (saveBtn) saveBtn.classList.remove('hidden');

    // Fit map to imported route
    if (this.map && gpxData.coords.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      gpxData.coords.forEach(c => bounds.extend([c[0], c[1]]));
      this.map.fitBounds(bounds, { padding: 60, duration: 800 });
    }

    // Load secondary data (SAC, water, weather)
    this.loadSACDataForRoute(gpxData.coords).catch(e => console.warn('[Peakflow] SAC:', e));
    this.loadWaterSources(gpxData.coords).catch(e => console.warn('[Peakflow] Water:', e));
    clearTimeout(this._secondaryDataTimer);
    this._secondaryDataTimer = setTimeout(() => {
      Promise.all([
        this.analyzeSnowOnRoute().catch(e => console.warn('[Peakflow] Snow:', e)),
        this.loadRouteWeather(gpxData.coords).catch(e => console.warn('[Peakflow] Weather:', e)),
        Promise.resolve().then(() => this.loadSunAnalysis(gpxData.coords, this.elevations)).catch(e => console.warn('[Peakflow] Sun:', e))
      ]);
    }, 1000);

    console.log('[Peakflow] GPX imported: ' + gpxData.name + ' (' + gpxData.coords.length + ' points, ' + this.waypoints.length + ' waypoints)');
  },

  /**
   * Get current route data for saving/exporting
   */
  getRouteData(name) {
    return PeakflowExport.buildRouteData(
      name,
      this.waypoints,
      this.routeCoords,
      this.elevations
    );
  },

  // Show/hide undo button based on waypoint count
  _updateUndoButton() {
    const btn = document.getElementById('undoWaypointBtn');
    if (!btn) return;
    if (this.waypoints.length > 0) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  },

  // Remove last waypoint (undo)
  undoLastWaypoint() {
    if (this.waypoints.length > 0) {
      this.removeWaypoint(this.waypoints.length - 1);
    }
  },

  // Mark a waypoint marker as failed (red blinking) and suggest moving it
  _markWaypointFailed(index) {
    if (!this.markers[index]) return;
    const el = this.markers[index].getElement();
    if (!el || el.dataset.failed) return;
    el.dataset.failed = 'true';
    el.style.background = '#e74c3c';
    el.style.animation = 'failedBlink 1s ease-in-out infinite';
    el.style.boxShadow = '0 0 12px rgba(231,76,60,0.8)';
    el.title = '⚠️ Kein Wanderweg gefunden — Marker verschieben!';
  },

  // Reset failed state on all markers
  _resetFailedMarkers() {
    this.markers.forEach(m => {
      const el = m.getElement();
      if (el && el.dataset.failed) {
        delete el.dataset.failed;
        el.style.background = 'var(--color-primary,#c9a84c)';
        el.style.animation = '';
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
        el.title = '';
      }
    });
  }
};
