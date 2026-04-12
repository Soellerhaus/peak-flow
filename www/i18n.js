/**
 * Peakflow i18n - Simple internationalization
 * Supports: de (default), en
 */
const PeakflowI18n = {
  _lang: 'de',
  _strings: {
    de: {
      // Header
      searchPlaceholder: 'Gipfel, H\u00fctte oder Ort suchen...',
      login: 'Anmelden',
      register: 'Registrieren',
      // Sidebar tabs
      routes: 'Routen',
      discover: 'Entdecken',
      saved: 'Gespeichert',
      // Route planning
      routePlan: 'ROUTE PLANEN',
      gpx: 'GPX',
      suggestions: '\uD83D\uDD0D Vorschl\u00E4ge',
      restart: 'Neu starten',
      tapMap: 'Tippe auf die Karte',
      setStart: 'um deinen Startpunkt zu setzen',
      myLocation: 'Mein Standort',
      locating: 'Standort wird ermittelt...',
      // Route stats
      distance: 'Distanz',
      elevation: 'H\u00F6henmeter',
      duration: 'Dauer',
      ascent: 'Aufstieg',
      descent: 'Abstieg',
      // Settings
      settings: '\u2699\uFE0F Einstellungen',
      name: 'Name',
      avatar: 'Avatar',
      tempo: 'Tempo',
      routeColor: 'Routenfarbe',
      mapView: 'Kartenansicht',
      showPeaks: 'Gipfel anzeigen',
      showWater: '\uD83D\uDCA7 Wasserquellen anzeigen',
      showElevation: 'H\u00F6henprofil anzeigen',
      darkMode: '\uD83C\uDF19 Dark Mode',
      language: 'Sprache / Language',
      savedLocations: 'Meine Standorte (max. 5)',
      savedLocationsHint: 'Der oberste Standort wird als Startpunkt verwendet.',
      searchAddLocation: 'Ort suchen und hinzuf\u00fcgen...',
      connectWatch: 'Uhr verbinden',
      changePassword: 'Passwort \u00e4ndern',
      newPassword: 'Neues Passwort (min. 6 Zeichen)',
      saveSettings: '\uD83D\uDCBE Einstellungen speichern',
      logout: 'Abmelden',
      repeatTutorial: '\uD83D\uDCDA Einf\u00fchrung wiederholen',
      // Auth
      email: 'E-Mail',
      password: 'Passwort',
      passwordMin: 'Mindestens 6 Zeichen',
      noAccount: 'Noch kein Konto?',
      hasAccount: 'Schon registriert?',
      registerNow: 'Jetzt registrieren',
      loginNow: 'Jetzt anmelden',
      welcomeSetup: 'Willkommen! Richte dein Profil ein.',
      // Navigation
      navActive: '\uD83E\uDDED Navigation aktiv',
      navStop: '\u23F9 Beenden',
      navStraight: 'Geradeaus',
      navFollowRoute: 'Folge der Route...',
      navStarted: 'Navigation gestartet. Folge der Route.',
      navOffRoute: 'Achtung! Du bist vom Weg abgekommen.',
      navSummit: 'Gipfel erreicht!',
      navFinish: 'Du hast dein Ziel erreicht! Tour beendet.',
      navRemaining: 'noch',
      // Toolbar
      zoomIn: 'Zoom +',
      zoomOut: 'Zoom \u2212',
      peaksToggle: 'Gipfel an/aus',
      waterToggle: 'Wasserquellen an/aus',
      poiFilter: 'POI-Filter',
      myLocationBtn: 'Mein Standort',
      planRoute: 'Route planen',
      layers: 'Kartenlayer',
      fitRoute: 'Route zentrieren',
      terrain3d: '3D Terrain an/aus',
      elevationToggle: 'H\u00F6henprofil an/aus',
      compassNorth: 'Nach Norden ausrichten',
      // Tutorial
      tutWelcomeTitle: 'Willkommen bei Peak Flow!',
      tutWelcomeText: 'Plane deine Touren in den Alpen mit 3D-Karte, Wetter und echten Wanderwegen.',
      tutRouteTitle: 'Route planen',
      tutRouteText: 'Tippe hier um den Routenplaner zu starten. Die Karte wechselt in den Planungsmodus.',
      tutWaypointTitle: 'Wegpunkte setzen',
      tutWaypointText: 'Tippe auf die Karte um Wegpunkte zu setzen. Dein erster Punkt ist der Startpunkt.',
      tutDragTitle: 'Punkte verschieben & l\u00F6schen',
      tutDragText: 'Ziehe Punkte um die Route anzupassen. Langer Druck auf einen Punkt l\u00F6scht ihn (am PC: Rechtsklick).',
      tutStatsTitle: 'Routen-Details',
      tutStatsText: 'Hier siehst du Distanz, H\u00F6henmeter, gesch\u00E4tzte Zeit und das H\u00F6henprofil deiner Tour.',
      tutProfileTitle: 'Aktivit\u00E4tsprofil',
      tutProfileText: 'W\u00E4hle dein Tempo: Wandern, Trail Running oder Radfahren. Die Route passt sich automatisch an.',
      tutReadyTitle: 'Bereit!',
      tutReadyText: 'Viel Spa\u00DF beim Planen! Du kannst diese Einf\u00FChrung jederzeit in den Einstellungen wiederholen.',
      tutNext: 'Weiter',
      tutGo: 'Los geht\u2019s!',
      // Footer
      footerPowered: 'Powered by Peakflow \u2014 a one man show by Claudio \uD83C\uDFD4\uFE0F',
      // Profile options
      hikeSlow: '\uD83D\uDEB6 Gem\u00FCtlich',
      hikeNormal: '\uD83E\uDD7E Normal',
      hikeFast: '\uD83E\uDD7E Z\u00FCgig',
      runTrail: '\uD83C\uDFC3 Trail',
      runPro: '\uD83C\uDFC3 Profi',
      bikeRoad: '\uD83D\uDEB4 Rennrad',
      bikeGravel: '\uD83D\uDEB4 Gravel',
      bikeMtb: '\uD83D\uDEB5 MTB',
      bikeEbike: '\uD83D\uDD0B E-Bike',
      // Map views
      mapTopo: '\uD83D\uDDFA\uFE0F Topografisch',
      mapSat: '\uD83D\uDEF0\uFE0F Satellit',
      mapStandard: '\uD83D\uDCCB Standard',
      // Misc
      freeRegister: 'Kostenlos registrieren',
      registerCta: 'Jetzt kostenlos anmelden \u2192',
      noWatch: 'Keine Uhr'
    },
    en: {
      searchPlaceholder: 'Search peak, hut or place...',
      login: 'Log in',
      register: 'Sign up',
      routes: 'Routes',
      discover: 'Discover',
      saved: 'Saved',
      routePlan: 'PLAN ROUTE',
      gpx: 'GPX',
      suggestions: '\uD83D\uDD0D Suggestions',
      restart: 'Start over',
      tapMap: 'Tap the map',
      setStart: 'to set your starting point',
      myLocation: 'My Location',
      locating: 'Getting location...',
      distance: 'Distance',
      elevation: 'Elevation',
      duration: 'Duration',
      ascent: 'Ascent',
      descent: 'Descent',
      settings: '\u2699\uFE0F Settings',
      name: 'Name',
      avatar: 'Avatar',
      tempo: 'Pace',
      routeColor: 'Route color',
      mapView: 'Map view',
      showPeaks: 'Show peaks',
      showWater: '\uD83D\uDCA7 Show water sources',
      showElevation: 'Show elevation profile',
      darkMode: '\uD83C\uDF19 Dark Mode',
      language: 'Language / Sprache',
      savedLocations: 'My locations (max. 5)',
      savedLocationsHint: 'The top location is used as starting point.',
      searchAddLocation: 'Search and add a place...',
      connectWatch: 'Connect watch',
      changePassword: 'Change password',
      newPassword: 'New password (min. 6 characters)',
      saveSettings: '\uD83D\uDCBE Save settings',
      logout: 'Log out',
      repeatTutorial: '\uD83D\uDCDA Repeat tutorial',
      email: 'Email',
      password: 'Password',
      passwordMin: 'At least 6 characters',
      noAccount: 'No account yet?',
      hasAccount: 'Already registered?',
      registerNow: 'Sign up now',
      loginNow: 'Log in now',
      welcomeSetup: 'Welcome! Set up your profile.',
      navActive: '\uD83E\uDDED Navigation active',
      navStop: '\u23F9 Stop',
      navStraight: 'Straight ahead',
      navFollowRoute: 'Follow the route...',
      navStarted: 'Navigation started. Follow the route.',
      navOffRoute: 'Warning! You have left the route.',
      navSummit: 'Summit reached!',
      navFinish: 'You have reached your destination! Tour complete.',
      navRemaining: 'left',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      peaksToggle: 'Peaks on/off',
      waterToggle: 'Water sources on/off',
      poiFilter: 'POI filter',
      myLocationBtn: 'My location',
      planRoute: 'Plan route',
      layers: 'Map layers',
      fitRoute: 'Fit route',
      terrain3d: '3D Terrain on/off',
      elevationToggle: 'Elevation on/off',
      compassNorth: 'Align north',
      tutWelcomeTitle: 'Welcome to Peak Flow!',
      tutWelcomeText: 'Plan your tours in the Alps with 3D maps, weather and real hiking trails.',
      tutRouteTitle: 'Plan a route',
      tutRouteText: 'Tap here to start the route planner. The map switches to planning mode.',
      tutWaypointTitle: 'Set waypoints',
      tutWaypointText: 'Tap the map to place waypoints. Your first point is the starting point.',
      tutDragTitle: 'Move & delete points',
      tutDragText: 'Drag points to adjust the route. Long press deletes a point (on PC: right-click).',
      tutStatsTitle: 'Route details',
      tutStatsText: 'Here you can see distance, elevation, estimated time and the elevation profile.',
      tutProfileTitle: 'Activity profile',
      tutProfileText: 'Choose your pace: Hiking, Trail Running or Cycling. The route adapts automatically.',
      tutReadyTitle: 'Ready!',
      tutReadyText: 'Enjoy planning! You can repeat this tutorial anytime in the settings.',
      tutNext: 'Next',
      tutGo: 'Let\u2019s go!',
      footerPowered: 'Powered by Peakflow \u2014 a one man show by Claudio \uD83C\uDFD4\uFE0F',
      hikeSlow: '\uD83D\uDEB6 Easy',
      hikeNormal: '\uD83E\uDD7E Normal',
      hikeFast: '\uD83E\uDD7E Fast',
      runTrail: '\uD83C\uDFC3 Trail',
      runPro: '\uD83C\uDFC3 Pro',
      bikeRoad: '\uD83D\uDEB4 Road',
      bikeGravel: '\uD83D\uDEB4 Gravel',
      bikeMtb: '\uD83D\uDEB5 MTB',
      bikeEbike: '\uD83D\uDD0B E-Bike',
      mapTopo: '\uD83D\uDDFA\uFE0F Topographic',
      mapSat: '\uD83D\uDEF0\uFE0F Satellite',
      mapStandard: '\uD83D\uDCCB Standard',
      freeRegister: 'Register for free',
      registerCta: 'Sign up for free \u2192',
      noWatch: 'No watch'
    }
  },

  init() {
    this._lang = localStorage.getItem('peakflow_lang') || 'de';
    this.apply();
  },

  setLang(lang) {
    if (!this._strings[lang]) return;
    this._lang = lang;
    localStorage.setItem('peakflow_lang', lang);
    this.apply();
  },

  t(key) {
    return (this._strings[this._lang] && this._strings[this._lang][key]) ||
           (this._strings.de && this._strings.de[key]) || key;
  },

  apply() {
    var lang = this._lang;
    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      var val = PeakflowI18n.t(key);
      if (val) el.textContent = val;
    });

    // Update placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-placeholder');
      var val = PeakflowI18n.t(key);
      if (val) el.placeholder = val;
    });

    // Update titles
    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-title');
      var val = PeakflowI18n.t(key);
      if (val) el.title = val;
    });

    // Update html lang attribute
    document.documentElement.lang = lang;

    // Update language selector if exists
    var langSelect = document.getElementById('settingsLang');
    if (langSelect) langSelect.value = lang;

    console.log('[i18n] Language set to: ' + lang);
  }
};
