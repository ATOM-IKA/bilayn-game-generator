const API_URL = 'https://api.anthropic.com/v1/messages';

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

async function generateGame(input, { apiKey, model, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('NO_API_KEY');

  const response = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(input) }],
    }),
  });

  if (!response.ok) throw new Error(`LLM_HTTP_${response.status}`);

  const data = await response.json();
  const text = data.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');

  const html = extractHtml(text);
  if (!html) throw new Error('NO_HTML_IN_RESPONSE');

  const check = validateGame(html);
  if (!check.ok) throw new Error(`INVALID_GAME: ${check.errors.join(', ')}`);

  return html;
}

module.exports = { AUDIENCES, SYSTEM_PROMPT, buildUserMessage, extractHtml, validateGame, generateGame };
