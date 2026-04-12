/**
 * Peakflow Onboarding Tutorial
 * Step-by-step spotlight tutorial for first-time users
 */
const PeakflowTutorial = {
  _overlay: null,
  _stepIdx: 0,
  _steps: [
    { titleKey: 'tutWelcomeTitle', textKey: 'tutWelcomeText', selector: '#map', icon: '\u26F0\uFE0F' },
    { titleKey: 'tutRouteTitle', textKey: 'tutRouteText', selector: '#routePlanBtn', icon: '\uD83D\uDDFA\uFE0F' },
    { titleKey: 'tutWaypointTitle', textKey: 'tutWaypointText', selector: '#map', icon: '\uD83D\uDCCD' },
    { titleKey: 'tutDragTitle', textKey: 'tutDragText', selector: '#map', icon: '\u270B' },
    { titleKey: 'tutStatsTitle', textKey: 'tutStatsText', selector: '[data-tab="routes"]', icon: '\uD83D\uDCCA' },
    { titleKey: 'tutProfileTitle', textKey: 'tutProfileText', selector: '#profileSelect', icon: '\uD83E\uDDB6' },
    { titleKey: 'tutReadyTitle', textKey: 'tutReadyText', selector: null, icon: '\uD83C\uDF1F' }
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

    // Update card content (i18n-aware)
    var t = typeof PeakflowI18n !== 'undefined' ? function(k) { return PeakflowI18n.t(k); } : function(k) { return k; };
    document.getElementById('tutorialIcon').textContent = step.icon;
    document.getElementById('tutorialTitle').textContent = t(step.titleKey);
    document.getElementById('tutorialText').textContent = t(step.textKey);

    // Update button text
    var btn = document.getElementById('tutorialBtn');
    btn.textContent = this._stepIdx === this._steps.length - 1 ? t('tutGo') : t('tutNext');

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
