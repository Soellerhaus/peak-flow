/**
 * Peakflow Onboarding Tutorial
 * Step-by-step spotlight tutorial for first-time users
 */
const PeakflowTutorial = {
  _overlay: null,
  _stepIdx: 0,
  _steps: [
    {
      title: 'Willkommen bei Peak Flow!',
      text: 'Plane deine Touren in den Alpen mit 3D-Karte, Wetter und echten Wanderwegen.',
      selector: '#map',
      icon: '\u26F0\uFE0F'
    },
    {
      title: 'Route planen',
      text: 'Tippe hier um den Routenplaner zu starten. Die Karte wechselt in den Planungsmodus.',
      selector: '#routePlanBtn',
      icon: '\uD83D\uDDFA\uFE0F'
    },
    {
      title: 'Wegpunkte setzen',
      text: 'Tippe auf die Karte um Wegpunkte zu setzen. Dein erster Punkt ist der Startpunkt.',
      selector: '#map',
      icon: '\uD83D\uDCCD'
    },
    {
      title: 'Punkte verschieben & l\u00F6schen',
      text: 'Ziehe Punkte um die Route anzupassen. Langer Druck auf einen Punkt l\u00F6scht ihn (am PC: Rechtsklick).',
      selector: '#map',
      icon: '\u270B'
    },
    {
      title: 'Routen-Details',
      text: 'Hier siehst du Distanz, H\u00F6henmeter, gesch\u00E4tzte Zeit und das H\u00F6henprofil deiner Tour.',
      selector: '[data-tab="routes"]',
      icon: '\uD83D\uDCCA'
    },
    {
      title: 'Aktivit\u00E4tsprofil',
      text: 'W\u00E4hle dein Tempo: Wandern, Trail Running oder Radfahren. Die Route passt sich automatisch an.',
      selector: '#profileSelect',
      icon: '\uD83E\uDDB6'
    },
    {
      title: 'Bereit!',
      text: 'Viel Spa\u00DF beim Planen! Du kannst diese Einf\u00FChrung jederzeit in den Einstellungen wiederholen.',
      selector: null,
      icon: '\uD83C\uDF1F'
    }
  ],

  start(force) {
    if (this._overlay) return; // Already running
    if (!force && localStorage.getItem('peakflow_tutorial_done')) return;
    this._stepIdx = 0;
    this._buildOverlay();
    this._showStep();
  },

  _buildOverlay() {
    if (this._overlay) this._overlay.remove();

    var el = document.createElement('div');
    el.id = 'tutorialOverlay';
    el.innerHTML =
      '<div class="tutorial-backdrop" id="tutorialBackdrop"></div>' +
      '<button class="tutorial-close" id="tutorialClose">\u2715</button>' +
      '<div class="tutorial-card" id="tutorialCard">' +
        '<div class="tutorial-icon" id="tutorialIcon"></div>' +
        '<div class="tutorial-title" id="tutorialTitle"></div>' +
        '<div class="tutorial-text" id="tutorialText"></div>' +
        '<div class="tutorial-footer">' +
          '<div class="tutorial-dots" id="tutorialDots"></div>' +
          '<button class="tutorial-btn" id="tutorialBtn">Weiter</button>' +
        '</div>' +
      '</div>' +
      '<div class="tutorial-spotlight" id="tutorialSpotlight"></div>';

    document.body.appendChild(el);
    this._overlay = el;

    var self = this;
    document.getElementById('tutorialClose').addEventListener('click', function() { self._finish(); });
    document.getElementById('tutorialBtn').addEventListener('click', function() { self._next(); });
    document.getElementById('tutorialBackdrop').addEventListener('click', function() { self._next(); });
  },

  _showStep() {
    var step = this._steps[this._stepIdx];
    if (!step) { this._finish(); return; }

    // Update card content
    document.getElementById('tutorialIcon').textContent = step.icon;
    document.getElementById('tutorialTitle').textContent = step.title;
    document.getElementById('tutorialText').textContent = step.text;

    // Update button text
    var btn = document.getElementById('tutorialBtn');
    btn.textContent = this._stepIdx === this._steps.length - 1 ? 'Los geht\u2019s!' : 'Weiter';

    // Build dots
    var dotsEl = document.getElementById('tutorialDots');
    var dots = '';
    for (var i = 0; i < this._steps.length; i++) {
      dots += '<span class="tutorial-dot' + (i === this._stepIdx ? ' active' : '') + '"></span>';
    }
    dotsEl.innerHTML = dots;

    // Position spotlight
    var spotlight = document.getElementById('tutorialSpotlight');
    var card = document.getElementById('tutorialCard');

    // Spotlight on target element (if any)
    if (step.selector) {
      var target = document.querySelector(step.selector);
      if (target) {
        var rect = target.getBoundingClientRect();
        var pad = 6;
        spotlight.style.display = 'block';
        spotlight.style.left = (rect.left - pad) + 'px';
        spotlight.style.top = (rect.top - pad) + 'px';
        spotlight.style.width = (rect.width + pad * 2) + 'px';
        spotlight.style.height = (rect.height + pad * 2) + 'px';
        spotlight.style.borderRadius = rect.width < 60 ? '50%' : '12px';
      } else {
        spotlight.style.display = 'none';
      }
    } else {
      spotlight.style.display = 'none';
    }

    // Card always fixed at bottom center of screen
    var cardW = Math.min(360, window.innerWidth - 24);
    card.style.left = ((window.innerWidth - cardW) / 2) + 'px';
    card.style.width = cardW + 'px';
    card.style.bottom = '24px';
    card.style.top = 'auto';

    // Animate in
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    requestAnimationFrame(function() {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });
  },

  _next() {
    this._stepIdx++;
    if (this._stepIdx >= this._steps.length) {
      this._finish();
    } else {
      this._showStep();
    }
  },

  _finish() {
    localStorage.setItem('peakflow_tutorial_done', '1');
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
  }
};
