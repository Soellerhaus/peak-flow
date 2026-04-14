/* ============================================
   PEAKFLOW - Weather Integration (Open-Meteo)
   ============================================ */

const PeakflowWeather = {

  BASE_URL: 'https://api.open-meteo.com/v1',

  // Weather code to icon/description mapping
  WEATHER_CODES: {
    0: { icon: '☀️', desc: 'Klar' },
    1: { icon: '🌤️', desc: 'Überwiegend klar' },
    2: { icon: '⛅', desc: 'Teilweise bewölkt' },
    3: { icon: '☁️', desc: 'Bewölkt' },
    45: { icon: '🌫️', desc: 'Nebel' },
    48: { icon: '🌫️', desc: 'Nebel mit Reif' },
    51: { icon: '🌦️', desc: 'Leichter Nieselregen' },
    53: { icon: '🌦️', desc: 'Nieselregen' },
    55: { icon: '🌧️', desc: 'Starker Nieselregen' },
    61: { icon: '🌧️', desc: 'Leichter Regen' },
    63: { icon: '🌧️', desc: 'Regen' },
    65: { icon: '🌧️', desc: 'Starker Regen' },
    66: { icon: '🌨️', desc: 'Gefrierender Regen' },
    67: { icon: '🌨️', desc: 'Starker gefrierender Regen' },
    71: { icon: '❄️', desc: 'Leichter Schneefall' },
    73: { icon: '❄️', desc: 'Schneefall' },
    75: { icon: '❄️', desc: 'Starker Schneefall' },
    77: { icon: '❄️', desc: 'Schneegriesel' },
    80: { icon: '🌦️', desc: 'Leichte Regenschauer' },
    81: { icon: '🌧️', desc: 'Regenschauer' },
    82: { icon: '⛈️', desc: 'Starke Regenschauer' },
    85: { icon: '🌨️', desc: 'Leichte Schneeschauer' },
    86: { icon: '🌨️', desc: 'Starke Schneeschauer' },
    95: { icon: '⛈️', desc: 'Gewitter' },
    96: { icon: '⛈️', desc: 'Gewitter mit Hagel' },
    99: { icon: '⛈️', desc: 'Schweres Gewitter mit Hagel' }
  },

  /**
   * Get current weather for a specific location
   */
  // Simple fetch cache (keyed by URL, 5min TTL)
  _cache: {},
  _cacheGet(url) {
    const entry = this._cache[url];
    if (entry && Date.now() - entry.ts < 300000) return entry.data;
    return null;
  },
  _cacheSet(url, data) {
    this._cache[url] = { data, ts: Date.now() };
    // Limit cache size
    const keys = Object.keys(this._cache);
    if (keys.length > 50) delete this._cache[keys[0]];
  },

  // Rate-limited fetch: max 1 request per 200ms to avoid 429
  _fetchQueue: Promise.resolve(),
  async rateLimitedFetch(url) {
    const cached = this._cacheGet(url);
    if (cached) return cached;
    this._fetchQueue = this._fetchQueue.then(() =>
      new Promise(resolve => setTimeout(resolve, 200))
    );
    await this._fetchQueue;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    this._cacheSet(url, data);
    return data;
  },

  async getCurrentWeather(lat, lng) {
    try {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lng,
        current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m',
        timezone: 'auto'
      });
      const url = `${this.BASE_URL}/forecast?${params}`;
      const data = await this.rateLimitedFetch(url);
      const c = data.current;
      if (!c) return null;
      const weatherInfo = this.WEATHER_CODES[c.weather_code] || { icon: '🌡️', desc: 'Unbekannt' };

      return {
        temperature: Math.round(c.temperature_2m),
        humidity: c.relative_humidity_2m,
        windSpeed: Math.round(c.wind_speed_10m),
        windGusts: Math.round(c.wind_gusts_10m),
        weatherCode: c.weather_code,
        icon: weatherInfo.icon,
        description: weatherInfo.desc
      };
    } catch (e) {
      console.warn('[Peakflow] Weather fetch failed', e);
      return null;
    }
  },

  /**
   * Get detailed forecast including snow data
   */
  async getDetailedForecast(lat, lng) {
    try {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lng,
        hourly: 'temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,snowfall,snow_depth,freezing_level_height',
        forecast_days: 3,
        timezone: 'auto'
      });
      const url = `${this.BASE_URL}/forecast?${params}`;
      const data = await this.rateLimitedFetch(url);
      return data.hourly;
    } catch (e) {
      console.warn('[Peakflow] Detailed forecast fetch failed', e);
      return null;
    }
  },

  /**
   * Get snow data for a location
   */
  async getSnowData(lat, lng, elevation) {
    try {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lng,
        hourly: 'snow_depth,snowfall,freezing_level_height',
        forecast_days: 1,
        timezone: 'auto'
      });
      // Pass elevation for accurate snow data at altitude
      if (elevation && elevation > 500) {
        params.set('elevation', Math.round(elevation));
      }
      const url = `${this.BASE_URL}/forecast?${params}`;
      const data = await this.rateLimitedFetch(url);
      const hourly = data.hourly;
      if (!hourly) return { snowDepth: 0, snowfall: 0, freezingLevel: 3000 };

      // Get current hour index
      const now = new Date();
      const currentHour = now.getHours();

      return {
        snowDepth: hourly.snow_depth ? Math.round((hourly.snow_depth[currentHour] || 0) * 100) : 0, // m to cm
        snowfall: hourly.snowfall ? hourly.snowfall[currentHour] || 0 : 0,
        freezingLevel: hourly.freezing_level_height ? Math.round(hourly.freezing_level_height[currentHour] || 0) : 0
      };
    } catch (e) {
      console.warn('[Peakflow] Snow data fetch failed', e);
      return { snowDepth: 0, snowfall: 0, freezingLevel: 3000 };
    }
  },

  /**
   * Get weather along a route (sample points)
   */
  async getRouteWeather(waypoints) {
    if (!waypoints || waypoints.length === 0) return [];

    // Sample max 5 points along the route
    const sampleCount = Math.min(waypoints.length, 5);
    const step = Math.max(1, Math.floor(waypoints.length / sampleCount));
    const samples = [];

    for (let i = 0; i < waypoints.length; i += step) {
      samples.push(waypoints[i]);
    }
    // Always include last point
    if (samples[samples.length - 1] !== waypoints[waypoints.length - 1]) {
      samples.push(waypoints[waypoints.length - 1]);
    }

    const weatherPromises = samples.map(wp =>
      this.getSnowData(wp.lat || wp[1], wp.lng || wp[0])
    );

    try {
      return await Promise.all(weatherPromises);
    } catch (e) {
      console.warn('[Peakflow] Route weather fetch failed', e);
      return [];
    }
  },

  /**
   * Render weather HTML for POI detail
   */
  renderWeatherHTML(weather) {
    if (!weather) return '<div class="weather-loading">Wetter nicht verfügbar</div>';

    return `
      <div class="weather-grid">
        <div class="weather-item">
          <span class="weather-item__icon">${weather.icon}</span>
          <div>
            <div class="weather-item__value">${weather.temperature}°C</div>
            <div class="weather-item__label">${weather.description}</div>
          </div>
        </div>
        <div class="weather-item">
          <span class="weather-item__icon">💨</span>
          <div>
            <div class="weather-item__value">${weather.windSpeed} km/h</div>
            <div class="weather-item__label">Wind (Böen ${weather.windGusts})</div>
          </div>
        </div>
        <div class="weather-item">
          <span class="weather-item__icon">💧</span>
          <div>
            <div class="weather-item__value">${weather.humidity}%</div>
            <div class="weather-item__label">Luftfeuchtigkeit</div>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Render 3-day forecast
   */
  renderForecastHTML(hourly) {
    if (!hourly) return '';

    // Get next 24 hours, every 3 hours
    const now = new Date();
    const currentHour = now.getHours();
    let html = '<div class="weather-forecast">';

    for (let i = currentHour; i < currentHour + 24; i += 3) {
      const idx = i % hourly.time.length;
      if (idx >= hourly.time.length) break;

      const time = new Date(hourly.time[idx]);
      const code = hourly.weather_code[idx];
      const temp = Math.round(hourly.temperature_2m[idx]);
      const weatherInfo = this.WEATHER_CODES[code] || { icon: '🌡️' };
      const snow = hourly.snowfall ? hourly.snowfall[idx] : 0;

      html += `
        <div class="weather-forecast__item">
          <div class="weather-forecast__time">${time.getHours()}:00</div>
          <div class="weather-forecast__icon">${weatherInfo.icon}</div>
          <div class="weather-forecast__temp">${temp}°C</div>
          ${snow > 0 ? `<div style="font-size:10px;color:var(--color-snow)">❄️ ${snow}cm</div>` : ''}
        </div>
      `;
    }

    html += '</div>';
    return html;
  },

  /**
   * Get 7-day daily forecast
   */
  async getWeeklyForecast(lat, lng) {
    try {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lng,
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max',
        forecast_days: 7,
        timezone: 'auto'
      });
      const resp = await fetch(`${this.BASE_URL}/forecast?${params}`);
      const data = await resp.json();
      return data.daily;
    } catch (e) {
      console.warn('[Peakflow] Weekly forecast failed', e);
      return null;
    }
  },

  /**
   * Render 7-day forecast as compact cards (no scrolling)
   */
  renderWeeklyHTML(daily) {
    if (!daily || !daily.time) return '<p>Nicht verf\u00fcgbar</p>';
    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    let html = '';
    for (let i = 0; i < daily.time.length; i++) {
      const d = new Date(daily.time[i]);
      const dayName = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : days[d.getDay()] + ' ' + d.getDate() + '.';
      const code = daily.weather_code[i];
      const info = this.WEATHER_CODES[code] || { icon: '\uD83C\uDF21\uFE0F', label: '' };
      const tMax = Math.round(daily.temperature_2m_max[i]);
      const tMin = Math.round(daily.temperature_2m_min[i]);
      const snow = daily.snowfall_sum ? Math.round(daily.snowfall_sum[i] * 10) / 10 : 0;
      const rain = daily.precipitation_sum ? Math.round(daily.precipitation_sum[i] * 10) / 10 : 0;
      const wind = daily.wind_speed_10m_max ? Math.round(daily.wind_speed_10m_max[i]) : 0;
      const isToday = i === 0;

      html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;' + (i < daily.time.length - 1 ? 'border-bottom:1px solid var(--border-color,#3a3632);' : '') + (isToday ? 'font-weight:700;' : '') + '">' +
        '<span style="width:55px;font-size:13px;color:var(--text-primary);">' + dayName + '</span>' +
        '<span style="font-size:20px;width:30px;text-align:center;">' + info.icon + '</span>' +
        '<span style="flex:1;font-size:13px;color:var(--text-primary);">' + tMax + '\u00b0 / ' + tMin + '\u00b0</span>' +
        (snow > 0 ? '<span style="font-size:11px;color:var(--color-snow,#93c5fd);">\u2744\uFE0F ' + snow + 'cm</span>' :
         rain > 0 ? '<span style="font-size:11px;color:#60a5fa;">\uD83C\uDF27\uFE0F ' + rain + 'mm</span>' : '') +
        '<span style="font-size:11px;color:var(--text-tertiary);width:45px;text-align:right;">\uD83D\uDCA8 ' + wind + '</span>' +
      '</div>';
    }
    return html;
  },

  /**
   * Render next day weather summary (compact, one line)
   */
  renderNextDayHTML(hourly) {
    if (!hourly || !hourly.time) return '';
    const now = new Date();
    const tomorrowStart = new Date(now);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    tomorrowStart.setHours(8, 0, 0, 0); // tomorrow 8am

    // Find index for tomorrow 8am, 12pm, 16pm
    let html = '<div style="margin-top:8px;"><h4 style="font-size:13px;font-weight:600;margin-bottom:6px;">Morgen</h4><div style="display:flex;gap:8px;">';
    const hours = [8, 12, 16];
    for (const h of hours) {
      const target = new Date(tomorrowStart);
      target.setHours(h);
      const idx = hourly.time.findIndex(function(t) { return new Date(t).getTime() >= target.getTime(); });
      if (idx < 0 || idx >= hourly.time.length) continue;
      const code = hourly.weather_code[idx];
      const info = this.WEATHER_CODES[code] || { icon: '\uD83C\uDF21\uFE0F' };
      const temp = Math.round(hourly.temperature_2m[idx]);
      html += '<div style="flex:1;text-align:center;padding:6px;background:var(--bg-tertiary,#2e2e2e);border-radius:8px;">' +
        '<div style="font-size:11px;color:var(--text-tertiary);">' + h + ':00</div>' +
        '<div style="font-size:18px;">' + info.icon + '</div>' +
        '<div style="font-size:13px;font-weight:600;">' + temp + '\u00b0</div>' +
      '</div>';
    }
    html += '</div></div>';
    return html;
  },

  // ─── WATCHLIST CONDITIONS ────────────────────────────────────────────
  /**
   * Get snow + weather conditions for multiple peaks (batch)
   * Returns array of {lat, lng, snowDepth, weather, wind, temp, status}
   * status: 'go' | 'maybe' | 'no'
   */
  async getWatchlistConditions(peaks) {
    if (!peaks || peaks.length === 0) return [];
    const results = [];
    // Process max 5 peaks at a time to avoid rate limiting
    for (let i = 0; i < peaks.length; i++) {
      const p = peaks[i];
      try {
        const params = new URLSearchParams({
          latitude: p.lat,
          longitude: p.lng,
          current: 'temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m',
          hourly: 'snow_depth',
          forecast_days: 1,
          timezone: 'auto'
        });
        const data = await this.rateLimitedFetch(`${this.BASE_URL}/forecast?${params}`);
        const snow = data.hourly?.snow_depth?.[new Date().getHours()] || 0;
        const snowCm = Math.round(snow * 100);
        const temp = data.current?.temperature_2m || 0;
        const wind = data.current?.wind_speed_10m || 0;
        const code = data.current?.weather_code || 0;
        const wInfo = this.WEATHER_CODES[code] || { icon: '🌡️', desc: 'Unbekannt' };
        // Determine status
        let status = 'go';
        if (snowCm > 30 || code >= 65 || code >= 95 || wind > 60) status = 'no';
        else if (snowCm > 5 || wind > 40 || code >= 51) status = 'maybe';
        results.push({
          lat: p.lat, lng: p.lng, name: p.peak_name || p.name,
          snowCm, temp: Math.round(temp), wind: Math.round(wind),
          weatherIcon: wInfo.icon, weatherDesc: wInfo.desc, weatherCode: code,
          status
        });
      } catch (e) {
        results.push({
          lat: p.lat, lng: p.lng, name: p.peak_name || p.name,
          snowCm: -1, temp: 0, wind: 0, weatherIcon: '❓', weatherDesc: 'Fehler',
          status: 'maybe'
        });
      }
    }
    return results;
  },

  // ─── BEST WEATHER WINDOW ────────────────────────────────────────────
  /**
   * Calculate best day to go for a given peak (7-day forecast)
   * Returns array of {date, dayName, score, details, isBest}
   */
  async calculateBestWindow(lat, lng) {
    const daily = await this.getWeeklyForecast(lat, lng);
    if (!daily || !daily.time) return null;

    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const results = [];
    let bestScore = -1;
    let bestIdx = 0;

    for (let i = 0; i < daily.time.length; i++) {
      const d = new Date(daily.time[i]);
      const dayName = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : days[d.getDay()] + ' ' + d.getDate() + '.';

      const rain = daily.precipitation_sum?.[i] || 0;
      const snow = daily.snowfall_sum?.[i] || 0;
      const wind = daily.wind_speed_10m_max?.[i] || 0;
      const tMax = daily.temperature_2m_max?.[i] || 0;
      const tMin = daily.temperature_2m_min?.[i] || 0;
      const code = daily.weather_code?.[i] || 0;

      // Scoring (max 50 points)
      let score = 0;
      // Precipitation (0-10)
      if (rain === 0 && snow === 0) score += 10;
      else if (rain < 2) score += 7;
      else if (rain < 5) score += 3;
      // Wind (0-10)
      if (wind < 15) score += 10;
      else if (wind < 25) score += 7;
      else if (wind < 40) score += 3;
      // Temperature (0-10)
      const avgTemp = (tMax + tMin) / 2;
      if (avgTemp >= 5 && avgTemp <= 20) score += 10;
      else if (avgTemp >= 0 && avgTemp <= 25) score += 7;
      else if (avgTemp >= -5 && avgTemp <= 30) score += 4;
      // Sky clarity (0-10)
      if (code <= 1) score += 10;
      else if (code <= 2) score += 7;
      else if (code <= 3) score += 4;
      else if (code <= 48) score += 2;
      // Snow bonus/penalty (0-10)
      if (snow === 0 && rain === 0) score += 10;
      else if (snow > 5) score -= 5;

      if (score > bestScore) { bestScore = score; bestIdx = i; }

      const wInfo = this.WEATHER_CODES[code] || { icon: '🌡️', desc: '' };
      results.push({
        date: daily.time[i], dayName, score,
        maxScore: 50,
        icon: wInfo.icon,
        tMax: Math.round(tMax), tMin: Math.round(tMin),
        rain: Math.round(rain * 10) / 10,
        snow: Math.round(snow * 10) / 10,
        wind: Math.round(wind),
        isBest: false
      });
    }
    if (results[bestIdx]) results[bestIdx].isBest = true;
    return results;
  },

  /**
   * Render Best Weather Window as HTML
   */
  renderBestWindowHTML(windowData) {
    if (!windowData || windowData.length === 0) return '<p>Keine Wetterdaten verfügbar</p>';
    let html = '<div style="display:flex;flex-direction:column;gap:6px;">';
    for (const d of windowData) {
      const pct = Math.round((d.score / d.maxScore) * 100);
      const barColor = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;' +
        (d.isBest ? 'background:rgba(34,197,94,0.1);border-radius:8px;padding:8px;border:1px solid rgba(34,197,94,0.3);' : '') + '">' +
        '<span style="width:55px;font-size:13px;font-weight:' + (d.isBest ? '700' : '400') + ';">' + d.dayName + '</span>' +
        '<span style="font-size:18px;">' + d.icon + '</span>' +
        '<div style="flex:1;height:8px;background:var(--bg-tertiary,#2a2826);border-radius:4px;overflow:hidden;">' +
          '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:4px;"></div>' +
        '</div>' +
        '<span style="width:32px;font-size:12px;font-weight:600;color:' + barColor + ';">' + pct + '%</span>' +
        (d.isBest ? '<span style="font-size:11px;font-weight:700;color:#22c55e;">⭐ BEST</span>' : '') +
      '</div>';
    }
    html += '</div>';
    return html;
  }
};
