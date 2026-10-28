const els = {
  prompt: document.getElementById('prompt'),
  audience: document.getElementById('audience'),
  generate: document.getElementById('generate'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  game: document.getElementById('game'),
  change: document.getElementById('change'),
  iterate: document.getElementById('iterate'),
  download: document.getElementById('download'),
};

const ERRORS = {
  NO_API_KEY: 'На сервере не задан ключ API. Запустите сервер с ANTHROPIC_API_KEY.',
  EMPTY_PROMPT: 'Опишите игру текстом.',
  NO_PREVIOUS_GAME: 'Сначала создайте игру.',
};

let currentHtml = '';

function setBusy(busy, text = '') {
  els.generate.disabled = busy;
  els.iterate.disabled = busy;
  els.status.textContent = text;
}

async function request(body) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(ERRORS[data.error] || 'Не удалось создать игру. Попробуйте ещё раз.');
  return data.html;
}

function showGame(html) {
  currentHtml = html;
  els.game.srcdoc = html;
  els.result.hidden = false;
  els.result.scrollIntoView({ behavior: 'smooth' });
}

async function generate() {
  setBusy(true, 'Создаём игру, это может занять до минуты…');
  try {
    showGame(await request({ prompt: els.prompt.value, audience: els.audience.value }));
    setBusy(false, 'Игра готова. Играйте или доработайте её ниже.');
  } catch (err) {
    setBusy(false, err.message);
  }
}

async function iterate() {
  const change = els.change.value.trim();
  if (!change) return setBusy(false, 'Напишите, что изменить.');

  setBusy(true, 'Дорабатываем игру…');
  try {
    showGame(await request({ previous: currentHtml, change }));
    els.change.value = '';
    setBusy(false, 'Игра обновлена.');
  } catch (err) {
    setBusy(false, err.message);
  }
}

function download() {
  const blob = new Blob([currentHtml], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'game.html';
  link.click();
  URL.revokeObjectURL(link.href);
}

els.generate.addEventListener('click', generate);
els.iterate.addEventListener('click', iterate);
els.download.addEventListener('click', download);
els.prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) generate();
});
