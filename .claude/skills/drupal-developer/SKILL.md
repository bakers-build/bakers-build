---
name: drupal-developer
description: Apply this repository's conventions whenever working on Drupal project files, including PHP, Twig, JavaScript, configuration, modules, and themes.
---

# Drupal Principles

- Follow Drupal best practices and use the latest supported APIs
  available in the installed project version.
- Follow Drupal JavaScript conventions using `attach` and `once`.
- Reuse existing implementations and suitable Core/contrib solutions
  before writing custom code.
- Fix root causes in code, configuration, or schema. For contrib bugs,
  search for existing patches or updates before creating a reproducible patch.
- Use hooks, including preprocess and alter hooks, only as a last resort;
  implement them as classes where supported.
- Validate code with PHPCS, PHPMD, and PHPStan using project configuration.
- Keep code comments brief; omit ticket references unless essential.

## Rendering

- Keep HTML in SDC templates and style elements directly with Tailwind.
  Use CSS files only for third-party libraries or when no alternative works.
- Never generate or add HTML, inline styles, or CSS classes in PHP.
- Presenter Twig templates only pass data and render arrays to SDC;
  they contain no HTML markup, styles, or CSS classes.
- Render entities through UI Patterns or Display Builder. Try existing
  modules such as UI Patterns before creating blocks solely for rendering.
- Render passed render arrays completely.
- Connect SDC at the lowest owning Twig template, not through parent
  wrappers. Use theme suggestions for variants, not parent CSS selectors.
- Obtain missing template suggestions through suitable modules,
  such as Formdazzle.

## Entities

- Use the contrib Entity module. Share common behavior through
  existing or shared base classes for compatible entity families.
