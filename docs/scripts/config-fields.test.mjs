// Each configuration file page lists exactly the keys its schema allows in its
// field table, nested keys included.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const SCHEMAS = new URL('../../bakers-cli/core/schema/', import.meta.url)
const PAGES = { connection: 'connection.md', machine: 'machine.md', project: 'project.md' }

const schemaFile = (name) => JSON.parse(readFileSync(new URL(name, SCHEMAS), 'utf8'))

// Resolve `#/$defs/x` in the current file and `other.schema.json#/$defs/x` across files.
function resolve(node, file) {
  while (node.$ref) {
    const [target, pointer] = node.$ref.split('#')
    if (target) file = target
    node = pointer.split('/').slice(1).reduce((value, key) => value[key], schemaFile(file))
  }
  return [node, file]
}

// Every key path the schema allows (`a.b`, `list[].key`) and the paths that take any child key.
function allowedPaths(kind) {
  const paths = new Set()
  const open = new Set()
  const walk = (raw, file, prefix) => {
    const [node, at] = resolve(raw, file)
    const shape = node.else ?? node
    if (shape.items) walk(shape.items, at, `${prefix}[]`)
    if (typeof shape.additionalProperties === 'object' || shape.additionalProperties === true) open.add(prefix)
    for (const [key, child] of Object.entries(shape.properties ?? {})) {
      const path = prefix ? `${prefix}.${key}` : key
      paths.add(path)
      walk(child, at, path)
    }
  }
  const schema = schemaFile(`${kind}.schema.json`)
  walk(schema, `${kind}.schema.json`, '')
  return { paths, open }
}

const allows = ({ paths, open }, key) =>
  paths.has(key) || [...open].some((prefix) => key.startsWith(`${prefix}.`))

function section(markdown, heading) {
  const start = markdown.search(new RegExp(`^## ${heading}\\s*$`, 'm'))
  if (start < 0) return ''
  const rest = markdown.slice(start).split('\n').slice(1).join('\n')
  const end = rest.search(/^## /m)
  return end < 0 ? rest : rest.slice(0, end)
}

const codes = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1])

// The first column of the table under `## Fields`, one or more keys per row.
function fieldKeys(markdown) {
  return section(markdown, 'Fields')
    .split('\n')
    .filter((line) => /^\|\s*`/.test(line))
    .flatMap((line) => codes(line.split('|')[1]))
}

for (const [kind, page] of Object.entries(PAGES)) {
  const markdown = readFileSync(new URL(`../configuration/${page}`, import.meta.url), 'utf8')
  const allowed = allowedPaths(kind)
  const listed = fieldKeys(markdown)

  test(`${page} field table lists every ${kind} schema key, nested keys included`, () => {
    assert.ok(listed.length > 0, `${page} has no field table under "## Fields"`)
    const missing = [...allowed.paths].filter((key) => !listed.includes(key))
    assert.deepEqual(missing, [], `${page} field table misses schema keys`)
  })

  test(`${page} field table lists only keys the ${kind} schema allows`, () => {
    const unknown = listed.filter((key) => !allows(allowed, key))
    assert.deepEqual(unknown, [], `${page} field table lists keys the schema rejects`)
  })
}
