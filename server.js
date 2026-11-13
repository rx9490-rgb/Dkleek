'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(process.env.PUBLIC_DIR || __dirname);
const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function send(req, res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    ...BASE_HEADERS,
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (char) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
  })[char]);
}

function getSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  let url;
  try {
    url = new URL(SUPABASE_URL);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    return null;
  }

  return { supabaseUrl: url.toString().replace(/\/$/, ''), supabaseAnonKey: SUPABASE_ANON_KEY };
}

async function serveIndex(req, res) {
  const config = getSupabaseConfig();
  if (!config) {
    return send(
      req,
      res,
      503,
      'Server configuration is incomplete. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) on the Node host.'
    );
  }

  const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  if (!html.includes('</head>')) {
    return send(req, res, 500, 'index.html is missing its closing head tag.');
  }

  const bootstrap = '<script>window.NASEEB_CONFIG=' +
    safeJsonForScript(config) +
    ';</script>';
  const output = html.replace('</head>', bootstrap + '</head>');

  res.writeHead(200, {
    ...BASE_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : output);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(req, res, 405, 'Method not allowed.');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(req, res, 400, 'Bad request.');
  }

  if (pathname === '/api/healthz') {
    return send(req, res, 200, JSON.stringify({ status: 'ok' }), 'application/json; charset=utf-8');
  }

  if (pathname === '/' || pathname === '/index.html') {
    try {
      return await serveIndex(req, res);
    } catch (error) {
      if (error.code === 'ENOENT') return send(req, res, 404, 'index.html not found.');
      console.error('Failed to serve index.html:', error.message);
      return send(req, res, 500, 'Internal server error.');
    }
  }

  const filePath = path.resolve(ROOT, `.${pathname}`);
  const relativePath = path.relative(ROOT, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return send(req, res, 404, 'Not found.');
  }

  const blockedNames = new Set([
    '.env',
    'package.json',
    'package-lock.json',
    'server.js',
  ]);
  if (
    relativePath.split(path.sep).some((part) => part.startsWith('.')) ||
    relativePath.split(path.sep).some((part) => blockedNames.has(part.toLowerCase()))
  ) {
    return send(req, res, 404, 'Not found.');
  }

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return send(req, res, 404, 'Not found.');

    const body = await fs.readFile(filePath);
    const contentType =
      MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      return send(req, res, 404, 'Not found.');
    }
    console.error('Request failed:', error.message);
    return send(req, res, 500, 'Internal server error.');
  }
});

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`Invalid PORT value: "${process.env.PORT || PORT}"`);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Naseeb server listening on port ${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
