const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

process.env.BUDGET_FILE = path.join(os.tmpdir(), `gf-srv-${Date.now()}.json`);
const PUBLIC = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-'));
fs.writeFileSync(path.join(PUBLIC, 'index.html'), '<div id="root">Игра по одному предложению</div>');

function listen(server) {
  return new Promise((resolve) => server.listen(0, () => resolve(`http://localhost:${server.address().port}`)));
}

async function withServer(fn) {
  const server = createServer({ publicDir: PUBLIC });
  const base = await listen(server);
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const post = (base, body) =>
  fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('отдаёт главную страницу', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Игра по одному предложению/);
  });
});

test('не отдаёт файлы за пределами public', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/..%2Fserver.js`);
    assert.notEqual(res.status, 200);
  });
});

test('пустой промпт возвращает 400', async () => {
  await withServer(async (base) => {
    const res = await post(base, { prompt: '   ' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'EMPTY_PROMPT');
  });
});

test('доработка без предыдущей игры возвращает 400', async () => {
  await withServer(async (base) => {
    const res = await post(base, { change: 'больше кнопки' });
    assert.equal(res.status, 400);
  });
});

test('без ANTHROPIC_API_KEY генерация возвращает 503', async () => {
  const saved = { ...process.env };
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'LLM_PROVIDER']) delete process.env[name];
  try {
    await withServer(async (base) => {
      const res = await post(base, { prompt: 'змейка' });
      assert.equal(res.status, 503);
    });
  } finally {
    process.env = saved;
  }
});

test('GET /api/usage отдаёт провайдера, модель и расход без общего лимита', async () => {
  const saved = { ...process.env };
  delete process.env.TOKEN_BUDGET;
  process.env.LLM_PROVIDER = 'openai';
  try {
    await withServer(async (base) => {
      const data = await (await fetch(`${base}/api/usage`)).json();
      assert.equal(data.provider, 'openai');
      assert.equal(data.model, 'gpt-5');
      assert.equal(data.limit, 0);
      assert.equal(data.used, 0);
    });
  } finally {
    process.env = saved;
  }
});

test('при исчерпанном бюджете генерация возвращает 429', async () => {
  const saved = { ...process.env };
  process.env.OPENAI_API_KEY = 'k';
  process.env.LLM_PROVIDER = 'openai';
  process.env.TOKEN_BUDGET = '1';
  process.env.BUDGET_FILE = path.join(os.tmpdir(), `gf-full-${Date.now()}.json`);
  fs.writeFileSync(process.env.BUDGET_FILE, JSON.stringify({ used: 5 }));
  try {
    await withServer(async (base) => {
      const res = await post(base, { prompt: 'змейка' });
      assert.equal(res.status, 429);
      assert.equal((await res.json()).error, 'TOKEN_BUDGET_EXCEEDED');
    });
  } finally {
    process.env = saved;
  }
});
