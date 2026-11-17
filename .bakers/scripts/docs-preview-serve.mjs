// Serves a built docs/ directory on 127.0.0.1 for .bakers/scripts/docs-preview.sh under an isolating
// runtime: the run can write the files, so the host only reads them and never runs docs code.
//   node docs-preview-serve.mjs <dir> --port <port>
import { closeSync, constants, createReadStream, fstatSync, openSync, realpathSync } from 'node:fs';
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

/** An open fd for the file a URL path names inside `root`, or undefined. Checked on the open fd, so
 * a link swapped in between check and read cannot lead out of it. */
function openFile(urlPath) {
  const path = decodeURIComponent(urlPath.split('?')[0]);
  for (const candidate of [path, `${path}.html`, join(path, 'index.html')]) {
    let fd;
    try {
      fd = openSync(join(root, candidate), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const real = realpathSync(`/proc/self/fd/${fd}`);
      if (real.startsWith(root + sep) && fstatSync(fd).isFile()) return fd;
    } catch {
      // Try the next spelling.
    }
    if (fd !== undefined) closeSync(fd);
  }
  return undefined;
}

createServer((req, res) => {
  let fd;
  try {
    fd = openFile(req.url ?? '/');
  } catch {
    // A malformed escape is a miss.
  }
  if (fd === undefined) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  res.setHeader('content-type', types[extname(req.url.split('?')[0])] ?? 'text/html; charset=utf-8');
  createReadStream(null, { fd }).pipe(res);
}).listen(port, '127.0.0.1');
