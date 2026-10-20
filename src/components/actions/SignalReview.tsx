'use client';

/**
 * Рассмотрение сигнальной карточки — второй человек в процессе.
 *
 * Аналитик формирует карточку, руководитель её рассматривает. Требование
 * ТЗ «Контроль решений» выполняется не тем, что действие записывается
 * в журнал, а тем, что оно отделено: у подтверждения свой автор, своя дата
 * и своя кнопка.
 *
 * Возврат требует комментария, подтверждение — нет. «Согласен» не нуждается
 * в объяснении; «переделать» без объяснения бесполезно — аналитик не узнает,
 * что исправлять. Кнопка возврата поэтому заблокирована, пока поле пустое,
 * и рядом сказано почему. Правило живёт на сервере (server/signals.ts),
 * здесь оно продублировано ради того, чтобы человек увидел условие до
 * нажатия, а не ошибку после.
 *
 * Повторное рассмотрение невозможно: карточка — документ. Изменение решения
 * оформляется новой карточкой, и это сообщается текстом, а не отсутствием
 * кнопок: исчезнувшие кнопки читаются как поломка.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { SIGNAL_STATUS_LABELS, type SignalStatus } from '../../core/domain/enums';
import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export function SignalReview({
  signalId,
  locale,
  status,
  reviewedBy,
  reviewComment,
}: {
  signalId: string;
  locale: Locale;
  status: string;
  reviewedBy: string | null;
  reviewComment: string | null;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [comment, setComment] = useState('');

  if (status !== 'DRAFT') {
    const label = SIGNAL_STATUS_LABELS[status as SignalStatus];
    return (
      <div className="no-print">
        <p className="faint">
          {label ? label[locale] : status}
          {reviewedBy ? `: ${reviewedBy}` : ''}. Решение по рассмотренной карточке не меняется —
          новое решение оформляется новой карточкой.
        </p>
        {reviewComment ? (
          <div className="notice notice-warn">
            <strong>{t('comment')}.</strong> {reviewComment}
          </div>
        ) : null}
      </div>
    );
  }

  function decide(decision: 'CONFIRMED' | 'RETURNED') {
    return action.run(
      () =>
        api.post(`/api/signals/${signalId}/review`, {
          decision,
          ...(comment.trim() && { comment: comment.trim() }),
        }),
      () => {
        setComment('');
        router.refresh();
      },
      decision === 'CONFIRMED' ? 'Карточка подтверждена.' : 'Карточка возвращена на доработку.',
    );
  }

  const returnBlocked = comment.trim().length === 0;

  return (
    <div className="no-print">
      <div className="field">
        <label htmlFor="signal-comment">{t('comment')}</label>
        <textarea
          id="signal-comment"
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Для возврата: что именно нужно исправить"
        />
      </div>

      <div className="row">
        <button
          type="button"
          className="btn-primary"
          disabled={action.busy}
          onClick={() => decide('CONFIRMED')}
        >
          {t('signalsConfirm')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={action.busy || returnBlocked}
          onClick={() => decide('RETURNED')}
        >
          {t('signalsReturn')}
        </button>
      </div>

      {returnBlocked ? <p className="faint">{t('signalsReturnHint')}</p> : null}

      <Feedback failure={action.failure} done={action.done} />
    </div>
  );
}
