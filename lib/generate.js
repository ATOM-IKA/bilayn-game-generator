const vm = require('node:vm');
const { PROVIDERS } = require('./providers');

const TIMEOUT_MS = 900000;
const DEFAULT_STALL_MS = 180000;
const DEFAULT_TIME_LIMIT_MS = 900000;
const MIN_REVIEW_MS = 60000;
const DEFAULT_REVIEW_MS = 240000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_GENERATION_TOKEN_LIMIT = 5_000_000;

const AUDIENCES = {
  kids: 'Аудитория: дети. Яркие контрастные цвета, крупные дружелюбные персонажи, мягкая сложность, много поощрений и анимации за успехи.',
  adults: 'Аудитория: взрослые. Чистый современный интерфейс, умеренная сложность, интересные механики и рекорды.',
  seniors: 'Аудитория: пожилые люди. Шрифт не меньше 24px, высокий контраст, крупные кнопки (не меньше 80px), спокойный темп, без внезапных штрафов, минимум действий.',
};

const SYSTEM_PROMPT = `Ты старший разработчик браузерных игр. Твои игры приятно показать заказчику: красивые, отзывчивые, с понятным и увлекательным геймплеем.

ФОРМАТ ОТВЕТА
- Верни ровно один блок \`\`\`html с полным HTML-документом и ничего кроме него.
- Один файл: HTML, CSS и JavaScript вместе. Никаких внешних скриптов, шрифтов, картинок, CDN и сетевых запросов (fetch, XMLHttpRequest, WebSocket). Игра работает офлайн в WebView.
- Только чистый JavaScript и Canvas 2D, без библиотек. Код аккуратный, до 500 строк, без заглушек и TODO.

ГЕЙМПЛЕЙ
- Экран старта: название игры, короткая подсказка по управлению и большая кнопка «Играть».
- Игровой цикл на requestAnimationFrame с расчётом времени кадра (dt не больше 0.05 с), скорость не зависит от частоты кадров.
- Понятные цели и правила: счёт, при необходимости жизни, таймер или уровни. Сложность растёт плавно.
- Конец игры: экран победы или поражения с итоговым счётом, рекордом и кнопкой «Играть снова». Рекорд хранится в localStorage внутри try/catch (хранилище может быть недоступно). Повторный запуск полностью сбрасывает состояние.
- Игра ставится на паузу, когда вкладка скрыта или окно потеряло фокус.

УПРАВЛЕНИЕ И ЭКРАН
- Клавиатура (стрелки, WASD, пробел) и касания (pointer events, свайпы или экранные кнопки не меньше 64px). Для касаний: touch-action: none на canvas. Не используй hover.
- Canvas заполняет окно, учитывай devicePixelRatio и событие resize. Игра играбельна в портретном окне 360x640 и на десктопе.
- Стили body: margin 0, overflow hidden, user-select none. Обязателен мета-тег viewport.

ВИЗУАЛ И ОТКЛИК
- Продуманная палитра из 2-4 цветов, градиентный фон, скруглённые формы, тени или свечение. Не оставляй чёрные прямоугольники и цвета по умолчанию.
- Живость: частицы при событиях, плавное движение, лёгкая тряска экрана при ударе, всплывающие очки.
- Звук через Web Audio API: короткие синтезированные сигналы (очко, ошибка, победа). Запускай AudioContext после первого касания, не падай, если он недоступен, и добавь кнопку выключения звука.
- Весь интерфейс на русском языке.

НАДЁЖНОСТЬ (главное: игра должна запуститься с первого раза)
- Никаких синтаксических ошибок. Все переменные объявлены до использования, все элементы DOM существуют к моменту обращения.
- Не используй alert, confirm, prompt, eval и внешние ресурсы.
- Перед ответом мысленно проверь: игру можно начать, играть, проиграть и выиграть, а «Играть снова» работает без утечек таймеров и обработчиков.

МЕХАНИКА ПО ЖАНРАМ
- Змейка: сетка, очередь поворотов, запрет разворота на 180 градусов, еда не появляется на змейке.
- Падающие блоки: фигуры, вращение, удаление линий, ускорение с уровнем.
- Кликер: большая цель, улучшения за очки, плавный рост цен, сохранение прогресса.
- Парные карточки и головоломки: сетка, анимация переворота, счётчик ходов, перемешивание Фишера-Йетса.
- Платформер и раннер: гравитация, прыжок, столкновения AABB, процедурная генерация препятствий.
- Аркада и шутер: игрок, пули, враги волнами, столкновения, жизни.
- Арканоид: мяч, платформа, кирпичи, отскок с учётом точки удара.
- Если жанр в запросе не указан, выбери подходящий и сделай его качественно.`;

