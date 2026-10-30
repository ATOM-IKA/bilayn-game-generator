import { useEffect, useState } from 'react';

const STEPS = ['Разбираем запрос', 'Продумываем механику', 'Пишем код игры', 'Проверяем и улучшаем'];

export default function Loader() {
  const [step, setStep] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="loader" role="status">
      <div className="loader__spinner" />
      <p className="loader__hint">Режим максимального качества, не дольше 15 минут. Прошло {elapsed}</p>
      <ul>
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? 'done' : i === step ? 'active' : ''}>
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
