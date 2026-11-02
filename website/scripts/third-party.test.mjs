// node --test website/scripts/third-party.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { thirdPartyLicenses, thirdPartyNotices } from './third-party.mjs'

function pkg(root, name, manifest, files = {}) {
  const dir = join(root, 'node_modules/.pnpm', `${name.replace('/', '+')}@1/node_modules`, name)
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }))
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text)
  return dir
}

test('fails the build when an explicitly included package cannot be inventoried', () => {
  const root = mkdtempSync(join(tmpdir(), 'third-party-'))
  const plugin = thirdPartyLicenses({ packages: ['missing-css'] })
  plugin.configResolved({ root, build: {} })
  assert.throws(() => plugin.generateBundle.call({ emitFile() {} }, {}, {}), /missing-css/)
})

test('emits notices for CSS-only packages and assets without JavaScript chunks', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'third-party-'))
  pkg(fixture, 'css-only', { version: '1.0.0', license: 'MIT' }, { LICENSE: 'Copyright CSS author\n' })
  const root = join(fixture, 'node_modules/.pnpm/css-only@1')
  writeFileSync(join(root, 'font.NOTICE'), 'Font copyright and OFL terms\n')
  const plugin = thirdPartyLicenses({ packages: ['css-only'], noticeFiles: ['font.NOTICE'] })
  plugin.configResolved({ root, build: {} })
  let emitted
  plugin.generateBundle.call({ emitFile(asset) { emitted = asset } }, {}, {})
  assert.equal(emitted.fileName, 'THIRD-PARTY-LICENSES.txt')
  assert.match(emitted.source, /css-only@1\.0\.0 \(MIT\)\n\nCopyright CSS author/)
  assert.match(emitted.source, /Font copyright and OFL terms/)
})

test('lists each bundled package once, sorted, with its license text', () => {
  const root = mkdtempSync(join(tmpdir(), 'third-party-'))
  const zed = pkg(root, 'zed', { version: '1.0.0', license: 'MIT' }, { LICENSE: 'MIT License\n\nCopyright (c) Zed\n' })
  const scoped = pkg(root, '@s/b', { version: '2.0.0', license: 'ISC' })

  const text = thirdPartyNotices([
    join(zed, 'dist/a.js'),
    join(zed, 'dist/b.js?commonjs-proxy'),
    `\0${join(scoped, 'dist/index.js')}`,
    join(root, 'docs/.vitepress/theme/index.ts'),
  ])

  assert.equal(text.match(/Copyright \(c\) Zed/g).length, 1)
  assert.ok(text.indexOf('@s/b@2.0.0 (ISC)') < text.indexOf('zed@1.0.0 (MIT)'))
  assert.match(text, /@s\/b@2\.0\.0 \(ISC\)\n\nThe package ships no license file\./)
  assert.doesNotMatch(text, /theme/)
})

test('falls back to the README License section when no license file ships', () => {
  const root = mkdtempSync(join(tmpdir(), 'third-party-'))
  const readme = '# fd\n\nUsage.\n\n## License\n\n(The MIT License)\n\nCopyright (c) Wilson\n\n## Thanks\n\nnot this\n'
  const dir = pkg(root, 'fd', { version: '1.0.0', license: 'MIT' }, { 'README.md': readme })

  const text = thirdPartyNotices([join(dir, 'dist/fd.js')])

  assert.match(text, /fd@1\.0\.0 \(MIT\)\n\n## License\n\n\(The MIT License\)\n\nCopyright \(c\) Wilson\n/)
  assert.doesNotMatch(text, /not this|Usage/)
})

test('the README License section keeps its sub-headings', () => {
  const root = mkdtempSync(join(tmpdir(), 'third-party-'))
  const readme = '# sub\n\n## License\n\n### MIT\n\nCopyright (c) Sub\n\n## Thanks\n\nnot this\n'
  const dir = pkg(root, 'sub', { version: '1.0.0', license: 'MIT' }, { 'README.md': readme })

  const text = thirdPartyNotices([join(dir, 'dist/sub.js')])

  assert.match(text, /## License\n\n### MIT\n\nCopyright \(c\) Sub\n/)
  assert.doesNotMatch(text, /not this/)
})

test('appends notice files for bundled material that is not an npm module', () => {
  const root = mkdtempSync(join(tmpdir(), 'third-party-'))
  const dir = pkg(root, 'zed', { version: '1.0.0', license: 'MIT' }, { LICENSE: 'MIT License\n\nCopyright (c) Zed\n' })
  const notice = join(root, 'NOTICE')
  writeFileSync(notice, 'Icons from Feather.\n\nCopyright (c) 2013-2023 Cole Bemis\n')

  const text = thirdPartyNotices([join(dir, 'dist/index.js')], [notice])

  assert.match(text, /Copyright \(c\) Zed\n\n-{72}\n\nIcons from Feather\.\n\nCopyright \(c\) 2013-2023 Cole Bemis\n$/)
})

test('a directory named like a license file is not read as one', () => {
  const root = mkdtempSync(join(tmpdir(), 'third-party-'))
  const dir = pkg(root, 'dirlic', { version: '1.0.0', license: 'MIT' }, { LICENSE: 'MIT License\n\nCopyright (c) Dir\n' })
  mkdirSync(join(dir, 'licenses'))

  const text = thirdPartyNotices([join(dir, 'dist/index.js')])

  assert.match(text, /dirlic@1\.0\.0 \(MIT\)\n\nMIT License\n\nCopyright \(c\) Dir\n/)
})
