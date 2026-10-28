// Симуляция Anthropic Messages API: отвечает через задержку готовой игрой.
// Запуск отдельно: node demo/fake-llm.js, затем ANTHROPIC_BASE_URL=http://localhost:4010 npm start
const http = require('node:http');
const { snakeHtml } = require('./games');

function startFakeLlm(port = 4010, delayMs = 6000, log = console.log) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const text = body.messages[0].content;
      const isChange = text.includes('Текущая игра');
      log(`[fake-llm] ${isChange ? 'доработка' : 'новая игра'}: ${text.slice(0, 70).replace(/\n/g, ' ')}…`);

      setTimeout(() => {
        const html = snakeHtml({ big: isChange });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: `Вот готовая игра.\n\`\`\`html\n${html}\n\`\`\`` }],
        }));
        log('[fake-llm] ответ отправлен');
      }, delayMs);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (require.main === module) {
  const port = Number(process.env.FAKE_LLM_PORT) || 4010;
  startFakeLlm(port).then(() => console.log(`Симуляция LLM: http://localhost:${port}`));
}

module.exports = { startFakeLlm };
