import { useEffect, useState } from 'react';
import { fetchUsage, requestGame } from './api.js';
import { loadGames, saveGames } from './storage.js';
import Phone from './components/Phone.jsx';
import Gallery from './components/Gallery.jsx';

const AUDIENCES = [
  { id: '', label: 'Любая' },
  { id: 'kids', label: 'Дети' },
  { id: 'adults', label: 'Взрослые' },
  { id: 'seniors', label: 'Пожилые' },
];

const EXAMPLES = [
  'Замути змейку для бабушки',
  'Яркий кликер с монетками для детей',
  'Головоломка «найди пару»',
  'Аркада: лови падающие звёзды',
];

const TWEAKS = ['Сделай кнопки больше', 'Добавь уровни', 'Сделай ярче', 'Добавь таймер'];

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [audience, setAudience] = useState('');
  const [change, setChange] = useState('');
  const [html, setHtml] = useState('');
  const [currentId, setCurrentId] = useState(null);
  const [games, setGames] = useState(loadGames);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ text: '', error: false });
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    fetchUsage().then(setUsage);
  }, []);

  const updateGames = (next) => setGames(saveGames(next));

  async function run(body, onDone) {
    setBusy(true);
    setStatus({ text: '', error: false });
    try {
      const data = await requestGame(body);
      setUsage(data.usage);
      onDone(data.html);
    } catch (err) {
      if (err.usage) setUsage(err.usage);
      setStatus({ text: err.message, error: true });
    } finally {
      setBusy(false);
    }
  }

  const generate = () =>
    run({ prompt, audience }, (result) => {
      const game = { id: crypto.randomUUID(), prompt: prompt.trim(), audience, html: result, createdAt: Date.now() };
      setHtml(result);
      setCurrentId(game.id);
      updateGames([game, ...games]);
      setStatus({ text: 'Игра готова. Играйте или доработайте её.', error: false });
    });

  const iterate = (text = change) => {
    const request = text.trim();
    if (!request) return setStatus({ text: 'Напишите, что изменить.', error: true });
    run({ previous: html, change: request }, (result) => {
      setHtml(result);
      setChange('');
      updateGames(games.map((g) => (g.id === currentId ? { ...g, html: result } : g)));
      setStatus({ text: 'Игра обновлена.', error: false });
    });
  };

  const openGame = (game) => {
    setHtml(game.html);
    setCurrentId(game.id);
    setPrompt(game.prompt);
    setAudience(game.audience);
    setStatus({ text: '', error: false });
  };

  const removeGame = (id) => {
    updateGames(games.filter((g) => g.id !== id));
    if (id === currentId) {
      setHtml('');
      setCurrentId(null);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'game.html' });
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <header className="top">
        <div className="logo">
          <span className="logo__mark">⚡</span>
          <span>GameForge</span>
        </div>
        <span className="badge" id="usage" title="Использовано токенов из общего лимита">
          {usage
            ? `${usage.provider === 'openai' ? 'OpenAI' : 'Claude'} · ${usage.model} · ${usage.used.toLocaleString('ru-RU')} / ${usage.limit.toLocaleString('ru-RU')} токенов`
            : 'AI · HTML5 · WebView'}
        </span>
      </header>

      <main className="layout">
        <div className="col">
          <section className="hero">
            <h1>
              Игра по <span className="grad">одному предложению</span>
            </h1>
            <p>Опишите, что хотите сыграть. ИИ напишет игру, которая сразу запустится на телефоне.</p>
          </section>

          <section className="card">
            <label className="field" htmlFor="prompt">
              Какую игру создать?
            </label>
            <textarea
              id="prompt"
              rows={3}
              value={prompt}
              placeholder="Например: замути змейку для бабушки"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && !busy && generate()}
            />
            <div className="chips">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="chip" onClick={() => setPrompt(example)}>
                  {example}
                </button>
              ))}
            </div>

            <span className="field">Для кого</span>
            <div className="segmented" role="radiogroup" aria-label="Аудитория">
              {AUDIENCES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={audience === a.id}
                  data-audience={a.id || 'any'}
                  className={audience === a.id ? 'is-active' : ''}
                  onClick={() => setAudience(a.id)}
                >
                  {a.label}
                </button>
              ))}
            </div>

            <button id="generate" type="button" className="btn btn--primary" disabled={busy} onClick={generate}>
              {busy ? 'Создаём…' : 'Создать игру'}
            </button>
            <p id="status" className={status.error ? 'status status--error' : 'status'} role="status">
              {status.text}
            </p>
          </section>

          <Gallery games={games} currentId={currentId} onOpen={openGame} onRemove={removeGame} />
        </div>

        <div className="col col--preview">
          <Phone html={html} busy={busy} />

          {html && (
            <section className="card card--tweak">
              <label className="field" htmlFor="change">
                Что доработать?
              </label>
              <div className="row">
                <input
                  id="change"
                  type="text"
                  value={change}
                  placeholder="Например: сделай кнопки больше"
                  onChange={(e) => setChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !busy && iterate()}
                />
                <button id="iterate" type="button" className="btn" disabled={busy} onClick={() => iterate()}>
                  Доработать
                </button>
              </div>
              <div className="chips">
                {TWEAKS.map((tweak) => (
                  <button key={tweak} type="button" className="chip" disabled={busy} onClick={() => iterate(tweak)}>
                    {tweak}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn--ghost" onClick={download}>
                Скачать HTML
              </button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
