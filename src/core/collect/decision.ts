/**
 * Решение по одному элементу потока: взять или отбросить — и почему.
 *
 * Требование к этому модулю ровно одно, и оно жёстче, чем кажется: по
 * каждому элементу должна остаться фраза, объясняющая решение словами
 * самого элемента. Не «отфильтровано», а «поймано словом „рассрочка“
 * (предложение денег) и словом „застройщик“ (кто продаёт)». Не «не прошло»,
 * а «сработала только одна группа — предмет („квартира“); этого мало,
 * иначе в выборку попадёт вся вторичная недвижимость».
 *
 * Причина требования не в красоте интерфейса. Сбор — это первый шаг, на
 * котором система что-то решает за аналитика, и единственный, чьи ошибки
 * невидимы: отброшенное объявление никуда не попадает и ниоткуда не
 * всплывёт. Поэтому отброшенное хранится вместе с причиной, а не
 * выбрасывается, и аналитик может увидеть, какое слово нужно добавить
 * или какое стоп-слово лишнее.
 *
 * Правило отбора. Объявление берётся, если:
 *
 *   1. не сработало ни одно стоп-слово;
 *   2. сработали термины минимум из двух разных положительных категорий.
 *
 * Второе условие — главное. Слово «квартира» само по себе не значит ничего:
 * оно есть в каждом втором объявлении страны. Признаком становится
 * сочетание — предмет и предложение денег, предмет и стадия стройки.
 * Порог вынесен в настройку, чтобы аналитик мог ослабить его на период,
 * когда важнее полнота, чем чистота очереди.
 *
 * Модуль чистый: ни Prisma, ни сети, ни текущего времени.
 */

import { z } from 'zod';

import { fold } from '../ai/text';
import type { Label } from '../domain/enums';
import {
  hitCategories,
  distinctTerms,
  matchTerms,
  POSITIVE_CATEGORIES,
  WATCH_TERM_CATEGORY_LABELS,
  type TermHit,
  type WatchTerm,
  type WatchTermCategory,
} from './terms';

// ---------------------------------------------------------------------------
// Вердикт и причина
// ---------------------------------------------------------------------------

export const COLLECT_VERDICTS = ['KEPT', 'SKIPPED'] as const;
export const collectVerdictSchema = z.enum(COLLECT_VERDICTS);
export type CollectVerdict = z.infer<typeof collectVerdictSchema>;

export const COLLECT_VERDICT_LABELS: Record<CollectVerdict, Label> = {
  KEPT: { ru: 'Взято в работу', kk: 'Жұмысқа алынды' },
  SKIPPED: { ru: 'Отброшено', kk: 'Шығарылды' },
};

export const COLLECT_REASONS = [
  'MATCHED',
  'NO_MATCH',
  'EXCLUDED',
  'TOO_NARROW',
  'DUPLICATE',
] as const;
export const collectReasonSchema = z.enum(COLLECT_REASONS);
export type CollectReason = z.infer<typeof collectReasonSchema>;

export const COLLECT_REASON_LABELS: Record<CollectReason, Label> = {
  MATCHED: { ru: 'Совпали слова-ловушки', kk: 'Сөз-тұзақтар сәйкес келді' },
  NO_MATCH: { ru: 'Ни одного совпадения', kk: 'Бірде-бір сәйкестік жоқ' },
  EXCLUDED: { ru: 'Сработало стоп-слово', kk: 'Тоқтату сөзі іске қосылды' },
  TOO_NARROW: { ru: 'Совпадений слишком мало', kk: 'Сәйкестік тым аз' },
  DUPLICATE: { ru: 'Уже есть в системе', kk: 'Жүйеде бұрыннан бар' },
};

// ---------------------------------------------------------------------------
// Настройка правила
// ---------------------------------------------------------------------------

export interface CollectRule {
  /**
   * Сколько разных положительных категорий должно сработать.
   * Единица означает «берём по любому совпадению» — это осознанный
   * выбор аналитика в пользу полноты, а не ошибка настройки.
   */
  minCategories: number;
}

export const DEFAULT_COLLECT_RULE: CollectRule = { minCategories: 2 };

export const collectRuleSchema = z.object({
  minCategories: z.number().int().min(1).max(POSITIVE_CATEGORIES.length),
});

// ---------------------------------------------------------------------------
// Отпечаток текста
// ---------------------------------------------------------------------------

/**
 * Отпечаток для поиска повторов.
 *
 * Одно и то же объявление приходит по нескольку раз: канал повторяет пост,
 * застройщик обновляет цену, не меняя остального текста. Сравнивать строки
 * целиком нельзя — различаются эмодзи, пробелы и регистр, — поэтому текст
 * сначала сворачивается до букв и цифр.
 *
 * Хеш — FNV-1a в двух вариантах начального значения, шестнадцать
 * шестнадцатеричных знаков. Криптостойкость здесь не нужна: от подбора
 * коллизии никто не защищается, нужна короткая детерминированная строка,
 * которую можно положить в индекс БД. Готовая функция из node:crypto не
 * взята сознательно — ядро должно оставаться пригодным к запуску
 * в браузере.
 */
export function fingerprint(text: string): string {
  const normalized = fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  let a = 0x811c9dc5;
  let b = 0x01000193;

  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x811c9dc5) >>> 0;
  }

  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Решение
// ---------------------------------------------------------------------------

