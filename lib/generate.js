const vm = require('node:vm');
const { PROVIDERS } = require('./providers');

const TIMEOUT_MS = 300000;
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

function buildUserMessage({ prompt, audience, previous, change }) {
  const parts = [];
  if (audience && AUDIENCES[audience]) parts.push(AUDIENCES[audience]);

  if (previous && change) {
    parts.push(`Доработай игру ниже по запросу: «${change}». Внеси только нужные изменения, остальное сохрани рабочим. Верни полный файл целиком.`);
    parts.push(`Текущая игра:\n\`\`\`html\n${previous}\n\`\`\``);
  } else {
    parts.push(`Создай игру по запросу: «${prompt}».`);
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

async function callLlm(messages, config) {
  const { provider, fetchImpl, budget, onUsage } = config;
  const adapter = PROVIDERS[provider];
  budget?.assertAvailable();
  config.beforeCall?.();

  const request = adapter.buildRequest({ ...config, system: SYSTEM_PROMPT, messages });
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

  const messages = [{ role: 'user', content: buildUserMessage(input) }];
  let lastError = 'NO_HTML_IN_RESPONSE';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const text = await callLlm(messages, config);
    const html = extractHtml(text);
    const check = html ? validateGame(html) : { ok: false, errors: ['нет блока ```html'] };

    if (html && check.ok) return html;

    lastError = html ? `INVALID_GAME: ${check.errors.join(', ')}` : 'NO_HTML_IN_RESPONSE';
    messages.push(
      { role: 'assistant', content: text },
      { role: 'user', content: `В игре найдены проблемы: ${check.errors.join('; ')}. Исправь их и верни полный файл одним блоком \`\`\`html.` },
    );
  }

  throw new Error(lastError);
}

module.exports = { AUDIENCES, SYSTEM_PROMPT, buildUserMessage, extractHtml, validateGame, generateGame };
