const KEY = 'gameforge.games';
const LIMIT = 12;

export function loadGames() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

export function saveGames(games) {
  const trimmed = games.slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // хранилище недоступно или заполнено: история просто не сохранится
  }
  return trimmed;
}
