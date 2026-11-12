// The egress sidecar of @bakers-build/addon-runtime-docker's allowlist mode.
// It sits on the internal run network and a normal bridge, and is the run's
// only way out:
//   :3128  HTTP CONNECT proxy, to allowed hosts only;
//   :8081  the model API, with the real credential added here (the run holds a placeholder);
//   :8082  a TCP relay to the conductor's tool server.
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, createServer as createTcpServer } from 'node:net';

/** Exact host, or `*.suffix` for any subdomain; case-insensitive. */
export function allowed(host, patterns) {
  const h = String(host).toLowerCase();
  return patterns.some((p) => {
    const q = String(p).toLowerCase();
    return q.startsWith('*.') ? h.endsWith(q.slice(1)) : h === q;
  });
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}

function splitHostPort(target) {
  const at = target.lastIndexOf(':');
  return {
    host: target.slice(0, at).replace(/^\[|\]$/g, ''),
    port: Number(target.slice(at + 1)),
  };
}

/**
 * `auth` maps each credential name, preferred first, to the headers sent with
 * it: `set` replaces a header (`{value}` is the secret), `append` adds a
 * comma-separated value. `secrets` holds the credential values (the sidecar's env).
 * @param {{ allow: string[], host?: string, apiTarget?: string,
 *   auth?: Record<string, { set: Record<string, string>, append?: Record<string, string> }>,
 *   secrets?: Record<string, string | undefined>, tools?: string,
 *   ports?: { egress?: number, api?: number, tools?: number } }} o
 */
export async function startProxy(o) {
  const bind = o.host ?? '0.0.0.0';
  const servers = [];

  const egress = createServer((_req, res) => {
    // shortcut: plain-HTTP proxying is refused; allow it when an allowed host needs http://.
    res.writeHead(403).end('only HTTPS (CONNECT) egress is allowed\n');
  });
  egress.on('connect', (req, socket, head) => {
    // A client may reset any tunnel, refused ones included; unhandled, that kills every stream.
    let upstream;
    socket.on('error', () => upstream?.destroy());
    const { host, port } = splitHostPort(req.url ?? '');
    if (!host || !port || !allowed(host, o.allow)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    upstream = connect(port, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket).pipe(upstream);
    });
    upstream.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  });
  servers.push(egress);
  const ports = { egress: await listen(egress, o.ports?.egress ?? 0, bind) };

  const auth = o.auth ?? {};
  const name = Object.keys(auth).find((k) => o.secrets?.[k]);
  if (o.apiTarget && name) {
    const value = String(o.secrets[name]);
    const { set, append = {} } = auth[name];
    // The run's placeholder may sit in any credential header.
    const strip = Object.values(auth).flatMap((a) =>
      Object.keys(a.set).map((h) => h.toLowerCase()),
    );
    const target = new URL(o.apiTarget);
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const api = createServer((req, res) => {
      const headers = { ...req.headers, host: target.host };
      for (const h of strip) delete headers[h];
      for (const [h, v] of Object.entries(set))
        headers[h.toLowerCase()] = v.replaceAll('{value}', value);
      for (const [h, v] of Object.entries(append)) {
        const k = h.toLowerCase();
        const list = String(headers[k] ?? '')
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean);
        if (!list.includes(v)) list.push(v);
        headers[k] = list.join(',');
      }
      const up = send(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          method: req.method,
          path: req.url,
          headers,
        },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on('error', () =>
        res.headersSent ? res.destroy() : res.writeHead(502).end(),
      );
      req.pipe(up);
    });
    servers.push(api);
    ports.api = await listen(api, o.ports?.api ?? 0, bind);
  }

  if (o.tools) {
    const { host, port } = splitHostPort(o.tools);
    const relay = createTcpServer((socket) => {
      const up = connect(port, host);
      socket.pipe(up).pipe(socket);
      up.on('error', () => socket.destroy());
      socket.on('error', () => up.destroy());
    });
    servers.push(relay);
    ports.tools = await listen(relay, o.ports?.tools ?? 0, bind);
  }

  return {
    ports,
    close: () =>
      Promise.all(
        servers.map((s) => new Promise((r) => s.close(() => r()))),
      ).then(() => {}),
  };
}

// Run as the sidecar: configuration comes from the environment.
if (import.meta.url === `file://${process.argv[1]}`) {
  const p = await startProxy({
    allow: (process.env.BB_ALLOW ?? '').split(',').filter(Boolean),
    apiTarget: process.env.BB_API_TARGET,
    auth: JSON.parse(process.env.BB_API_AUTH ?? '{}'),
    secrets: process.env,
    ...(process.env.BB_TOOLS ? { tools: process.env.BB_TOOLS } : {}),
    ports: { egress: 3128, api: 8081, tools: 8082 },
  });
  console.log(`bb-runtime proxy listening ${JSON.stringify(p.ports)}`);
}
