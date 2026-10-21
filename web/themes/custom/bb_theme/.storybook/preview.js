import '../css/app.src.css'
import '../js/skin.src.js'

// Run the rendered story's component JavaScript (BB-333).
//
// Until now this file imported CSS and nothing else, and main.js renders Twig through Twing: no
// component JS ran in Storybook and there was no Drupal.attachBehaviors, which is why the theme's
// JS components have always rendered as markup only. That was invisible while every one of them
// degraded gracefully -- a collapsible rendered from its own `open` prop looks the same whether or
// not the toggle is wired. It stops being invisible the moment a component draws or measures
// itself, because then the story shows an empty box on the exact surface a design ticket's
// acceptance evidence is taken from.
//
// The component glob mirrors how Drupal attaches JS, so Storybook and the site run the same code
// for anything that still registers a behaviour. It stays a glob rather than an import list,
// because an import list drifts the day someone adds a JS component and nobody notices it never
// runs.
//
// `../js/*.src.js` is deliberately NOT globbed. That entry point calls `Alpine.start()`, and Alpine
// warns and misbehaves when started twice, so importing it here as well as through the glob would
// start it a second time. Instead the preview performs the same setup the entry point does --
// the same plugin, the same single registration inside one `alpine:init` listener, the same single
// start -- which is what makes a story's declarative behaviour the behaviour the site gets.
//
// `Drupal`, `once` and `drupalSettings` are defined by an inline script in preview-head.html, NOT
// here: Vite prepends the imports this glob generates to the top of this file, so a shim imported
// here would load after the modules that need it. See that file for the full reasoning.
import Alpine from 'alpinejs'
import persist from '@alpinejs/persist'
import optionPicker from '../components/option_picker/option_picker.src.js'
import imageCrop from '../components/image_crop/image_crop.src.js'

import.meta.glob('../components/**/*.js', { eager: true })

Alpine.plugin(persist)
document.addEventListener('alpine:init', () => {
  Alpine.data('optionPicker', optionPicker)
  Alpine.data('imageCrop', imageCrop)
})
window.Alpine = Alpine
Alpine.start()

/**
 * Attaches Drupal behaviours to a story once the renderer has put it in the DOM.
 *
 * A decorator sees the story BEFORE it is mounted, so attaching here directly would find no nodes.
 * The double rAF waits for the frame after the renderer's insertion, which is also the first moment
 * the story has a layout -- load-bearing for any component that measures its container, which
 * would otherwise read a zero width. Attaching to `document.body` rather than to a wrapper keeps the
 * story's own markup untouched: no extra element, no changed selector, nothing for the existing
 * stories to notice. `once()` makes re-attachment a no-op.
 */
const withComponentBehaviors = (storyFn, context) => {
  const rendered = storyFn(context)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.Drupal.attachBehaviors(document.body, window.drupalSettings)
    })
  })
  return rendered
}

/**
 * Promotes every open `<dialog>` in a story to a REAL modal.
 *
 * An `open` attribute and `showModal()` are not the same state. The attribute renders the element
 * where it stands, with no top layer, no focus trap and no `::backdrop` -- which is the boundary
 * dialog.twig states about itself, and it is correct about its own markup: "the real top layer, the
 * focus trap and ::backdrop exist only after showModal(), so there is deliberately no scrim -- a
 * painted one would claim a modality this markup does not have". So a dialog story was previously
 * showing a non-modal surface, and every add, edit, cancel and confirm surface in this theme is a
 * dialog.
 *
 * This is STORYBOOK EMULATION of what the browser does on a real page, and it stays here for that
 * reason: nothing about the component changes, no `::backdrop` rule is added -- the UA default is
 * deliberately kept -- and the component's stated boundary is left exactly where it is.
 *
 * Same double-rAF idiom as `withComponentBehaviors` above, and for the same reason: a decorator sees
 * the story BEFORE it is mounted, so calling `showModal()` here directly would find no dialog. The
 * frame after the renderer's insertion is also the first moment the element has a layout, which
 * matters here because promoting to the top layer must not move the box.
 *
 * The selector is `dialog[open]` and NOT `dialog[open][data-dialog]`: only dialog.twig emits
 * `data-dialog`, so a narrower selector would miss any surface that owns its own `<dialog>` instead
 * of going through that component. BB-503 deleted the one that did, so today the broad selector
 * and the narrow one cover the same set; it stays broad so the next such surface is covered the day
 * it arrives rather than the day someone notices. Scope is global on purpose
 * -- a per-story opt-in list is the kind of list nobody maintains.
 *
 * `close()` before `showModal()`, and the `:modal` guard, keep a re-render from throwing: calling
 * `showModal()` on a dialog that is already modal raises InvalidStateError.
 */
const withDialogModality = (storyFn, context) => {
  const rendered = storyFn(context)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('dialog[open]').forEach((dialog) => {
        if (!dialog.isConnected || dialog.matches(':modal')) {
          return
        }
        dialog.close()
        dialog.showModal()
      })
    })
  })
  return rendered
}

/** Keep the app picker and Designbook toolbar on the same root attributes. */
const withThemeAttributes = (storyFn, context) => {
  const apply = () => {
    window.bakersRestoreAppearance()
    const selection = context.globals.theme || 'light'
    const named = /^(harbor|grove|ember|iris)(-dark)?$/.exec(selection)
    const { layout = selection === 'cozy' ? 'cozy' : 'compact', mode, theme } = context.parameters.bakersTheme || {}
    document.documentElement.setAttribute('data-layout', layout)
    if (theme || named) document.documentElement.setAttribute('data-skin', theme || named[1])
    if (mode || named || selection === 'dark') document.documentElement.setAttribute('data-mode', mode || (named && !named[2] ? 'light' : 'dark'))
    // The addon paints its documentation canvas inline; stories use the app tokens.
    document.body.style.removeProperty('background-color')
    document.body.style.removeProperty('color')
    window.dispatchEvent(new CustomEvent('bakers-appearance', { detail: {
      theme: document.documentElement.dataset.skin, mode: document.documentElement.dataset.mode,
    } }))
  }
  apply()
  const rendered = storyFn(context)
  // The addon's theme effect runs after render; restore the app selection afterwards.
  requestAnimationFrame(() => requestAnimationFrame(apply))
  return rendered
}

/** @type { import('@storybook/html-vite').Preview } */
const preview = {
  tags: ['autodocs'],
  decorators: [withComponentBehaviors, withDialogModality, withThemeAttributes],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}
export default preview
