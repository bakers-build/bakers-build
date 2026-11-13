// Serves a built docs/ directory on 127.0.0.1 for .bakers/scripts/docs-preview.sh under an isolating
// runtime: the run can write the files, so the host only reads them and never runs docs code.
//   node docs-preview-serve.mjs <dir> --port <port>
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

// Not resolved: a linked root, like any link out of it, then matches no real path below.
const root = resolve(process.argv[2]);
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** The file a URL path names inside `root`, or undefined; a link leading out of it is refused. */
function resolveFile(urlPath) {
  const path = decodeURIComponent(urlPath.split('?')[0]);
  for (const candidate of [path, `${path}.html`, join(path, 'index.html')]) {
    try {
      const real = realpathSync(join(root, candidate));
      if ((real === root || real.startsWith(root + sep)) && statSync(real).isFile()) return real;
    } catch {
      // Try the next spelling.
    }
  }
  return undefined;
}

createServer((req, res) => {
  let file;
  try {
    file = resolveFile(req.url ?? '/');
  } catch {
    // A malformed escape is a miss.
  }
  if (!file) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1');
