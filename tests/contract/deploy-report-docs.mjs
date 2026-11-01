// The deploy job's docs smoke check (scripts/deploy/deploy-report.mjs <stack> <app> <docs>):
// docs root, marketplace.json and its archive, same host and sha256 pinned.
//
//   node tests/contract/deploy-report-docs.mjs
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const REPORT = fileURLToPath(new URL('../../scripts/deploy/deploy-report.mjs', import.meta.url))
const ZIP = Buffer.from('PK zip bytes')
const SHA = createHash('sha256').update(ZIP).digest('hex')

// One local host plays the app (the existing probes) and the docs host.
async function serve(catalog) {
  const server = createServer((req, res) => {
    const routes = {
      '/user/login': [200, {}],
      '/.well-known/oauth-authorization-server': [200, {}],
      '/mcp': [401, { 'www-authenticate': 'Bearer realm="mcp_server"' }],
      '/': [200, {}],
      '/marketplace.json': [200, {}, JSON.stringify(catalog(origin))],
      '/plugins/bakers-1.0.0.zip': [200, {}, ZIP],
    }
    const [status, headers, body] = routes[req.url] ?? [404, {}]
    res.writeHead(status, headers).end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return { origin, close: () => server.close() }
}

const entry = (url, sha256 = SHA) => ({
  name: 'bakers',
  plugins: [{ name: 'bakers', source: { source: 'archive', url, sha256 } }],
})

function report(origin) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [REPORT, '--smoke-only', origin, origin],
      { env: { ...process.env, SMOKE_WAIT_SECONDS: '0' } },
      (error, stdout) => resolve({ code: error?.code ?? 0, stdout }),
    )
  })
}

test('passes when the archive is on the docs host and its sha256 matches', async () => {
  const site = await serve((origin) => entry(`${origin}/plugins/bakers-1.0.0.zip`))
  const { code, stdout } = await report(site.origin)
  site.close()
  assert.equal(code, 0, stdout)
  assert.match(stdout, /ok {3}marketplace archive matches its sha256/)
})

test('fails on a sha256 that does not match the served zip', async () => {
  const site = await serve((origin) => entry(`${origin}/plugins/bakers-1.0.0.zip`, '0'.repeat(64)))
  const { code, stdout } = await report(site.origin)
  site.close()
  assert.equal(code, 1)
  assert.match(stdout, /FAIL marketplace archive matches its sha256/)
})

test('fails on an archive URL on another host', async () => {
  const site = await serve(() => entry('https://elsewhere.example/plugins/bakers-1.0.0.zip'))
  const { code, stdout } = await report(site.origin)
  site.close()
  assert.equal(code, 1)
  assert.match(stdout, /FAIL marketplace archive on the docs host/)
})
