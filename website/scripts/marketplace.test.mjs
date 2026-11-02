// node --test website/scripts/marketplace.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { buildMarketplace } from './marketplace.mjs'

// Reads a zip's entries by the format spec (EOCD → central directory → local headers),
// independently of the writer, so the test checks the bytes a client would read.
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const files = new Map()
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + size)
    files.set(name, method === 8 ? inflateRawSync(raw) : raw)
    at += 46 + nameLen + extraLen + commentLen
  }
  return files
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'marketplace-'))
  const pluginDir = join(root, 'plugin')
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true })
  mkdirSync(join(pluginDir, 'skills', 'bb-demo'), { recursive: true })
  writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{"name":"bakers","version":"1.2.3"}\n')
  writeFileSync(join(pluginDir, 'skills', 'bb-demo', 'SKILL.md'), '# Demo skill\n'.repeat(50))
  const catalogFile = join(root, 'marketplace.json')
  writeFileSync(
    catalogFile,
    JSON.stringify({
      name: 'bakers',
      owner: { name: 'keytec' },
      plugins: [{ name: 'bakers', source: './.claude/skills/bakers-build', description: 'd' }],
    }),
  )
  return { pluginDir, catalogFile, outDir: join(root, 'dist') }
}

test('publishes the plugin as a versioned zip behind an archive source on the serving host', () => {
  const paths = fixture()
  buildMarketplace(paths)

  const zip = readFileSync(join(paths.outDir, 'plugins', 'bakers-1.2.3.zip'))
  const catalog = JSON.parse(readFileSync(join(paths.outDir, 'marketplace.json'), 'utf8'))

  assert.equal(catalog.name, 'bakers')
  assert.equal(catalog.plugins.length, 1)
  assert.equal(catalog.plugins[0].name, 'bakers')
  assert.equal(catalog.plugins[0].description, 'd')
  assert.deepEqual(catalog.plugins[0].source, {
    source: 'archive',
    // The container fills in its own host at start-up.
    url: 'https://${DOCS_DOMAIN}/plugins/bakers-1.2.3.zip',
    sha256: createHash('sha256').update(zip).digest('hex'),
  })
})

test('the zip holds the plugin root at its top level, contents unchanged', () => {
  const paths = fixture()
  buildMarketplace(paths)

  const files = readZip(readFileSync(join(paths.outDir, 'plugins', 'bakers-1.2.3.zip')))
  assert.deepEqual([...files.keys()].sort(), ['.claude-plugin/plugin.json', 'skills/bb-demo/SKILL.md'])
  assert.equal(files.get('skills/bb-demo/SKILL.md').toString(), '# Demo skill\n'.repeat(50))
  assert.equal(files.get('.claude-plugin/plugin.json').toString(), '{"name":"bakers","version":"1.2.3"}\n')
})

test('the real plugin zip carries its licenses and exactly the tracked plugin files', () => {
  const paths = fixture()
  const pluginDir = new URL('../../.claude/skills/bakers-build/', import.meta.url).pathname
  buildMarketplace({ ...paths, pluginDir })

  const { version } = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))
  const files = readZip(readFileSync(join(paths.outDir, 'plugins', `bakers-${version}.zip`)))
  assert.match(files.get('LICENSE')?.toString() ?? '', /^MIT License\n\nCopyright \(c\) 2026 keytec GmbH\n/)
  // bb-verdict derives from ponytail (MIT); its notice travels with the plugin.
  assert.match(files.get('NOTICE')?.toString() ?? '', /ponytail[\s\S]*Copyright \(c\) 2026 DietrichGebert\n/)
  // docs/bakers/licensing.md: only reviewed, tracked content ships; keytec's private skills never do.
  const tracked = execFileSync('git', ['ls-files'], { cwd: pluginDir, encoding: 'utf8' }).split('\n').filter(Boolean)
  assert.deepEqual([...files.keys()].sort(), tracked.sort())
})
