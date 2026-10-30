const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { buildUserMessage, extractHtml, validateGame, generateGame } = require('../lib/generate');
const { createBudget } = require('../lib/budget');

const GAME =
  '<!doctype html><html><body><canvas></canvas><script>addEventListener("keydown", () => {}); requestAnimationFrame(() => {});</script></body></html>';

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

test('generateGame с authToken шлёт заголовок Authorization и работает без apiKey', async () => {
  let headers;
  const fakeFetch = async (url, init) => {
    headers = init.headers;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: `\`\`\`html\n${GAME}\n\`\`\`` }] }) };
  };
  await generateGame({ prompt: 'x' }, { authToken: 't', model: 'm', fetchImpl: fakeFetch });
  assert.equal(headers.authorization, 'Bearer t');
  assert.equal(headers['x-api-key'], undefined);
});

test('validateGame находит синтаксическую ошибку JavaScript', () => {
  const bad = GAME.replace('requestAnimationFrame(() => {});', 'function (');
  const result = validateGame(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /синтаксическая ошибка/);
});

test('validateGame требует игровой цикл, ввод и запрещает alert', () => {
  const noLoop = '<canvas></canvas><script>addEventListener("click", () => {});</script>';
  assert.match(validateGame(noLoop).errors.join(), /игрового цикла/);
  const noInput = '<canvas></canvas><script>requestAnimationFrame(() => {});</script>';
  assert.match(validateGame(noInput).errors.join(), /обработки ввода/);
  assert.match(validateGame(GAME.replace('() => {}', 'alert(1)')).errors.join(), /alert/);
});

test('OpenAI: запрос идёт в chat/completions, токены учитываются в бюджете', async () => {
  let sent;
  const used = [];
  const fakeFetch = async (url, init) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: `\`\`\`html\n${GAME}\n\`\`\`` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    };
  };
  const budget = createBudget({ limit: 100, file: path.join(os.tmpdir(), `gf-b-${Date.now()}.json`) });

  const html = await generateGame(
    { prompt: 'змейка' },
    { provider: 'openai', apiKey: 'sk-test', model: 'gpt-5', fetchImpl: fakeFetch, budget, onUsage: (u) => used.push(u), reasoningEffort: 'low' },
  );

  assert.equal(html, GAME);
  assert.equal(sent.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(sent.headers.authorization, 'Bearer sk-test');
  assert.equal(sent.body.model, 'gpt-5');
  assert.equal(sent.body.max_completion_tokens, 32000);
  assert.equal(sent.body.reasoning_effort, 'low');
  assert.equal(sent.body.messages[0].role, 'system');
  assert.match(sent.body.messages[1].content, /змейка/);
  assert.equal(budget.used, 30);
  assert.deepEqual(used, [{ input: 10, output: 20, total: 30 }]);
});

test('OpenAI: finish_reason=length даёт RESPONSE_TRUNCATED', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { total_tokens: 5 } }),
  });
  await assert.rejects(
    generateGame({ prompt: 'x' }, { provider: 'openai', apiKey: 'k', fetchImpl: fakeFetch }),
    /RESPONSE_TRUNCATED/,
  );
});

test('ошибка HTTP сохраняет тело ответа в detail', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'Incorrect API key' });
  await assert.rejects(
    generateGame({ prompt: 'x' }, { provider: 'openai', apiKey: 'k', fetchImpl: fakeFetch }),
    (err) => err.message === 'LLM_HTTP_401' && err.detail === 'Incorrect API key',
  );
});

test('бюджет токенов блокирует запрос, когда лимит исчерпан', async () => {
  const budget = createBudget({ limit: 10, file: path.join(os.tmpdir(), `gf-b2-${Date.now()}.json`) });
  budget.add(10);
  let called = false;
  const fakeFetch = async () => {
    called = true;
  };
  await assert.rejects(
    generateGame({ prompt: 'x' }, { apiKey: 'k', fetchImpl: fakeFetch, budget }),
    /TOKEN_BUDGET_EXCEEDED/,
  );
  assert.equal(called, false);
});

test('бюджет токенов сохраняется в файл и читается заново', () => {
  const file = path.join(os.tmpdir(), `gf-b3-${Date.now()}.json`);
  createBudget({ limit: 5_000_000, file }).add(1234);
  const again = createBudget({ limit: 5_000_000, file });
  assert.deepEqual(again.snapshot(), { used: 1234, limit: 5_000_000, remaining: 4_998_766 });
});
