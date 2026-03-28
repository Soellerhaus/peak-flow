/* ============================================
   PEAKFLOW - Utility Functions
   ============================================ */

const PeakflowUtils = {

  // Activity profiles - 5 levels for accurate time estimation
  PROFILES: {
    hiker_slow:  { flatSpeed: 3,  ascentRate: 250, descentRate: 400, label: 'Gemütlich',  icon: '🚶' },
    hiker:       { flatSpeed: 4,  ascentRate: 300, descentRate: 500, label: 'Normal',      icon: '🥾' },
    hiker_fast:  { flatSpeed: 5,  ascentRate: 400, descentRate: 600, label: 'Zügig',       icon: '🥾' },
    runner:      { flatSpeed: 8,  ascentRate: 500, descentRate: 800, label: 'Trailrunner',  icon: '🏃' },
    runner_fast: { flatSpeed: 18, ascentRate: 1200, descentRate: 2000, label: 'Profi',       icon: '🏃' }
  },

  currentProfile: 'hiker',

  /**
   * Calculate hiking/running time using DIN 33466 formula
   * @param {number} distanceKm - Horizontal distance in km
   * @param {number} ascentM - Total ascent in meters
   * @param {number} descentM - Total descent in meters
   * @returns {{ hours: number, minutes: number, totalMinutes: number }}
   */
  calculateTime(distanceKm, ascentM, descentM) {
    const profile = this.PROFILES[this.currentProfile];

    // Time for horizontal distance
    const timeFlat = distanceKm / profile.flatSpeed; // hours

    // Time for vertical (ascent + descent)
    const timeAscent = ascentM / profile.ascentRate; // hours
    const timeDescent = descentM / profile.descentRate; // hours
    const timeVertical = timeAscent + timeDescent;

    // DIN 33466: larger value + (smaller value / 2)
    // For runner profiles: use reduced DIN factor (runners ascend and move forward simultaneously)
    const larger = Math.max(timeFlat, timeVertical);
    const smaller = Math.min(timeFlat, timeVertical);
    const isRunner = this.currentProfile === 'runner' || this.currentProfile === 'runner_fast';
    const dinFactor = isRunner ? 0.25 : 0.5; // Runners overlap flat+vertical more
    const totalHours = larger + (smaller * dinFactor);

    const totalMinutes = Math.round(totalHours * 60);
    return {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      totalMinutes
    };
  },

  /**
   * Format duration nicely
   */
  formatDuration(hours, minutes) {
    if (hours === 0) return `${minutes} min`;
    return `${hours}:${String(minutes).padStart(2, '0')} h`;
  },

  /**
   * Calculate distance between two coordinates (Haversine)
   * @returns {number} Distance in km
   */
  haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  toRad(deg) { return deg * Math.PI / 180; },

  /**
   * Calculate total distance of a route (array of [lng, lat] or [lng, lat, ele])
   * @returns {number} Total distance in km
   */
  routeDistance(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      total += this.haversineDistance(
        coords[i - 1][1], coords[i - 1][0],
        coords[i][1], coords[i][0]
      );
    }
    return total;
  },

  /**
   * Calculate ascent and descent from elevation array
   * @param {number[]} elevations
   * @returns {{ ascent: number, descent: number }}
   */
  calculateElevationGain(elevations) {
    let ascent = 0, descent = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff > 0) ascent += diff;
      else descent += Math.abs(diff);
    }
    return { ascent: Math.round(ascent), descent: Math.round(descent) };
  },

  /**
   * Determine difficulty based on route stats
   * @returns {{ level: string, label: string, class: string }}
   */
  calculateDifficulty(distanceKm, ascentM, maxElevation) {
    let score = 0;
    if (distanceKm > 20) score += 3;
    else if (distanceKm > 12) score += 2;
    else if (distanceKm > 6) score += 1;

    if (ascentM > 1500) score += 3;
    else if (ascentM > 800) score += 2;
    else if (ascentM > 400) score += 1;

    if (maxElevation > 3000) score += 2;
    else if (maxElevation > 2500) score += 1;

    if (score <= 2) return { level: 'easy', label: 'Leicht', class: 'difficulty-badge--easy' };
    if (score <= 4) return { level: 'moderate', label: 'Mittel', class: 'difficulty-badge--moderate' };
    if (score <= 6) return { level: 'hard', label: 'Schwer', class: 'difficulty-badge--hard' };
    return { level: 'expert', label: 'Experte', class: 'difficulty-badge--expert' };
  },

  /**
   * Calculate sunrise and sunset for a given position and date
   * Simple approximation algorithm
   */
  calculateSunTimes(lat, lng, date = new Date()) {
    const dayOfYear = this.getDayOfYear(date);
    const declination = 23.45 * Math.sin(this.toRad((360 / 365) * (dayOfYear - 81)));
    const latRad = this.toRad(lat);
    const decRad = this.toRad(declination);

    const hourAngle = Math.acos(
      -Math.tan(latRad) * Math.tan(decRad)
    ) * (180 / Math.PI);

    // Solar noon in UTC hours (approximate)
    const solarNoon = 12 - (lng / 15);
    const sunriseUTC = solarNoon - (hourAngle / 15);
    const sunsetUTC = solarNoon + (hourAngle / 15);

    // Convert to local time (rough timezone from longitude)
    const tzOffset = Math.round(lng / 15);
    const sunrise = sunriseUTC + tzOffset;
    const sunset = sunsetUTC + tzOffset;

    return {
      sunrise: this.formatHourMinute(sunrise),
      sunset: this.formatHourMinute(sunset)
    };
  },

  getDayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  },

  formatHourMinute(decimalHours) {
    const h = Math.floor(decimalHours);
    const m = Math.round((decimalHours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },

  /**
   * Generate packing list based on route conditions
   */
  generatePackingList(ascentM, maxElevation, snowDepth, temperature, windSpeed, rain) {
    const items = [];

    // Basics always
    items.push('Wasser (1-2L)', 'Erste-Hilfe-Set', 'Handy + Powerbank', 'Sonnenschutz');

    // Elevation based
    if (maxElevation > 2500) {
      items.push('Warme Schicht', 'Mütze', 'Handschuhe');
    }
    if (maxElevation > 3000) {
      items.push('Stirnlampe');
    }

    // Snow based - realistic recommendations
    if (snowDepth > 0 && snowDepth < 30) {
      items.push('Gamaschen', 'Grödel/Spikes');
    }
    if (snowDepth >= 30 && snowDepth < 80) {
      items.push('Schneeschuhe', 'Grödel/Spikes', 'Gamaschen');
    }
    if (snowDepth >= 80) {
      items.push('Schneeschuhe', 'Tourenski (optional)');
    }
    // LVS only above 2000m with significant snow (avalanche risk)
    if (snowDepth >= 30 && maxElevation > 2000) {
      items.push('LVS-Gerät', 'Sonde', 'Schaufel');
    }
    // Eispickel/Steigeisen only for high alpine >3000m routes
    if (snowDepth >= 20 && maxElevation > 3000) {
      items.push('Steigeisen', 'Eispickel');
    }

    // Weather based
    if (temperature < 0) {
      items.push('Thermounterwäsche', 'Isolationsjacke');
    }
    if (windSpeed > 40) {
      items.push('Windjacke');
    }
    if (rain > 0) {
      items.push('Regenjacke', 'Regenhose');
    }

    // Ascent based
    if (ascentM > 800) {
      items.push('Wanderstöcke');
    }
    if (ascentM > 1200) {
      items.push('Energieriegel/Snacks');
    }

    return [...new Set(items)]; // Remove duplicates
  },

  /**
   * Nutrition & Hydration calculator for trail activities
   * Based on sports science: ~500-800 kcal/h hiking, 600-1000 kcal/h running
   * Hydration: 500-1000ml/h depending on temp, intensity, altitude
   */
  calculateNutrition(distanceKm, ascentM, descentM, durationH, tempC, profile) {
    if (!distanceKm || !durationH || durationH <= 0) return null;

    // Base calorie burn per hour by profile
    const calPerHour = {
      'hiker_slow': 400, 'hiker': 500, 'hiker_fast': 600,
      'runner': 750, 'runner_fast': 900
    };
    const baseCal = calPerHour[profile] || 500;

    // Extra calories for elevation (1 Hm up ≈ 1 kcal, 1 Hm down ≈ 0.3 kcal)
    const elevCal = (ascentM || 0) * 1.0 + (descentM || 0) * 0.3;

    // Total calories
    const totalCal = Math.round(baseCal * durationH + elevCal);

    // Hydration: base 500ml/h + temperature adjustment + altitude adjustment
    var mlPerHour = 500;
    if (tempC > 20) mlPerHour += (tempC - 20) * 30; // +30ml per degree above 20°C
    if (tempC > 30) mlPerHour += (tempC - 30) * 50; // extra above 30°C
    if (tempC < 5) mlPerHour -= 100; // less in cold
    const maxElev = (ascentM || 0) > 1500 ? 3000 : 2000; // rough estimate
    if (maxElev > 2500) mlPerHour += 150; // altitude increases fluid loss
    mlPerHour = Math.max(300, mlPerHour); // minimum 300ml/h

    const totalMl = Math.round(mlPerHour * durationH);
    const totalL = (totalMl / 1000).toFixed(1);

    // Food items (1 gel ≈ 100kcal, 1 bar ≈ 250kcal, 1 banana ≈ 100kcal)
    // Rule: eat 200-300 kcal/h for efforts > 2h
    const eatableCalPerH = durationH > 2 ? 250 : 150;
    const foodCal = Math.round(eatableCalPerH * durationH);
    const gels = Math.ceil(foodCal * 0.4 / 100); // 40% from gels
    const bars = Math.ceil(foodCal * 0.4 / 250); // 40% from bars
    const bananas = Math.ceil(foodCal * 0.2 / 100); // 20% from fruit

    // Electrolyte tabs (1 per 500ml above 1L in warm weather)
    var electroTabs = 0;
    if (totalMl > 1000 && tempC > 15) {
      electroTabs = Math.ceil((totalMl - 1000) / 500);
    }

    return {
      calories: totalCal,
      waterL: parseFloat(totalL),
      waterMl: totalMl,
      gels: gels,
      bars: bars,
      bananas: bananas,
      electroTabs: electroTabs,
      mlPerHour: Math.round(mlPerHour),
      calPerHour: Math.round(baseCal + elevCal / durationH)
    };
  },

  /**
   * Calculate slope steepness between two points
   * @returns {number} Slope in degrees
   */
  calculateSlope(distance, elevDiff) {
    if (distance === 0) return 0;
    return Math.atan(elevDiff / (distance * 1000)) * (180 / Math.PI);
  },

  /**
   * Get color for slope steepness
   */
  getSlopeColor(slopeDeg) {
    return '#22c55e'; // Einheitlich grün
  },

  /**
   * Get color for snow depth
   */
  getSnowColor(depthCm) {
    if (depthCm <= 0) return null; // no snow
    if (depthCm < 20) return '#93c5fd'; // light blue
    if (depthCm < 50) return '#3b82f6'; // blue
    return '#ffffff'; // white - heavy snow
  }
};
