const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { generateGame, AUDIENCES } = require('./lib/generate');
const { PROVIDERS, isReasoningModel } = require('./lib/providers');
const { createBudget } = require('./lib/budget');

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.join(__dirname, 'dist');
const MAX_BODY = 64 * 1024;
const DEFAULT_GENERATION_TOKEN_LIMIT = 5_000_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

// Настройки читаются из окружения при каждом обращении, поэтому тесты могут менять их на лету.
function getConfig() {
  const env = process.env;
  const hasAnthropicKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
  const hasOpenAiKey = env.OPENAI_API_KEY || env.LLM_API_KEY;
  const provider = env.LLM_PROVIDER || (hasAnthropicKey && !hasOpenAiKey ? 'anthropic' : 'openai');
  const isOpenAi = provider === 'openai';
  const adapter = PROVIDERS[provider];
  const model = (isOpenAi ? env.OPENAI_MODEL : env.ANTHROPIC_MODEL) || adapter?.defaultModel;

  return {
    provider,
    model,
    // LLM_API_KEY и LLM_BASE_URL: общие имена для любого провайдера или шлюза
    apiKey: (isOpenAi ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY) || env.LLM_API_KEY,
    authToken: isOpenAi ? undefined : env.ANTHROPIC_AUTH_TOKEN,
    baseUrl: (isOpenAi ? env.OPENAI_BASE_URL : env.ANTHROPIC_BASE_URL) || env.LLM_BASE_URL || undefined,
    // среднее рассуждение по умолчанию: быстрее и дешевле, чем high
    reasoningEffort: isOpenAi ? env.OPENAI_REASONING_EFFORT || (isReasoningModel(model) ? 'medium' : undefined) : undefined,
    stallMs: Number(env.LLM_STALL_TIMEOUT_MS) || undefined,
    timeLimitMs: Number(env.GENERATION_TIMEOUT_MS) || undefined,
    quality: env.QUALITY === 'standard' ? 'standard' : 'max',
    maxTokens: Number(env.MAX_TOKENS) || undefined,
    maxAttempts: Number(env.MAX_ATTEMPTS) || undefined,
    generationLimit: Number(env.GENERATION_TOKEN_LIMIT) || DEFAULT_GENERATION_TOKEN_LIMIT,
    tokenBudget: Number(env.TOKEN_BUDGET) || 0,
    budgetFile: env.BUDGET_FILE || path.join(__dirname, '.usage.json'),
  };
}

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

const log = (message) => console.log(`${new Date().toLocaleTimeString('ru-RU')} ${message}`);

function usageInfo(config, budget) {
  return { provider: config.provider, model: config.model, ...budget.snapshot() };
}

async function handleGenerate(req, res, budget) {
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

  const config = getConfig();
  try {
    const html = await generateGame({ prompt, audience, previous, change }, { ...config, budget, log });
    return send(res, 200, { html, usage: usageInfo(config, budget) });
  } catch (err) {
    console.error('generate failed:', err.message, err.detail || '');
    if (err.message === 'NO_API_KEY') return send(res, 503, { error: 'NO_API_KEY' });
    if (err.message === 'TOKEN_BUDGET_EXCEEDED') return send(res, 429, { error: err.message, usage: usageInfo(config, budget) });
    return send(res, 502, { error: err.message, usage: usageInfo(config, budget) });
  }
}

function serveStatic(req, res, publicDir) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.normalize(path.join(publicDir, urlPath === '/' ? '/index.html' : urlPath));
  if (!filePath.startsWith(publicDir + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const hint = 'Фронтенд не собран. Выполните npm run build (или запустите npm start).';
      return send(res, 404, urlPath === '/' ? hint : 'Not found', 'text/plain; charset=utf-8');
    }
    send(res, 200, data, MIME[path.extname(filePath)] || 'application/octet-stream');
  });
}

function createServer({ publicDir = DIST_DIR } = {}) {
  const initial = getConfig();
  const budget = createBudget({ limit: initial.tokenBudget, file: initial.budgetFile });

  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/generate') return handleGenerate(req, res, budget);
    if (req.method === 'GET' && req.url === '/api/usage') return send(res, 200, usageInfo(getConfig(), budget));
    if (req.method === 'GET') return serveStatic(req, res, publicDir);
    send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  });
}

if (require.main === module) {
  const config = getConfig();
  createServer().listen(PORT, () => {
    console.log(`Game generator: http://localhost:${PORT}`);
    console.log(`Провайдер: ${config.provider}, модель: ${config.model}, потолок на одну генерацию: ${config.generationLimit.toLocaleString('ru-RU')} токенов, качество: ${config.quality}, рассуждение: ${config.reasoningEffort || 'по умолчанию'}`);
    if (!config.apiKey && !config.authToken) {
      const name = config.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
      console.log(`Внимание: не задан ${name} в файле .env, генерация вернёт ошибку 503.`);
    }
  });
}

module.exports = { createServer };
