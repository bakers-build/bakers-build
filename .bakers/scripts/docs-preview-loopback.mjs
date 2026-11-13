// Preloaded into `vitepress preview` by .bakers/scripts/docs-preview.sh: vitepress 1.6 ignores `--host`
// for `preview` and calls `listen(port, cb)`, which binds every interface. A listen without a host
// binds 127.0.0.1 here, so the preview is reachable only through the `ports_up docs` tunnel.
import net from 'node:net';

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (port, ...rest) {
  if (typeof port === 'number' && typeof rest[0] !== 'string') rest.unshift('127.0.0.1');
  return listen.call(this, port, ...rest);
};
