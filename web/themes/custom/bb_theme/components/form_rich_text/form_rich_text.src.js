/**
 * @file
 * The Markdown toolbar behind form_rich_text, and its text-editor adapter.
 *
 * Importing the library registers the `markdown-toolbar` and `md-*` custom
 * elements the component's markup uses. Until they are defined — no JavaScript —
 * the component's CSS hides the toolbar and the author has the plain textarea.
 *
 * `Drupal.editors.bb_markdown` is the adapter of the bb_markdown text
 * editor bound to bb_rich (core Editor API). The editor renders the component
 * server-side around a placeholder textarea; attach() swaps the real textarea
 * in, so the editor path and the bb_markdown element path share one markup.
 *
 * Bundled through js/markdown-toolbar.src.js (the chart.js precedent); a
 * co-located form_rich_text.js would be loaded by SDC as well (Designbook JS-01).
 */
import '@github/markdown-toolbar-element';

const PLACEHOLDER_ID = 'bakers-markdown-placeholder';
// Drupal's own state classes on a textarea survive the swap to the component's.
const DRUPAL_CLASS = /^(form-textarea|required|error|resize-.+)$/;
const originalClass = new WeakMap();

if (window.Drupal) {
  window.Drupal.editors = window.Drupal.editors || {};
  window.Drupal.editors.bb_markdown = {
    attach(element, format) {
      // A read-only body gets no toolbar; a bb_markdown element already has one.
      if (element.disabled || element.readOnly || element.closest('.form-rich-text')) {
        return;
      }
      // The toolbar finds its field by id; with a duplicate id (an htmx fragment
      // beside a same-named form) it would edit the other textarea.
      if (document.getElementById(element.id) !== element) {
        return;
      }
      const template = document.createElement('template');
      template.innerHTML = format.editorSettings.toolbar;
      const control = template.content.querySelector('.form-rich-text');
      const placeholder = control.querySelector(`#${PLACEHOLDER_ID}`);
      control.dataset.bakersMarkdownEditor = '';
      control.querySelector('markdown-toolbar').setAttribute('for', element.id);

      originalClass.set(element, element.className);
      const kept = [...element.classList].filter((name) => DRUPAL_CLASS.test(name));
      element.className = placeholder.className;
      element.classList.add(...kept);

      element.before(control);
      placeholder.replaceWith(element);
    },
    detach(element, format, trigger) {
      // Core detaches with 'serialize' on every submit and keeps the editor
      // attached; only an unload or a format switch removes the toolbar.
      if (trigger === 'serialize') {
        return;
      }
      const control = element.closest('[data-bakers-markdown-editor]');
      if (!control) {
        return;
      }
      control.replaceWith(element);
      element.className = originalClass.get(element) ?? element.className;
      originalClass.delete(element);
    },
    onChange() {},
  };
}
