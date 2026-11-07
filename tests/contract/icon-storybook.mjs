// node tests/contract/icon-storybook.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import twing from '../../web/themes/custom/bb_theme/node_modules/twing/index.cjs'
import { initEnvironment } from '../../web/themes/custom/bb_theme/.storybook/twing-hooks.js'

const sdcRequire = createRequire(realpathSync(fileURLToPath(new URL('../../web/themes/custom/bb_theme/node_modules/storybook-addon-sdc/package.json', import.meta.url))))
const pluginRequire = createRequire(sdcRequire.resolve('vite-plugin-twing-drupal/package.json'))
const { addDrupalExtensions } = pluginRequire('@christianwiedemann/drupal-twig-extensions/twing')

const template = readFileSync(new URL('../../web/themes/custom/bb_theme/components/icon/icon.twig', import.meta.url), 'utf8')
const brandTemplate = readFileSync(new URL('../../web/themes/custom/bb_theme/components/brand/brand.twig', import.meta.url), 'utf8')
const env = twing.createSynchronousEnvironment(twing.createSynchronousArrayLoader({
  icon: template,
  brand: brandTemplate,
}), { autoEscapingStrategy: 'html' })
addDrupalExtensions(env)
initEnvironment(env)
env.addFunction(twing.createSynchronousFunction('create_attribute', () => ({}), []))
const attributes = {
  addClass(classes) { this.classes = classes; return this },
  toString() { return ` class="custom-icon ${this.classes.join(' ')}"` },
}
const html = env.render('icon', { name: 'user', size: 'lg', attributes })
for (const expected of ['sprite.svg#user', 'width="20"', 'custom-icon icon inline-block shrink-0', 'aria-hidden="true"', 'focusable="false"']) {
  assert.ok(html.includes(expected), expected)
}
const team = env.render('icon', { name: 'team', size: 'md', attributes })
assert.ok(team.includes('sprite.svg#team'), 'sprite.svg#team')
const sprite = readFileSync(new URL('../../web/themes/custom/bb_theme/dist/assets/icons/sprite.svg', import.meta.url), 'utf8')
assert.ok(/id="team"/.test(sprite), 'built sprite contains symbol id=team')
const escaped = env.render('icon', { name: '"><script>alert(1)</script>', attributes })
assert.ok(!escaped.includes('<script>'))
assert.ok(escaped.includes('&lt;script&gt;'))
for (const size of ['default', 'compact']) {
  const brandHtml = env.render('brand', { size, attributes })
  assert.ok(brandHtml.includes('src="/themes/custom/bb_theme/logo-wordmark.svg"'), `brand ${size} renders logo-wordmark.svg`)
  assert.ok(brandHtml.includes('alt="bakers.build"'), `brand ${size} names bakers.build`)
}
console.log('PASS: Storybook icon rendering, size, attributes and escaping.')
