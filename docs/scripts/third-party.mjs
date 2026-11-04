// Third-party notices for the built docs site. Minification strips most license
// headers, so the client build writes /THIRD-PARTY-LICENSES.txt listing every npm
// package that actually ended up in a chunk, with its license text
// (docs/bakers/licensing.md). scripts/check-site.mjs fails the build without it.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i

// The package root of a module id: everything up to the last node_modules/<name>.
function packageRoot(id) {
  const path = id.replace(/^\0/, '').replace(/\?.*$/, '')
  const at = path.lastIndexOf('/node_modules/')
  if (at < 0) return null
  const rest = path.slice(at + '/node_modules/'.length).split('/')
  return path.slice(0, at) + '/node_modules/' + rest.slice(0, rest[0].startsWith('@') ? 2 : 1).join('/')
}

// Some packages keep their license only in the README's "License" section.
function readmeLicense(root) {
  const file = readdirSync(root).find((name) => /^readme(\.md)?$/i.test(name))
  if (!file) return ''
  // Ends at the next heading of the same or a higher level, so sub-headings stay in.
  const match = readFileSync(join(root, file), 'utf8').match(/^(#+) Licen[cs]e\b[\s\S]*?(?=^(?!\1#)#+ |$(?![\s\S]))/im)
  return match ? match[0].trim() : ''
}

// noticeFiles: notices for bundled material that is not an npm module (icons), appended verbatim.
export function thirdPartyNotices(moduleIds, noticeFiles = []) {
  const roots = new Set(moduleIds.map(packageRoot).filter((root) => root && existsSync(join(root, 'package.json'))))
  const entries = [...roots].map((root) => {
    const { name, version, license } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const files = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    const readme = files.length ? '' : readmeLicense(root)
    const text = files.length
      ? files.map((file) => readFileSync(join(root, file), 'utf8').trim()).join('\n\n')
      : readme || 'The package ships no license file.'
    return { key: `${name}@${version}`, block: `${name}@${version} (${license ?? 'no license field'})\n\n${text}\n` }
  })
  const unique = [...new Map(entries.map((entry) => [entry.key, entry])).values()]
  unique.sort((a, b) => a.key.localeCompare(b.key))
  const blocks = [...unique.map((entry) => entry.block), ...noticeFiles.map((file) => readFileSync(file, 'utf8').trim() + '\n')]
  return (
    'Third-party software bundled into this build, with its license terms.\n\n' +
    blocks.join(`\n${'-'.repeat(72)}\n\n`)
  )
}

// Vite plugin: emits the notices from the client bundle (the SSR bundle is never served).
// packages: names listed even when no JS chunk holds them (e.g. CSS-only tailwindcss);
// noticeFiles: see thirdPartyNotices. Both resolve against the Vite root.
export function thirdPartyLicenses({ packages = [], noticeFiles = [] } = {}) {
  let ssr = false
  let root = ''
  return {
    name: 'bakers-third-party-licenses',
    apply: 'build',
    configResolved(config) {
      ssr = Boolean(config.build.ssr)
      root = config.root
    },
    generateBundle(_, bundle) {
      if (ssr) return
      const ids = Object.values(bundle).flatMap((chunk) =>
        chunk.type === 'chunk'
          ? Object.entries(chunk.modules)
              .filter(([, module]) => module.renderedLength > 0)
              .map(([id]) => id)
          : [],
      )
      for (const name of packages) {
        const manifest = join(root, 'node_modules', name, 'package.json')
        if (!existsSync(manifest)) throw new Error(`Cannot inventory bundled package ${name}: ${manifest}`)
        ids.push(manifest)
      }
      const source = thirdPartyNotices(ids, noticeFiles.map((file) => join(root, file)))
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-LICENSES.txt', source })
    },
  }
}
