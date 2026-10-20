/**
 * Поиск без перечня со стороны сервера: слова поиска, деньги, остаток дня.
 *
 * Здесь лежит то, что нельзя вычислить без базы: какие слова включены, что
 * уже израсходовано за сутки и сколько осталось. Арифметика денег и правила
 * отказа живут в ядре (src/core/collect/budget.ts) и сюда приходят готовыми
 * — поэтому их можно проверить без базы, а здесь остаётся только чтение.
 *
 * Два решения, которые стоит объяснить.
 *
 * Первое: израсходованное за сутки считается по сохранённым прогонам, а не
 * хранится счётчиком. Счётчик — это второе место, где живёт правда о
 * расходе, и он расходится с историей при первом же сбое на середине
 * операции. Сумма по прогонам не может разойтись с прогонами по устройству.
 *
 * Второе: дневной предел берётся из окружения и приводится к допустимому
 * отрезку. Предел, выставленный в тысячу долларов опечаткой, перестаёт быть
 * пределом; потолок MAX_DAILY_BUDGET_USD не настраивается нигде.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import {
  DEFAULT_DAILY_BUDGET_USD,
  DEFAULT_SEARCH_QUERIES,
  HASHTAG_PROBLEM_TEXT,
  INSTAGRAM_SOURCE_ID,
  MAX_ACTIVE_QUERIES,
  clampDailyBudgetUsd,
  decideBudget,
  hasGeoMarker,
  hashtagExploreUrl,
  normalizeHashtag,
  spentTodayUsd,
  startOfLocalDay,
  type BudgetDecision,
  type HashtagProblem,
} from '../core/collect';
import { writeAudit } from '../core/scoring/service';
import { HttpError, notFound } from './http';

export type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Слова поиска
// ---------------------------------------------------------------------------

export interface SearchQueryView {
  id: string;
  sourceId: string;
  tag: string;
  active: boolean;
  noteRu: string | null;
  noteKk: string | null;
  lastWalkedAt: Date | null;
  lastFound: number;
  /** Адрес страницы тега: аналитик может открыть и убедиться сам. */
  exploreUrl: string;
  /** Есть ли в слове привязка к месту. Без неё обход уходит в другие регионы. */
  geoAnchored: boolean;
}

function toView(row: {
  id: string;
  sourceId: string;
  tag: string;
  active: boolean;
  noteRu: string | null;
  noteKk: string | null;
  lastWalkedAt: Date | null;
  lastFound: number;
}): SearchQueryView {
  return {
    ...row,
    exploreUrl: hashtagExploreUrl(row.tag),
    geoAnchored: hasGeoMarker(row.tag),
  };
}

export async function listSearchQueries(db: Db): Promise<SearchQueryView[]> {
  const rows = await db.searchQuery.findMany({
    orderBy: [{ active: 'desc' }, { tag: 'asc' }],
    select: {
      id: true,
      sourceId: true,
      tag: true,
      active: true,
      noteRu: true,
      noteKk: true,
      lastWalkedAt: true,
      lastFound: true,
    },
  });

  return rows.map(toView);
}

/** Включённые слова в том виде, в каком их примет сборщик. */
export async function activeSearchTags(db: Db): Promise<string[]> {
  const rows = await db.searchQuery.findMany({
    where: { active: true, sourceId: INSTAGRAM_SOURCE_ID },
    orderBy: { tag: 'asc' },
    select: { tag: true },
  });

  return rows.map((row) => row.tag);
}

function rejectTag(problem: HashtagProblem): HttpError {
  return new HttpError('VALIDATION', HASHTAG_PROBLEM_TEXT[problem].ru);
}

export interface CreateSearchQueryInput {
  tag: string;
  active?: boolean;
  noteRu?: string | null;
  noteKk?: string | null;
  actor: string;
}

/**
 * Добавление слова поиска.
 *
 * Приведение к виду тега возвращается вызывающему вместе с признаком
 * «изменено»: написанное словами («жк усть каменогорск») ищется склеенным
 * («жкустькаменогорск»), и аналитик должен увидеть, что именно уйдёт в
 * запрос, а не узнать об этом по пустому результату.
 */
export async function createSearchQuery(
  db: PrismaClient,
  input: CreateSearchQueryInput,
): Promise<{ query: SearchQueryView; changed: boolean }> {
  const normalized = normalizeHashtag(input.tag);
  if (!normalized.tag) throw rejectTag(normalized.problem ?? 'EMPTY');

  const existing = await db.searchQuery.findUnique({
    where: { sourceId_tag: { sourceId: INSTAGRAM_SOURCE_ID, tag: normalized.tag } },
  });

  if (existing) {
    throw new HttpError(
      'PRECONDITION',
      `Слово «${normalized.tag}» уже есть в списке. Два одинаковых слова — это два ` +
        'запроса к одной и той же странице тега и двойная плата за один результат.',
    );
  }

  const active = input.active ?? true;
  if (active) await assertRoomForOneMore(db);

  const row = await db.searchQuery.create({
    data: {
      sourceId: INSTAGRAM_SOURCE_ID,
      tag: normalized.tag,
      active,
      noteRu: input.noteRu ?? null,
      noteKk: input.noteKk ?? null,
      createdBy: input.actor,
    },
  });

  await writeAudit(db, {
    entityType: 'SearchQuery',
    entityId: row.id,
    action: 'SEARCH_QUERY_CREATED',
    actor: input.actor,
    after: { tag: row.tag, active: row.active, geoAnchored: hasGeoMarker(row.tag) },
    comment:
      `Добавлено слово поиска «${row.tag}»` +
      (normalized.changed ? ` (введено «${input.tag.trim()}», приведено к виду тега).` : '.'),
  });

  return { query: toView(row), changed: normalized.changed };
}

