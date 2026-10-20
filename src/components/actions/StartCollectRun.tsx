'use client';

/**
 * Запуск прогона по публичному Telegram-каналу.
 *
 * Чтение канала — единственное действие системы, которое выходит в сеть
 * к чужому серверу, и единственное, которое длится секунды, а не
 * миллисекунды. Поэтому кнопка сообщает, что происходит, а не замирает:
 * прогон на канале с сотней публикаций — это ожидание, и молчащий
 * интерфейс в такой момент читается как поломка.
 *
 * Порог групп выведен рядом с полем канала, а не спрятан в настройки.
 * Он меняет состав выборки сильнее всего остального: при пороге 1 в
 * очередь придёт вся вторичка. Аналитик должен видеть, с каким порогом
 * он запускает прогон, и этот же порог сохранится в записи прогона —
 * потом будет видно, какой выборка была на самом деле.
 *
 * Отказ показывается тем же способом, что и у остальных действий.
 * Закрытый канал, опечатка в имени, изменившаяся разметка страницы —
 * всё это приходит с сервера человеческим текстом, и прогон с такой
 * ошибкой всё равно сохраняется: на экране останется след попытки.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export function StartCollectRun({
  locale,
  defaultChannel,
  defaultMinCategories,
  maxCategories,
}: {
  locale: Locale;
  /** Демонстрационный канал: чтобы кнопку было чем нажать сразу. */
  defaultChannel: string;
  defaultMinCategories: number;
  maxCategories: number;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [channel, setChannel] = useState(defaultChannel);
  const [minCategories, setMinCategories] = useState(defaultMinCategories);
  /**
   * Итог последнего прогона держится отдельно от useAction: тот сообщает
   * об успехе строкой, известной до вызова, а сказать здесь нужно числа,
   * которые придут в ответе. «Готово» без чисел заставило бы аналитика
   * пересчитывать строки таблицы глазами.
   */
  const [summary, setSummary] = useState<string | null>(null);

  const thresholds = Array.from({ length: maxCategories }, (_, index) => index + 1);

  function start() {
    setSummary(null);
    return action.run(
      () =>
        api.post<{ stats: { total: number; kept: number; skipped: number } }>('/api/collect/runs', {
          channel: channel.trim(),
          minCategories,
        }),
      (result) => {
        setSummary(
          `Прочитано ${result.stats.total}, взято ${result.stats.kept}, ` +
            `отброшено ${result.stats.skipped}.`,
        );
        router.refresh();
      },
    );
  }

  const blocked = channel.trim().length < 2;

  return (
    <div className="card no-print">
      <h2 style={{ marginTop: 0 }}>{t('collectRun')}</h2>

      <div className="grid grid-3">
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="collect-channel">{t('collectChannel')}</label>
          <input
            id="collect-channel"
            type="text"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            placeholder="@ukg_novostroyki"
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="collect-threshold">{t('collectThreshold')}</label>
          <select
            id="collect-threshold"
            value={minCategories}
            onChange={(event) => setMinCategories(Number(event.target.value))}
          >
            {thresholds.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="faint" style={{ marginTop: 4 }}>
        {t('collectRunHint')}
      </p>
      <p className="faint" style={{ marginTop: 0 }}>
        {t('collectThresholdHint')}
      </p>

      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn-primary" disabled={action.busy || blocked} onClick={start}>
          {action.busy ? t('loading') : t('collectRunStart')}
        </button>
      </div>

      <Feedback failure={action.failure} done={action.failure ? null : summary} />
    </div>
  );
}
