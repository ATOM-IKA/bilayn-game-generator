const ERRORS = {
  NO_API_KEY: 'Не задан ключ API. Впишите OPENAI_API_KEY в файл .env и перезапустите сервер.',
  EMPTY_PROMPT: 'Опишите игру одним предложением.',
  NO_PREVIOUS_GAME: 'Сначала создайте игру.',
  TOKEN_BUDGET_EXCEEDED: 'Достигнут общий лимит токенов (TOKEN_BUDGET). Увеличьте его в .env или удалите файл .usage.json.',
  GENERATION_TOKEN_LIMIT_EXCEEDED: 'Генерация превысила потолок токенов (GENERATION_TOKEN_LIMIT). Упростите запрос или увеличьте потолок в .env.',
  LLM_HTTP_401: 'Ключ API не подошёл. Проверьте ключ в файле .env.',
  LLM_HTTP_403: 'Доступ запрещён. Проверьте ключ и права на выбранную модель.',
  LLM_HTTP_404: 'Модель не найдена или недоступна для вашего ключа. Проверьте OPENAI_MODEL в .env.',
  LLM_HTTP_429: 'Лимит запросов или недостаточно средств на счёте OpenAI. Проверьте баланс и повторите.',
  GENERATION_TIMEOUT: 'Генерация не уложилась в отведённое время (GENERATION_TIMEOUT_MS, по умолчанию 15 минут) и остановлена. Повторите попытку или включите QUALITY=standard в .env (быстрее).',
  LLM_NETWORK: 'Нет связи с сервером модели. Проверьте интернет и адрес LLM_BASE_URL, затем повторите.',
  LLM_TIMEOUT: 'Модель отвечала слишком долго. Повторите или включите QUALITY=standard в .env.',
  LLM_STREAM_ERROR: 'Шлюз вернул внутреннюю ошибку посреди ответа (даже после повторов). Попробуйте ещё раз позже.',
  LLM_STREAM_INTERRUPTED: 'Соединение со шлюзом оборвалось. Повторите попытку.',
  RESPONSE_TRUNCATED: 'Игра получилась слишком большой. Увеличьте MAX_TOKENS в .env или упростите запрос.',
};

async function readJson(response) {
  return response.json().catch(() => ({}));
}

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

  const data = await readJson(response);
  if (!response.ok) {
    const gatewayDown = /^LLM_HTTP_5\d\d$/.test(data.error || '');
    const known = ERRORS[data.error] || (gatewayDown ? 'Шлюз модели временно недоступен или не дождался ответа. Повторите попытку.' : '');
    const code = data.error ? ` Код ошибки: ${data.error}.` : '';
    const error = new Error(known || `Не удалось создать игру.${code} Подробности в консоли сервера.`);
    error.usage = data.usage;
    throw error;
  }
  return data;
}

export async function fetchUsage() {
  try {
    const response = await fetch('/api/usage');
    return response.ok ? await readJson(response) : null;
  } catch {
    return null;
  }
}
