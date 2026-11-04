// URL-hosted Claude Code marketplace for the built docs site. A marketplace added by URL
// downloads only marketplace.json, so the `bakers` plugin ships as a zip behind an `archive`
// source pinned by sha256. The host stays the placeholder ${DOCS_DOMAIN}: the docs container
// substitutes its own at start-up, so one image serves every environment.
//
//   node scripts/marketplace.mjs        after `vitepress build`, writes into .vitepress/dist
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

// A deflated zip of every file under dir, root at the top, fixed timestamps so equal input
// gives an equal zip (and sha256).
function zip(dir) {
  const names = readdirSync(dir, { recursive: true })
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => name.split(sep).join('/'))
    .sort()
  const locals = []
  const centrals = []
  let offset = 0
  for (const name of names) {
    const data = readFileSync(join(dir, name))
    const packed = deflateRawSync(data)
    const path = Buffer.from(name)
    // version 20, flags 0 (bit 11 would mark UTF-8), deflate, DOS time 0 / date 1980-01-01.
    const common = Buffer.alloc(26)
    common.writeUInt16LE(20, 0)
    common.writeUInt16LE(8, 4)
    common.writeUInt16LE(0x21, 8)
    common.writeUInt32LE(crc32(data), 10)
    common.writeUInt32LE(packed.length, 14)
    common.writeUInt32LE(data.length, 18)
    common.writeUInt16LE(path.length, 22)
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), common, path, packed])
    // comment length, disk, internal and external attributes, then the local header's offset.
    const tail = Buffer.alloc(14)
    tail.writeUInt32LE(offset, 10)
    centrals.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0]), common, tail, path]))
    locals.push(local)
    offset += local.length
  }
  const central = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, end])
}

export function buildMarketplace({ pluginDir, catalogFile, outDir }) {
  const { version } = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))
  const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'))
  const archive = zip(pluginDir)
  // Versioned name: a cache never serves a changed zip under a name it already holds.
  const file = `plugins/bakers-${version}.zip`
  mkdirSync(join(outDir, 'plugins'), { recursive: true })
  writeFileSync(join(outDir, file), archive)
  catalog.plugins = catalog.plugins.map((plugin) =>
    plugin.name === 'bakers'
      ? {
          ...plugin,
          source: {
            source: 'archive',
            url: `https://\${DOCS_DOMAIN}/${file}`,
            sha256: createHash('sha256').update(archive).digest('hex'),
          },
        }
      : plugin,
  )
  writeFileSync(join(outDir, 'marketplace.json'), `${JSON.stringify(catalog, null, 2)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url))
  buildMarketplace({
    pluginDir: repo('.claude/skills/bakers-build'),
    catalogFile: repo('.claude-plugin/marketplace.json'),
    outDir: repo('docs/.vitepress/dist'),
  })
}
