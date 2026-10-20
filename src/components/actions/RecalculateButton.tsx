'use client';

/**
 * Пересчёт балла объекта.
 *
 * Кнопка нужна потому, что балл в объекте — кэш, а не истина. Истина —
 * таблица факторов. Расхождение возможно после правки данных в обход обычных
 * операций, и карточка объекта показывает его прямо: «кэш расходится
 * с расчётом по факторам». Эта кнопка закрывает расхождение.
 *
 * Операция идемпотентна: пересчёт без изменений не создаёт ни записи
 * в журнале, ни точки на графике динамики. Поэтому кнопку можно нажимать
 * без опасений — она не засоряет историю.
 */

import { useRouter } from 'next/navigation';

import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export function RecalculateButton({
  projectSlug,
  locale,
  emphasize,
}: {
  projectSlug: string;
  locale: Locale;
  /** true, когда кэш разошёлся: тогда кнопка — основное действие экрана. */
  emphasize?: boolean;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  return (
    <span className="no-print">
      <button
        type="button"
        className={emphasize ? 'btn-primary' : 'btn'}
        disabled={action.busy}
        onClick={() =>
          action.run(
            () => api.post(`/api/projects/${projectSlug}/recalculate`, {}),
            () => router.refresh(),
          )
        }
      >
        {t('scoringRecalculate')}
      </button>
      <Feedback failure={action.failure} done={action.done} />
    </span>
  );
}
