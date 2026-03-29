/* ============================================
   PEAKFLOW - Supabase Client + Fallback Data
   ============================================ */

const PeakflowData = {

  // Bergkönig Supabase (public read access to peaks/huts/passes)
  SUPABASE_URL: 'https://wbrvkweezbeakfphssxp.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE',

  // PeakFlow Supabase (Auth + saved routes with RLS)
  AUTH_SUPABASE_URL: 'https://gvzrgdyaosxqhozjuuph.supabase.co',
  AUTH_SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2enJnZHlhb3N4cWhvemp1dXBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MzIwNDYsImV4cCI6MjA5MDEwODA0Nn0.lSES2gvImvv7Tsa2IVZ5ak_c9y-Weg-TVhcHdeLmyX0',

  client: null,      // Bergkönig (peaks data)
  authClient: null,  // PeakFlow (auth + routes)
  isConnected: false,
  isAuthConnected: false,
  currentUser: null,

  /**
   * Initialize both Supabase clients
   */
  init() {
    if (typeof supabase === 'undefined') {
      console.log('[Peakflow] Supabase SDK not loaded, using fallback data');
      return;
    }

    // Data client (Bergkönig - peaks)
    if (this.SUPABASE_URL && this.SUPABASE_KEY) {
      try {
        this.client = supabase.createClient(this.SUPABASE_URL, this.SUPABASE_KEY);
        this.isConnected = true;
        console.log('[Peakflow] Supabase connected');
      } catch (e) {
        console.warn('[Peakflow] Supabase connection failed, using fallback data', e);
      }
    }

    // Auth client (PeakFlow - auth + routes)
    if (this.AUTH_SUPABASE_URL && this.AUTH_SUPABASE_KEY) {
      try {
        this.authClient = supabase.createClient(this.AUTH_SUPABASE_URL, this.AUTH_SUPABASE_KEY);
        this.isAuthConnected = true;
        console.log('[Peakflow] Auth Supabase connected');
        this.restoreSession();
      } catch (e) {
        console.warn('[Peakflow] Auth Supabase connection failed', e);
      }
    }
  },

  /**
   * Restore auth session on page load
   */
  async restoreSession() {
    if (!this.authClient) return;
    try {
      const { data: { session } } = await this.authClient.auth.getSession();
      if (session) {
        this.currentUser = session.user;
        this.updateAuthUI();
        console.log('[Peakflow] Session restored for', session.user.email);
        // Load and apply profile settings after restore
        if (typeof Peakflow !== 'undefined' && Peakflow.loadAndApplyProfile) {
          Peakflow.loadAndApplyProfile();
        }
      }
    } catch (e) { /* no session */ }
  },

  /**
   * Sign up with email/password
   */
  async signUp(email, password) {
    if (!this.authClient) return { error: { message: 'Auth nicht verfügbar' } };
    const { data, error } = await this.authClient.auth.signUp({ email, password });
    if (!error && data.user) {
      this.currentUser = data.user;
      this.updateAuthUI();
    }
    return { data, error };
  },

  /**
   * Sign in with email/password
   */
  async signIn(email, password) {
    if (!this.authClient) return { error: { message: 'Auth nicht verfügbar' } };
    const { data, error } = await this.authClient.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      this.currentUser = data.user;
      this.updateAuthUI();
    }
    return { data, error };
  },

  /**
   * Sign out
   */
  async signOut() {
    if (!this.authClient) return;
    await this.authClient.auth.signOut();
    this.currentUser = null;
    this.updateAuthUI();
  },

  /**
   * Update UI based on auth state
   */
  updateAuthUI() {
    const loginBtn = document.getElementById('loginBtn');
    const userMenu = document.getElementById('userMenu');
    const userName = document.getElementById('userName');

    if (this.currentUser) {
      if (loginBtn) loginBtn.classList.add('hidden');
      if (userMenu) userMenu.classList.remove('hidden');
      if (userName) userName.textContent = this.currentUser.email.split('@')[0];
    } else {
      if (loginBtn) loginBtn.classList.remove('hidden');
      if (userMenu) userMenu.classList.add('hidden');
    }
  },

  /**
   * Load summits for initial view (top peaks across Alps)
   */
  async getSummits() {
    if (this.isConnected) {
      try {
        const { data, error } = await this.client
          .from('peaks')
          .select('id, name, name_de, lat, lng, elevation, osm_region, difficulty, description')
          .gte('elevation', 2500)
          .eq('is_active', true)
          .order('elevation', { ascending: false })
          .limit(300);
        if (!error && data && data.length > 0) {
          console.log(`[Peakflow] Loaded ${data.length} initial peaks from Supabase`);
          return data.map(p => this.formatPeak(p));
        }
      } catch (e) { console.warn('[Peakflow] Supabase peaks query failed', e); }
    }
    return this.FALLBACK_SUMMITS;
  },

  /**
   * Load peaks for a specific map viewport (called on zoom/pan)
   */
  async getSummitsInBounds(south, west, north, east, minElevation) {
    if (!this.isConnected) return [];
    try {
      const { data, error } = await this.client
        .from('peaks')
        .select('id, name, name_de, lat, lng, elevation, osm_region, difficulty, description')
        .gte('lat', south)
        .lte('lat', north)
        .gte('lng', west)
        .lte('lng', east)
        .gte('elevation', minElevation || 500)
        .eq('is_active', true)
        .order('elevation', { ascending: false })
        .limit(150);
      if (!error && data) {
        return data.map(p => this.formatPeak(p));
      }
    } catch (e) { console.warn('[Peakflow] Viewport peaks query failed', e); }
    return [];
  },

  /**
   * Format a peak record
   */
  formatPeak(p) {
    const name = p.name_de || p.name;
    const region = this.regionName(p.osm_region);
    const diff = p.difficulty || 'T1';
    const diffLabels = { T1: 'Wanderweg', T2: 'Bergwandern', T3: 'Anspruchsvoll', T4: 'Alpinwandern', T5: 'Alpinklettern', T6: 'Schwieriges Alpinklettern' };
    const diffLabel = diffLabels[diff] || diff;

    // Use Supabase description if available, otherwise generate
    let desc = p.description;
    if (!desc) {
      desc = `${name} ist ein ${p.elevation}m hoher Gipfel in ${region}.`;
      if (p.elevation > 3500) desc += ` Einer der höchsten Berge der Alpen.`;
      else if (p.elevation > 2500) desc += ` Ein markanter Hochgebirgsgipfel.`;
      else if (p.elevation > 1500) desc += ` Ein beliebtes Wanderziel.`;
      else desc += ` Ein Gipfel in den Voralpen.`;
      desc += ` Schwierigkeit: ${diffLabel} (${diff}).`;
      if (diff >= 'T4') desc += ' Alpine Erfahrung und Trittsicherheit erforderlich.';
      if (p.elevation > 2500) desc += ' Im Winter nur mit entsprechender Ausrüstung.';
    }

    return {
      id: p.id,
      name,
      lat: p.lat,
      lng: p.lng,
      elevation: p.elevation,
      difficulty: this.sacToDifficulty(p.difficulty),
      sacScale: diff,
      region,
      description: desc
    };
  },

  /**
   * Convert SAC difficulty to 1-5 stars
   */
  sacToDifficulty(sac) {
    if (!sac) return 2;
    const map = { 'T1': 1, 'T2': 2, 'T3': 3, 'T4': 4, 'T5': 5, 'T6': 5 };
    return map[sac] || 2;
  },

  /**
   * Convert region code to human name
   */
  regionName(code) {
    const names = {
      'AT-08': 'Vorarlberg', 'AT-07': 'Tirol', 'AT-06': 'Steiermark',
      'AT-05': 'Salzburg', 'AT-03': 'Kärnten', 'AT-04': 'Oberösterreich',
      'DE-BY': 'Bayern', 'IT-32-BZ': 'Südtirol', 'IT-32-TN': 'Trentino',
      'CH': 'Schweiz', 'FR': 'Frankreich', 'SI': 'Slowenien', 'LI': 'Liechtenstein'
    };
    return names[code] || code || 'Alpen';
  },

  /**
   * Check if a summit is reachable via hiking trails (Overpass API)
   * Returns: { reachable: bool, maxSac: 'T1'-'T6'|null, lastTrailPoint: [lng,lat]|null, warning: string|null }
   */
  _reachabilityCache: new Map(),

  async checkSummitReachability(poi) {
    const key = `${poi.lat.toFixed(4)},${poi.lng.toFixed(4)}`;
    if (this._reachabilityCache.has(key)) return this._reachabilityCache.get(key);

    const result = { reachable: true, maxSac: null, lastTrailPoint: null, warning: null };

    try {
      // Check Supabase peaks table for pre-analyzed reachability data (no Overpass needed!)
      if (poi.id || poi.osm_id) {
        const idField = poi.id ? 'id' : 'osm_id';
        const idVal = poi.id || poi.osm_id;
        const url = `${this.SUPABASE_URL}/rest/v1/peaks?${idField}=eq.${idVal}&select=reachable,max_sac_scale,nearest_trail_distance_m`;
        const resp = await fetch(url, { headers: { 'apikey': this.SUPABASE_KEY } });
        if (resp.ok) {
          const data = await resp.json();
          if (data.length > 0 && data[0].reachable !== null) {
            const p = data[0];
            result.reachable = p.reachable;
            result.maxSac = p.max_sac_scale;
            if (!p.reachable) {
              if (p.nearest_trail_distance_m > 200) {
                result.warning = `Wanderweg endet ${p.nearest_trail_distance_m}m vor dem Gipfel. Wegloses Gelände!`;
              } else if (p.max_sac_scale && p.max_sac_scale >= 'T5') {
                result.warning = `Gipfel nur über SAC ${p.max_sac_scale} (Alpinklettern) erreichbar.`;
              } else {
                result.warning = 'Kein Wanderweg zum Gipfel vorhanden.';
              }
            }
            this._reachabilityCache.set(key, result);
            return result;
          }
        }
      }
      // If no Supabase data available, assume reachable (don't spam Overpass)
      result.reachable = true;
    } catch (e) {
      console.warn('[Peakflow] Reachability check failed', e);
    }

    this._reachabilityCache.set(key, result);
    return result;
  },

  /**
   * Load all huts
   */
  async getHuts() {
    // Huts table not in Supabase yet - use fallback data
    return this.FALLBACK_HUTS;
  },

  async getPasses() {
    // Passes table not in Supabase yet - use fallback data
    return this.FALLBACK_PASSES;
  },

  /**
   * Save a route
   */
  async saveRoute(route) {
    // Must be logged in to save to Supabase
    if (this.isAuthConnected && this.currentUser) {
      try {
        const { data, error } = await this.authClient.from('saved_routes').insert([{
          user_id: this.currentUser.id,
          name: route.name,
          coords: route.coords,
          waypoints: route.waypoints,
          distance: route.distance,
          ascent: route.ascent,
          duration: route.duration,
          difficulty: route.difficulty || null
        }]);
        if (!error) {
          console.log('[Peakflow] Route saved to Supabase');
          return data;
        }
        console.warn('[Peakflow] Route save error:', error);
      } catch (e) { console.warn('[Peakflow] Route save to Supabase failed', e); }
    }
    // Fallback: LocalStorage (not logged in)
    const routes = JSON.parse(localStorage.getItem('peakflow_routes') || '[]');
    route.id = Date.now().toString();
    routes.push(route);
    localStorage.setItem('peakflow_routes', JSON.stringify(routes));
    return route;
  },

  /**
   * Load saved routes (from Supabase if logged in, otherwise localStorage)
   */
  async getSavedRoutes() {
    if (this.isAuthConnected && this.currentUser) {
      try {
        const { data, error } = await this.authClient
          .from('saved_routes')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data) return data;
      } catch (e) { console.warn('[Peakflow] Route load from Supabase failed', e); }
    }
    return JSON.parse(localStorage.getItem('peakflow_routes') || '[]');
  },

  /**
   * Delete a saved route
   */
  async deleteRoute(id) {
    if (this.isAuthConnected && this.currentUser) {
      try {
        await this.authClient.from('saved_routes').delete().eq('id', id);
        return;
      } catch (e) { /* fallback */ }
    }
    const routes = JSON.parse(localStorage.getItem('peakflow_routes') || '[]');
    const filtered = routes.filter(r => r.id !== id);
    localStorage.setItem('peakflow_routes', JSON.stringify(filtered));
  },

  // ============================================
  // USER PROFILE METHODS
  // ============================================

  /**
   * Fetch current user's profile from user_profiles
   */
  async getProfile() {
    if (!this.authClient || !this.currentUser) return null;
    try {
      const { data, error } = await this.authClient
        .from('user_profiles')
        .select('*')
        .eq('id', this.currentUser.id)
        .single();
      if (error) {
        console.warn('[Peakflow] getProfile error:', error.message);
        return null;
      }
      return data;
    } catch (e) {
      console.warn('[Peakflow] getProfile failed', e);
      return null;
    }
  },

  /**
   * Update profile fields for the current user
   */
  async updateProfile(updates) {
    if (!this.authClient || !this.currentUser) return { error: { message: 'Nicht angemeldet' } };
    try {
      updates.updated_at = new Date().toISOString();
      const { data, error } = await this.authClient
        .from('user_profiles')
        .update(updates)
        .eq('id', this.currentUser.id)
        .select()
        .single();
      if (error) {
        console.warn('[Peakflow] updateProfile error:', error.message);
        return { data: null, error };
      }
      return { data, error: null };
    } catch (e) {
      console.warn('[Peakflow] updateProfile failed', e);
      return { data: null, error: { message: e.message } };
    }
  },

  /**
   * Create a profile for a new user (fallback if trigger didn't fire)
   */
  async createProfile() {
    if (!this.authClient || !this.currentUser) return { error: { message: 'Nicht angemeldet' } };
    try {
      const { data, error } = await this.authClient
        .from('user_profiles')
        .insert([{
          id: this.currentUser.id,
          display_name: this.currentUser.email ? this.currentUser.email.split('@')[0] : 'Wanderer',
          avatar: 'hiker',
          activity_profile: 'hiker',
          route_color: '#39ff14',
          map_style: 'topo',
          show_peaks: true,
          locations: [],
          watch_brand: 'none'
        }])
        .select()
        .single();
      if (error) {
        // Profile might already exist (duplicate key) - try fetching it
        if (error.code === '23505') {
          return { data: await this.getProfile(), error: null };
        }
        console.warn('[Peakflow] createProfile error:', error.message);
        return { data: null, error };
      }
      return { data, error: null };
    } catch (e) {
      console.warn('[Peakflow] createProfile failed', e);
      return { data: null, error: { message: e.message } };
    }
  },

  // ============================================
  // FALLBACK DATA (used when no Supabase)
  // ============================================

  FALLBACK_SUMMITS: [
    {
      id: 1, name: 'Berg König', lat: 47.42, lng: 10.98, elevation: 2621,
      difficulty: 3,
      description: 'Der Berg König thront majestätisch über dem Allgäuer Alpenvorland. Seine markante Silhouette ist bereits aus der Ferne erkennbar und zieht Bergsteiger aus ganz Europa an. Der Gipfel bietet ein atemberaubendes 360-Grad-Panorama von den Lechtaler Alpen bis zum Bodensee. Die Besteigung führt durch alpine Blumenwiesen, über felsige Grate und vorbei an kristallklaren Bergseen. Im Frühsommer blühen hier seltene Alpenrosen und Enzian.'
    },
    {
      id: 2, name: 'Zugspitze', lat: 47.4211, lng: 10.9853, elevation: 2962,
      difficulty: 4,
      description: 'Mit 2.962 Metern ist die Zugspitze der höchste Berg Deutschlands und ein absolutes Highlight der Nordalpen. Der Gipfel liegt direkt auf der Grenze zwischen Deutschland und Österreich. Drei Normalwege führen zum Gipfel: durch das Höllental, über das Reintal oder von der österreichischen Seite über den Stopselzieher-Klettersteig. Bei klarer Sicht reicht der Blick bis zu 250 km weit über vier Länder.'
    },
    {
      id: 3, name: 'Großglockner', lat: 47.0742, lng: 12.6947, elevation: 3798,
      difficulty: 5,
      description: 'Der Großglockner ist mit 3.798 Metern der höchste Berg Österreichs und einer der markantesten Gipfel der Ostalpen. Sein vergletscherter Doppelgipfel erhebt sich über dem Pasterze-Gletscher, dem größten Gletscher der Ostalpen. Die Normalroute über den Stüdlgrat erfordert alpine Erfahrung und Gletscherausrüstung. Die Erzherzog-Johann-Hütte auf 3.454m ist die höchstgelegene Schutzhütte Österreichs.'
    },
    {
      id: 4, name: 'Matterhorn', lat: 45.9766, lng: 7.6585, elevation: 4478,
      difficulty: 5,
      description: 'Das Matterhorn ist der ikonischste Berg der Alpen und einer der berühmtesten Berge weltweit. Seine nahezu perfekte Pyramidenform erhebt sich 4.478 Meter über die Grenze zwischen der Schweiz und Italien. Die Erstbesteigung 1865 durch Edward Whymper endete tragisch mit vier Todesfällen. Heute ist der Hörnligrat die meistbegangene Route, erfordert aber exzellente alpine Fähigkeiten und einen Bergführer.'
    },
    {
      id: 5, name: 'Säntis', lat: 47.2494, lng: 9.3432, elevation: 2502,
      difficulty: 3,
      description: 'Der Säntis ist der höchste Berg im Alpstein-Massiv und ein Wahrzeichen der Ostschweiz. Dank der Schwebebahn ist der Gipfel auch für Nicht-Bergsteiger erreichbar. Für Wanderer bietet der Aufstieg über den Lisengrat einen spektakulären, ausgesetzten Gratweg. Die Wetterstation auf dem Gipfel gehört zu den ältesten der Schweiz. An klaren Tagen sieht man sechs Länder.'
    },
    {
      id: 6, name: 'Wildspitze', lat: 46.8853, lng: 10.8671, elevation: 3768,
      difficulty: 5,
      description: 'Die Wildspitze ist mit 3.768 Metern der höchste Berg Tirols und der zweithöchste Österreichs. Sie liegt in den Ötztaler Alpen und bietet Hochtouren-Flair mit Gletscherüberquerungen. Die Normalroute führt über den Rofenkarferner und erfordert Gletschererfahrung. Vom Gipfel überblickt man das gesamte Panorama der Ötztaler und Stubaier Alpen.'
    },
    {
      id: 7, name: 'Ortler', lat: 46.5072, lng: 10.5426, elevation: 3905,
      difficulty: 5,
      description: 'Der Ortler ist mit 3.905 Metern der höchste Berg Südtirols und der gesamten Ortler-Alpen-Gruppe. Die Normalroute über den Hintergrat ist eine anspruchsvolle Hochtour über Gletscher und Fels. Die Geschichte des Berges ist eng mit dem Ersten Weltkrieg verbunden, als österreichische und italienische Truppen um die Gipfel kämpften.'
    },
    {
      id: 8, name: 'Watzmann', lat: 47.5549, lng: 12.9214, elevation: 2713,
      difficulty: 4,
      description: 'Der Watzmann ist der dritthöchste Berg Deutschlands und berühmt für seine beeindruckende Ostwand – die höchste Felswand der Ostalpen. Die Watzmann-Überschreitung über alle Gipfel ist eine der beliebtesten und anspruchsvollsten Bergtouren der Bayerischen Alpen. Die Sage erzählt, der versteinerte König Watzmann habe einst Bauern und Tiere gequält.'
    }
  ],

  FALLBACK_HUTS: [
    {
      id: 1, name: 'Königshütte', lat: 47.415, lng: 10.975, elevation: 1920,
      description: 'Die Königshütte liegt idyllisch am Fuße des Berg König und ist der perfekte Ausgangspunkt für die Gipfelbesteigung. Die gemütliche Hütte serviert herzhafte Tiroler Küche und selbstgebackenes Brot. Besonders der Kaiserschmarrn ist legendär.',
      website_url: 'https://www.alpenverein.de',
      beds: 45, open_from: 'Juni', open_to: 'Oktober', phone: '+43 5264 12345'
    },
    {
      id: 2, name: 'Münchner Hütte', lat: 47.428, lng: 10.995, elevation: 2100,
      description: 'Die Münchner Hütte liegt auf einem aussichtsreichen Plateau mit direktem Blick auf die umliegende Bergwelt. Sie wurde 1897 erbaut und verbindet alpinen Charme mit modernem Komfort. Die Sonnenterrasse ist ein beliebter Rastplatz.',
      website_url: 'https://www.alpenverein.de',
      beds: 60, open_from: 'Mai', open_to: 'November', phone: '+43 5264 23456'
    },
    {
      id: 3, name: 'Erzherzog-Johann-Hütte', lat: 47.0780, lng: 12.6960, elevation: 3454,
      description: 'Die höchstgelegene Schutzhütte Österreichs thront am Fuße des Großglockner-Gipfels. Sie dient als letzter Stützpunkt vor dem Gipfelanstieg und bietet atemberaubende Sonnenaufgänge über dem Pasterze-Gletscher.',
      website_url: 'https://www.alpenverein.at',
      beds: 30, open_from: 'Juli', open_to: 'September', phone: '+43 4824 23456'
    },
    {
      id: 4, name: 'Hörnlihütte', lat: 45.9830, lng: 7.6590, elevation: 3260,
      description: 'Die Hörnlihütte am Fuß des Matterhorns ist die Basisstation für den Normalweg über den Hörnligrat. Die komplett renovierte Hütte bietet modernen Komfort auf 3.260 Metern – ein unvergessliches Erlebnis.',
      website_url: 'https://www.hoernlihuette.ch',
      beds: 130, open_from: 'Juli', open_to: 'September', phone: '+41 27 123 4567'
    },
    {
      id: 5, name: 'Watzmannhaus', lat: 47.5510, lng: 12.9250, elevation: 1930,
      description: 'Das Watzmannhaus liegt malerisch am Falzköpfl und ist Ausgangspunkt für die berühmte Watzmann-Überschreitung. Die DAV-Hütte bietet Platz für über 200 Bergsteiger und ist im Sommer stets gut besucht.',
      website_url: 'https://www.dav-berchtesgaden.de',
      beds: 210, open_from: 'Mai', open_to: 'Oktober', phone: '+49 8652 12345'
    }
  ],

  FALLBACK_PASSES: [
    {
      id: 1, name: 'Königsjoch', lat: 47.425, lng: 10.990, elevation: 2340,
      description: 'Das Königsjoch verbindet das Lechtal mit dem Inntal und ist seit Jahrhunderten ein wichtiger Übergang. Der Pass bietet spektakuläre Ausblicke auf beide Täler und ist im Sommer ein beliebter Wanderübergang.',
      connects_from: 'Lechtal', connects_to: 'Inntal'
    },
    {
      id: 2, name: 'Windscharte', lat: 47.430, lng: 11.010, elevation: 2580,
      description: 'Die Windscharte ist ein exponierter Übergang, der seinem Namen alle Ehre macht. Häufig weht hier kräftiger Wind. Der Übergang erfordert Trittsicherheit und Schwindelfreiheit.',
      connects_from: 'Inntal', connects_to: 'Wipptal'
    },
    {
      id: 3, name: 'Stelvio Pass', lat: 46.5285, lng: 10.4536, elevation: 2757,
      description: 'Der Stilfser Joch ist einer der höchsten befahrbaren Gebirgspässe Europas. Mit 48 Kehren auf der Nordseite ist die Passstraße legendär bei Radfahrern. Der Pass verbindet das Vinschgau in Südtirol mit dem Veltlin in der Lombardei.',
      connects_from: 'Vinschgau (Südtirol)', connects_to: 'Veltlin (Lombardei)'
    },
    {
      id: 4, name: 'Timmelsjoch', lat: 46.9064, lng: 11.0967, elevation: 2474,
      description: 'Das Timmelsjoch verbindet das Ötztal in Tirol mit dem Passeiertal in Südtirol. Die Hochalpenstraße bietet grandiose Ausblicke und führt durch eine beeindruckende Hochgebirgslandschaft.',
      connects_from: 'Ötztal (Tirol)', connects_to: 'Passeiertal (Südtirol)'
    }
  ],

  // ============================================
  // COMMUNITY RACES
  // ============================================

  async getCommunityRaces() {
    if (!this.authClient) return [];
    try {
      const { data, error } = await this.authClient
        .from('community_races')
        .select('*')
        .eq('is_public', true)
        .order('race_date', { ascending: true });
      if (!error && data) return data;
    } catch (e) { console.warn('[Peakflow] Load races failed', e); }
    return [];
  },

  async saveCommunityRace(race) {
    if (!this.authClient || !this.currentUser) return { error: 'Nicht angemeldet' };
    try {
      const { data, error } = await this.authClient
        .from('community_races')
        .insert([{
          user_id: this.currentUser.id,
          race_name: race.race_name,
          race_date: race.race_date || null,
          start_time: race.start_time || null,
          start_name: race.start_name || null,
          finish_name: race.finish_name || null,
          distance: race.distance || null,
          ascent: race.ascent || null,
          descent: race.descent || null,
          coords: race.coords,
          waypoints: race.waypoints || null,
          description: race.description || null,
          logo_url: race.logo_url || null,
          website_url: race.website_url || null,
          is_public: true
        }])
        .select()
        .single();
      if (error) return { error: error.message };
      return { data };
    } catch (e) { return { error: e.message }; }
  },

  async deleteCommunityRace(id) {
    if (!this.authClient || !this.currentUser) return;
    await this.authClient.from('community_races').delete().eq('id', id);
  },

  async toggleRacePeak(raceId) {
    if (!this.authClient || !this.currentUser) return { error: 'Nicht angemeldet' };
    // Check if already peaked
    const { data: existing } = await this.authClient
      .from('race_peaks')
      .select('id')
      .eq('race_id', raceId)
      .eq('user_id', this.currentUser.id)
      .maybeSingle();
    if (existing) {
      // Remove peak
      await this.authClient.from('race_peaks').delete().eq('id', existing.id);
      return { peaked: false };
    } else {
      // Add peak
      await this.authClient.from('race_peaks').insert([{ race_id: raceId, user_id: this.currentUser.id }]);
      return { peaked: true };
    }
  },

  async getUserPeaks(raceIds) {
    if (!this.authClient || !this.currentUser || !raceIds.length) return [];
    const { data } = await this.authClient
      .from('race_peaks')
      .select('race_id')
      .eq('user_id', this.currentUser.id)
      .in('race_id', raceIds);
    return (data || []).map(d => d.race_id);
  }
};
