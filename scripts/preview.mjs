import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRoot = path.join(projectRoot, 'dist');

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

export const safeHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'"
};

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

export async function createPreviewServer({ root = defaultRoot } = {}) {
  root = await realpath(root);
  if (!(await stat(root)).isDirectory()) throw new Error('Preview root must be a directory.');

  return createServer(async (request, response) => {
    for (const [name, value] of Object.entries(safeHeaders)) response.setHeader(name, value);
    response.setHeader('Cache-Control', 'no-store');
    const head = request.method === 'HEAD';
    const sendText = (status, text) => {
      response.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(text)
      });
      response.end(head ? undefined : text);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(405, 'Method not allowed');
      return;
    }

    let pathname;
    try {
      const raw = request.url ?? '/';
      if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) throw new Error('invalid URL');
      const decodedUrl = decodeURIComponent(raw);
      pathname = decodedUrl.split('?')[0];
      if (/[\u0000-\u001f\u007f]/.test(pathname)) throw new Error('invalid URL');
    } catch {
      sendText(400, 'Bad request');
      return;
    }
    // Check before normalization so encoded or literal dot segments cannot disappear.
    if (pathname.includes('\\') || pathname.split('/').includes('..')) {
      sendText(403, 'Forbidden');
      return;
    }
    let filePath = path.resolve(root, '.' + pathname);
    if (!inside(root, filePath)) {
      sendText(403, 'Forbidden');
      return;
    }

    try {
      let status = pathname === '/404.html' ? 404 : 200;
      let info;
      try {
        info = await stat(filePath);
        if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
        info = await stat(filePath);
        if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        status = 404;
        filePath = path.join(root, '404.html');
        try {
          info = await stat(filePath);
          if (!info.isFile()) throw new Error('not a file');
        } catch {
          sendText(404, 'Not found');
          return;
        }
      }
      if (!inside(root, await realpath(filePath))) {
        sendText(403, 'Forbidden');
        return;
      }
      response.statusCode = status;
      response.setHeader('Content-Type', types[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
      response.setHeader('Content-Length', info.size);
      if (head) {
        response.end();
        return;
      }
      createReadStream(filePath).on('error', () => {
        if (response.headersSent) response.destroy();
        else sendText(500, 'Internal server error');
      }).pipe(response);
    } catch {
      sendText(500, 'Internal server error');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.');
    process.exitCode = 1;
  } else {
    try {
      const server = await createPreviewServer();
      server.on('error', (error) => {
        console.error(`Preview failed: ${error.message}`);
        process.exitCode = 1;
      });
      server.listen(port, '127.0.0.1', () => {
        console.log(`Previewing dist/ at http://127.0.0.1:${port}`);
      });
    } catch (error) {
      console.error(error.code === 'ENOENT' ? 'dist/ does not exist. Run npm run build first.' : error.message);
      process.exitCode = 1;
    }
  }
}
