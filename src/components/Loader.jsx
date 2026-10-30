import { useEffect, useState } from 'react';

const STEPS = ['Разбираем запрос', 'Продумываем дизайн и механику', 'Пишем код игры', 'Проверяем и улучшаем код', 'Финальная полировка'];

export default function Loader() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="loader" role="status">
      <div className="loader__spinner" />
      <p className="loader__hint">Режим максимального качества: это может занять несколько минут</p>
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
