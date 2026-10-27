/**
 * @file
 * The theme's Alpine bundle, and its single JavaScript entry point.
 *
 * Alpine is the theme's client-side approach.
 * Nearly all behaviour is declarative in the components' Twig; only option_picker,
 * image_crop and period-range are large enough to need a registered component, registered here.
 *
 * Ordering is not a matter of taste. Alpine dispatches `alpine:init` before it
 * starts observing mutations, and warns when `start()` is called twice, so every
 * registration belongs in the one listener below and there is exactly one start.
 */
import Alpine from 'alpinejs';
import persist from '@alpinejs/persist';
import optionPicker from '../components/option_picker/option_picker.src.js';
import imageCrop from '../components/image_crop/image_crop.src.js';
import periodRange from '../components/period-range/period-range.src.js';

Alpine.plugin(persist);

document.addEventListener('alpine:init', () => {
  Alpine.data('optionPicker', optionPicker);
  Alpine.data('imageCrop', imageCrop);
  Alpine.data('periodRange', periodRange);
});

// Exposed so a component can reach the instance from the console while debugging;
// nothing in the theme depends on the global.
window.Alpine = Alpine;

Alpine.start();
