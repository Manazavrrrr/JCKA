'use client';

/**
 * Формирование сигнальной карточки.
 *
 * Отличие этого действия от остальных: его результат покидает систему.
 * Карточка уходит в управление, в прокуратуру, в суд — туда, где её прочтёт
 * человек, не видевший ни одного другого экрана приложения.
 *
 * Отсюда два следствия в разметке.
 *
 * Первое: условие готовности показывается до нажатия. Сервер откажет, если
 * у объекта нет ни одного подтверждённого фактора либо у подтверждённых
 * не зафиксированы автор, дата и обоснование — и откажет с перечнем изъянов.
 * Но аналитик должен видеть это заранее: «сформируйте карточку» на объекте,
 * где карточку сформировать нельзя, — обещание, которое интерфейс не сдержит.
 *
 * Второе: приписка аналитика необязательна. Текст карточки собирается
 * из подтверждённых факторов автоматически и одинаково при каждом
 * формировании — это требование воспроизводимости. Приписка добавляет
 * обстоятельства, которых нет в факторах, но не заменяет их.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type Label } from '../../core/domain/enums';
import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

interface CreatedSignal {
  signal: { id: string };
}

export function CreateSignal({
  projectSlug,
  locale,
  ready,
  integrityWarnings,
  hasConfirmed,
}: {
  projectSlug: string;
  locale: Locale;
  /** Готовность по расчёту: есть подтверждённые факторы и нет изъянов. */
  ready: boolean;
  integrityWarnings: readonly Label[];
  hasConfirmed: boolean;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();
  const [note, setNote] = useState('');

  async function submit() {
    const result = await action.run<CreatedSignal>(
      () => api.post(`/api/signals`, { project: projectSlug, ...(note.trim() && { note: note.trim() }) }),
      (created) => {
        setNote('');
        router.push(`/signals/${created.signal.id}`);
      },
    );
    return result;
  }

  return (
    <div className="no-print">
      {!ready ? (
        <div className="notice notice-warn">
          <strong>{t('signalsNotReady')}</strong>
          {!hasConfirmed ? (
            <p style={{ margin: '6px 0 0' }}>
              Сейчас у объекта нет подтверждённых факторов: выносить в карточку
              нечего. Балл складывается только из подтверждённых фактов, а не из
              гипотез.
            </p>
          ) : null}
          {integrityWarnings.length > 0 ? (
            <ul>
              {integrityWarnings.map((item, index) => (
                <li key={index}>{item[locale]}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="signal-note">{t('signalsNote')}</label>
        <textarea
          id="signal-note"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Обстоятельства, которых нет в факторах. Необязательно."
        />
        <small className="faint">
          Если оставить пустым, в карточку попадёт автоматическая сводка по
          подтверждённым факторам — одинаковая при каждом формировании.
        </small>
      </div>

      <button
        type="button"
        className="btn-primary"
        disabled={action.busy || !ready}
        onClick={submit}
        title={ready ? undefined : t('signalsNotReady')}
      >
        {t('signalsCreate')}
      </button>

      <Feedback failure={action.failure} done={action.done} />
    </div>
  );
}
