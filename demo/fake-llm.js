// Симуляция API OpenAI и Anthropic: отвечает через задержку готовой игрой.
// Запуск отдельно: node demo/fake-llm.js, затем OPENAI_BASE_URL=http://localhost:4010 (или ANTHROPIC_BASE_URL) npm start
const http = require('node:http');
const { snakeHtml } = require('./games');

function startFakeLlm(port = 4010, delayMs = 6000, log = console.log) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const isOpenAi = req.url.includes('/chat/completions');
      const text = body.messages.find((m) => m.role === 'user').content;
      const isChange = text.includes('Текущая игра');
      log(`[fake-llm] ${isChange ? 'доработка' : 'новая игра'}: ${text.slice(0, 70).replace(/\n/g, ' ')}…`);

      setTimeout(() => {
        const html = snakeHtml({ big: isChange });
        res.writeHead(200, { 'content-type': 'application/json' });
        const reply = `Вот готовая игра.\n\`\`\`html\n${html}\n\`\`\``;
        res.end(JSON.stringify(isOpenAi
          ? {
              choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1200, completion_tokens: 3800, total_tokens: 5000 },
            }
          : {
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: reply }],
              usage: { input_tokens: 1200, output_tokens: 3800 },
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
