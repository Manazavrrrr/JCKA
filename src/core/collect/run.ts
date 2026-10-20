/**
 * Прогон сбора: пачка сырых элементов на входе, разобранная пачка на выходе.
 *
 * Прогон сознательно ничего не сохраняет и ничего не скачивает. Коннектор
 * (он живёт в адаптерах, в src/server) приносит сюда уже полученные тексты,
 * получает обратно решения и сам решает, что писать в базу. Благодаря этому
 * вся логика отбора проверяется тестами без сети и без БД: одна и та же
 * пачка всегда даёт один и тот же результат.
 *
 * Отдельно считается, сколько элементов поймал каждый термин. Это нужно на
 * экране настроек: список слов-ловушек со временем обрастает словами,
 * которые не ловят ничего, и без счётчика их никто никогда не вычистит.
 *
 * Модуль чистый: ни Prisma, ни сети, ни текущего времени.
 */

import {
  decide,
  fingerprint,
  type CollectDecision,
  type CollectReason,
  type CollectRule,
  COLLECT_REASONS,
} from './decision';
import type { WatchTerm, WatchTermCategory } from './terms';

// ---------------------------------------------------------------------------
// Вход
// ---------------------------------------------------------------------------

/** Элемент потока в том виде, в каком его приносит коннектор. */
export interface RawItem {
  /** Идентификатор источника из каталога. */
  sourceId: string;
  /** Идентификатор в источнике: номер поста, идентификатор объявления. */
  externalId: string;
  text: string;
  url?: string | null;
  author?: string | null;
  /** Дата публикации в ISO. Берётся из источника, а не из часов системы. */
  publishedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Выход
// ---------------------------------------------------------------------------

export interface CollectedItem {
  sourceId: string;
  externalId: string;
  text: string;
  url: string | null;
  author: string | null;
  publishedAt: string | null;
  fingerprint: string;
  decision: CollectDecision;
}

export interface TermUsage {
  termId: string;
  termText: string;
  category: WatchTermCategory;
  /** Сколько элементов прогона поймал термин. Ноль — кандидат на удаление. */
  items: number;
}

export interface CollectStats {
  total: number;
  kept: number;
  skipped: number;
  byReason: Record<CollectReason, number>;
  /** Все активные термины, включая ни разу не сработавшие. */
  termUsage: TermUsage[];
}

export interface CollectRunResult {
  items: CollectedItem[];
  stats: CollectStats;
}

export interface RunOptions {
  rule?: CollectRule;
  /**
   * Отпечатки того, что уже лежит в системе с прошлых прогонов.
   * Внутри прогона повторы отслеживаются сами.
   */
  seen?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Прогон
// ---------------------------------------------------------------------------

export function runCollection(
  items: readonly RawItem[],
  terms: readonly WatchTerm[],
  options: RunOptions = {},
): CollectRunResult {
  /**
   * В набор повторов попадают только взятые элементы.
   *
   * Иначе второй экземпляр объявления, отброшенного по стоп-слову, получил
   * бы причину «уже есть в системе» — формально верно, а по сути неправда:
   * в системе его нет, его отбросили. Аналитик, разбирающийся, почему
   * объявление не дошло, увидел бы не ту причину.
   */
  const seen = new Set(options.seen ?? []);
  const results: CollectedItem[] = [];

  const byReason = Object.fromEntries(COLLECT_REASONS.map((reason) => [reason, 0])) as Record<
    CollectReason,
    number
  >;

  const usage = new Map<string, TermUsage>();
  for (const term of terms) {
    if (!term.active) continue;
    usage.set(term.id, { termId: term.id, termText: term.text, category: term.category, items: 0 });
  }

  for (const item of items) {
    const decision = decide(item.text, terms, { rule: options.rule, seen });
    const print = fingerprint(item.text);

    if (decision.verdict === 'KEPT') seen.add(print);
    byReason[decision.reason] += 1;

    // Срабатывания считаются по элементам, а не по вхождениям: слово,
    // встреченное в одном объявлении пять раз, поймало одно объявление.
    const counted = new Set<string>();
    for (const hit of [...decision.hits, ...decision.excludedBy]) {
      if (counted.has(hit.termId)) continue;
      counted.add(hit.termId);
      const entry = usage.get(hit.termId);
      if (entry) entry.items += 1;
    }

    results.push({
      sourceId: item.sourceId,
      externalId: item.externalId,
      text: item.text,
      url: item.url ?? null,
      author: item.author ?? null,
      publishedAt: item.publishedAt ?? null,
      fingerprint: print,
      decision,
    });
  }

  const kept = results.filter((item) => item.decision.verdict === 'KEPT').length;

  return {
    items: results,
    stats: {
      total: results.length,
      kept,
      skipped: results.length - kept,
      byReason,
      termUsage: [...usage.values()].sort((a, b) => b.items - a.items || a.termText.localeCompare(b.termText)),
    },
  };
}