/**
 * Потолок включённых слов — это потолок расхода на один обход.
 *
 * Сборщик берёт свою долю результатов на каждый адрес, поэтому цена обхода
 * растёт произведением числа слов на долю. Ограничение здесь, а не в
 * настройке, по той же причине, по которой потолок прогона не настраивается:
 * иначе предел снимается опечаткой.
 */
async function assertRoomForOneMore(db: Db): Promise<void> {
  const active = await db.searchQuery.count({ where: { active: true } });
  if (active < MAX_ACTIVE_QUERIES) return;

  throw new HttpError(
    'PRECONDITION',
    `Включённых слов уже ${active}, больше ${MAX_ACTIVE_QUERIES} обход не берёт: ` +
      'каждое слово — отдельная страница тега и отдельная плата. ' +
      'Выключите ненужное слово, прежде чем добавлять новое.',
  );
}

export interface SearchQueryPatch {
  active?: boolean;
  noteRu?: string | null;
  noteKk?: string | null;
}

export async function updateSearchQuery(
  db: PrismaClient,
  id: string,
  patch: SearchQueryPatch,
  actor: string,
): Promise<SearchQueryView> {
  const before = await db.searchQuery.findUnique({ where: { id } });
  if (!before) throw notFound('Слово поиска');

  if (patch.active === true && !before.active) await assertRoomForOneMore(db);

  const row = await db.searchQuery.update({
    where: { id },
    data: {
      ...(patch.active === undefined ? {} : { active: patch.active }),
      ...(patch.noteRu === undefined ? {} : { noteRu: patch.noteRu }),
      ...(patch.noteKk === undefined ? {} : { noteKk: patch.noteKk }),
    },
  });

  await writeAudit(db, {
    entityType: 'SearchQuery',
    entityId: row.id,
    action: 'SEARCH_QUERY_UPDATED',
    actor,
    before: { active: before.active, noteRu: before.noteRu },
    after: { active: row.active, noteRu: row.noteRu },
    comment:
      before.active === row.active
        ? `Изменено пояснение к слову «${row.tag}».`
        : `Слово «${row.tag}» ${row.active ? 'включено в обход' : 'выключено из обхода'}.`,
  });

  return toView(row);
}

/**
 * Удаление слова.
 *
 * Удаляется само слово, но не найденное по нему: элементы сбора привязаны к
 * прогону, а не к слову, и остаются на месте. Иначе удаление слова стирало
 * бы из истории объявления, по которым аналитик уже принял решение.
 */
export async function deleteSearchQuery(
  db: PrismaClient,
  id: string,
  actor: string,
): Promise<void> {
  const before = await db.searchQuery.findUnique({ where: { id } });
  if (!before) throw notFound('Слово поиска');

  await db.searchQuery.delete({ where: { id } });

  await writeAudit(db, {
    entityType: 'SearchQuery',
    entityId: id,
    action: 'SEARCH_QUERY_DELETED',
    actor,
    before: { tag: before.tag, active: before.active, lastFound: before.lastFound },
    comment: `Удалено слово поиска «${before.tag}». Найденное по нему остаётся в истории прогонов.`,
  });
}

export interface RestoreResult {
  /** Слова, которых в списке не было и которые добавлены сейчас. */
  added: string[];
  /** Из добавленных — те, что пришлось оставить выключенными. */
  addedDisabled: string[];
  /** Слова из набора, которые уже были в списке и не тронуты. */
  kept: string[];
  activeCount: number;
}

/**
 * Вернуть набор слов по умолчанию.
 *
 * Зачем это действие вообще нужно. Слова живут в базе, а не в коде, и это
 * правильно — но у такого решения есть обратная сторона: аналитик, удаливший
 * все слова, остаётся с пустым экраном и без способа начать заново, кроме
 * пересоздания базы, то есть потери всей работы. То же состояние возникает
 * после `npm run db:push` на базе прежней версии: таблица появилась, а слов
 * в ней нет. Кнопка закрывает оба случая.
 *
 * Три решения в этой функции.
 *
 * Первое. Существующие слова не трогаются вообще — ни пояснение, ни
 * включённость, ни история обходов. Слово, которое аналитик выключил сам,
 * не включается обратно: «вернуть набор» значит «доложить недостающее», а не
 * «отменить мои решения». Поэтому в ответе отдельно названо и добавленное, и
 * оставленное как было.
 *
 * Второе. Потолок включённых слов соблюдается, но отказом не отвечает:
 * недостающие слова добавляются, и те, которым не хватило места, приходят
 * выключенными. Отказ «в списке уже десять включённых» оставил бы аналитика
 * с той же пустотой, из которой он нажимал кнопку; выключенное слово он
 * включит сам, когда освободит место, — и увидит, какие именно пришли
 * выключенными.
 *
 * Третье. Всё пишется в журнал одной записью на слово, как и ручное
 * добавление. Набор по умолчанию — такое же решение, как введённое руками, и
 * прятать его из журнала значило бы, что в списке появились слова без автора.
 */
