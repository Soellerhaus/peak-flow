/* ============================================
   PEAKFLOW - GPX Export & Web Share API
   ============================================ */

const PeakflowExport = {

  /**
   * Generate GPX XML from route data
   * @param {Object} route - { name, waypoints: [{lat, lng, ele, name?}], coords: [[lng,lat,ele]] }
   * @returns {string} GPX XML string
   */
  generateGPX(route) {
    const now = new Date().toISOString();
    const name = route.name || 'Peakflow Route';

    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"
     version="1.1"
     creator="Peakflow - peakflow.app">
  <metadata>
    <name>${this.escapeXml(name)}</name>
    <time>${now}</time>
    <desc>Route erstellt mit Peakflow</desc>
  </metadata>
`;

    // Waypoints (POIs along route)
    if (route.waypoints && route.waypoints.length > 0) {
      for (const wp of route.waypoints) {
        gpx += `  <wpt lat="${wp.lat}" lon="${wp.lng}">
    <ele>${wp.ele || 0}</ele>
    <name>${this.escapeXml(wp.name || 'Wegpunkt')}</name>
  </wpt>\n`;
      }
    }

    // Track
    if (route.coords && route.coords.length > 0) {
      gpx += `  <trk>
    <name>${this.escapeXml(name)}</name>
    <trkseg>\n`;

      for (const coord of route.coords) {
        const lng = coord[0];
        const lat = coord[1];
        const ele = coord[2] || 0;
        gpx += `      <trkpt lat="${lat}" lon="${lng}">
        <ele>${ele}</ele>
      </trkpt>\n`;
      }

      gpx += `    </trkseg>
  </trk>\n`;
    }

    gpx += `</gpx>`;
    return gpx;
  },

  /**
   * Escape special XML characters
   */
  escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },

  /**
   * Download GPX file
   */
  downloadGPX(route) {
    const gpxContent = this.generateGPX(route);
    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(route.name || 'peakflow-route').replace(/[^a-zA-Z0-9-_]/g, '_')}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Share GPX via Web Share API (for watch transfer)
   */
  async shareToWatch(route) {
    const gpxContent = this.generateGPX(route);
    const fileName = `${(route.name || 'peakflow-route').replace(/[^a-zA-Z0-9-_]/g, '_')}.gpx`;
    const file = new File([gpxContent], fileName, { type: 'application/gpx+xml' });

    // Check if Web Share API with files is supported
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: `Peakflow: ${route.name || 'Route'}`,
          text: 'Route an deine Uhr senden - öffne mit Garmin Connect, Suunto oder Polar App',
          files: [file]
        });
        return { success: true, method: 'share' };
      } catch (e) {
        if (e.name === 'AbortError') {
          return { success: false, method: 'cancelled' };
        }
        console.warn('[Peakflow] Web Share failed, falling back to download', e);
      }
    }

    // Fallback: direct download
    this.downloadGPX(route);
    return { success: true, method: 'download' };
  },

  /**
   * Generate route data from current route state
   */
  buildRouteData(name, waypoints, routeCoords, elevations) {
    return {
      name: name || `Route ${new Date().toLocaleDateString('de-DE')}`,
      waypoints: waypoints.map((wp, i) => ({
        lat: wp.lat || wp[1],
        lng: wp.lng || wp[0],
        ele: elevations ? elevations[i] || 0 : 0,
        name: wp.name || `Wegpunkt ${i + 1}`
      })),
      coords: routeCoords.map((c, i) => [
        c[0], c[1], elevations && elevations[i] ? elevations[i] : (c[2] || 0)
      ])
    };
  }
};
