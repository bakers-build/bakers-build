import twing from 'twing'

const { createSynchronousFunction, createSynchronousEnvironment, createSynchronousArrayLoader, createMarkup } = twing

// Storybook has no Drupal Icon API; preview the bakers sprite with escaped Twig output.
const preview = createSynchronousEnvironment(createSynchronousArrayLoader({
  icon: '<svg{{ attributes|raw }} width="{{ size }}" height="{{ size }}" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#{{ name }}"></use></svg>',
}), { autoEscapingStrategy: 'html' })

export function initEnvironment(twingEnvironment) {
  twingEnvironment.addFunction(createSynchronousFunction('icon', (_context, pack, name, settings) => {
    if (pack !== 'bakers' || !name) return ''
    return createMarkup(preview.render('icon', {
      name,
      size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 }[settings.get('size')] || 16,
      attributes: settings.get('attributes').addClass(['icon', 'inline-block', 'shrink-0']).toString(),
    }))
  }, [{ name: 'pack' }, { name: 'name' }, { name: 'settings' }]))
}