export async function restoreDefaultSearchQueries(
  db: PrismaClient,
  actor: string,
): Promise<RestoreResult> {
  const existing = new Set(
    (await db.searchQuery.findMany({ select: { tag: true } })).map((row) => row.tag),
  );

  let activeCount = await db.searchQuery.count({ where: { active: true } });

  const result: RestoreResult = { added: [], addedDisabled: [], kept: [], activeCount };

  for (const seed of DEFAULT_SEARCH_QUERIES) {
    if (existing.has(seed.tag)) {
      result.kept.push(seed.tag);
      continue;
    }

    const active = seed.active && activeCount < MAX_ACTIVE_QUERIES;

    const row = await db.searchQuery.create({
      data: {
        sourceId: INSTAGRAM_SOURCE_ID,
        tag: seed.tag,
        active,
        noteRu: seed.note.ru,
        noteKk: seed.note.kk,
        createdBy: actor,
      },
    });

    if (active) activeCount += 1;
    result.added.push(seed.tag);
    if (seed.active && !active) result.addedDisabled.push(seed.tag);

    await writeAudit(db, {
      entityType: 'SearchQuery',
      entityId: row.id,
      action: 'SEARCH_QUERY_CREATED',
      actor,
      after: { tag: row.tag, active: row.active, geoAnchored: hasGeoMarker(row.tag) },
      comment:
        `Слово поиска «${row.tag}» добавлено возвратом набора по умолчанию` +
        (seed.active && !active
          ? ` и оставлено выключенным: включённых слов уже ${MAX_ACTIVE_QUERIES}.`
          : '.'),
    });
  }

  result.activeCount = activeCount;
  return result;
}

/** Отметка после обхода: когда ходили и сколько принесло. */
export async function markWalked(
  db: Db,
  tags: readonly string[],
  found: number,
  at: Date,
): Promise<void> {
  if (tags.length === 0) return;

  await db.searchQuery.updateMany({
    where: { sourceId: INSTAGRAM_SOURCE_ID, tag: { in: [...tags] } },
    data: { lastWalkedAt: at, lastFound: found },
  });
}

// ---------------------------------------------------------------------------
// Деньги
// ---------------------------------------------------------------------------

/**
 * Дневной предел из окружения.
 *
 * Отсутствие переменной — не ошибка, а обычный случай: предел по умолчанию
 * выбран так, чтобы демонстрация работала без настройки и без неожиданного
 * счёта. Нечитаемое значение приводится к тому же умолчанию, а не к нулю:
 * опечатка в переменной не должна выглядеть как «обход выключен».
 */
export function dailyBudgetUsd(): number {
  const raw = process.env.COLLECT_DAILY_BUDGET_USD?.trim();
  if (!raw) return DEFAULT_DAILY_BUDGET_USD;

  const parsed = Number(raw.replace(',', '.'));
  if (!Number.isFinite(parsed)) return DEFAULT_DAILY_BUDGET_USD;

  return clampDailyBudgetUsd(parsed);
}

/** Платные прогоны за местные сутки — основа для подсчёта остатка. */
export async function paidRunsToday(db: Db, now: Date) {
  const rows = await db.collectRun.findMany({
    where: { startedAt: { gte: startOfLocalDay(now) }, costUsd: { gt: 0 } },
    select: { startedAt: true, costUsd: true },
  });

  return rows.map((row) => ({ startedAt: row.startedAt, costUsd: row.costUsd }));
}

/**
 * Можно ли потратиться на обход прямо сейчас.
 *
 * Решение целиком принимает ядро; здесь только собраны три числа, которых у
 * ядра нет: израсходованное, предел и размер задуманного обхода.
 */
export async function budgetStatus(
  db: Db,
  options: { plannedResults: number; now?: Date },
): Promise<BudgetDecision> {
  const now = options.now ?? new Date();
  const runs = await paidRunsToday(db, now);

  return decideBudget({
    runs,
    dailyBudgetUsd: dailyBudgetUsd(),
    plannedResults: options.plannedResults,
    now,
  });
}

/** Сколько уже израсходовано за местные сутки, доллары. */
export async function spentToday(db: Db, now: Date = new Date()): Promise<number> {
  return spentTodayUsd(await paidRunsToday(db, now), now);
}
