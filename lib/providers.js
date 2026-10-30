// Адаптеры LLM-провайдеров: как собрать запрос и как прочитать ответ.
const isReasoningModel = (model = '') => /^(gpt-([5-9]|\d{2,})|o\d)/.test(model);

// Склеивает адрес шлюза и путь: учитывает слэш в конце и уже указанный /v1.
function apiUrl(baseUrl, path) {
  const root = baseUrl.replace(/\/+$/, '');
  return /\/v1$/.test(root) ? `${root}${path}` : `${root}/v1${path}`;
}

const PROVIDERS = {
  anthropic: {
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-5-5',
    defaultMaxTokens: () => 16000,

    buildRequest({ apiKey, authToken, model, baseUrl, maxTokens, system, messages }) {
      return {
        url: apiUrl(baseUrl, '/messages'),
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...(apiKey && { 'x-api-key': apiKey }),
          ...(authToken && { authorization: `Bearer ${authToken}` }),
        },
        body: { model, max_tokens: maxTokens, system, messages },
      };
    },

    parseResponse(data) {
      const text = data.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
      const input = data.usage?.input_tokens || 0;
      const output = data.usage?.output_tokens || 0;
      return { text, truncated: data.stop_reason === 'max_tokens', usage: { input, output, total: input + output } };
    },
  },

  openai: {
    defaultBaseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-6.1-sol',
    // токены рассуждений входят в лимит ответа: для моделей с рассуждением (gpt-5 и новее, o-серия) берём максимум 128 тыс.
    defaultMaxTokens: (model) => (isReasoningModel(model) ? 128000 : 16000),

    buildRequest({ apiKey, model, baseUrl, maxTokens, system, messages, reasoningEffort, stream = true }) {
      return {
        url: apiUrl(baseUrl, '/chat/completions'),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: {
          model,
          max_completion_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...messages],
          ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
          // поток держит соединение живым: шлюзы и прокси обрывают долгое молчание
          ...(stream && { stream: true, stream_options: { include_usage: true } }),
        },
      };
    },

    parseResponse(data) {
      const choice = data.choices?.[0];
      const input = data.usage?.prompt_tokens || 0;
      const output = data.usage?.completion_tokens || 0;
      return {
        text: choice?.message?.content || '',
        truncated: choice?.finish_reason === 'length',
        usage: { input, output, total: data.usage?.total_tokens || input + output },
      };
    },
  },
};

module.exports = { PROVIDERS, isReasoningModel, apiUrl };