const PLAN_INSTRUCTION = `Сначала кратко (до 150 слов) опиши план в блоке \`\`\`text: жанр, цель, правила победы и поражения, управление, визуальный стиль, риски багов. Затем верни игру строго по этому плану одним блоком \`\`\`html.`;

const REVIEW_REQUEST = `Проведи строгое ревью игры выше по чек-листу:
1. Запускается без ошибок в консоли, переменные объявлены, элементы DOM существуют.
2. Рабочий цикл: старт, игра, проигрыш, победа, «Играть снова» с полным сбросом состояния.
3. Управление клавиатурой и касаниями, нет залипания клавиш, большие зоны нажатия.
4. Адаптация к размеру окна и devicePixelRatio, портретный экран 360x640.
5. Нет утечек таймеров и обработчиков при перезапуске, пауза при потере фокуса.
6. Граничные случаи: края поля, одновременные нажатия, быстрые повторные клики.
7. Визуал и отклик: палитра, анимации, частицы, звук, понятные подсказки.
Исправь найденные проблемы и улучшай игру там, где это делает её интереснее. Верни полный файл одним блоком \`\`\`html.`;

function buildReviewMessage({ prompt, audience, change }, html) {
  const parts = [];
  if (audience && AUDIENCES[audience]) parts.push(AUDIENCES[audience]);
  parts.push(change ? `Игра доработана по запросу: «${change}».` : `Игра создана по запросу: «${prompt}».`);
  parts.push(`Игра:\n\`\`\`html\n${html}\n\`\`\``);
  parts.push(REVIEW_REQUEST);
  return parts.join('\n\n');
}

function buildUserMessage({ prompt, audience, previous, change }, withPlan) {
  const parts = [];
  if (audience && AUDIENCES[audience]) parts.push(AUDIENCES[audience]);

  if (previous && change) {
    parts.push(`Доработай игру ниже по запросу: «${change}». Внеси только нужные изменения, остальное сохрани рабочим. Верни полный файл целиком.`);
    parts.push(`Текущая игра:\n\`\`\`html\n${previous}\n\`\`\``);
  } else {
    parts.push(`Создай игру по запросу: «${prompt}».`);
    if (withPlan) parts.push(PLAN_INSTRUCTION);
  }
  return parts.join('\n\n');
}

