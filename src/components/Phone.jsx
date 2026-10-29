import Loader from './Loader.jsx';

export default function Phone({ html, busy }) {
  return (
    <div className="phone" aria-label="Предпросмотр в WebView">
      <div className="phone__notch" />
      <div className="phone__screen">
        {html ? (
          <iframe id="game" sandbox="allow-scripts" srcDoc={html} title="Сгенерированная игра" />
        ) : (
          <div className="phone__empty">
            <div className="phone__orb" />
            <p>Здесь появится ваша игра</p>
            <span>Опишите игру и нажмите «Создать игру»</span>
          </div>
        )}
        {busy && <Loader />}
      </div>
    </div>
  );
}
