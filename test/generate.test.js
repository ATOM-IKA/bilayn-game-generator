const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { buildUserMessage, extractHtml, validateGame, generateGame } = require('../lib/generate');
const { createBudget } = require('../lib/budget');
const { apiUrl } = require('../lib/providers');

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
  assert.equal(sent.body.max_completion_tokens, 128000);
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
  assert.equal(createBudget({ limit: 0, file }).snapshot().remaining, null);
});

test('потолок токенов считается на одну генерацию по всем попыткам', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```html\n<p>нет игры</p>\n```' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 60, completion_tokens: 60, total_tokens: 120 },
      }),
    };
  };
  await assert.rejects(
    generateGame({ prompt: 'x' }, { provider: 'openai', apiKey: 'k', fetchImpl: fakeFetch, generationLimit: 100, maxAttempts: 5 }),
    /GENERATION_TOKEN_LIMIT_EXCEEDED/,
  );
  assert.equal(calls, 1);
});

test('потолок одной генерации по умолчанию 5 000 000 не мешает обычной работе', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: `\`\`\`html\n${GAME}\n\`\`\`` }, finish_reason: 'stop' }],
      usage: { total_tokens: 4_900_000 },
    }),
  });
  assert.equal(await generateGame({ prompt: 'x' }, { provider: 'openai', apiKey: 'k', fetchImpl: fakeFetch }), GAME);
});

test('максимум ответа: 128000 для моделей с рассуждением (gpt-5, gpt-6.1-sol, o3) и 16000 для остальных', async () => {
  const sizes = {};
  const make = (model) => async (url, init) => {
    sizes[model] = JSON.parse(init.body).max_completion_tokens;
    return { ok: true, json: async () => ({ choices: [{ message: { content: `\`\`\`html\n${GAME}\n\`\`\`` }, finish_reason: 'stop' }], usage: { total_tokens: 1 } }) };
  };
  for (const model of ['gpt-5', 'gpt-6.1-sol', 'o3', 'gpt-4.1']) {
    await generateGame({ prompt: 'x' }, { provider: 'openai', apiKey: 'k', model, fetchImpl: make(model) });
  }
  assert.deepEqual(sizes, { 'gpt-5': 128000, 'gpt-6.1-sol': 128000, o3: 128000, 'gpt-4.1': 16000 });
});

function scripted(replies) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body);
    const text = replies[seen.length - 1];
    return { ok: true, json: async () => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { total_tokens: 100 } }) };
  };
  return { fetchImpl, seen };
}

const fence = (html) => `\`\`\`html\n${html}\n\`\`\``;

test('режим max: дизайн-документ, код по нему, затем ревью с улучшенной версией', async () => {
  const improved = GAME.replace('<canvas>', '<canvas id="improved">');
  const { fetchImpl, seen } = scripted(['ДИЗАЙН: змейка с яблоками', fence(GAME), fence(improved)]);

  const html = await generateGame({ prompt: 'змейка' }, { provider: 'openai', apiKey: 'k', quality: 'max', fetchImpl });

  assert.equal(html, improved);
  assert.equal(seen.length, 3);
  const userText = (body, i) => body.messages.filter((m) => m.role === 'user')[i].content;
  assert.match(userText(seen[0], 0), /дизайн-документ/);
  assert.match(userText(seen[1], 0), /ДИЗАЙН: змейка с яблоками/);
  assert.match(userText(seen[2], 1), /строгое ревью/);
});

test('режим max: если ревью сломало игру, остаётся рабочая версия', async () => {
  const { fetchImpl } = scripted(['план', fence(GAME), fence('<p>сломано</p>')]);
  const html = await generateGame({ prompt: 'x' }, { provider: 'openai', apiKey: 'k', quality: 'max', fetchImpl });
  assert.equal(html, GAME);
});

test('режим max: при доработке дизайн-документ не запрашивается', async () => {
  const { fetchImpl, seen } = scripted([fence(GAME), fence(GAME)]);
  await generateGame({ previous: GAME, change: 'кнопки больше' }, { provider: 'openai', apiKey: 'k', quality: 'max', fetchImpl });
  assert.equal(seen.length, 2);
  assert.match(seen[0].messages.find((m) => m.role === 'user').content, /кнопки больше/);
});