function extractHtml(text) {
  const fenced = text.match(/```html\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = text.search(/<!doctype html|<html/i);
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (start !== -1 && end > start) return text.slice(start, end + '</html>'.length).trim();

  return null;
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
}

// Слабые эвристики: на последней попытке игра принимается, если других ошибок нет.
const SOFT_ERROR = /игрового цикла|обработки ввода/;

function validateGame(html) {
  const errors = [];
  if (!/<canvas/i.test(html)) errors.push('нет элемента canvas');
  if (!/<script/i.test(html)) errors.push('нет скрипта');
  if (/<script[^>]+src=/i.test(html)) errors.push('внешний скрипт');
  if (/(src|href)\s*=\s*["']https?:/i.test(html)) errors.push('внешний ресурс');
  if (/\b(fetch|XMLHttpRequest)\s*\(/.test(html)) errors.push('сетевой запрос');
  if (/\b(alert|confirm|prompt|eval)\s*\(/.test(html)) errors.push('запрещённый вызов alert/confirm/prompt/eval');
  if (!/requestAnimationFrame|setInterval|setTimeout/.test(html)) errors.push('нет игрового цикла');
  if (!/addEventListener\s*\(\s*['"](key|pointer|touch|mouse|click)|\bon(click|key|pointer|touch|mouse)\w*\s*=/.test(html)) {
    errors.push('нет обработки ввода');
  }

  inlineScripts(html).forEach((code) => {
    try {
      new vm.Script(code);
    } catch (err) {
      errors.push(`синтаксическая ошибка JavaScript: ${err.message}`);
    }
  });

  return { ok: errors.length === 0, errors };
}

const TRANSIENT_STATUSES = [500, 502, 503, 504, 520, 521, 522, 523, 524];
const RETRY_DELAYS_MS = [2000, 5000, 10000];

function adjustParams(params, detail) {
  if (params.stream && /stream/i.test(detail)) return { stream: false };
  if (params.reasoningEffort && /reasoning/i.test(detail)) return { reasoningEffort: undefined };
  if (/max_(completion_)?tokens|maximum.*tokens|output.*limit/i.test(detail) && params.maxTokens > 16000) {
    return { maxTokens: params.maxTokens > 32000 ? 32000 : 16000 };
  }
  return null;
}

// Временный сбой: сеть, обрыв потока или перегрузка шлюза. Такой запрос стоит повторить.
function isTransient(err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return false;
  return TRANSIENT_STATUSES.includes(err.status) || ['LLM_STREAM_INTERRUPTED', 'LLM_STREAM_ERROR'].includes(err.message) || err.name === 'TypeError';
}

// Собирает потоковый ответ (SSE) в обычный объект ответа Chat Completions.
// Ждёт очередной кусок потока, но не дольше stallMs и не дольше общего срока генерации.
function readWithStall(reader, stallMs, deadline) {
  return new Promise((resolve, reject) => {
    const remaining = Math.max(1, deadline - Date.now());
    const byDeadline = remaining <= stallMs;
    const timer = setTimeout(() => {
      reader.cancel().catch(() => {});
      reject(new Error(byDeadline ? 'GENERATION_TIMEOUT' : 'LLM_STREAM_INTERRUPTED'));
    }, Math.min(stallMs, remaining));
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function readStream(response, stallMs, deadline) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason = null;
  let usage = null;

  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }
    if (chunk.error) throw Object.assign(new Error('LLM_STREAM_ERROR'), { detail: JSON.stringify(chunk.error).slice(0, 500) });
    const choice = chunk.choices?.[0];
    if (choice?.delta?.content) content += choice.delta.content;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  };

  for (;;) {
    const { done, value } = await readWithStall(reader, stallMs, deadline);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach(handle);
  }
  handle(buffer);

  // поток закончился без причины остановки: соединение оборвали на полпути
  if (!finishReason) throw new Error('LLM_STREAM_INTERRUPTED');
  return { choices: [{ message: { content }, finish_reason: finishReason }], usage };
}

async function requestOnce(adapter, config, params, system, messages) {
  const request = adapter.buildRequest({ ...config, ...params, system, messages });
  const response = await config.fetchImpl(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(Math.max(1, Math.min(TIMEOUT_MS, config.deadline - Date.now()))),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw Object.assign(new Error(`LLM_HTTP_${response.status}`), { status: response.status, detail });
  }
  const isStream = (response.headers?.get?.('content-type') || '').includes('text/event-stream');
  return isStream ? readStream(response, config.stallMs || DEFAULT_STALL_MS, config.deadline) : response.json();
}

async function callLlm(messages, config, system = SYSTEM_PROMPT, { stage = 'запрос', effort } = {}) {
  const { provider, budget, onUsage, log } = config;
  const adapter = PROVIDERS[provider];
  budget?.assertAvailable();
  config.beforeCall?.();
  if (config.deadline - Date.now() <= 0) throw new Error('GENERATION_TIMEOUT');

  const reasoningEffort = config.reasoningEffort ? effort || config.reasoningEffort : undefined;
  const startedAt = Date.now();
  log?.(`→ ${stage}: запрос к ${config.model} (рассуждение: ${reasoningEffort || 'нет'})`);
  const params = { reasoningEffort, maxTokens: config.maxTokens, stream: provider === 'openai' && config.stream !== false };
  const delays = config.retryDelaysMs || RETRY_DELAYS_MS;
  let paramFixes = 0;
  let transientRetries = 0;
  let data;

  for (;;) {
    try {
      data = await requestOnce(adapter, config, params, system, messages);
      break;
    } catch (err) {
      // API отклонил параметр (HTTP 400/422): повторяем без него или с меньшим лимитом
      const fix = [400, 422].includes(err.status) && paramFixes < 3 ? adjustParams(params, err.detail || '') : null;
      if (fix) {
        Object.assign(params, fix);
        paramFixes++;
        continue;
      }
      const timedOut = err.name === 'TimeoutError' || config.deadline - Date.now() <= 0;
      if (isTransient(err) && transientRetries < delays.length && !timedOut) {
        log?.(`↻ ${stage}: временный сбой (${err.message}), повтор ${transientRetries + 1} из ${delays.length}`);
        await new Promise((resolve) => setTimeout(resolve, delays[transientRetries++]));
        continue;
      }
      if (err.name === 'TimeoutError') {
        const overDeadline = config.deadline - Date.now() <= 1000;
        throw Object.assign(new Error(overDeadline ? 'GENERATION_TIMEOUT' : 'LLM_TIMEOUT'), { detail: err.message });
      }
      if (err.name === 'TypeError') throw Object.assign(new Error('LLM_NETWORK'), { detail: err.cause?.message || err.message });
      throw err;
    }
  }

  const parsed = adapter.parseResponse(data);
  budget?.add(parsed.usage.total);
  onUsage?.(parsed.usage);
  log?.(`← ${stage}: готово за ${Math.round((Date.now() - startedAt) / 1000)} с, токенов: ${parsed.usage.total}`);

  if (parsed.truncated) throw new Error('RESPONSE_TRUNCATED');
  return parsed.text;
}

async function generateGame(input, options) {
  const provider = options.provider || 'anthropic';
  const adapter = PROVIDERS[provider];
  if (!adapter) throw new Error(`UNKNOWN_PROVIDER: ${provider}`);
  if (!options.apiKey && !options.authToken) throw new Error('NO_API_KEY');

  const model = options.model || adapter.defaultModel;
  const generationLimit = options.generationLimit || DEFAULT_GENERATION_TOKEN_LIMIT;
  let spent = 0;

  const config = {
    ...options,
    provider,
    model,
    baseUrl: options.baseUrl || adapter.defaultBaseUrl,
    maxTokens: options.maxTokens || adapter.defaultMaxTokens(model),
    fetchImpl: options.fetchImpl || fetch,
    // общий срок на всю генерацию (все этапы и повторы вместе)
    deadline: Date.now() + (options.timeLimitMs || DEFAULT_TIME_LIMIT_MS),
    // потолок на одну генерацию считается по всем попыткам вместе
    beforeCall: () => {
      if (spent >= generationLimit) throw new Error('GENERATION_TOKEN_LIMIT_EXCEEDED');
    },
    onUsage: (usage) => {
      spent += usage.total;
      options.onUsage?.(usage);
    },
  };
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;

  const isNewGame = !(input.previous && input.change);
  const maxQuality = options.quality === 'max';

  // Этап 1: план и код игры одним запросом, с исправлением по результатам проверки
  const messages = [{ role: 'user', content: buildUserMessage(input, maxQuality && isNewGame) }];
  let lastError = 'NO_HTML_IN_RESPONSE';
  let built = null;

  for (let attempt = 1; attempt <= maxAttempts && !built; attempt++) {
    const text = await callLlm(messages, config, SYSTEM_PROMPT, { stage: maxQuality ? `этап 1 из 2, код игры (попытка ${attempt})` : `код игры (попытка ${attempt})` });
    const html = extractHtml(text);
    const check = html ? validateGame(html) : { ok: false, errors: ['нет блока ```html'] };

    const onlySoftErrors = html && !check.ok && check.errors.every((e) => SOFT_ERROR.test(e));
    if (html && (check.ok || (onlySoftErrors && attempt === maxAttempts))) {
      if (!check.ok) config.log?.(`⚠ игра принята с замечаниями: ${check.errors.join('; ')}`);
      built = html;
      break;
    }

    lastError = html ? `INVALID_GAME: ${check.errors.join(', ')}` : 'NO_HTML_IN_RESPONSE';
    messages.push(
      { role: 'assistant', content: text },
      { role: 'user', content: `В игре найдены проблемы: ${check.errors.join('; ')}. Исправь их и верни полный файл одним блоком \`\`\`html.` },
    );
  }

  if (!built) throw new Error(lastError);
  if (!maxQuality) return built;

  // Этап 2: ревью и улучшение. Если не вышло или не хватает времени, остаётся рабочая версия с этапа 1.
  if (config.deadline - Date.now() < MIN_REVIEW_MS) {
    config.log?.('⏱ ревью пропущено: не хватает времени до лимита');
    return built;
  }
  try {
    // Ревью получает только запрос и готовую игру, без истории: так вход в несколько раз короче.
    // у ревью свой лимит времени: оно не должно затягивать уже готовую игру
    const reviewConfig = { ...config, deadline: Math.min(config.deadline, Date.now() + (options.reviewTimeMs || DEFAULT_REVIEW_MS)) };
    const reviewText = await callLlm(
      [{ role: 'user', content: buildReviewMessage(input, built) }],
      reviewConfig,
      SYSTEM_PROMPT,
      { stage: 'этап 2 из 2, ревью и улучшение', effort: 'low' },
    );
    const reviewed = extractHtml(reviewText);
    if (reviewed && validateGame(reviewed).ok) return reviewed;
  } catch {
    // ревью необязательно: рабочая игра важнее
  }
  return built;
}

module.exports = { AUDIENCES, SYSTEM_PROMPT, buildUserMessage, extractHtml, validateGame, generateGame };
