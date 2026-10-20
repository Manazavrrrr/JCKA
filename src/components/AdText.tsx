/**
 * Текст объявления с подсветкой найденного.
 *
 * Требование технического задания — «подсветка ключевых фраз» — здесь
 * выполняется с одной важной оговоркой: подсветки две, и они разные.
 *
 * Пунктирная линия без заливки — цитата, на которую ссылается гипотеза
 * ИИ. Это вопрос: «в этом месте, похоже, требуют платную бронь —
 * посмотрите». Плотная заливка — фрагмент, который аналитик приложил
 * к фактору как доказательство. Это утверждение, за которым стоит
 * человек с именем и датой в журнале.
 *
 * Одинаковое оформление превратило бы первое во второе: судья, читающий
 * объявление, увидел бы «система нашла нарушение» там, где система
 * только задала вопрос. Разделение подсветок — не оформительское
 * решение, а то же самое разграничение гипотезы и факта, которое
 * проходит через всю систему.
 *
 * Разрезание текста по границам фрагментов живёт в core/text/highlight.ts
 * и проверяется тестами отдельно: пересечения цитат — место, где легко
 * потерять или удвоить кусок текста.
 */

import {
  type HighlightSpan,
  clipSegments,
  segmentClass,
  toSegments,
} from '../core/text/highlight';
import { type Locale, translator } from '../i18n/dict';

export function AdText({
  text,
  spans,
  limit,
}: {
  text: string;
  spans: readonly HighlightSpan[];
  /** Для списков: показать только начало, не сдвигая подсветку. */
  limit?: number;
}) {
  const all = toSegments(text, spans);
  const segments = limit ? clipSegments(all, limit) : all;
  const truncated = limit !== undefined && text.length > limit;

  return (
    <div className="adtext">
      {segments.map((segment, index) => {
        const className = segmentClass(segment);
        if (!className) return <span key={index}>{segment.text}</span>;
        return (
          <mark
            key={index}
            className={className}
            title={segment.titles.join(' • ') || undefined}
          >
            {segment.text}
          </mark>
        );
      })}
      {truncated ? <span className="faint">…</span> : null}
    </div>
  );
}

/** Условные обозначения к подсветке — без них два вида линий ничего не значат. */
export function HighlightLegend({ locale }: { locale: Locale }) {
  const t = translator(locale);
  return (
    <div className="legend">
      <span className="legend-item">
        <span className="legend-swatch ai" />
        {t('publicationsHighlightAi')}
      </span>
      <span className="legend-item">
        <span className="legend-swatch evidence" />
        {t('publicationsHighlightEvidence')}
      </span>
    </div>
  );
}

/**
 * Обозначение для экрана сбора.
 *
 * Отдельная подпись, а не общая с карточкой объявления: на собранном
 * элементе нет ни гипотез, ни доказательств — есть только совпадение
 * со списком слов, и называть его нужно своим именем.
 */
export function TermLegend({ locale }: { locale: Locale }) {
  const t = translator(locale);
  return (
    <div className="legend">
      <span className="legend-item">
        <span className="legend-swatch term" />
        {t('collectHighlightTerm')}
      </span>
    </div>
  );
}

/**
 * Подсветка по сработавшим словам-ловушкам.
 *
 * Позиции берутся из записи элемента: они посчитаны при сборе по тому же
 * тексту, который хранится рядом, поэтому указывают на точные символы.
 * В подсказку кладётся само слово из списка, а не группа: аналитик,
 * наводя курсор, спрашивает «что здесь сработало», и ответ «предмет»
 * ему ничего не даёт.
 */
export function spansFromHits(
  hits: readonly {
    termText: string;
    charStart: number;
    charEnd: number;
  }[],
): HighlightSpan[] {
  return hits.map((hit) => ({
    charStart: hit.charStart,
    charEnd: hit.charEnd,
    role: 'TERM' as const,
    title: `слово-ловушка «${hit.termText}»`,
  }));
}

/**
 * Сбор фрагментов для подсветки из того, что отдаёт API.
 *
 * Функция написана здесь, а не на странице, чтобы карточка объявления и
 * страница разбора собирали подсветку одинаково. Непригодные смещения
 * отбрасываются ниже, в toSegments, — страница из-за одной испорченной
 * записи не падает.
 */
export function spansFrom({
  suggestions,
  evidence,
}: {
  suggestions?: readonly {
    id: string;
    charStart: number | null;
    charEnd: number | null;
    factorCode: string | null;
    status: string;
  }[];
  evidence?: readonly {
    id: string;
    charStart: number | null;
    charEnd: number | null;
    /** Код фактора приходит через связь: у доказательства своего кода нет. */
    factor?: { code: string } | null;
  }[];
}): HighlightSpan[] {
  const result: HighlightSpan[] = [];

  for (const item of suggestions ?? []) {
    // Отклонённая гипотеза не подсвечивается: аналитик уже ответил
    // «нет», и повторное выделение фрагмента возвращало бы снятый вопрос.
    if (item.status === 'REJECTED') continue;
    if (item.charStart === null || item.charEnd === null) continue;
    result.push({
      charStart: item.charStart,
      charEnd: item.charEnd,
      role: 'AI',
      title: item.factorCode ? `${item.factorCode} — гипотеза ИИ` : 'Гипотеза ИИ',
      refId: item.id,
    });
  }

  for (const item of evidence ?? []) {
    if (item.charStart === null || item.charEnd === null) continue;
    result.push({
      charStart: item.charStart,
      charEnd: item.charEnd,
      role: 'EVIDENCE',
      title: item.factor
        ? `${item.factor.code} — доказательство аналитика`
        : 'Доказательство аналитика',
      refId: item.id,
    });
  }

  return result;
}
