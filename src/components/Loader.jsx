import { useEffect, useState } from 'react';

const STEPS = ['Разбираем запрос', 'Придумываем механику', 'Пишем код игры', 'Проверяем, что игра запускается'];

export default function Loader() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="loader" role="status">
      <div className="loader__spinner" />
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
