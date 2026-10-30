const fs = require('node:fs');

// Учёт токенов за всё время работы. Расход хранится в файле, чтобы пережить перезапуск сервера.
// limit = 0 означает «без общего лимита».
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
    get remaining() { return limit ? Math.max(0, limit - used) : null; },
    assertAvailable() {
      if (limit && used >= limit) throw new Error('TOKEN_BUDGET_EXCEEDED');
    },
    add(tokens) {
      used += tokens;
      save();
    },
    snapshot() {
      return { used, limit, remaining: limit ? Math.max(0, limit - used) : null };
    },
  };
}

module.exports = { createBudget };
