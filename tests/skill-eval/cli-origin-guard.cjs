// Contract subprocess preload: the CLI may reach only the one fixture origin. fetch (undici) is
// checked on every request hop, so redirects and follow-up URLs are covered, and again before any
// connection opens; node:http(s) and child processes are refused outright.
const allowed = new URL(process.env.BB_CONTRACT_ALLOWED_ORIGIN ?? 'http://invalid.invalid').origin;
const refuse = target => {
  process.stderr.write(`ORIGIN_BOUNDARY: refused ${target}; only ${allowed} is reachable\n`);
  process.exit(98);
};
const channels = require('node:diagnostics_channel');
channels.subscribe('undici:request:create', ({ request }) => {
  if (request.origin !== allowed) refuse(`${request.origin}${request.path}`);
});
channels.subscribe('undici:client:beforeConnect', ({ connectParams: p }) => {
  if (`${p.protocol}//${p.host}` !== allowed) refuse(`${p.protocol}//${p.host}`);
});
for (const protocol of ['node:http', 'node:https']) {
  require(protocol).request = () => refuse(protocol);
  require(protocol).get = () => refuse(protocol);
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  require('node:child_process')[name] = () => refuse(`child_process.${name}`);
}
require('node:module').syncBuiltinESMExports();
