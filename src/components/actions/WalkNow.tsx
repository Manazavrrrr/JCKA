'use client';

/**
 * Кнопка «обойти сейчас».
 *
 * Кнопка остаётся, хотя обход идёт сам, и это не дублирование таймера. У
 * ручного запуска две задачи, которых у таймера нет: убедиться, что обход
 * работает, не дожидаясь срока, — и собрать внеурочно, когда появился повод.
 *
 * Три решения, которые стоит объяснить.
 *
 * Первое. Кнопка проходит через тот же дневной предел, что и автоматический
 * обход. «Нажать самому» не должно быть способом обойти ограничение расхода:
 * иначе предел защищает только от программы, а от человека — нет, тогда как
 * ошибается чаще человек.
 *
 * Второе. Отказ показывается словами сервера, а не своим текстом. Причин
 * отказа три, и лечатся они по-разному: нет включённых слов — исправляется на
 * этом же экране; кончился дневной предел — пройдёт само к следующим суткам;
 * нет ключа — нужна правка .env и перезапуск. Свести их к «обход не удался»
 * значило бы заставить аналитика перебирать три варианта вслепую.
 *
 * Третье. В итоге названо и то, сколько взято, и то, сколько прогон стоил.
 * Стоимость, названная после прогона, — это уже списанная стоимость, и
 * спрятать её значило бы сделать расход заметным только в чужой консоли.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

interface WalkResponse {
  skipped: { reason: string; note: { ru: string; kk: string } } | null;
  tags: string[];
  plannedResults: number;
  costUsd: number;
  runId: string | null;
  stats: { total: number; kept: number; skipped: number } | null;
}

export function WalkNow({
  locale,
  /** Сколько публикаций задуман обход по включённым словам. */
  plannedResults,
  /** Во что он обойдётся по сегодняшней цене. */
  plannedCostUsd,
  /** Пустит ли дневной предел прогон прямо сейчас. */
  allowed,
}: {
  locale: Locale;
  plannedResults: number;
  plannedCostUsd: number;
  allowed: boolean;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [summary, setSummary] = useState<string | null>(null);

  function walk() {
    setSummary(null);
    return action.run(
      () => api.post<WalkResponse>('/api/collect/walk', {}),
      (result) => {
        if (result.skipped) {
          setSummary(locale === 'kk' ? result.skipped.note.kk : result.skipped.note.ru);
        } else {
          const stats = result.stats;
          setSummary(
            `Обход прошёл по ${result.tags.length} словам. ` +
              `Прочитано ${stats?.total ?? 0}, взято ${stats?.kept ?? 0}, ` +
              `отброшено ${stats?.skipped ?? 0}. ` +
              `Стоило ${result.costUsd.toFixed(2).replace('.', ',')} $.`,
          );
        }
        router.refresh();
      },
    );
  }

  /*
   * Кнопка не блокируется исчерпанным пределом намеренно. Нажатие при
   * исчерпанном пределе ничего не стоит и ничего не ломает: обход откажется
   * сам и объяснит, почему. Заблокированная кнопка без объяснения оставляет
   * аналитика с догадкой, а догадка здесь — про деньги.
   */
  const blocked = plannedResults === 0;

  return (
    <div className="no-print" style={{ marginTop: 10 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          className="btn-primary"
          disabled={action.busy || blocked}
          onClick={walk}
        >
          {action.busy ? t('loading') : t('walkNow')}
        </button>
        <span className={allowed ? 'faint' : 'tag tag-warn'}>
          {t('walkPlanned')}: {plannedResults} · {t('collectEstimatedCost')}:{' '}
          {plannedCostUsd.toFixed(2).replace('.', ',')} $
        </span>
      </div>

      <Feedback failure={action.failure} done={action.failure ? null : summary} />
    </div>
  );
}