test('режим standard делает один запрос', async () => {
  const { fetchImpl, seen } = scripted([fence(GAME)]);
  await generateGame({ prompt: 'x' }, { provider: 'openai', apiKey: 'k', quality: 'standard', fetchImpl });
  assert.equal(seen.length, 1);
});

test('если API отклонил reasoning_effort, запрос повторяется без него', async () => {
  const bodies = [];
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.reasoning_effort) return { ok: false, status: 400, text: async () => "Unsupported value: 'reasoning_effort'" };
    return { ok: true, json: async () => ({ choices: [{ message: { content: `\`\`\`html\n${GAME}\n\`\`\`` }, finish_reason: 'stop' }], usage: { total_tokens: 1 } }) };
  };
  const html = await generateGame({ prompt: 'x' }, { provider: 'openai', apiKey: 'k', fetchImpl: fakeFetch, reasoningEffort: 'max' });
  assert.equal(html, GAME);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].reasoning_effort, undefined);
});

test('если API отклонил слишком большой max_completion_tokens, лимит уменьшается', async () => {
  const sizes = [];
  const fakeFetch = async (url, init) => {
    const size = JSON.parse(init.body).max_completion_tokens;
    sizes.push(size);
    if (size > 32000) return { ok: false, status: 400, text: async () => 'max_completion_tokens is too large: 128000. This model supports at most 32768' };
    return { ok: true, json: async () => ({ choices: [{ message: { content: `\`\`\`html\n${GAME}\n\`\`\`` }, finish_reason: 'stop' }], usage: { total_tokens: 1 } }) };
  };
  await generateGame({ prompt: 'x' }, { provider: 'openai', apiKey: 'k', fetchImpl: fakeFetch, model: 'gpt-6.1-sol' });
  assert.deepEqual(sizes, [128000, 32000]);
});

test('apiUrl учитывает слэш в конце и уже указанный /v1', () => {
  assert.equal(apiUrl('https://gw.example/', '/chat/completions'), 'https://gw.example/v1/chat/completions');
  assert.equal(apiUrl('https://gw.example', '/chat/completions'), 'https://gw.example/v1/chat/completions');
  assert.equal(apiUrl('https://gw.example/v1/', '/chat/completions'), 'https://gw.example/v1/chat/completions');
});

function sse(parts, { finish = 'stop', usage = { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 } } = {}) {
  const events = parts.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  if (finish) events.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`);
  if (usage) events.push(`data: ${JSON.stringify({ choices: [], usage })}\n\n`, 'data: [DONE]\n\n');
  const bytes = new TextEncoder().encode(events.join(''));
  // режем поток на куски по 7 байт, чтобы проверить сборку строк, разорванных между кусками
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7));
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const GAME_REPLY = ['```html\n', GAME, '\n```'];
const openAi = { provider: 'openai', apiKey: 'k', retryDelaysMs: [0, 0, 0] };

test('потоковый ответ OpenAI собирается в игру и учитывает токены', async () => {
  let body;
  const fetchImpl = async (url, init) => {
    body = JSON.parse(init.body);
    return sse(GAME_REPLY);
  };
  const budget = createBudget({ limit: 0, file: path.join(os.tmpdir(), `gf-s-${Date.now()}.json`) });
  const html = await generateGame({ prompt: 'x' }, { ...openAi, fetchImpl, budget });
  assert.equal(html, GAME);
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(budget.used, 20);
});

test('оборванный поток повторяется и затем успешно завершается', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls === 1 ? sse(['```html\n<canv'], { finish: null, usage: null }) : sse(GAME_REPLY));
  assert.equal(await generateGame({ prompt: 'x' }, { ...openAi, fetchImpl }), GAME);
  assert.equal(calls, 2);
});

test('временный сбой шлюза 502 повторяется', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls < 3 ? new Response('Bad gateway', { status: 502 }) : sse(GAME_REPLY));
  assert.equal(await generateGame({ prompt: 'x' }, { ...openAi, fetchImpl }), GAME);
  assert.equal(calls, 3);
});

