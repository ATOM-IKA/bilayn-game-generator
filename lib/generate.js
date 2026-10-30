const vm = require('node:vm');
const { PROVIDERS } = require('./providers');

const TIMEOUT_MS = 900000;
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

const DESIGN_SYSTEM_PROMPT = `Ты опытный геймдизайнер браузерных игр. Пишешь краткие и конкретные дизайн-документы, по которым разработчик сразу делает игру.`;

function buildDesignRequest({ prompt, audience }) {
  const parts = [];
  if (audience && AUDIENCES[audience]) parts.push(AUDIENCES[audience]);
  parts.push(`Запрос на игру: «${prompt}».`);
  parts.push(`Прежде чем писать код, составь дизайн-документ (до 350 слов): жанр, цель игры, правила победы и поражения, управление клавиатурой и касаниями, механики и рост сложности, визуальный стиль и палитра, эффекты и звук, экран старта и конца, граничные случаи и риски багов. Только текст, без кода.`);
  return parts.join('\n\n');
}

const REVIEW_REQUEST = `Проведи строгое ревью своей игры по чек-листу:
1. Запускается без ошибок в консоли, переменные объявлены, элементы DOM существуют.
2. Рабочий цикл: старт, игра, проигрыш, победа, «Играть снова» с полным сбросом состояния.
3. Управление клавиатурой и касаниями, нет залипания клавиш, большие зоны нажатия.
4. Адаптация к размеру окна и devicePixelRatio, портретный экран 360x640.
5. Нет утечек таймеров и обработчиков при перезапуске, пауза при потере фокуса.
6. Граничные случаи: края поля, одновременные нажатия, быстрые повторные клики.
7. Визуал и отклик: палитра, анимации, частицы, звук, понятные подсказки.
Исправь найденные проблемы и улучшай игру там, где это делает её интереснее. Верни полный файл одним блоком \`\`\`html.`;

function buildUserMessage({ prompt, audience, previous, change }, design) {
  const parts = [];
  if (audience && AUDIENCES[audience]) parts.push(AUDIENCES[audience]);

  if (previous && change) {
    parts.push(`Доработай игру ниже по запросу: «${change}». Внеси только нужные изменения, остальное сохрани рабочим. Верни полный файл целиком.`);
    parts.push(`Текущая игра:\n\`\`\`html\n${previous}\n\`\`\``);
  } else {
    parts.push(`Создай игру по запросу: «${prompt}».`);
    if (design) parts.push(`Дизайн-документ, реализуй игру строго по нему:\n${design}`);
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

function validateGame(html) {
  const errors = [];
  if (!/<canvas/i.test(html)) errors.push('нет элемента canvas');
  if (!/<script/i.test(html)) errors.push('нет скрипта');
  if (/<script[^>]+src=/i.test(html)) errors.push('внешний скрипт');
  if (/(src|href)\s*=\s*["']https?:/i.test(html)) errors.push('внешний ресурс');
  if (/\b(fetch|XMLHttpRequest)\s*\(/.test(html)) errors.push('сетевой запрос');
  if (/\b(alert|confirm|prompt|eval)\s*\(/.test(html)) errors.push('запрещённый вызов alert/confirm/prompt/eval');
  if (!/requestAnimationFrame|setInterval|setTimeout/.test(html)) errors.push('нет игрового цикла');
  if (!/addEventListener\s*\(\s*['"](keydown|pointerdown|touchstart|mousedown|click)|\bonclick\b|\bonpointerdown\b/.test(html)) {
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

async function callLlm(messages, config, system = SYSTEM_PROMPT) {
  const { provider, fetchImpl, budget, onUsage } = config;
  const adapter = PROVIDERS[provider];
  budget?.assertAvailable();
  config.beforeCall?.();

  const request = adapter.buildRequest({ ...config, system, messages });
  const response = await fetchImpl(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw Object.assign(new Error(`LLM_HTTP_${response.status}`), { detail });
  }

  const parsed = adapter.parseResponse(await response.json());
  budget?.add(parsed.usage.total);
  onUsage?.(parsed.usage);

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

  // Этап 1 (максимальное качество): дизайн-документ
  const design = maxQuality && isNewGame
    ? (await callLlm([{ role: 'user', content: buildDesignRequest(input) }], config, DESIGN_SYSTEM_PROMPT)).trim()
    : '';

  // Этап 2: код игры, с исправлением по результатам проверки
  const messages = [{ role: 'user', content: buildUserMessage(input, design) }];
  let lastError = 'NO_HTML_IN_RESPONSE';
  let built = null;
  let builtText = '';

  for (let attempt = 1; attempt <= maxAttempts && !built; attempt++) {
    const text = await callLlm(messages, config);
    const html = extractHtml(text);
    const check = html ? validateGame(html) : { ok: false, errors: ['нет блока ```html'] };

    if (html && check.ok) {
      built = html;
      builtText = text;
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

  // Этап 3: ревью и улучшение. Если не вышло, остаётся рабочая версия с этапа 2.
  try {
    const reviewText = await callLlm(
      [...messages, { role: 'assistant', content: builtText }, { role: 'user', content: REVIEW_REQUEST }],
      config,
    );
    const reviewed = extractHtml(reviewText);
    if (reviewed && validateGame(reviewed).ok) return reviewed;
  } catch {
    // ревью необязательно: рабочая игра важнее
  }
  return built;
}

module.exports = { AUDIENCES, SYSTEM_PROMPT, buildUserMessage, extractHtml, validateGame, generateGame };
