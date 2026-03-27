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

    // Sample points along route (max 8 for API efficiency)
    const sampleCount = Math.min(routeCoords.length, 8);
    const step = Math.max(1, Math.floor(routeCoords.length / sampleCount));
    const samples = [];

    for (let i = 0; i < routeCoords.length; i += step) {
      samples.push(routeCoords[i]);
    }

    // Fetch snow data for sample points
    const snowPromises = samples.map(coord =>
      PeakflowWeather.getSnowData(coord[1], coord[0])
    );

    try {
      this.snowData = await Promise.all(snowPromises);
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

    // CRITICAL: Tour too dangerous with this much snow
    if (snow > 80) {
      parts.push(`⛔ WARNUNG: Bis zu ${snow}cm Schnee auf der Route!`);
      parts.push('Peakflow rät von dieser Tour ab! Bei dieser Schneelage ist sicheres Wandern nicht möglich.');
      parts.push('Lawinengefahr, Wegfindung unmöglich, Einbruchgefahr.');
      if (analysis.hasSnowfall) parts.push('Zusätzlich Neuschnee erwartet!');
      if (analysis.minFreezingLevel < 3000) parts.push(`Nullgradgrenze bei ${analysis.minFreezingLevel}m.`);
      return parts.join(' ');
    }

    if (snow > 50) {
      parts.push(`🔴 Bis zu ${snow}cm Schnee auf der Route! Tour nur mit Schneeschuhen/Tourenski möglich.`);
    } else if (snow > 20) {
      parts.push(`🟠 Teilweise ${snow}cm Schnee. Grödel/Gamaschen empfohlen.`);
    } else if (snow > 0) {
      parts.push(`Vereinzelt Schneereste (bis ${snow}cm).`);
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
    // Snow overlay DISABLED - it overwrites the route color!
    // Snow warnings are shown in the sidebar text instead.
    // The route stays clean neon-green, danger sections blink separately.
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
