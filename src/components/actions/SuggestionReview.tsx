'use client';

/**
 * Решение аналитика по гипотезе ИИ.
 *
 * Две кнопки, и обе формулировки выбраны против соблазна. «Согласиться» —
 * не «подтвердить»: согласие означает «да, в этом месте текста действительно
 * сказано то, что прочитал разбор», и ничего больше. Балл после него не
 * меняется, а у объекта появляется задача на проверку.
 *
 * Поэтому успешное согласие показывает приписку, которую отдаёт сам API:
 * фактор создан в статусе «требует проверки», баллов не начислено. Без неё
 * интерфейс выглядел бы так, будто нажатие кнопки чем-то решило вопрос, и
 * аналитик мог бы остановиться на полпути — согласившись с прочтением, но
 * не проверив утверждение.
 *
 * Отклонение комментария не требует: «нет, здесь не об этом» — обычный
 * результат чтения текста. Но поле оставлено, потому что иногда причина
 * ценнее решения: именно отклонённые гипотезы показывают, где разбор
 * ошибается систематически.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

interface ReviewResponse {
  suggestionId: string;
  status: 'ACCEPTED' | 'REJECTED';
  factorId: string | null;
  linkedProjectId: string | null;
  scoreDelta: 0;
  note: { ru: string; kk: string } | null;
}

export function SuggestionReview({
  suggestionId,
  locale,
  /** Уже рассмотренная гипотеза решения не принимает: журнал однозначен. */
  status,
  reviewedBy,
}: {
  suggestionId: string;
  locale: Locale;
  status: string;
  reviewedBy?: string | null;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [comment, setComment] = useState('');
  const [note, setNote] = useState<string | null>(null);

  if (status !== 'PENDING') {
    return (
      <p className="faint no-print">
        Решение принято{reviewedBy ? `: ${reviewedBy}` : ''}. Изменить его нельзя — новое решение
        оформляется новым разбором.
      </p>
    );
  }

  async function decide(decision: 'ACCEPTED' | 'REJECTED') {
    const result = await action.run<ReviewResponse>(
      () =>
        api.post(`/api/suggestions/${suggestionId}`, {
          decision,
          ...(comment.trim() && { comment: comment.trim() }),
        }),
      () => {
        setComment('');
        router.refresh();
      },
      decision === 'ACCEPTED' ? undefined : 'Гипотеза отклонена.',
    );

    // Приписку пишет сервер: правило «балл не изменился» живёт там же,
    // где создаётся фактор, и не должно дублироваться в интерфейсе.
    setNote(result?.note ? result.note[locale] : null);
  }

  return (
    <div className="no-print">
      <div className="field">
        <label htmlFor={`suggestion-comment-${suggestionId}`}>{t('comment')}</label>
        <input
          id={`suggestion-comment-${suggestionId}`}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Необязательно: почему согласились или отклонили"
        />
      </div>

      <div className="row">
        <button
          type="button"
          className="btn-primary"
          disabled={action.busy}
          onClick={() => decide('ACCEPTED')}
        >
          {t('suggestionsAccept')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={action.busy}
          onClick={() => decide('REJECTED')}
        >
          {t('suggestionsRejectBtn')}
        </button>
      </div>

      {note ? <div className="notice notice-info">{note}</div> : null}

      <Feedback failure={action.failure} done={action.done} />
    </div>
  );
}
