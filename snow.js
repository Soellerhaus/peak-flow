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
  // GeoSphere Austria TAWES stations with snow measurement (>800m, 89 stations across all Alps)
  SNOW_STATIONS: [
    { id: '11318', name: 'Brunnenkogel', lat: 46.913, lng: 10.862, elev: 3437 },
    { id: '11343', name: 'Sonnblick', lat: 47.054, lng: 12.957, elev: 3109 },
    { id: '11316', name: 'Pitztaler Gletscher', lat: 46.927, lng: 10.879, elev: 2864 },
    { id: '11124', name: 'Valluga', lat: 47.157, lng: 10.213, elev: 2805 },
    { id: '11267', name: 'Dachstein-Hunerkogel', lat: 47.468, lng: 13.626, elev: 2700 },
    { id: '11268', name: 'Dachstein-Gletscher', lat: 47.474, lng: 13.633, elev: 2520 },
    { id: '11138', name: 'Rudolfshuette', lat: 47.135, lng: 12.626, elev: 2317 },
    { id: '11126', name: 'Patscherkofel', lat: 47.209, lng: 11.462, elev: 2251 },
    { id: '11265', name: 'Villacher Alpe', lat: 46.604, lng: 13.673, elev: 2117 },
    { id: '11110', name: 'Galzig', lat: 47.130, lng: 10.230, elev: 2079 },
    { id: '11340', name: 'Schmittenhoehe', lat: 47.329, lng: 12.738, elev: 1956 },
    { id: '11127', name: 'Obergurgl', lat: 46.867, lng: 11.024, elev: 1941 },
    { id: '8989078', name: 'Koelnbreinsperre', lat: 47.083, lng: 13.346, elev: 1916 },
    { id: '11135', name: 'Hahnenkamm', lat: 47.418, lng: 12.359, elev: 1794 },
    { id: '11149', name: 'Obertauern', lat: 47.249, lng: 13.560, elev: 1772 },
    { id: '11349', name: 'Katschberg', lat: 47.061, lng: 13.615, elev: 1635 },
    { id: '11344', name: 'Kolm-Saigurn', lat: 47.069, lng: 12.985, elev: 1626 },
    { id: '11337', name: 'Loferer Alm', lat: 47.598, lng: 12.646, elev: 1619 },
    { id: '11155', name: 'Feuerkogel', lat: 47.817, lng: 13.718, elev: 1618 },
    { id: '11312', name: 'Galtuer', lat: 46.968, lng: 10.186, elev: 1587 },
    { id: '11180', name: 'Rax', lat: 47.718, lng: 15.779, elev: 1547 },
    { id: '11216', name: 'Kanzelhoehe', lat: 46.677, lng: 13.902, elev: 1520 },
    { id: '11308', name: 'Warth', lat: 47.256, lng: 10.186, elev: 1478 },
    { id: '11326', name: 'Schmirn', lat: 47.087, lng: 11.580, elev: 1464 },
    { id: '11317', name: 'St.Leonhard/Pitztal', lat: 47.027, lng: 10.866, elev: 1454 },
    { id: '11222', name: 'Flattnitz', lat: 46.941, lng: 14.036, elev: 1437 },
    { id: '11129', name: 'Brenner', lat: 47.007, lng: 11.511, elev: 1412 },
    { id: '11300', name: 'St.Jakob/Defereggen', lat: 46.917, lng: 12.354, elev: 1383 },
    { id: '11200', name: 'Kals', lat: 47.005, lng: 12.646, elev: 1352 },
    { id: '11113', name: 'Nauders', lat: 46.891, lng: 10.497, elev: 1330 },
    { id: '11311', name: 'St.Anton', lat: 47.131, lng: 10.267, elev: 1304 },
    { id: '11306', name: 'Schroecken', lat: 47.262, lng: 10.086, elev: 1244 },
    { id: '11307', name: 'Langen/Arlberg', lat: 47.132, lng: 10.123, elev: 1221 },
    { id: '11161', name: 'Praebichl', lat: 47.522, lng: 14.954, elev: 1215 },
    { id: '11187', name: 'Mittelberg', lat: 47.323, lng: 10.152, elev: 1204 },
    { id: '11260', name: 'Mallnitz', lat: 46.992, lng: 13.167, elev: 1197 },
    { id: '11119', name: 'Seefeld', lat: 47.325, lng: 11.176, elev: 1182 },
    { id: '11348', name: 'Mariapfarr', lat: 47.152, lng: 13.745, elev: 1151 },
    { id: '11111', name: 'Tannheim', lat: 47.500, lng: 10.506, elev: 1100 },
    { id: '11372', name: 'Bad Gastein', lat: 47.111, lng: 13.133, elev: 1092 },
    { id: '11315', name: 'Holzgau', lat: 47.258, lng: 10.339, elev: 1092 },
    { id: '11201', name: 'Sillian', lat: 46.746, lng: 12.424, elev: 1081 },
    { id: '11148', name: 'St.Michael/Lungau', lat: 47.094, lng: 13.623, elev: 1052 },
    { id: '11329', name: 'Steinach/Brenner', lat: 47.098, lng: 11.466, elev: 1036 },
    { id: '11304', name: 'Brand', lat: 47.103, lng: 9.738, elev: 1029 },
    { id: '11100', name: 'Sulzberg', lat: 47.522, lng: 9.914, elev: 1016 },
    { id: '11136', name: 'Krimml', lat: 47.229, lng: 12.182, elev: 1009 },
    { id: '11108', name: 'Gaschurn', lat: 46.980, lng: 10.032, elev: 985 },
    { id: '11118', name: 'Ehrwald', lat: 47.404, lng: 10.920, elev: 982 },
    { id: '11339', name: 'Hochfilzen', lat: 47.470, lng: 12.621, elev: 962 },
    { id: '11346', name: 'Rauris', lat: 47.224, lng: 12.992, elev: 934 },
    { id: '11303', name: 'Schoppernau', lat: 47.311, lng: 10.018, elev: 839 },
    { id: '11314', name: 'Reutte', lat: 47.494, lng: 10.715, elev: 842 },
    { id: '11104', name: 'Fraxern', lat: 47.314, lng: 9.674, elev: 807 }
  ],
  _stationCache: null,
  _stationCacheTime: 0,

  /**
   * Fetch snow from Südtirol/South Tyrol OpenDataHub
   */
  async _fetchSuedtirolSnow() {
    if (this._suedtirolCache && Date.now() - this._suedtirolCacheTime < 30 * 60 * 1000) {
      return this._suedtirolCache;
    }
    try {
      var resp = await fetch('https://tourism.api.opendatahub.com/v1/Weather/Measuringpoint?pagesize=200');
      if (!resp.ok) return [];
      var data = await resp.json();
      var items = Array.isArray(data) ? data : (data.Items || data.data || []);
      var result = [];
      items.forEach(function(i) {
        var snow = i.SnowHeight;
        if (snow === null || snow === undefined || snow === '' || snow === 0) return;
        var gps = i.GpsPoints && i.GpsPoints.position ? i.GpsPoints.position : (i.GpsInfo && i.GpsInfo[0] ? i.GpsInfo[0] : null);
        if (!gps || !gps.Latitude || !gps.Longitude) return;
        result.push({
          name: i.Shortname || '?',
          lat: gps.Latitude,
          lng: gps.Longitude,
          elev: gps.Altitude || 0,
          snow: typeof snow === 'number' ? snow : parseInt(snow) || 0
        });
      });
      this._suedtirolCache = result;
      this._suedtirolCacheTime = Date.now();
      console.log('[Snow] S\u00fcdtirol stations loaded:', result.length, 'with snow data');
      return result;
    } catch(e) {
      console.warn('[Snow] S\u00fcdtirol fetch failed:', e.message);
      return [];
    }
  },
  _suedtirolCache: null,
  _suedtirolCacheTime: 0,

  // MeteoSwiss stations with snow measurement (>1000m, 48 stations across Swiss Alps)
  SWISS_STATIONS: [
    { id: 'WFJ', name: 'Weissfluhjoch', lat: 46.833, lng: 9.806, elev: 2691 },
    { id: 'SAE', name: 'Saentis', lat: 47.249, lng: 9.343, elev: 2501 },
    { id: 'GUE', name: 'Guetsch/Andermatt', lat: 46.652, lng: 8.616, elev: 2286 },
    { id: 'GRH', name: 'Grimsel Hospiz', lat: 46.572, lng: 8.333, elev: 1980 },
    { id: 'MLS', name: 'Le Moleson', lat: 46.546, lng: 7.018, elev: 1974 },
    { id: 'BUF', name: 'Buffalora', lat: 46.648, lng: 10.267, elev: 1971 },
    { id: 'ARO', name: 'Arosa', lat: 46.793, lng: 9.679, elev: 1878 },
    { id: 'BIV', name: 'Bivio', lat: 46.462, lng: 9.669, elev: 1856 },
    { id: 'SIA', name: 'Segl-Maria', lat: 46.432, lng: 9.762, elev: 1804 },
    { id: 'SAM', name: 'Samedan', lat: 46.526, lng: 9.879, elev: 1709 },
    { id: 'DOL', name: 'La Dole', lat: 46.425, lng: 6.099, elev: 1670 },
    { id: 'SBE', name: 'S.Bernardino', lat: 46.464, lng: 9.185, elev: 1639 },
    { id: 'ZER', name: 'Zermatt', lat: 46.029, lng: 7.752, elev: 1638 },
    { id: 'GRC', name: 'Graechen', lat: 46.195, lng: 7.837, elev: 1605 },
    { id: 'DAV', name: 'Davos', lat: 46.813, lng: 9.844, elev: 1594 },
    { id: 'FIO', name: 'Fionnay', lat: 46.031, lng: 7.309, elev: 1500 },
    { id: 'SIM', name: 'Simplon-Dorf', lat: 46.197, lng: 8.056, elev: 1465 },
    { id: 'ANT', name: 'Andermatt', lat: 46.631, lng: 8.581, elev: 1435 },
    { id: 'MVE', name: 'Montana', lat: 46.299, lng: 7.461, elev: 1423 },
    { id: 'ABO', name: 'Adelboden', lat: 46.492, lng: 7.561, elev: 1321 },
    { id: 'SCU', name: 'Scuol', lat: 46.793, lng: 10.283, elev: 1304 },
    { id: 'ENG', name: 'Engelberg', lat: 46.822, lng: 8.411, elev: 1036 }
  ],
  _swissCache: null,
  _swissCacheTime: 0,

  /**
   * Fetch snow from MeteoSwiss VQHA80 CSV (Swiss stations)
   */
  async _fetchSwissSnow() {
    if (this._swissCache && Date.now() - this._swissCacheTime < 30 * 60 * 1000) {
      return this._swissCache;
    }
    try {
      var resp = await fetch('https://data.geo.admin.ch/ch.meteoschweiz.messwerte-aktuell/VQHA80.csv');
      if (!resp.ok) return {};
      var text = await resp.text();
      var lines = text.trim().split('\n');
      var header = lines[0].split(';');
      var snowIdx = header.indexOf('sre000z0');
      if (snowIdx < 0) return {};
      var result = {};
      for (var li = 1; li < lines.length; li++) {
        var parts = lines[li].split(';');
        var stationId = parts[0];
        var snowVal = parseFloat(parts[snowIdx]);
        if (!isNaN(snowVal) && snowVal >= 0) {
          result[stationId] = snowVal;
        }
      }
      this._swissCache = result;
      this._swissCacheTime = Date.now();
      console.log('[Snow] Swiss MeteoSwiss loaded:', Object.keys(result).length, 'stations');
      return result;
    } catch(e) {
      console.warn('[Snow] MeteoSwiss fetch failed:', e.message);
      return {};
    }
  },

  /**
   * Find nearest Swiss station snow depth
   */
  _getNearestSwissSnow(lat, lng, elev, swissData) {
    if (!swissData) return null;
    var bestDist = 0.3; // max ~60km
    var bestSnow = null;
    var bestStation = null;
    for (var i = 0; i < this.SWISS_STATIONS.length; i++) {
      var s = this.SWISS_STATIONS[i];
      if (Math.abs(s.elev - elev) > 700) continue;
      var d = Math.pow(s.lat - lat, 2) + Math.pow(s.lng - lng, 2);
      if (d < bestDist && swissData[s.id] !== undefined) {
        bestDist = d;
        bestSnow = swissData[s.id];
        bestStation = s;
      }
    }
    return bestStation && bestSnow !== null ? { snow: bestSnow, station: bestStation } : null;
  },

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

    // 1. Fetch real station data (GeoSphere AT + Südtirol IT + MeteoSwiss CH)
    var stationData = await this._fetchStationSnow();
    var suedtirolData = await this._fetchSuedtirolSnow();
    var swissData = await this._fetchSwissSnow();

    // 2. Also fetch Open-Meteo data
    try {
      this.snowData = [];
      for (const coord of samples) {
        const d = await PeakflowWeather.getSnowData(coord[1], coord[0], coord[2] || 0);

        // Override with real station data if available (Austria GeoSphere)
        if (stationData) {
          var nearest = this._getNearestStationSnow(coord[1], coord[0], coord[2] || 0, stationData);
          if (nearest && nearest.snow > d.snowDepth) {
            d.snowDepth = nearest.snow;
            d.stationName = nearest.station.name;
            d.stationElev = nearest.station.elev;
          }
        }

        // Check Swiss stations
        if (swissData) {
          var nearestCH = this._getNearestSwissSnow(coord[1], coord[0], coord[2] || 0, swissData);
          if (nearestCH && nearestCH.snow > d.snowDepth) {
            d.snowDepth = nearestCH.snow;
            d.stationName = nearestCH.station.name + ' (CH)';
            d.stationElev = nearestCH.station.elev;
          }
        }

        // Also check Südtirol stations
        if (suedtirolData && suedtirolData.length > 0) {
          var bestDist = 0.5; // max ~80km
          var bestST = null;
          for (var si = 0; si < suedtirolData.length; si++) {
            var st = suedtirolData[si];
            if (Math.abs(st.elev - (coord[2] || 0)) > 700) continue;
            var dd = Math.pow(st.lat - coord[1], 2) + Math.pow(st.lng - coord[0], 2);
            if (dd < bestDist) { bestDist = dd; bestST = st; }
          }
          if (bestST && bestST.snow > d.snowDepth) {
            d.snowDepth = bestST.snow;
            d.stationName = bestST.name;
            d.stationElev = bestST.elev;
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
