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
  async analyzeRoute(routeCoords) {
    if (!routeCoords || routeCoords.length < 2) return null;

    // Sample points along route (max 4 to avoid API rate limits)
    const sampleCount = Math.min(routeCoords.length, 4);
    const step = Math.max(1, Math.floor(routeCoords.length / sampleCount));
    const samples = [];

    for (let i = 0; i < routeCoords.length; i += step) {
      samples.push(routeCoords[i]);
    }

    // Fetch snow data sequentially via rate-limited queue (not parallel!)
    try {
      this.snowData = [];
      for (const coord of samples) {
        const d = await PeakflowWeather.getSnowData(coord[1], coord[0], coord[2] || 0);
        this.snowData.push(d);
      }
    } catch (e) {
      console.warn('[Peakflow] Snow analysis failed', e);
      this.snowData = [];
      return null;
    }

    // Analyze results
    const maxSnow = Math.max(...this.snowData.map(d => d.snowDepth));
    const avgSnow = this.snowData.reduce((s, d) => s + d.snowDepth, 0) / this.snowData.length;
    const freezingLevels = this.snowData.map(d => d.freezingLevel);
    const minFreezing = Math.min(...freezingLevels);
    const hasSnowfall = this.snowData.some(d => d.snowfall > 0);

    // Determine snow segments for coloring
    const segments = this.snowData.map((data, i) => ({
      index: i,
      coord: samples[i],
      snowDepth: data.snowDepth,
      freezingLevel: data.freezingLevel,
      color: PeakflowUtils.getSnowColor(data.snowDepth),
      snowfall: data.snowfall
    }));

    return {
      maxSnowDepth: Math.round(maxSnow),
      avgSnowDepth: Math.round(avgSnow),
      minFreezingLevel: minFreezing,
      hasSnowfall,
      segments,
      hasSnow: maxSnow > 0
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
