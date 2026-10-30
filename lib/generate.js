const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const TIMEOUT_MS = 180000;
const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_MAX_ATTEMPTS = 2;

const AUDIENCES = {
  kids: 'Аудитория: дети. Яркие контрастные цвета, понятные символы, быстрый старт, мягкая сложность.',
  adults: 'Аудитория: взрослые. Обычный современный UI, умеренная сложность.',
  seniors: 'Аудитория: пожилые люди. Крупные кнопки и шрифт (не меньше 24px), высокий контраст, минимум действий, простое управление.',
};

const SYSTEM_PROMPT = `Ты генерируешь браузерные игры для встраивания в WebView.

Правила результата:
- Верни ровно один блок \`\`\`html с полным самодостаточным HTML-документом.
- Игра работает без сети: никаких внешних скриптов, стилей, шрифтов, картинок и запросов fetch/XMLHttpRequest.
- Геймплей на HTML5 Canvas, код на чистом JavaScript.
- Есть экран старта с кнопкой «Старт», геймплей, условие победы или поражения и кнопка «Играть снова».
- Управление: клавиатура (стрелки, WASD) и касания (экранные кнопки или свайп).
- Канвас масштабируется под размер окна, UI на русском языке.
- Код компактный: не больше 250 строк, без лишних комментариев и украшательств.
- Пиши короткие понятные формулировки и не добавляй пояснений вне блока кода.`;

function buildUserMessage({ prompt, audience, previous, change }) {
  const parts = [];
  if (audience && AUDIENCES[audience]) parts.push(AUDIENCES[audience]);

  if (previous && change) {
    parts.push(`Доработай игру ниже по запросу: «${change}».`);
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

function validateGame(html) {
  const errors = [];
  if (!/<canvas/i.test(html)) errors.push('нет элемента canvas');
  if (!/<script/i.test(html)) errors.push('нет скрипта');
  if (/<script[^>]+src=/i.test(html)) errors.push('внешний скрипт');
  if (/(src|href)\s*=\s*["']https?:/i.test(html)) errors.push('внешний ресурс');
  if (/\b(fetch|XMLHttpRequest)\s*\(/.test(html)) errors.push('сетевой запрос');
  return { ok: errors.length === 0, errors };
}

async function callLlm(messages, { apiKey, authToken, model, baseUrl, fetchImpl, maxTokens }) {
  const response = await fetchImpl(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(apiKey && { 'x-api-key': apiKey }),
      ...(authToken && { authorization: `Bearer ${authToken}` }),
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: SYSTEM_PROMPT, messages }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`LLM_HTTP_${response.status}`);

  const data = await response.json();
  if (data.stop_reason === 'max_tokens') throw new Error('RESPONSE_TRUNCATED');
  return data.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
}

async function generateGame(
  input,
  { apiKey, authToken, model, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, maxTokens = DEFAULT_MAX_TOKENS, maxAttempts = DEFAULT_MAX_ATTEMPTS },
) {
  if (!apiKey && !authToken) throw new Error('NO_API_KEY');

  const opts = { apiKey, authToken, model, baseUrl, fetchImpl, maxTokens };
  const messages = [{ role: 'user', content: buildUserMessage(input) }];
  let lastError = 'NO_HTML_IN_RESPONSE';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const text = await callLlm(messages, opts);
    const html = extractHtml(text);
    const check = html ? validateGame(html) : { ok: false, errors: ['нет блока ```html'] };

    if (html && check.ok) return html;

    lastError = html ? `INVALID_GAME: ${check.errors.join(', ')}` : 'NO_HTML_IN_RESPONSE';
    messages.push(
      { role: 'assistant', content: text },
      { role: 'user', content: `Результат не подходит: ${check.errors.join(', ')}. Верни исправленную игру одним блоком \`\`\`html.` },
    );
  }

  throw new Error(lastError);
}

module.exports = { AUDIENCES, SYSTEM_PROMPT, buildUserMessage, extractHtml, validateGame, generateGame };
