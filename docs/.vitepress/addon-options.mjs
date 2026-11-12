// Renders an addon page's Options table from the addon's options.schema.json at build time:
// the line `<!-- @options @bakers-build/addon-<name> -->` becomes a note and a Markdown table,
// so the page cannot drift from what `bakers config check` validates.
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const REPO = new URL('../../', import.meta.url)
const DIRECTIVE = /^<!-- @options (\S+) -->$/gm

// A package name maps to its addon folder; a bakers.build schema URL to bakers-cli/core/schema/.
export function loadSchema(ref, root = REPO) {
  const addon = ref.match(/^@bakers-build\/addon-([\w-]+)$/)
  const shared = ref.match(/^https:\/\/bakers\.build\/schema\/([\w-]+\.schema\.json)$/)
  const file = addon
    ? `bakers-cli/addons/${addon[1]}/options.schema.json`
    : shared && `bakers-cli/core/schema/${shared[1]}`
  if (!file) throw new Error(`addon-options: no schema for ${ref}`)
  return JSON.parse(readFileSync(new URL(file, root), 'utf8'))
}

const code = (value) => `\`${typeof value === 'string' ? value : JSON.stringify(value)}\``
const cell = (text) => text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')

function typeOf(node) {
  if (node.const !== undefined) return code(node.const)
  if (node.enum) return node.enum.map(code).join(' \\| ')
  return [node.type ?? 'any'].flat().join(' \\| ')
}

// Replaces every $ref by its target (`#/...` in `doc`, or `<url>#/...` loaded); keys beside a $ref
// overlay the target, per property, and a `false` property drops the target's option.
function inline(node, doc, load) {
  if (typeof node !== 'object' || node === null) return node
  const { $ref, ...own } = node
  const walked = Object.fromEntries(Object.entries(own).map(([key, value]) => [
    key,
    key === 'properties' || key === 'patternProperties'
      ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, inline(child, doc, load)]))
      : key === 'items' || key === 'additionalProperties' ? inline(value, doc, load) : value,
  ]))
  if (!$ref) return walked
  const [url, pointer = ''] = $ref.split('#')
  const target = url ? load(url) : doc
  const base = inline(pointer.split('/').slice(1).reduce((value, key) => value[key], target), target, load)
  const properties = { ...base.properties }
  for (const [name, child] of Object.entries(walked.properties ?? {})) {
    if (child === false) delete properties[name]
    else properties[name] = { ...properties[name], ...child }
  }
  return { ...base, ...walked, ...(base.properties || walked.properties ? { properties } : {}) }
}

// `yes` for a required key; `yes, with/unless \`x\`` for one an if/then/else requires.
function requirements(node) {
  const when = (node.if?.required ?? []).map(code).join(', ')
  return {
    ...Object.fromEntries((node.else?.required ?? []).map((key) => [key, `yes, unless ${when}`])),
    ...Object.fromEntries((node.then?.required ?? []).map((key) => [key, `yes, with ${when}`])),
    ...Object.fromEntries((node.required ?? []).map((key) => [key, 'yes'])),
  }
}

// Every option below `node`: `a.b` for properties, `a[].b` for list items, `a.<name>` for open keys.
function rows(node, prefix = '') {
  const required = requirements(node)
  const join = (key) => (prefix ? `${prefix}.${key}` : key)
  const open = [
    ...(typeof node.additionalProperties === 'object' ? [node.additionalProperties] : []),
    ...Object.values(node.patternProperties ?? {}),
  ]
  return [
    ...Object.entries(node.properties ?? {}).flatMap(([key, child]) => [
      { path: join(key), node: child, required: required[key] ?? '' },
      ...rows(child, join(key)),
    ]),
    ...(typeof node.items === 'object' ? rows(node.items, `${prefix}[]`) : []),
    ...open.flatMap((child) => {
      const path = join(`<${node.propertyNames?.title ?? 'key'}>`)
      return [{ path, node: child, required: '' }, ...rows(child, path)]
    }),
  ]
}

export function optionsTable(pkg, { page, load = loadSchema }) {
  const schema = load(pkg)
  const lines = rows(inline(schema, schema, load)).map(({ path, node, required }) => {
    const effect = node.description
    if (!effect) throw new Error(`${page}: option \`${path}\` of ${pkg} has no description in its options.schema.json`)
    const fallback = node.default === undefined ? '—' : code(node.default)
    return `| ${code(path)} | ${typeOf(node)} | ${fallback} | ${required} | ${cell(effect)} |`
  })
  if (!lines.length) throw new Error(`${page}: ${pkg} has no options; remove its @options directive`)
  return [
    `*Generated from the \`options.schema.json\` of \`${pkg}\`; change the schema, not this table.*`,
    '',
    '| Option | Type | Default | Required | Effect |',
    '|---|---|---|---|---|',
    ...lines,
  ].join('\n')
}

export const expandOptions = (markdown, options) =>
  markdown.replace(DIRECTIVE, (_, pkg) => optionsTable(pkg, options))

// markdown-it plugin (config.mts): expands directives before parsing, so local search indexes the rows.
export function addonOptions(md) {
  const parse = md.parse.bind(md)
  md.parse = (src, env) => parse(expandOptions(src, { page: env?.relativePath ?? 'unknown page' }), env)
}

// Public addons need schema-backed documentation; marked addons have no public pages.
export function addonCoverage(root = REPO) {
  const addons = new URL('bakers-cli/addons/', root)
  const docs = new URL('docs/addons/', root)
  const names = readdirSync(addons).filter((name) => existsSync(new URL(`${name}/package.json`, addons))).sort()
  const failures = []
  const load = (ref) => loadSchema(ref, root)
  for (const name of names) {
    const { bakers } = JSON.parse(readFileSync(new URL(`${name}/package.json`, addons), 'utf8'))
    const stability = bakers?.stability
    if (stability !== undefined) {
      if (!['internal', 'experimental'].includes(stability)) failures.push(`${name}: unknown stability ${JSON.stringify(stability)}`)
      if (existsSync(new URL(`${name}.md`, docs)) || existsSync(new URL(`${name}/`, docs))) {
        failures.push(`${name}: marked addon must not have a public page or page directory`)
      }
      continue
    }
    if (!existsSync(new URL(`${name}/options.schema.json`, addons))) {
      failures.push(`${name}: missing options.schema.json`)
      continue
    }
    const page = `addons/${name}.md`
    const text = existsSync(new URL(`${name}.md`, docs)) ? readFileSync(new URL(`${name}.md`, docs), 'utf8') : ''
    const pkg = `@bakers-build/addon-${name}`
    const schema = load(pkg)
    const hasOptions = rows(inline(schema, schema, load)).length > 0
    const hasDirective = text.includes(`<!-- @options ${pkg} -->`)
    if (hasOptions && !hasDirective) failures.push(`${page}: lacks <!-- @options ${pkg} -->`)
    if (!hasOptions && (hasDirective || /^## Options\s*$/m.test(text))) {
      failures.push(`${page}: addon has no options; remove its Options heading and directive`)
    }
  }
  return { failures }
}
