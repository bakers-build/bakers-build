/**
 * Apply the saved light/dark mode before CSS paints. Keep synchronous: Alpine loads later.
 * The choice is light, dark or system; system follows prefers-color-scheme and survives island swaps.
 */
(function () {
  'use strict';

  var choices = ['light', 'dark', 'system'];
  var root = document.documentElement;
  var scheme = null;
  try {
    scheme = window.matchMedia('(prefers-color-scheme: dark)');
  } catch (e) {
    // System preference may be unavailable in restricted contexts.
  }

  function stored() {
    try {
      var value = window.localStorage.getItem('bakers-mode');
      return choices.indexOf(value) !== -1 ? value : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function modeOf(choice) {
    if (choice !== 'system') return choice;
    return scheme && scheme.matches ? 'dark' : 'light';
  }

  // Storage may be blocked, so the current choice also lives in memory.
  var current = stored();

  window.bakersRestoreAppearance = function () {
    root.setAttribute('data-mode', modeOf(current));
  };
  window.bakersRestoreAppearance();

  if (scheme && scheme.addEventListener) {
    scheme.addEventListener('change', function () {
      if (current === 'system') window.bakersRestoreAppearance();
    });
  }

  window.bakersModeChoice = function () {
    return current;
  };

  window.bakersSetMode = function (choice) {
    current = choices.indexOf(choice) !== -1 ? choice : 'system';
    try {
      window.localStorage.setItem('bakers-mode', current);
    } catch (e) {
      // The selection still works when storage is unavailable.
    }
    window.bakersRestoreAppearance();
    var mode = root.getAttribute('data-mode');
    window.dispatchEvent(new CustomEvent('bakers-appearance', { detail: { mode: mode, choice: current } }));
    return mode;
  };
})();
