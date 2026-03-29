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
    const routeName = (route.name || 'peakflow-route').replace(/[^a-zA-Z0-9-_]/g, '_');

    // Mobile detection
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile && navigator.share) {
      // Try multiple file types - some browsers reject xml but accept octet-stream
      const attempts = [
        { name: routeName + '.gpx', type: 'application/octet-stream' },
        { name: routeName + '.gpx', type: 'application/gpx+xml' },
        { name: routeName + '.gpx', type: 'application/xml' },
        { name: routeName + '.gpx', type: 'text/xml' }
      ];

      for (const attempt of attempts) {
        try {
          const file = new File([gpxContent], attempt.name, { type: attempt.type });
          // Skip canShare check - just try to share directly
          await navigator.share({ title: 'Peakflow: ' + (route.name || 'Route'), files: [file] });
          return { success: true, method: 'share' };
        } catch (e) {
          if (e.name === 'AbortError') return { success: false, method: 'cancelled' };
          // Try next mime type
          continue;
        }
      }

      // Last resort on mobile: share as text with GPX content
      try {
        await navigator.share({
          title: 'Peakflow: ' + (route.name || 'Route'),
          text: gpxContent
        });
        return { success: true, method: 'share-text' };
      } catch (e) {
        // Fall through to download
      }
    }

    // Desktop or all share attempts failed: download + instructions
    this.downloadGPX(route);
    if (isMobile) {
      this._showWatchInstructions(routeName);
    }
    return { success: true, method: 'download' };
  },

  /**
   * Show instructions popup for getting GPX on watch
   */
  _showWatchInstructions(fileName) {
    // Remove existing
    document.getElementById('watchInstructions')?.remove();
    document.getElementById('watchInstructionsBackdrop')?.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'watchInstructionsBackdrop';
    backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999;';

    const popup = document.createElement('div');
    popup.id = 'watchInstructions';
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg-secondary,#242424);border:1px solid var(--border-color,#3a3632);border-radius:16px;padding:24px;z-index:1000;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);color:var(--text-primary,#f0ece2);font-family:Inter,sans-serif;';

    popup.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h3 style="font-size:16px;font-weight:700;">\u2705 GPX heruntergeladen!</h3>' +
      '<button id="closeWatchInstr" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);font-size:22px;">&times;</button>' +
      '</div>' +
      '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;"><strong>' + fileName + '.gpx</strong> wurde gespeichert.</p>' +
      '<div style="font-size:13px;line-height:1.6;">' +
        '<div style="padding:10px;background:var(--bg-tertiary,#2e2e2e);border-radius:8px;margin-bottom:8px;">' +
          '<strong>\u2328\uFE0F Garmin</strong><br>Garmin Connect App \u2192 Training \u2192 Strecken \u2192 Importieren \u2192 GPX w\u00e4hlen' +
        '</div>' +
        '<div style="padding:10px;background:var(--bg-tertiary,#2e2e2e);border-radius:8px;margin-bottom:8px;">' +
          '<strong>\u2328\uFE0F Suunto</strong><br>Suunto App \u2192 Karte \u2192 Routen \u2192 Route importieren \u2192 GPX w\u00e4hlen' +
        '</div>' +
        '<div style="padding:10px;background:var(--bg-tertiary,#2e2e2e);border-radius:8px;margin-bottom:8px;">' +
          '<strong>\u2328\uFE0F Polar</strong><br>Polar Flow App \u2192 Favoriten \u2192 Route \u2192 GPX importieren' +
        '</div>' +
        '<div style="padding:10px;background:var(--bg-tertiary,#2e2e2e);border-radius:8px;">' +
          '<strong>\u2328\uFE0F Coros</strong><br>Coros App \u2192 Training \u2192 Route \u2192 GPX importieren' +
        '</div>' +
      '</div>' +
      '<p style="font-size:11px;color:var(--text-tertiary);margin-top:12px;">Die Route wird automatisch via Bluetooth auf deine Uhr synchronisiert.</p>';

    document.body.appendChild(backdrop);
    document.body.appendChild(popup);

    var close = function() { popup.remove(); backdrop.remove(); };
    document.getElementById('closeWatchInstr').addEventListener('click', close);
    backdrop.addEventListener('click', close);
  },

  /**
   * Parse GPX XML text into route data
   * @param {string} xmlText - GPX file contents
   * @returns {Object} { name, coords: [[lng,lat,ele]...], waypoints: [{lat,lng,ele,name}...] }
   */
  parseGPX(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    // Check for parse errors
    if (doc.querySelector('parsererror')) {
      throw new Error('Ungültige GPX-Datei');
    }

    // Extract route name
    const trkName = doc.querySelector('trk > name');
    const metaName = doc.querySelector('metadata > name');
    const name = (trkName && trkName.textContent) || (metaName && metaName.textContent) || 'Importierte Route';

    // Extract track points from all segments
    const coords = [];
    let trkpts = doc.querySelectorAll('trkpt');

    // Fallback: try route points if no track
    if (trkpts.length === 0) {
      trkpts = doc.querySelectorAll('rtept');
    }

    for (const pt of trkpts) {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      const eleEl = pt.querySelector('ele');
      const ele = eleEl ? parseFloat(eleEl.textContent) : 0;
      if (!isNaN(lat) && !isNaN(lon)) {
        coords.push([lon, lat, ele]);
      }
    }

    // Extract waypoints
    const waypoints = [];
    for (const wpt of doc.querySelectorAll('wpt')) {
      const lat = parseFloat(wpt.getAttribute('lat'));
      const lon = parseFloat(wpt.getAttribute('lon'));
      const eleEl = wpt.querySelector('ele');
      const nameEl = wpt.querySelector('name');
      if (!isNaN(lat) && !isNaN(lon)) {
        waypoints.push({
          lat, lng: lon,
          ele: eleEl ? parseFloat(eleEl.textContent) : 0,
          name: nameEl ? nameEl.textContent : null
        });
      }
    }

    if (coords.length === 0) {
      throw new Error('Keine Track-Punkte in der GPX-Datei gefunden');
    }

    return { name, coords, waypoints };
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
