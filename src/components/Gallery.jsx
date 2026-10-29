const AUDIENCE_LABEL = { kids: 'Дети', adults: 'Взрослые', seniors: 'Пожилые' };

export default function Gallery({ games, currentId, onOpen, onRemove }) {
  if (!games.length) return null;

  return (
    <section className="card">
      <h2 className="card__title">Мои игры</h2>
      <ul className="gallery">
        {games.map((game) => (
          <li key={game.id} className={game.id === currentId ? 'gallery__item is-current' : 'gallery__item'}>
            <button type="button" className="gallery__open" onClick={() => onOpen(game)}>
              <span className="gallery__prompt">{game.prompt}</span>
              <span className="gallery__meta">
                {AUDIENCE_LABEL[game.audience] || 'Любая аудитория'} · {new Date(game.createdAt).toLocaleDateString('ru-RU')}
              </span>
            </button>
            <button type="button" className="gallery__remove" aria-label="Удалить игру" onClick={() => onRemove(game.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
