/**
 * Apply saved appearance before CSS paints. Keep synchronous: Alpine loads later.
 * The selected palette and light/dark mode are independent and survive island swaps.
 */
(function () {
  'use strict';

  var themes = ['bakers', 'harbor', 'grove', 'ember', 'iris'];
  var modes = ['light', 'dark'];
  var root = document.documentElement;
  var defaultMode = 'light';
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) defaultMode = 'dark';
  } catch (e) {
    // System preference may be unavailable in restricted contexts.
  }

  function read(key, allowed, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return allowed.indexOf(value) !== -1 ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }

  window.bakersRestoreAppearance = function () {
    root.setAttribute('data-skin', read('bakers-theme', themes, 'bakers'));
    root.setAttribute('data-mode', read('bakers-mode', modes, defaultMode));
  };
  window.bakersRestoreAppearance();

  function apply(attribute, key, value) {
    root.setAttribute(attribute, value);
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      // The selection still works when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent('bakers-appearance', { detail: {
      theme: root.getAttribute('data-skin'), mode: root.getAttribute('data-mode'),
    } }));
    return value;
  }

  window.bakersSetTheme = function (theme) {
    return apply('data-skin', 'bakers-theme', themes.indexOf(theme) !== -1 ? theme : 'bakers');
  };
  window.bakersSetMode = function (mode) {
    return apply('data-mode', 'bakers-mode', modes.indexOf(mode) !== -1 ? mode : defaultMode);
  };
  window.bakersToggleMode = function () {
    return window.bakersSetMode(root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark');
  };
})();
