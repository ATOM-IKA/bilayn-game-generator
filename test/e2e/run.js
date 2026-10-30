// Сквозная проверка: UI -> сервер -> (поддельный LLM) -> iframe с игрой.
// Реальный LLM не вызывается, ответ берётся из snake.html. Нужен Chromium (CHROMIUM_PATH).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createServer } = require('../../server');

const GAME = fs.readFileSync(path.join(__dirname, 'snake.html'), 'utf8');
const CHROMIUM = process.env.CHROMIUM_PATH || '/snap/bin/chromium';

const received = [];
const fakeLlm = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    received.push({ ...JSON.parse(raw), auth: req.headers.authorization, url: req.url });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: `\`\`\`html\n${GAME}\n\`\`\`` }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 900, total_tokens: 1000 },
    }));
  });
});

const userText = (r) => r.messages.find((m) => m.role === 'user').content;
const listen = (server) => new Promise((resolve) => server.listen(0, () => resolve(server.address().port)));

(async () => {
  const llmPort = await listen(fakeLlm);
  process.env.LLM_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = `http://localhost:${llmPort}`;
  process.env.BUDGET_FILE = path.join(require('node:os').tmpdir(), `gf-e2e-${Date.now()}.json`);
  const app = createServer();
  const appPort = await listen(app);

  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`http://localhost:${appPort}/`);
  await page.fill('#prompt', 'замути змейку для бабушки');
  await page.click('[data-audience="seniors"]');
  await page.click('#generate');
  await page.waitForSelector('#game', { timeout: 15000 });

  const frame = page.frameLocator('#game');
  await page.waitForTimeout(500); // ждём выполнения скрипта игры в iframe
  await frame.locator('#start').click();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(500);
  const painted = await frame.locator('#c').evaluate((cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4) colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return [colors.size, getComputedStyle(document.getElementById('ui')).display, document.getElementById('msg').textContent];
  });

  await page.fill('#change', 'сделай кнопки больше');
  await page.click('#iterate');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Игра обновлена.');

  const badge = (await page.textContent('#usage')).replace(/\s+/g, ' ');
  await browser.close();
  app.close();
  fakeLlm.close();

  const checks = [
    ['запрос ушёл в LLM с промптом и аудиторией', /змейку/.test(userText(received[0])) && /пожилые/.test(userText(received[0]))],
    ['запрос ушёл по пути OpenAI с ключом', received[0].url === '/v1/chat/completions' && received[0].auth === 'Bearer test-key'],
    ['счётчик токенов показан в шапке', /потрачено 2 000 токенов/.test(badge)],
    ['игра отрисовала несколько цветов на canvas', painted[0] >= 3],
    ['доработка отправила текущую игру и правку', received.length === 2 && /кнопки больше/.test(userText(received[1]))],
    ['нет JS-ошибок на странице', errors.length === 0],
  ];
  checks.forEach(([name, ok]) => console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`));
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
})().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
