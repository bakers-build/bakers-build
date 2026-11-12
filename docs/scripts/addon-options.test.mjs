// The Options table of an addon page is rendered from the addon's options.schema.json
// (docs/.vitepress/addon-options.mjs), and every schema-bearing addon page carries the directive.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addonCoverage, expandOptions } from '../.vitepress/addon-options.mjs'

const HARNESS = 'https://bakers.build/schema/harness-options.schema.json'

// Renders `page` with schemas served from `schemas` by package name or $ref URL.
const render = (schemas, src, page = 'addons/demo.md') =>
  expandOptions(src, { page, load: (ref) => schemas[ref] })

const directive = (pkg = '@bakers-build/addon-demo') => `<!-- @options ${pkg} -->`

const rowsOf = (markdown) => markdown.split('\n').filter((line) => /^\| `/.test(line))

test('one row per option: key, type, default, required, effect', () => {
  const schema = {
    type: 'object',
    required: ['zone'],
    properties: {
      zone: { type: 'string', description: 'Domain of the public names.' },
      port: { type: 'integer', default: 22, description: 'SSH port.' },
      method: { enum: ['squash', 'merge'], description: 'How to merge.' },
      auth: { const: 'gh', description: 'Use the gh login.' },
      id: { type: ['integer', 'string'], description: 'The App ID.' },
      with: { description: 'Anything.' },
    },
  }
  assert.deepEqual(rowsOf(render({ '@bakers-build/addon-demo': schema }, directive())), [
    '| `zone` | string | — | yes | Domain of the public names. |',
    '| `port` | integer | `22` |  | SSH port. |',
    '| `method` | `squash` \\| `merge` | — |  | How to merge. |',
    '| `auth` | `gh` | — |  | Use the gh login. |',
    '| `id` | integer \\| string | — |  | The App ID. |',
    '| `with` | any | — |  | Anything. |',
  ])
})

test('nested, list and open keys read as dotted paths with a named placeholder', () => {
  const pane = {
    type: 'object',
    required: ['direction'],
    properties: { direction: { enum: ['right', 'down'], description: 'Split direction.' } },
  }
  const schema = {
    type: 'object',
    properties: {
      merge: {
        type: 'object',
        description: 'Merge rule per base branch.',
        propertyNames: { title: 'base' },
        additionalProperties: {
          type: 'object',
          description: 'The rule for one base.',
          properties: { method: { enum: ['squash', 'merge'], description: 'Merge method.' } },
        },
      },
      states: {
        type: 'object',
        description: 'Layout per state.',
        patternProperties: { '^[a-z]+$': { type: 'object', description: 'One state.', properties: {
          panes: { type: 'array', items: pane, description: 'Panes opened.' },
        } } },
      },
      claimers: { type: 'array', items: { type: 'string' }, description: 'Claimer packages.' },
    },
  }
  const paths = rowsOf(render({ '@bakers-build/addon-demo': schema }, directive())).map((row) => row.split(' | ')[0])
  assert.deepEqual(paths, [
    '| `merge`',
    '| `merge.<base>`',
    '| `merge.<base>.method`',
    '| `states`',
    '| `states.<key>`',
    '| `states.<key>.panes`',
    '| `states.<key>.panes[].direction`',
    '| `claimers`',
  ])
  assert.ok(render({ '@bakers-build/addon-demo': schema }, directive()).includes(
    '| `states.<key>.panes[].direction` | `right` \\| `down` | — | yes | Split direction. |',
  ))
})

test('local and cross-file $refs resolve; a harness addon narrows and drops shared options', () => {
  const harness = {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'Model the agent runs.' },
      permissions: { enum: ['sandbox', 'system'], default: 'system', description: 'Permission mode.' },
      config: { type: 'object', description: 'Own configuration.' },
      env_deny: { $ref: '#/$defs/list', description: 'Variables removed.' },
    },
    $defs: { list: { type: 'array', items: { type: 'string' } } },
  }
  const addon = {
    $ref: HARNESS,
    properties: {
      permissions: { enum: ['system'] },
      config: false,
      layout: { $ref: '#/$defs/layout' },
    },
    $defs: { layout: { type: 'object', description: 'Startup layout.' } },
  }
  const pointed = { type: 'object', properties: { model: { $ref: `${HARNESS}#/properties/model` } } }
  const schemas = { [HARNESS]: harness, '@bakers-build/addon-demo': addon, '@bakers-build/addon-pointed': pointed }
  assert.deepEqual(rowsOf(render(schemas, directive())), [
    '| `model` | string | — |  | Model the agent runs. |',
    '| `permissions` | `system` | `system` |  | Permission mode. |',
    '| `env_deny` | array | — |  | Variables removed. |',
    '| `layout` | object | — |  | Startup layout. |',
  ])
  assert.deepEqual(rowsOf(render(schemas, directive('@bakers-build/addon-pointed'))), [
    '| `model` | string | — |  | Model the agent runs. |',
  ])
})

test('a required key under if/else is required with or unless the condition key', () => {
  const schema = {
    type: 'object',
    properties: {
      auth: { const: 'gh', description: 'Use the gh login.' },
      app_id: { type: 'string', description: 'The App ID.' },
      token: { type: 'string', description: 'A token.' },
    },
    if: { required: ['auth'] },
    then: { required: ['token'] },
    else: { required: ['app_id'] },
  }
  const required = rowsOf(render({ '@bakers-build/addon-demo': schema }, directive())).map((row) => row.split(' | ')[3])
  assert.deepEqual(required, ['', 'yes, unless `auth`', 'yes, with `auth`'])
})

test('an option without a description fails, naming the page and the option', () => {
  const schema = { type: 'object', properties: { open: { type: 'object', description: 'Layout.', properties: { command: { type: 'string' } } } } }
  assert.throws(
    () => render({ '@bakers-build/addon-demo': schema }, directive(), 'addons/demo/options.md'),
    (error) => error.message.includes('addons/demo/options.md') && error.message.includes('`open.command`'),
  )
})

test('the table carries a generated note; text around the directive is unchanged', () => {
  const schema = { type: 'object', properties: { zone: { type: 'string', description: 'Zone.' } } }
  const before = '# Demo\n\n## Options\n\nProse before.\n\n'
  const after = '\n\nProse after, with `<!-- @options x -->` quoted inline.\n'
  const out = render({ '@bakers-build/addon-demo': schema }, `${before}${directive()}${after}`)
  assert.ok(out.startsWith(before))
  assert.ok(out.endsWith(after))
  const generated = out.slice(before.length, -after.length)
  assert.match(generated, /^\*Generated from the `options\.schema\.json` of `@bakers-build\/addon-demo`/)
  assert.ok(generated.includes('| Option | Type | Default | Required | Effect |'))
})

test('every schema-bearing addon page carries its directive; the rest are listed as not generated', () => {
  const { missing, notGenerated } = addonCoverage()
  assert.deepEqual(missing, [], 'schema-bearing addon pages without <!-- @options … -->')
  assert.deepEqual(notGenerated, [
    'agents', 'bakers-ui', 'bakers-ui-artifacts', 'ddev', 'deployment', 'docker-compose', 'dropsh',
    'essentials', 'info', 'name-refs', 'ports-cloudflare-quick', 'remote-drupal', 'track', 'workspace',
    'ports-services.md',
  ])
})
