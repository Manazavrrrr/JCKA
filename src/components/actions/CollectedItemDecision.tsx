'use client';

/**
 * Решение аналитика по собранному элементу: завести объявление или
 * признать, что к делу он не относится.
 *
 * Это место, где машинный отбор заканчивается. Слово-ловушка сказала
 * «посмотрите сюда»; станет ли элемент объявлением в системе, решает
 * человек. Автоматического перевода нет намеренно — иначе одно неудачное
 * слово в настройках залило бы реестр сотнями записей, за которые никто
 * не отвечает.
 *
 * Причина отклонения обязательна, и поле для неё открыто сразу, а не по
 * нажатию. Спрятанное за кнопкой поле превращает обязательное объяснение
 * в препятствие, и аналитик начинает писать в нём «не то» — лишь бы
 * пройти. Открытое поле с подсказкой рядом читается как часть решения.
 *
 * Решение человека не переписывает вердикт фильтра: они хранятся порознь
 * и оба видны на карточке. Расхождение между ними — самый полезный
 * сигнал на этом экране: оно показывает, какое слово пора поправить.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export function CollectedItemDecision({ itemId, locale }: { itemId: string; locale: Locale }) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [comment, setComment] = useState('');

  function accept() {
    return action.run(
      () => api.post(`/api/collect/items/${itemId}/accept`),
      () => router.refresh(),
      'Объявление заведено. Дальше — разбор и привязка к объекту реестра.',
    );
  }

  function dismiss() {
    return action.run(
      () => api.post(`/api/collect/items/${itemId}/dismiss`, { comment: comment.trim() }),
      () => {
        setComment('');
        router.refresh();
      },
      'Элемент убран из очереди. Причина записана в журнал.',
    );
  }

  const dismissBlocked = comment.trim().length < 3;

  return (
    <div className="no-print" style={{ marginTop: 10 }}>
      <div className="field">
        <label htmlFor={`dismiss-${itemId}`}>{t('comment')}</label>
        <input
          id={`dismiss-${itemId}`}
          type="text"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Для отклонения: почему элемент не относится к делу"
        />
      </div>

      <div className="row">
        <button type="button" className="btn-primary" disabled={action.busy} onClick={accept}>
          {t('collectAccept')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={action.busy || dismissBlocked}
          onClick={dismiss}
        >
          {t('collectDismiss')}
        </button>
      </div>

      {dismissBlocked ? <p className="faint">{t('collectDismissHint')}</p> : null}

      <Feedback failure={action.failure} done={action.done} />
    </div>
  );
}
