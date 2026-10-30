const fs = require('node:fs');

// Общий лимит токенов на всё время работы. Расход хранится в файле, чтобы пережить перезапуск сервера.
function createBudget({ limit, file }) {
  let used = 0;
  try {
    used = Number(JSON.parse(fs.readFileSync(file, 'utf8')).used) || 0;
  } catch {
    // файла ещё нет или он повреждён: начинаем с нуля
  }

  const save = () => {
    try {
      fs.writeFileSync(file, JSON.stringify({ used }));
    } catch {
      // расход не сохранится, но генерация продолжит работать
    }
  };

  return {
    get used() { return used; },
    get limit() { return limit; },
    get remaining() { return Math.max(0, limit - used); },
    assertAvailable() {
      if (used >= limit) throw new Error('TOKEN_BUDGET_EXCEEDED');
    },
    add(tokens) {
      used += tokens;
      save();
    },
    snapshot() {
      return { used, limit, remaining: Math.max(0, limit - used) };
    },
  };
}

module.exports = { createBudget };