export interface CollectDecision {
  verdict: CollectVerdict;
  reason: CollectReason;
  /** Сработавшие положительные термины, по порядку в тексте. */
  hits: TermHit[];
  /** Сработавшие стоп-слова. Непусто только при причине EXCLUDED. */
  excludedBy: TermHit[];
  /** Положительные категории, которые сработали. */
  categories: WatchTermCategory[];
  /** Фраза для интерфейса: решение словами самого объявления. */
  explanation: Label;
}

export interface DecideOptions {
  rule?: CollectRule;
  /** Отпечатки уже собранного: повтор отбрасывается с отдельной причиной. */
  seen?: ReadonlySet<string>;
}

/**
 * Разбирает текст словами-ловушками и выносит решение.
 *
 * Порядок проверок соответствует порядку, в котором об этом думает человек:
 * сначала «это вообще не про то» (стоп-слово), потом «тут ничего нет»,
 * потом «тут мало», и только затем «берём». Повтор проверяется первым,
 * потому что по уже собранному тексту разбор не нужен вовсе.
 */
export function decide(text: string, terms: readonly WatchTerm[], options: DecideOptions = {}): CollectDecision {
  const rule = options.rule ?? DEFAULT_COLLECT_RULE;

  if (options.seen?.has(fingerprint(text))) {
    return {
      verdict: 'SKIPPED',
      reason: 'DUPLICATE',
      hits: [],
      excludedBy: [],
      categories: [],
      explanation: {
        ru: 'Отброшено: такой же текст уже собран — отличия только в пробелах, регистре и значках.',
        kk: 'Шығарылды: дәл осындай мәтін бұрын жиналған — айырмашылық тек бос орындарда, әріп регистрінде және таңбаларда.',
      },
    };
  }

  const allHits = matchTerms(text, terms);
  const excludedBy = allHits.filter((hit) => hit.category === 'EXCLUDE');
  const hits = allHits.filter((hit) => hit.category !== 'EXCLUDE');
  const categories = hitCategories(hits);

  if (excludedBy.length > 0) {
    return {
      verdict: 'SKIPPED',
      reason: 'EXCLUDED',
      hits,
      excludedBy,
      categories,
      explanation: explainExcluded(excludedBy),
    };
  }

  if (hits.length === 0) {
    return {
      verdict: 'SKIPPED',
      reason: 'NO_MATCH',
      hits,
      excludedBy,
      categories,
      explanation: {
        ru: 'Отброшено: ни одно активное слово-ловушка в тексте не встретилось.',
        kk: 'Шығарылды: мәтінде бірде-бір белсенді сөз-тұзақ кездеспеді.',
      },
    };
  }

  if (categories.length < rule.minCategories) {
    return {
      verdict: 'SKIPPED',
      reason: 'TOO_NARROW',
      hits,
      excludedBy,
      categories,
      explanation: explainTooNarrow(hits, categories, rule),
    };
  }

  return {
    verdict: 'KEPT',
    reason: 'MATCHED',
    hits,
    excludedBy,
    categories,
    explanation: explainMatched(hits),
  };
}

// ---------------------------------------------------------------------------
// Формулировки
// ---------------------------------------------------------------------------

/** «„рассрочка“ (предложение денег), „застройщик“ (кто продаёт)». */
function listHits(hits: readonly TermHit[], language: keyof Label): string {
  return distinctTerms(hits)
    .map((hit) => `«${hit.termText}» (${WATCH_TERM_CATEGORY_LABELS[hit.category][language].toLowerCase()})`)
    .join(', ');
}

function explainMatched(hits: readonly TermHit[]): Label {
  return {
    ru: `Поймано словами: ${listHits(hits, 'ru')}.`,
    kk: `Мына сөздермен ұсталды: ${listHits(hits, 'kk')}.`,
  };
}

/** «„посуточно“, „аренд*“» — без названия группы: её называет сама фраза. */
function listWords(hits: readonly TermHit[]): string {
  return distinctTerms(hits)
    .map((hit) => `«${hit.termText}»`)
    .join(', ');
}

function explainExcluded(excludedBy: readonly TermHit[]): Label {
  const words = listWords(excludedBy);

  return {
    ru: `Отброшено: сработало стоп-слово ${words}. Такие объявления к долевому строительству не относятся.`,
    kk: `Шығарылды: ${words} тоқтату сөзі іске қосылды. Мұндай хабарландырулар үлестік құрылысқа қатысты емес.`,
  };
}

function explainTooNarrow(
  hits: readonly TermHit[],
  categories: readonly WatchTermCategory[],
  rule: CollectRule,
): Label {
  const groups = categories
    .map((category) => WATCH_TERM_CATEGORY_LABELS[category].ru.toLowerCase())
    .join(', ');
  const groupsKk = categories
    .map((category) => WATCH_TERM_CATEGORY_LABELS[category].kk.toLowerCase())
    .join(', ');

  // Категория уже названа в «Сработала группа …», поэтому слова перечисляются
  // без повторного ярлыка: «группа „предмет“ — „квартир*“ (предмет)» читается как заикание.
  const words = listWords(hits);

  return {
    ru:
      `Отброшено: совпадений мало. Сработала группа «${groups}» — ${words}. ` +
      `Нужно совпадение минимум по ${rule.minCategories} разным группам, иначе в выборку попадёт вся вторичная недвижимость.`,
    kk:
      `Шығарылды: сәйкестік аз. «${groupsKk}» тобы іске қосылды — ${words}. ` +
      `Кемінде ${rule.minCategories} түрлі топ бойынша сәйкестік қажет, әйтпесе таңдауға бүкіл қайталама тұрғын үй түседі.`,
  };
}
