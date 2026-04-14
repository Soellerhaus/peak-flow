/* ============================================
   PEAKFLOW - Snow Overlay & Analysis
   ============================================ */

const PeakflowSnow = {

  isActive: false,
  snowData: [],

  /**
   * Analyze snow conditions along a route
   * @param {Array} routeCoords - Array of [lng, lat, elevation] coords
   * @returns {Object} Snow analysis
   */
  // GeoSphere Austria TAWES stations with snow measurement (>1000m)
  SNOW_STATIONS: [
    { id: '11318', name: 'Brunnenkogel', lat: 46.913, lng: 10.862, elev: 3437 },
    { id: '11343', name: 'Sonnblick', lat: 47.054, lng: 12.957, elev: 3109 },
    { id: '11316', name: 'Pitztaler Gletscher', lat: 46.927, lng: 10.879, elev: 2864 },
    { id: '11124', name: 'Valluga', lat: 47.157, lng: 10.213, elev: 2805 },
    { id: '11138', name: 'Rudolfsh\u00fctte', lat: 47.135, lng: 12.626, elev: 2317 },
    { id: '11126', name: 'Patscherkofel', lat: 47.209, lng: 11.462, elev: 2251 },
    { id: '11110', name: 'Galzig', lat: 47.130, lng: 10.230, elev: 2079 },
    { id: '11340', name: 'Schmitten', lat: 47.329, lng: 12.738, elev: 1956 },
    { id: '11127', name: 'Obergurgl', lat: 46.867, lng: 11.024, elev: 1941 },
    { id: '11135', name: 'Hahnenkamm', lat: 47.418, lng: 12.359, elev: 1794 },
    { id: '11149', name: 'Obertauern', lat: 47.249, lng: 13.560, elev: 1772 },
    { id: '11344', name: 'Kolm-Saigurn', lat: 47.069, lng: 12.985, elev: 1626 },
    { id: '11312', name: 'Galt\u00fcr', lat: 46.968, lng: 10.186, elev: 1587 },
    { id: '11308', name: 'Warth', lat: 47.256, lng: 10.186, elev: 1478 },
    { id: '11326', name: 'Schmirn', lat: 47.087, lng: 11.580, elev: 1464 },
    { id: '11129', name: 'Brenner', lat: 47.007, lng: 11.511, elev: 1412 },
    { id: '11311', name: 'St.Anton', lat: 47.131, lng: 10.267, elev: 1304 },
    { id: '11306', name: 'Schr\u00f6cken', lat: 47.262, lng: 10.086, elev: 1244 },
    { id: '11307', name: 'Langen/Arlberg', lat: 47.132, lng: 10.123, elev: 1221 }
  ],
  _stationCache: null,
  _stationCacheTime: 0,

  /**
   * Fetch real snow depths from GeoSphere Austria TAWES stations
   */
  async _fetchStationSnow() {
    // Cache for 30 minutes
    if (this._stationCache && Date.now() - this._stationCacheTime < 30 * 60 * 1000) {
      return this._stationCache;
    }
    try {
      var ids = this.SNOW_STATIONS.map(function(s) { return s.id; }).join(',');
      var url = 'https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min?parameters=SCHNEE&station_ids=' + ids;
      var resp = await fetch(url);
      if (!resp.ok) return null;
      var data = await resp.json();
      var result = {};
      (data.features || []).forEach(function(f) {
        var sid = f.properties ? f.properties.station : '';
        var snowData = (f.properties && f.properties.parameters && f.properties.parameters.SCHNEE) ? f.properties.parameters.SCHNEE.data : [];
        var snow = snowData.length > 0 ? snowData[snowData.length - 1] : null;
        if (sid && snow !== null && snow !== undefined) {
          result[sid] = snow;
        }
      });
      this._stationCache = result;
      this._stationCacheTime = Date.now();
      console.log('[Snow] GeoSphere stations loaded:', Object.keys(result).length, 'with data');
      return result;
    } catch(e) {
      console.warn('[Snow] GeoSphere station fetch failed:', e.message);
      return null;
    }
  },

  /**
   * Find nearest station snow depth for a given coordinate
   */
  _getNearestStationSnow(lat, lng, elev, stationData) {
    if (!stationData) return null;
    var bestDist = Infinity;
    var bestSnow = null;
    var bestStation = null;
    for (var i = 0; i < this.SNOW_STATIONS.length; i++) {
      var s = this.SNOW_STATIONS[i];
      // Only use stations within similar elevation range (±500m)
      if (Math.abs(s.elev - elev) > 700) continue;
      var d = Math.pow(s.lat - lat, 2) + Math.pow(s.lng - lng, 2);
      if (d < bestDist && stationData[s.id] !== undefined) {
        bestDist = d;
        bestSnow = stationData[s.id];
        bestStation = s;
      }
    }
    // Only use if station is within ~80km
    if (bestDist > 0.5) return null; // ~80km
    return bestSnow !== null ? { snow: bestSnow, station: bestStation } : null;
  },

  async analyzeRoute(routeCoords) {
    if (!routeCoords || routeCoords.length < 2) return null;

    // Sample points along route (max 4 to avoid API rate limits)
    const sampleCount = Math.min(routeCoords.length, 4);
    const step = Math.max(1, Math.floor(routeCoords.length / sampleCount));
    const samples = [];

    for (let i = 0; i < routeCoords.length; i += step) {
      samples.push(routeCoords[i]);
    }

    // 1. Try real GeoSphere station data first
    var stationData = await this._fetchStationSnow();

    // 2. Also fetch Open-Meteo data
    try {
      this.snowData = [];
      for (const coord of samples) {
        const d = await PeakflowWeather.getSnowData(coord[1], coord[0], coord[2] || 0);

        // Override with real station data if available
        if (stationData) {
          var nearest = this._getNearestStationSnow(coord[1], coord[0], coord[2] || 0, stationData);
          if (nearest && nearest.snow > d.snowDepth) {
            d.snowDepth = nearest.snow;
            d.stationName = nearest.station.name;
            d.stationElev = nearest.station.elev;
          }
        }

        this.snowData.push(d);
      }
    } catch (e) {
      console.warn('[Peakflow] Snow analysis failed', e);
      this.snowData = [];
      return null;
    }

    // Analyze results — combine API snow with Altschnee estimate
    const month = new Date().getMonth(); // 0=Jan, 3=Apr, 5=Jun
    const maxElev = Math.max(...samples.map(s => s[2] || 0));

    // Altschnee-Sch\u00e4tzung basierend auf H\u00f6he + Monat (Alpen-typisch)
    // Schneegrenze im Fr\u00fchjahr: ~1400m (M\u00e4rz), ~1800m (April), ~2200m (Mai), ~2600m (Juni)
    const snowlineByMonth = [800, 900, 1100, 1400, 1800, 2200, 2600, 2800, 2600, 2000, 1400, 1000];
    const snowline = snowlineByMonth[month] || 1800;

    this.snowData.forEach(function(d, i) {
      var elev = samples[i] ? (samples[i][2] || 0) : 0;
      if (elev > snowline && d.snowDepth === 0) {
        // Estimate Altschnee: ~10cm per 100m above snowline
        var altschnee = Math.round((elev - snowline) / 100 * 10);
        altschnee = Math.min(altschnee, 150); // cap at 150cm
        if (altschnee > d.snowDepth) {
          d.snowDepth = altschnee;
          d.isEstimate = true;
        }
      }
    });

    const maxSnow = Math.max(...this.snowData.map(d => d.snowDepth));
    const avgSnow = this.snowData.reduce((s, d) => s + d.snowDepth, 0) / this.snowData.length;
    const freezingLevels = this.snowData.map(d => d.freezingLevel);
    const minFreezing = Math.min(...freezingLevels);
    const hasSnowfall = this.snowData.some(d => d.snowfall > 0);
    const isEstimate = this.snowData.some(d => d.isEstimate);

    // Determine snow segments for coloring
    const segments = this.snowData.map((data, i) => ({
      index: i,
      coord: samples[i],
      snowDepth: data.snowDepth,
      freezingLevel: data.freezingLevel,
      color: PeakflowUtils.getSnowColor(data.snowDepth),
      snowfall: data.snowfall
    }));

    // Check if data came from real station
    var stationName = null, stationElev = null;
    this.snowData.forEach(function(d) {
      if (d.stationName) { stationName = d.stationName; stationElev = d.stationElev; }
    });

    return {
      maxSnowDepth: Math.round(maxSnow),
      avgSnowDepth: Math.round(avgSnow),
      minFreezingLevel: minFreezing,
      hasSnowfall,
      segments,
      hasSnow: maxSnow > 0,
      isEstimate: isEstimate || false,
      snowline: snowline,
      stationName: stationName,
      stationElev: stationElev
    };
  },

  /**
   * Generate snow warning text
   */
  getWarningText(analysis) {
    if (!analysis || !analysis.hasSnow) return null;

    const parts = [];
    const snow = analysis.maxSnowDepth;

    // CRITICAL: Snow danger levels for hiking
    if (snow >= 40) {
      parts.push(`\u26D4 WARNUNG: ${snow}cm Schnee auf der Route!`);
      parts.push('Kein Durchkommen mit normalen Wanderschuhen! Tour nur mit Schneeschuhen/Tourenski m\u00f6glich.');
      parts.push('Lawinengefahr, Wegfindung unm\u00f6glich, Einbruchgefahr.');
      if (analysis.hasSnowfall) parts.push('Zus\u00e4tzlich Neuschnee erwartet!');
      if (analysis.minFreezingLevel < 3000) parts.push(`Nullgradgrenze bei ${analysis.minFreezingLevel}m.`);
      return parts.join(' ');
    }

    if (snow >= 10) {
      parts.push(`\uD83D\uDD34 ${snow}cm Schnee auf der Route! Trail nicht begehbar \u2014 zu gef\u00e4hrlich f\u00fcr Wanderung.`);
      parts.push('Altschneefelder, rutschig, Wegfindung schwierig. Gr\u00f6del + Gamaschen Pflicht.');
    } else if (snow > 0) {
      parts.push(`\uD83D\uDFE0 Vereinzelt Schneereste (bis ${snow}cm). Vorsicht bei Altschneefeldern.`);
    }

    if (analysis.hasSnowfall) {
      parts.push('Neuschnee erwartet!');
    }

    if (analysis.minFreezingLevel < 3000) {
      parts.push(`Nullgradgrenze bei ${analysis.minFreezingLevel}m.`);
    }

    if (analysis.stationName) {
      parts.push(`(Messwert: Station ${analysis.stationName}, ${analysis.stationElev}m)`);
    } else if (analysis.isEstimate) {
      parts.push(`(Altschnee-Sch\u00e4tzung, Schneegrenze ~${analysis.snowline}m)`);
    }

    return parts.join(' ');
  },

  /**
   * Apply snow overlay to MapLibre route
   */
  applySnowOverlay(map, routeCoords, analysis) {
    // Snow overlay disabled — snow info shown in sidebar text only
    this.removeSnowOverlay(map);
  },

  /**
   * Remove snow overlay from map
   */
  removeSnowOverlay(map) {
    if (!map) return;
    if (map.getLayer('snow-overlay-layer')) {
      map.removeLayer('snow-overlay-layer');
    }
    if (map.getSource('snow-overlay')) {
      map.removeSource('snow-overlay');
    }
  },

  /**
   * Toggle snow overlay visibility
   */
  toggle(map) {
    this.isActive = !this.isActive;
    if (map && map.getLayer('snow-overlay-layer')) {
      map.setLayoutProperty(
        'snow-overlay-layer',
        'visibility',
        this.isActive ? 'visible' : 'none'
      );
    }
    return this.isActive;
  }
};
