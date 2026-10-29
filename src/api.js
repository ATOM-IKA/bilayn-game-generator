const ERRORS = {
  NO_API_KEY: 'Не задан ключ API. Впишите ANTHROPIC_API_KEY в файл .env и перезапустите сервер.',
  EMPTY_PROMPT: 'Опишите игру одним предложением.',
  NO_PREVIOUS_GAME: 'Сначала создайте игру.',
  LLM_HTTP_401: 'Ключ API не подошёл. Проверьте ANTHROPIC_API_KEY в файле .env.',
  LLM_HTTP_429: 'Превышен лимит запросов к модели. Подождите минуту и повторите.',
  RESPONSE_TRUNCATED: 'Игра получилась слишком большой. Попробуйте упростить запрос.',
};

export async function requestGame(body) {
  let response;
  try {
    response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Сервер недоступен. Запущен ли npm start?');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(ERRORS[data.error] || 'Не удалось создать игру. Попробуйте ещё раз.');
  return data.html;
}
