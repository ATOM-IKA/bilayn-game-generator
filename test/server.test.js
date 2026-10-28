const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

function listen(server) {
  return new Promise((resolve) => server.listen(0, () => resolve(`http://localhost:${server.address().port}`)));
}

async function withServer(fn) {
  const server = createServer();
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
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await withServer(async (base) => {
      const res = await post(base, { prompt: 'змейка' });
      assert.equal(res.status, 503);
    });
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});
