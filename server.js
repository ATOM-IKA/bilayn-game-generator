const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { generateGame, AUDIENCES } = require('./lib/generate');

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  const isRaw = typeof body === 'string' || Buffer.isBuffer(body);
  res.end(isRaw ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        reject(new Error('BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleGenerate(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return send(res, 400, { error: err.message });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const change = typeof body.change === 'string' ? body.change.trim() : '';
  const previous = typeof body.previous === 'string' ? body.previous : '';
  const audience = AUDIENCES[body.audience] ? body.audience : undefined;

  if (!change && !prompt) return send(res, 400, { error: 'EMPTY_PROMPT' });
  if (change && !previous) return send(res, 400, { error: 'NO_PREVIOUS_GAME' });

  try {
    const html = await generateGame(
      { prompt, audience, previous, change },
      { apiKey: process.env.ANTHROPIC_API_KEY, model: MODEL },
    );
    return send(res, 200, { html });
  } catch (err) {
    console.error('generate failed:', err.message);
    if (err.message === 'NO_API_KEY') return send(res, 503, { error: 'NO_API_KEY' });
    return send(res, 502, { error: err.message });
  }
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(filePath)] || 'application/octet-stream');
  });
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/generate') return handleGenerate(req, res);
    if (req.method === 'GET') return serveStatic(req, res);
    send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Game generator: http://localhost:${PORT}  (model: ${MODEL})`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('Внимание: ANTHROPIC_API_KEY не задан, генерация вернёт ошибку 503.');
  });
}

module.exports = { createServer };