test('постоянный сбой 524 заканчивается ошибкой LLM_HTTP_524 после повторов', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response('timeout', { status: 524 });
  };
  await assert.rejects(generateGame({ prompt: 'x' }, { ...openAi, fetchImpl }), (err) => err.message === 'LLM_HTTP_524');
  assert.equal(calls, 4);
});

test('сетевая ошибка повторяется, а затем превращается в LLM_NETWORK', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new TypeError('fetch failed', { cause: { message: 'ECONNRESET' } });
  };
  await assert.rejects(
    generateGame({ prompt: 'x' }, { ...openAi, fetchImpl }),
    (err) => err.message === 'LLM_NETWORK' && err.detail === 'ECONNRESET',
  );
  assert.equal(calls, 4);
});

test('401 не повторяется', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response('bad key', { status: 401 });
  };
  await assert.rejects(generateGame({ prompt: 'x' }, { ...openAi, fetchImpl }), /LLM_HTTP_401/);
  assert.equal(calls, 1);
});

test('если шлюз не принимает stream, запрос повторяется без потока', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.stream) return new Response("Unknown parameter: 'stream_options'", { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: GAME_REPLY.join('') }, finish_reason: 'stop' }], usage: { total_tokens: 3 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  assert.equal(await generateGame({ prompt: 'x' }, { ...openAi, fetchImpl }), GAME);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].stream, undefined);
});

test('внутренняя ошибка шлюза посреди потока повторяется', async () => {
  const errorStream = () =>
    new Response(`data: ${JSON.stringify({ error: { code: 'server_error', message: 'could not complete' } })}\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  let calls = 0;
  const fetchImpl = async () => (++calls < 3 ? errorStream() : sse(GAME_REPLY));
  assert.equal(await generateGame({ prompt: 'x' }, { ...openAi, fetchImpl }), GAME);
  assert.equal(calls, 3);
});

test('зависший поток обрывается по таймауту молчания и запрос повторяется', async () => {
  let calls = 0;
  const hanging = () => new Response(new ReadableStream({ start() {} }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const fetchImpl = async () => (++calls === 1 ? hanging() : sse(GAME_REPLY));
  const logs = [];
  const html = await generateGame({ prompt: 'x' }, { ...openAi, fetchImpl, stallMs: 30, log: (m) => logs.push(m) });
  assert.equal(html, GAME);
  assert.equal(calls, 2);
  assert.ok(logs.some((m) => m.includes('повтор')));
  assert.ok(logs.some((m) => m.startsWith('←') && m.includes('токенов')));
});

test('режим max: дизайн и ревью идут с низким рассуждением, код с заданным', async () => {
  const efforts = [];
  const replies = ['план', fence(GAME), fence(GAME)];
  let i = 0;
  const fetchImpl = async (url, init) => {
    efforts.push(JSON.parse(init.body).reasoning_effort);
    return sse([replies[i++]]);
  };
  await generateGame({ prompt: 'x' }, { ...openAi, fetchImpl, quality: 'max', reasoningEffort: 'high' });
  assert.deepEqual(efforts, ['low', 'high', 'low']);
});

test('общий лимит времени: зависший код игры даёт GENERATION_TIMEOUT', async () => {
  const hanging = () => new Response(new ReadableStream({ start() {} }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const started = Date.now();
  await assert.rejects(
    generateGame({ prompt: 'x' }, { ...openAi, fetchImpl: async () => hanging(), timeLimitMs: 300, stallMs: 5000 }),
    (err) => err.message === 'GENERATION_TIMEOUT',
  );
  assert.ok(Date.now() - started < 2000);
});

test('общий лимит времени: если на ревью времени не хватает, возвращается готовая игра', async () => {
  const logs = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return sse([calls === 1 ? 'план' : fence(GAME)]);
  };
  // срок 30 секунд меньше минимального запаса на ревью (60 секунд), поэтому ревью пропускается
  const html = await generateGame({ prompt: 'x' }, { ...openAi, fetchImpl, quality: 'max', timeLimitMs: 30000, log: (m) => logs.push(m) });
  assert.equal(html, GAME);
  assert.equal(calls, 2);
  assert.ok(logs.some((m) => m.includes('ревью пропущено')));
});
