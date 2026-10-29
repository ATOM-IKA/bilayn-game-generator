const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUserMessage, extractHtml, validateGame, generateGame } = require('../lib/generate');

const GAME = '<!doctype html><html><body><canvas></canvas><script>console.log(1)</script></body></html>';

test('extractHtml берёт содержимое блока ```html', () => {
  const text = `Вот игра:\n\`\`\`html\n${GAME}\n\`\`\`\nГотово.`;
  assert.equal(extractHtml(text), GAME);
});

test('extractHtml без блока находит документ по тегам html', () => {
  assert.equal(extractHtml(`текст ${GAME} хвост`), GAME);
});

test('extractHtml возвращает null, если HTML нет', () => {
  assert.equal(extractHtml('просто текст'), null);
});

test('validateGame принимает самодостаточную игру', () => {
  assert.deepEqual(validateGame(GAME), { ok: true, errors: [] });
});

test('validateGame отклоняет внешний скрипт и сеть', () => {
  const bad = '<canvas></canvas><script src="https://cdn.example.com/x.js"></script>';
  assert.equal(validateGame(bad).ok, false);
  assert.match(validateGame(bad).errors.join(), /внешний скрипт/);

  const net = '<canvas></canvas><script>fetch("/api")</script>';
  assert.match(validateGame(net).errors.join(), /сетевой запрос/);
});

test('validateGame требует canvas', () => {
  assert.match(validateGame('<script></script>').errors.join(), /canvas/);
});

test('buildUserMessage для новой игры содержит промпт и аудиторию', () => {
  const msg = buildUserMessage({ prompt: 'змейка', audience: 'seniors' });
  assert.match(msg, /змейка/);
  assert.match(msg, /пожилые/);
});

test('buildUserMessage для доработки передаёт текущую игру и правку', () => {
  const msg = buildUserMessage({ previous: GAME, change: 'кнопки больше' });
  assert.match(msg, /кнопки больше/);
  assert.ok(msg.includes(GAME));
});

test('generateGame без ключа бросает NO_API_KEY', async () => {
  await assert.rejects(generateGame({ prompt: 'x' }, { apiKey: '' }), /NO_API_KEY/);
});

test('generateGame возвращает валидный HTML из ответа LLM (fetch подменён)', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: `\`\`\`html\n${GAME}\n\`\`\`` }] }),
    };
  };

  const html = await generateGame({ prompt: 'змейка' }, { apiKey: 'k', model: 'm', fetchImpl: fakeFetch });

  assert.equal(html, GAME);
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.headers['x-api-key'], 'k');
  assert.equal(sent.body.model, 'm');
  assert.match(sent.body.messages[0].content, /змейка/);
});

test('generateGame повторяет запрос, если первый ответ невалиден', async () => {
  const replies = ['```html\n<p>нет игры</p>\n```', `\`\`\`html\n${GAME}\n\`\`\``];
  let calls = 0;
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: replies[calls++] }] }),
  });

  const html = await generateGame({ prompt: 'x' }, { apiKey: 'k', model: 'm', fetchImpl: fakeFetch });
  assert.equal(html, GAME);
  assert.equal(calls, 2);
});

test('generateGame отклоняет невалидный ответ', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: '```html\n<p>нет игры</p>\n```' }] }),
  });
  await assert.rejects(
    generateGame({ prompt: 'x' }, { apiKey: 'k', model: 'm', fetchImpl: fakeFetch }),
    /INVALID_GAME/,
  );
});

test('generateGame передаёт maxTokens и не повторяет запрос при maxAttempts=1', async () => {
  let calls = 0;
  let sentMax;
  const fakeFetch = async (url, init) => {
    calls++;
    sentMax = JSON.parse(init.body).max_tokens;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: '```html\n<p>нет игры</p>\n```' }] }) };
  };
  await assert.rejects(
    generateGame({ prompt: 'x' }, { apiKey: 'k', model: 'm', fetchImpl: fakeFetch, maxTokens: 8000, maxAttempts: 1 }),
    /INVALID_GAME/,
  );
  assert.equal(calls, 1);
  assert.equal(sentMax, 8000);
});
