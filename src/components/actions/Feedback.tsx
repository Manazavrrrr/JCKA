'use client';

/**
 * Показ результата действия.
 *
 * Выделено в отдельный компонент, потому что форма отказа одинакова для всех
 * действий и важнее, чем кажется: именно здесь аналитик узнаёт, почему
 * система не дала подтвердить фактор.
 *
 * Перечень недостающих условий показывается списком, а не склеенной строкой.
 * «Не хватает: подтверждённого отсутствия основания; доказательства
 * документом» в одну строку читается как одно требование, а это два разных,
 * и закрыть нужно оба.
 */

import { type ActionFailure } from './useAction';

export function Feedback({
  failure,
  done,
}: {
  failure: ActionFailure | null;
  done: string | null;
}) {
  if (failure) {
    const fieldErrors = Object.entries(failure.fields);
    return (
      <div className="notice notice-error" role="alert">
        <strong>{failure.message}</strong>
        {failure.missing.length > 0 ? (
          <ul>
            {failure.missing.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : null}
        {fieldErrors.length > 0 ? (
          <ul>
            {fieldErrors.map(([field, messages]) => (
              <li key={field}>
                <span className="mono">{field}</span>: {messages.join(' ')}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (done) {
    return (
      <div className="notice notice-info" role="status">
        {done}
      </div>
    );
  }

  return null;
}
