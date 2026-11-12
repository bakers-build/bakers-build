// Renders an addon page's Options table from the addon's options.schema.json at build time:
// the line `<!-- @options @bakers-build/addon-<name> -->` becomes a note and a Markdown table,
// so the page cannot drift from what `bakers config check` validates.
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const REPO = new URL('../../', import.meta.url)
const DIRECTIVE = /^<!-- @options (\S+) -->$/gm

// A package name maps to its addon folder; a bakers.build schema URL to bakers-cli/core/schema/.
export function loadSchema(ref) {
  const addon = ref.match(/^@bakers-build\/addon-([\w-]+)$/)
  const shared = ref.match(/^https:\/\/bakers\.build\/schema\/([\w-]+\.schema\.json)$/)
  const file = addon
    ? `bakers-cli/addons/${addon[1]}/options.schema.json`
    : shared && `bakers-cli/core/schema/${shared[1]}`
  if (!file) throw new Error(`addon-options: no schema for ${ref}`)
  return JSON.parse(readFileSync(new URL(file, REPO), 'utf8'))
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

// `missing`: pages of schema-bearing addons without their directive. `notGenerated`: addons
// without a schema, then addon pages with a hand-written `## Options` that belong to no addon.
export function addonCoverage() {
  const addons = new URL('bakers-cli/addons/', REPO)
  const docs = new URL('docs/addons/', REPO)
  const names = readdirSync(addons).filter((name) => existsSync(new URL(`${name}/package.json`, addons))).sort()
  const missing = []
  const notGenerated = []
  for (const name of names) {
    if (!existsSync(new URL(`${name}/options.schema.json`, addons))) {
      notGenerated.push(name)
      continue
    }
    const page = `${name}.md`
    const text = existsSync(new URL(page, docs)) ? readFileSync(new URL(page, docs), 'utf8') : ''
    if (!text.includes(`<!-- @options @bakers-build/addon-${name} -->`)) missing.push(`addons/${page}`)
  }
  for (const page of readdirSync(docs).filter((file) => file.endsWith('.md')).sort()) {
    const text = readFileSync(new URL(page, docs), 'utf8')
    if (!names.includes(page.slice(0, -3)) && /^## Options\s*$/m.test(text) && !text.includes('<!-- @options ')) notGenerated.push(page)
  }
  return { missing, notGenerated }
}
