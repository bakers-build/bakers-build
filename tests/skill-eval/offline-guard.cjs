// Regression subprocess preload: even a swallowed network/process attempt fails the test.
const forbidden = () => {
  process.stderr.write(`${new Error('OFFLINE_BOUNDARY: network or child process attempted').stack}\n`);
  process.exit(97);
};
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  require('node:child_process')[name] = forbidden;
}
require('node:net').Socket.prototype.connect = forbidden;
require('node:tls').connect = forbidden;
for (const protocol of ['node:http', 'node:https']) {
  require(protocol).request = forbidden;
  require(protocol).get = forbidden;
}
globalThis.fetch = forbidden;
require('node:module').syncBuiltinESMExports();
