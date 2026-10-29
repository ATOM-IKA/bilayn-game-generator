// Записывает видео: промпт -> генерация (симуляция LLM) -> игра -> доработка.
// Результат: demo/out/demo.webm и demo.mp4. Нужен Chromium (CHROMIUM_PATH) и ffmpeg.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { createServer } = require('../server');
const { startFakeLlm } = require('./fake-llm');

const OUT = path.join(__dirname, 'out');
const CHROMIUM = process.env.CHROMIUM_PATH || '/snap/bin/chromium';
const SIZE = { width: 1100, height: 900 };
const listen = (s) => new Promise((r) => s.listen(0, () => r(s.address().port)));

async function playToWin(frame, page) {
  await frame.locator('#start').click();
  const steps = ['ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
  for (let score = 1; score <= 4; score++) {
    await frame.locator('#msg').filter({ hasText: `Счёт: ${score} из 5` }).waitFor({ timeout: 15000 });
    await page.keyboard.press(steps[score - 1]);
  }
  await frame.locator('#msg').filter({ hasText: 'Победа' }).waitFor({ timeout: 15000 });
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const llm = await startFakeLlm(0, 6000, (m) => console.log(m));
  process.env.ANTHROPIC_API_KEY = 'simulated-key';
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${llm.address().port}`;
  const app = createServer();
  const appPort = await listen(app);

  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } });
  const page = await context.newPage();
  const frame = page.frameLocator('#game');

  await page.goto(`http://localhost:${appPort}/`);
  await page.waitForTimeout(1200);

  await page.click('#prompt');
  await page.keyboard.type('замути змейку для бабушки', { delay: 90 });
  await page.waitForTimeout(500);
  await page.click('[data-audience="seniors"]');
  await page.waitForTimeout(800);
  await page.click('#generate');

  await page.waitForSelector('#game', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await playToWin(frame, page);
  await page.waitForTimeout(1500);

  await page.click('#change');
  await page.keyboard.type('сделай кнопки больше', { delay: 90 });
  await page.waitForTimeout(400);
  await page.click('#iterate');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Игра обновлена.', null, { timeout: 30000 });
  await page.waitForTimeout(2500);

  const video = await page.video().path();
  await context.close();
  await browser.close();
  app.close();
  llm.close();

  fs.renameSync(video, path.join(OUT, 'demo.webm'));
  execFileSync('ffmpeg', ['-y', '-i', path.join(OUT, 'demo.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(OUT, 'demo.mp4')], { stdio: 'ignore' });
  console.log('Готово:', path.join(OUT, 'demo.mp4'));
})().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
