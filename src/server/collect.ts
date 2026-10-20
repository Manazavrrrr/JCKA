/**
 * Слой сбора со стороны сервера: сеть, база и журнал действий.
 *
 * Разделение с ядром проведено по одной линии: здесь всё, что нельзя
 * повторить в тесте, — запрос к t.me, запись в базу, текущее время. Решение
 * «брать или не брать» принимается в src/core/collect и сюда приходит уже
 * готовым вместе с объяснением. Поэтому проверить правило отбора можно, не
 * поднимая ни сервера, ни сети, а здесь остаётся только порядок операций.
 *
 * Три решения, которые стоит объяснить.
 *
 * Первое. Прогон сохраняется целиком, включая отброшенное. Отброшенное
 * объявление больше нигде не появится, и если фильтр настроен неверно,
 * заметить это можно только одним способом — открыв список отказов с
 * причиной по каждому. Хранение «мусора» здесь и есть проверяемость.
 *
 * Второе. Неудачный прогон — это тоже запись в таблице, со статусом FAILED
 * и текстом ошибки. Иначе сбой выглядит как «ничего не нашли»: внешне
 * неотличимо от пустого канала, а по сути противоположно.
 *
 * Третье. Счётчик срабатываний термина считается по сохранённым элементам,
 * а не берётся из статистики прогона. Статистика прогона — снимок на момент
 * прогона; термин, добавленный вчера, в ней отсутствует и выглядел бы
 * мёртвым. Пересчёт по элементам отвечает на вопрос аналитика буквально:
 * сколько объявлений поймало это слово за всё время.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import {
  APIFY_TOKEN_PAGE,
  ApifyParseError,
  DEFAULT_COLLECT_RULE,
  DEFAULT_HASHTAG_LIMIT,
  DEFAULT_POSTS_LIMIT,
  DEFAULT_WATCH_TERMS,
  INSTAGRAM_SOURCE_ID,
  TelegramParseError,
  apifyRunUrl,
  channelUrl,
  clampPostsLimit,
  estimateRunCostUsd,
  findSource,
  instagramHashtagInput,
  instagramScraperInput,
  limitPerTagWithinWalk,
  normalizeChannel,
  normalizeInstagramAccount,
  parseApifyPosts,
  parseTelegramPage,
  plannedWalkResults,
  runCollection,
  type BudgetDecision,
  type CollectedItem as CollectedItemResult,
  type InstagramScraperInput,
  type RawItem,
  type TermHit,
  type WatchTerm,
  type WatchTermCategory,
  type WatchTermInput,
} from '../core/collect';
import { APIFY_FIXTURE_ACCOUNT, APIFY_FIXTURE_POSTS } from '../core/collect/apify.fixture';
import type { Label } from '../core/domain/enums';
import { writeAudit } from '../core/scoring/service';
import { activeSearchTags, budgetStatus, markWalked } from './discovery';
import { HttpError, notFound } from './http';

export type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Слова-ловушки
// ---------------------------------------------------------------------------

/** Строка базы → термин в том виде, в каком его понимает ядро. */
function toWatchTerm(row: {
  id: string;
  category: string;
  language: string;
  text: string;
  active: boolean;
  noteRu: string | null;
  noteKk: string | null;
}): WatchTerm {
  return {
    id: row.id,
    category: row.category as WatchTermCategory,
    language: row.language as WatchTerm['language'],
    text: row.text,
    active: row.active,
    note: row.noteRu && row.noteKk ? { ru: row.noteRu, kk: row.noteKk } : null,
  };
}

/** Все термины, включая выключенные: прогон сам отсеет неактивные. */
export async function loadWatchTerms(db: Db): Promise<WatchTerm[]> {
  const rows = await db.watchTerm.findMany({ orderBy: [{ category: 'asc' }, { text: 'asc' }] });
  return rows.map(toWatchTerm);
}

/**
 * Сколько элементов поймал каждый термин за всё время.
 *
 * Считается разбором hitsJson сохранённых элементов. На объёмах надзорного
 * органа это десятки тысяч строк в год — читается за один запрос; если
 * когда-нибудь перестанет, счётчик переедет в отдельную таблицу, но
 * заводить её сейчас значило бы усложнить схему ради гипотезы.
 */
async function termUsage(db: Db): Promise<Map<string, number>> {
  const rows = await db.collectedItem.findMany({ select: { hitsJson: true } });
  const usage = new Map<string, number>();

  for (const row of rows) {
    let hits: TermHit[];
    try {
      hits = JSON.parse(row.hitsJson) as TermHit[];
    } catch {
      continue;
    }

    // Один элемент считается термину один раз, сколько бы раз слово
    // ни встретилось в тексте: аналитика интересуют объявления, а не слова.
    for (const termId of new Set(hits.map((hit) => hit.termId))) {
      usage.set(termId, (usage.get(termId) ?? 0) + 1);
    }
  }

  return usage;
}

export interface WatchTermView extends WatchTerm {
  /** Сколько объявлений поймал термин. Ноль — кандидат на пересмотр. */
  caught: number;
  updatedAt: Date;
}

export async function listWatchTerms(db: Db): Promise<WatchTermView[]> {
  const [rows, usage] = await Promise.all([
    db.watchTerm.findMany({ orderBy: [{ category: 'asc' }, { text: 'asc' }] }),
    termUsage(db),
  ]);

  return rows.map((row) => ({
    ...toWatchTerm(row),
    caught: usage.get(row.id) ?? 0,
    updatedAt: row.updatedAt,
  }));
}

/** Повтор термина в той же группе — не сбой, а подсказка: он уже есть. */
function duplicateTerm(text: string): HttpError {
  return new HttpError('PRECONDITION', `Слово «${text}» в этой группе уже заведено.`);
}

export async function createWatchTerm(
  db: PrismaClient,
  input: WatchTermInput,
  actor: string,
): Promise<WatchTermView> {
  const existing = await db.watchTerm.findUnique({
    where: { category_text: { category: input.category, text: input.text } },
  });
  if (existing) throw duplicateTerm(input.text);

  return db.$transaction(async (tx) => {
    const row = await tx.watchTerm.create({
      data: {
        category: input.category,
        language: input.language,
        text: input.text,
        active: input.active,
        noteRu: input.note?.ru ?? null,
        noteKk: input.note?.kk ?? null,
        createdBy: actor,
      },
    });

    await writeAudit(tx, {
      entityType: 'WatchTerm',
      entityId: row.id,
      action: 'WATCH_TERM_CREATED',
      actor,
      after: { category: row.category, text: row.text, active: row.active },
      comment: 'Добавлено слово-ловушка. Повлияет на следующие прогоны сбора.',
    });

    return { ...toWatchTerm(row), caught: 0, updatedAt: row.updatedAt };
  });
}

export interface WatchTermPatch {
  text?: string;
  active?: boolean;
  language?: WatchTerm['language'];
  note?: { ru: string; kk: string } | null;
}

export async function updateWatchTerm(
  db: PrismaClient,
  id: string,
  patch: WatchTermPatch,
  actor: string,
): Promise<WatchTermView> {
  const before = await db.watchTerm.findUnique({ where: { id } });
  if (!before) throw notFound('Слово-ловушка');

  if (patch.text !== undefined && patch.text !== before.text) {
    const clash = await db.watchTerm.findUnique({
      where: { category_text: { category: before.category, text: patch.text } },
    });
    if (clash) throw duplicateTerm(patch.text);
  }

  const [row, usage] = await db.$transaction(async (tx) => {
    const updated = await tx.watchTerm.update({
      where: { id },
      data: {
        ...(patch.text !== undefined && { text: patch.text }),
        ...(patch.active !== undefined && { active: patch.active }),
        ...(patch.language !== undefined && { language: patch.language }),
        ...(patch.note !== undefined && {
          noteRu: patch.note?.ru ?? null,
          noteKk: patch.note?.kk ?? null,
        }),
      },
    });

    await writeAudit(tx, {
      entityType: 'WatchTerm',
      entityId: id,
      action: 'WATCH_TERM_UPDATED',
      actor,
      before: { text: before.text, active: before.active },
      after: { text: updated.text, active: updated.active },
      comment: 'Изменено слово-ловушка. Уже собранные решения не пересчитываются.',
    });

    return [updated, await termUsage(tx)] as const;
  });

  return { ...toWatchTerm(row), caught: usage.get(row.id) ?? 0, updatedAt: row.updatedAt };
}

export async function deleteWatchTerm(
  db: PrismaClient,
  id: string,
  actor: string,
): Promise<{ id: string }> {
  const before = await db.watchTerm.findUnique({ where: { id } });
  if (!before) throw notFound('Слово-ловушка');

  return db.$transaction(async (tx) => {
    await tx.watchTerm.delete({ where: { id } });

    /**
     * Удаление слова не переписывает прошлые решения: объяснение к элементу
     * сохранено строкой (см. explanationRu в схеме) и остаётся правдой о том,
     * почему элемент взяли тогда. Журнал фиксирует, когда слово исчезло.
     */
    await writeAudit(tx, {
      entityType: 'WatchTerm',
      entityId: id,
      action: 'WATCH_TERM_DELETED',
      actor,
      before: { category: before.category, text: before.text },
      comment: 'Удалено слово-ловушка. Ранее собранные элементы и их объяснения сохранены.',
    });

    return { id };
  });
}

export interface RestoreTermsResult {
  /** Слова, которых в базе не было и которые добавлены сейчас. */
  added: string[];
  /** Слова набора, уже стоявшие в базе. Не тронуты. */
  kept: number;
  activeCount: number;
}

/**
 * Возврат набора слов-ловушек по умолчанию.
 *
 * Тупик, который закрывает эта кнопка, тише денежного: слова-ловушки
 * бесплатны, и удалить их все кажется безобидным. Но прогон без включённых
 * ловушек отбрасывает всё прочитанное — внешне это ровно то же, что
 * «реклама кончилась». Вернуть набор вручную значило бы заводить семь
 * десятков слов по одному, то есть на деле — пересоздавать базу.
 *
 * Правило то же, что у слов поиска, и по той же причине: имеющееся не
 * трогаем. Выключенная ловушка остаётся выключенной, правленый текст —
 * правленым, пояснение — своим. Возврат доливает недостающее, а не
 * откатывает настройку к заводской.
 *
 * Совпадение ищется по паре «группа + текст» — тому же ключу, по которому
 * база не даёт завести двойника. Слово «ЖК», перенесённое аналитиком из
 * одной группы в другую, поэтому считается отсутствующим в своей и будет
 * доложено: группа у ловушки — не ярлык, а то, в какой из пяти признаков
 * она складывается при отборе.
 */
export async function restoreDefaultWatchTerms(
  db: PrismaClient,
  actor: string,
): Promise<RestoreTermsResult> {
  const rows = await db.watchTerm.findMany({ select: { category: true, text: true } });
  const existing = new Set(rows.map((row) => `${row.category} ${row.text}`));

  const result: RestoreTermsResult = { added: [], kept: 0, activeCount: 0 };

  for (const term of DEFAULT_WATCH_TERMS) {
    if (existing.has(`${term.category} ${term.text}`)) {
      result.kept += 1;
      continue;
    }

    const row = await db.watchTerm.create({
      data: {
        category: term.category,
        language: term.language,
        text: term.text,
        active: term.active,
        noteRu: term.note?.ru ?? null,
        noteKk: term.note?.kk ?? null,
        createdBy: actor,
      },
    });

    result.added.push(term.text);

    await writeAudit(db, {
      entityType: 'WatchTerm',
      entityId: row.id,
      action: 'WATCH_TERM_CREATED',
      actor,
      after: { category: row.category, text: row.text, active: row.active },
      comment: `Слово-ловушка «${row.text}» добавлено возвратом набора по умолчанию.`,
    });
  }

  result.activeCount = await db.watchTerm.count({ where: { active: true } });
  return result;
}

// ---------------------------------------------------------------------------
// Чтение витрины канала
// ---------------------------------------------------------------------------

/** Сколько ждём ответ t.me, мс. Дольше — считаем, что источник недоступен. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Скачивает витрину публичного канала.
 *
 * Запрос идёт на тот же адрес, который открывает обычный браузер, и ничего,
 * кроме общедоступной страницы, не запрашивает: ни токена, ни входа, ни
 * приватных методов API. Заголовок User-Agent указан честно — так владелец
 * канала в своей статистике видит, кто читал витрину.
 */
export async function fetchChannelPage(channel: string): Promise<string> {
  const url = channelUrl(channel);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'user-agent': 'SAQ-QURYLYS/1.0 (monitoring of public construction ads)',
        'accept-language': 'ru,kk;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(
      'PRECONDITION',
      `Не удалось открыть ${url}: ${reason}. ` +
        'Проверьте подключение к интернету — витрина канала читается напрямую с t.me.',
    );
  }

  if (response.status === 404) {
    throw new HttpError(
      'NOT_FOUND',
      `Канала @${channel} нет или у него нет открытой веб-версии. ` +
        'Публичную витрину имеют только каналы с коротким именем.',
    );
  }

  if (!response.ok) {
    throw new HttpError(
      'PRECONDITION',
      `Telegram ответил ${response.status} на запрос ${url}. Попробуйте позже.`,
    );
  }

  return response.text();
}

// ---------------------------------------------------------------------------
// Прогон
// ---------------------------------------------------------------------------

export interface StartCollectInput {
  /** Имя канала в любом виде: «@имя», ссылка, чистое имя. */
  channel: string;
  /** Порог числа сработавших групп. По умолчанию — настройка отбора. */
  minCategories?: number;
  actor: string;
}

const TELEGRAM_SOURCE_ID = 'telegram-public';

/** Отпечатки уже взятых элементов: по ним ловятся повторы между прогонами. */
async function seenFingerprints(db: Db): Promise<Set<string>> {
  const rows = await db.collectedItem.findMany({
    where: { verdict: 'KEPT' },
    select: { fingerprint: true },
  });
  return new Set(rows.map((row) => row.fingerprint));
}

/** Сериализация сработавших слов: всё, что нужно для подсветки в карточке. */
function hitsPayload(item: CollectedItemResult): string {
  const pack = (hit: TermHit) => ({
    termId: hit.termId,
    termText: hit.termText,
    category: hit.category,
    fragment: hit.fragment,
    charStart: hit.charStart,
    charEnd: hit.charEnd,
    quote: hit.quote,
  });

  return JSON.stringify([
    ...item.decision.hits.map(pack),
    ...item.decision.excludedBy.map(pack),
  ]);
}

/**
 * Что известно о прогоне до того, как он удался или не удался.
 *
 * Вынесено в одну структуру, потому что порядок операций у всех коннекторов
 * одинаков — прочитать, отобрать, сохранить, записать в журнал, — и
 * различаются только чтение и подписи. Повторять эти шестьдесят строк в
 * каждом коннекторе значило бы завести по экземпляру на источник и
 * расходиться в них при первой же правке.
 */
interface RunContext {
  sourceId: string;
  /** Что именно читали: имя канала, имя аккаунта. */
  target: string;
  /** Как назвать прочитанное в журнале: «каналу @name», «аккаунту @name». */
  label: string;
  startedAt: Date;
  minCategories: number;
  actor: string;
  /** Чем прогон отличается от живого сбора. null — обычный прогон. */
  note?: string | null;
  /**
   * Во что обошёлся прогон, доллары. У бесплатных источников ноль.
   *
   * Пишется то, что прогон стоил, а не то, сколько запрашивали: обход,
   * урезанный под остаток дневного предела, стоит меньше задуманного, и
   * именно меньшее число должно сойтись со счётом Apify в конце месяца.
   */
  costUsd?: number;
}

/**
 * Неудачная попытка — это запись в таблице, а не отсутствие записи.
 *
 * Без неё сбой выглядит на экране как «ничего не нашли»: внешне неотличимо
 * от пустого канала, а по сути противоположно.
 */
async function recordFailedRun(db: PrismaClient, ctx: RunContext, message: string): Promise<void> {
  await db.collectRun.create({
    data: {
      sourceId: ctx.sourceId,
      target: ctx.target,
      startedAt: ctx.startedAt,
      finishedAt: new Date(),
      status: 'FAILED',
      error: message,
      minCategories: ctx.minCategories,
      note: ctx.note ?? null,
      startedBy: ctx.actor,
      /*
       * Неудавшийся прогон записывается с нулевой ценой. Apify за сорвавшийся
       * запуск не берёт денег, и завышать расход означало бы съедать дневной
       * предел попытками, которые ничего не стоили.
       */
      costUsd: 0,
    },
  });
}

/**
 * Отбор и сохранение: одно и то же для всех источников.
 *
 * Сохраняется и отброшенное — вместе с причиной по каждому элементу.
 * Отброшенное объявление больше нигде не появится, и если фильтр настроен
 * неверно, заметить это можно только одним способом: открыв список отказов.
 */
async function finishRun(db: PrismaClient, ctx: RunContext, raw: RawItem[]) {
  const [terms, seen] = await Promise.all([loadWatchTerms(db), seenFingerprints(db)]);
  const result = runCollection(raw, terms, { rule: { minCategories: ctx.minCategories }, seen });

  return db.$transaction(async (tx) => {
    const run = await tx.collectRun.create({
      data: {
        sourceId: ctx.sourceId,
        target: ctx.target,
        startedAt: ctx.startedAt,
        finishedAt: new Date(),
        status: 'OK',
        minCategories: ctx.minCategories,
        total: result.stats.total,
        kept: result.stats.kept,
        skipped: result.stats.skipped,
        statsJson: JSON.stringify(result.stats),
        note: ctx.note ?? null,
        startedBy: ctx.actor,
        costUsd: ctx.costUsd ?? 0,
      },
    });

    for (const item of result.items) {
      await tx.collectedItem.create({
        data: {
          runId: run.id,
          sourceId: item.sourceId,
          externalId: item.externalId,
          url: item.url,
          author: item.author,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
          rawText: item.text,
          fingerprint: item.fingerprint,
          verdict: item.decision.verdict,
          reason: item.decision.reason,
          explanationRu: item.decision.explanation.ru,
          explanationKk: item.decision.explanation.kk,
          hitsJson: hitsPayload(item),
        },
      });
    }

    await writeAudit(tx, {
      entityType: 'CollectRun',
      entityId: run.id,
      action: 'COLLECT_RUN_FINISHED',
      actor: ctx.actor,
      after: {
        sourceId: ctx.sourceId,
        target: ctx.target,
        total: result.stats.total,
        kept: result.stats.kept,
        byReason: result.stats.byReason,
        ...(ctx.note ? { note: ctx.note } : {}),
      },
      comment:
        `Сбор по ${ctx.label}: взято ${result.stats.kept} из ${result.stats.total}.` +
        (ctx.note ? ` ${ctx.note}` : ''),
    });

    return { run, stats: result.stats };
  });
}

/**
 * Полный проход по каналу: скачать, разобрать, отобрать, сохранить.
 *
 * Прогон записывается в базу в обоих исходах. При неудаче — со статусом
 * FAILED и текстом ошибки: на экране сбора видно, что попытка была и чем
 * закончилась, а не пустой список без объяснений.
 */
export async function collectFromTelegram(db: PrismaClient, input: StartCollectInput) {
  const channel = normalizeChannel(input.channel);
  if (!channel) {
    throw new HttpError(
      'VALIDATION',
      `«${input.channel}» не похоже на имя публичного канала. ` +
        'Подойдёт имя (@ukg_novostroyki), ссылка t.me/ukg_novostroyki или адрес витрины.',
    );
  }

  const source = findSource(TELEGRAM_SOURCE_ID);
  if (!source) throw notFound('Источник сбора');

  const ctx: RunContext = {
    sourceId: TELEGRAM_SOURCE_ID,
    target: channel,
    label: `каналу @${channel}`,
    startedAt: new Date(),
    minCategories: input.minCategories ?? DEFAULT_COLLECT_RULE.minCategories,
    actor: input.actor,
  };

  let raw: RawItem[];
  try {
    const html = await fetchChannelPage(channel);
    raw = parseTelegramPage(html, channel, { sourceId: TELEGRAM_SOURCE_ID });
  } catch (error) {
    const message =
      error instanceof TelegramParseError || error instanceof HttpError
        ? error.message
        : 'Непредвиденная ошибка при чтении канала.';

    await recordFailedRun(db, ctx, message);
    throw error instanceof HttpError ? error : new HttpError('PRECONDITION', message);
  }

  return finishRun(db, ctx, raw);
}

// ---------------------------------------------------------------------------
// Instagram через Apify
// ---------------------------------------------------------------------------

/**
 * Сколько ждём ответ Apify, мс.
 *
 * Больше, чем у t.me, и намеренно: синхронный запуск актора — это не отдача
 * готовой страницы, а полный цикл «поднять контейнер, открыть профиль,
 * пролистать ленту». Полминуты здесь нормальное время, а не признак сбоя.
 */
const APIFY_TIMEOUT_MS = 120_000;

/** Ключ из окружения. Пустая строка считается отсутствием ключа. */
function apifyToken(): string | null {
  const token = process.env.APIFY_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Запускает актор и возвращает собранный набор данных.
 *
 * Вход приходит готовым, а не собирается здесь. Причина в том, что входов
 * два: профиль аккаунта и страницы тегов при обходе без перечня. Собирает
 * их ядро — там же, где посчитан потолок результатов, — а эта функция
 * остаётся одной сетевой обёрткой на оба случая. Иначе появилось бы два
 * почти одинаковых запроса к Apify, и расходиться они начали бы на первой
 * же правке обработки ошибок.
 *
 * Ключ уходит заголовком Authorization, а не параметром адреса: адрес
 * целиком попадает в журналы и в текст ошибки, и ключ утёк бы сразу в
 * несколько мест. По той же причине ни одно сообщение об ошибке ниже не
 * содержит ни ключа, ни тела запроса.
 */
async function runApifyActor(
  input: InstagramScraperInput,
  options: { token: string },
): Promise<unknown> {
  const url = apifyRunUrl();
  const body = JSON.stringify(input);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
        'user-agent': 'SAQ-QURYLYS/1.0 (monitoring of public construction ads)',
      },
      body,
      signal: AbortSignal.timeout(APIFY_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(
      'PRECONDITION',
      `Не удалось выполнить сбор через Apify: ${reason}. ` +
        'Сбор идёт запросом к api.apify.com — проверьте подключение к интернету. ' +
        'Деньги за неудавшийся запуск не списываются.',
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new HttpError(
      'PRECONDITION',
      'Apify не принял ключ. Проверьте значение APIFY_TOKEN: ключ создаётся в консоли ' +
        `(${APIFY_TOKEN_PAGE}), копируется целиком и не должен содержать пробелов. ` +
        'Старый ключ мог быть отозван — тогда нужно создать новый.',
    );
  }

  if (response.status === 402) {
    throw new HttpError(
      'PRECONDITION',
      'Apify отказал по тарифу: на счёте не осталось средств или исчерпан месячный лимит ' +
        'бесплатного плана. Сбор платный — пополните счёт или дождитесь следующего периода.',
    );
  }

  if (!response.ok) {
    throw new HttpError(
      'PRECONDITION',
      `Apify ответил ${response.status} на запуск сбора. Попробуйте позже; ` +
        'если повторяется — посмотрите журнал прогонов в консоли Apify.',
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new HttpError(
      'PRECONDITION',
      'Apify вернул ответ, который не разбирается как JSON. Прогон не сохранён.',
    );
  }
}

export interface StartInstagramCollectInput {
  /** Имя аккаунта в любом виде: «@имя», ссылка, чистое имя. */
  account: string;
  /** Сколько публикаций запросить. Сверху ограничено MAX_POSTS_LIMIT. */
  limit?: number;
  /** Отсечка по давности в формате актора: «7 days», «2026-10-01». */
  newerThan?: string | null;
  minCategories?: number;
  actor: string;
}

/**
 * Полный проход по профилю застройщика в Instagram.
 *
 * Два пути, и они не смешиваются.
 *
 * Есть ключ — идёт живой сбор: прогон помечается ценой, которую ожидали
 * списать, чтобы счёт в конце месяца можно было сверить с историей прогонов.
 *
 * Ключа нет — прогон выполняется на сохранённом образце, и об этом сказано
 * в двух местах сразу: в пометке прогона и в поле «что читали», куда
 * записывается имя аккаунта из образца, а не то, которое запросил аналитик.
 * Второе важнее первого: иначе в базе осталась бы строка, утверждающая, что
 * профиль monterosa.kz прочитан, хотя к нему не обращались. Выдать
 * демонстрацию за живой сбор не получится даже случайно.
 */
export async function collectFromInstagram(
  db: PrismaClient,
  input: StartInstagramCollectInput,
) {
  const account = normalizeInstagramAccount(input.account);
  if (!account) {
    throw new HttpError(
      'VALIDATION',
      `«${input.account}» не похоже на имя аккаунта в Instagram. ` +
        'Подойдёт имя (@monterosa.kz), ссылка instagram.com/monterosa.kz или адрес профиля. ' +
        'Ссылка на отдельную публикацию или на хештег не подойдёт: читается профиль целиком.',
    );
  }

  const source = findSource(INSTAGRAM_SOURCE_ID);
  if (!source) throw notFound('Источник сбора');

  const limit = clampPostsLimit(input.limit ?? DEFAULT_POSTS_LIMIT);
  const token = apifyToken();
  const live = token !== null;

  const ctx: RunContext = {
    sourceId: INSTAGRAM_SOURCE_ID,
    // Имя аккаунта в демонстрационном прогоне — из образца, а не из запроса.
    target: live ? account : APIFY_FIXTURE_ACCOUNT,
    label: `аккаунту @${live ? account : APIFY_FIXTURE_ACCOUNT}`,
    startedAt: new Date(),
    minCategories: input.minCategories ?? DEFAULT_COLLECT_RULE.minCategories,
    actor: input.actor,
    note: live
      ? `Живой сбор через Apify: запрошено до ${limit} публикаций, ожидаемая стоимость ${estimateRunCostUsd(limit).toFixed(2)} $.`
      : `Ключа Apify нет, живой сбор не выполнялся. Прогон сделан на сохранённом образце (аккаунт @${APIFY_FIXTURE_ACCOUNT}); аккаунт @${account} прочитан не был.`,
    // Демонстрационный прогон денег не стоит и дневной предел не расходует.
    costUsd: live ? estimateRunCostUsd(limit) : 0,
  };

  let raw: RawItem[];
  try {
    const payload = live
      ? await runApifyActor(
          instagramScraperInput(account, { limit, newerThan: input.newerThan ?? null }),
          { token: token as string },
        )
      : APIFY_FIXTURE_POSTS;

    raw = parseApifyPosts(payload, { sourceId: INSTAGRAM_SOURCE_ID });
  } catch (error) {
    const message =
      error instanceof ApifyParseError || error instanceof HttpError
        ? error.message
        : 'Непредвиденная ошибка при чтении профиля.';

    await recordFailedRun(db, ctx, message);
    throw error instanceof HttpError ? error : new HttpError('PRECONDITION', message);
  }

  return finishRun(db, ctx, raw);
}

// ---------------------------------------------------------------------------
// Обход без перечня: поиск по словам
// ---------------------------------------------------------------------------

/** Идентификатор обхода в поле «что читали»: это не аккаунт и не канал. */
export const HASHTAG_WALK_TARGET = 'поиск по словам';

export interface WalkInput {
  /**
   * Слова для обхода. Не задано — берутся включённые из базы. Передаются
   * явно только в одном случае: когда вызывающий уже прочитал список и не
   * хочет читать его второй раз.
   */
  tags?: readonly string[];
  /** Сколько результатов брать с одного слова. Сверху режется потолком обхода. */
  limitPerTag?: number;
  newerThan?: string | null;
  minCategories?: number;
  actor: string;
}

/**
 * Почему обход не состоялся.
 *
 * Три разных причины, а не одна на всё: нет слов — настраивается на экране;
 * кончились деньги — проходит само к следующим суткам; нет ключа — нужна
 * переменная в .env. Свести их в одну значило бы заставить аналитика
 * догадываться, что из трёх делать.
 */
export type WalkSkipReason = 'NO_QUERIES' | 'BUDGET' | 'NO_KEY';

export interface WalkResult {
  /** Прогон не состоялся — и вот почему. null значит, что обход прошёл. */
  skipped: null | { reason: WalkSkipReason; note: Label };
  run: Awaited<ReturnType<typeof finishRun>> | null;
  tags: string[];
  plannedResults: number;
  costUsd: number;
  budget: BudgetDecision | null;
}

/**
 * Обход страниц тегов: находит объявления без заранее известных аккаунтов.
 *
 * Отличие от сбора по профилю — не в коде, а в постановке. Перечень
 * аккаунтов отвечает на вопрос «что нового у тех, кого мы знаем»; обход по
 * словам — на вопрос «кто ещё продаёт жильё в этом городе». Второй вопрос и
 * есть задача надзора: застройщик, о котором известно, уже в реестре.
 *
 * Три решения, которые стоит объяснить.
 *
 * Первое. Деньги спрашиваются до запроса, а не после. Отказ по дневному
 * пределу — это запись прогона со статусом SKIPPED_BUDGET и причиной, а не
 * тихий пропуск: иначе автоматический обход, упёршийся в предел, выглядит
 * как обход, на котором ничего не нашлось.
 *
 * Второе. Обход не урезается молча. Если задуманное не умещается в остаток
 * дня, он отклоняется целиком, а не выполняется в сокращённом виде: прогон,
 * прошедший по двум словам из пяти, в истории неотличим от прогона, где по
 * трём словам не было публикаций.
 *
 * Третье. Без ключа обход не подменяется образцом. Для сбора по профилю
 * образец оправдан — он показывает разбор и отбор на реальном тексте. Здесь
 * же обещание другое: «нашли того, о ком не знали», — и выполнить его
 * образцом нельзя. Поэтому прогон записывается как несостоявшийся.
 */
export async function walkHashtags(db: PrismaClient, input: WalkInput): Promise<WalkResult> {
  const tags = [...(input.tags ?? (await activeSearchTags(db)))];
  const startedAt = new Date();
  const minCategories = input.minCategories ?? DEFAULT_COLLECT_RULE.minCategories;

  if (tags.length === 0) {
    const note = {
      ru: 'Обход не выполнялся: ни одно слово поиска не включено. Деньги не расходовались.',
      kk: 'Айналып шығу орындалмады: бірде-бір іздеу сөзі қосылмаған. Қаражат жұмсалмады.',
    };

    await recordSkippedWalk(db, { startedAt, minCategories, actor: input.actor, note: note.ru });
    return { skipped: { reason: 'NO_QUERIES', note }, run: null, tags, plannedResults: 0, costUsd: 0, budget: null };
  }

  const limitPerTag = limitPerTagWithinWalk(tags.length, input.limitPerTag ?? DEFAULT_HASHTAG_LIMIT);
  const plannedResults = plannedWalkResults(tags.length, limitPerTag);
  const budget = await budgetStatus(db, { plannedResults, now: startedAt });

  if (!budget.allowed) {
    await recordSkippedWalk(db, {
      startedAt,
      minCategories,
      actor: input.actor,
      note: budget.note.ru,
    });
    return {
      skipped: { reason: 'BUDGET', note: budget.note },
      run: null,
      tags,
      plannedResults,
      costUsd: 0,
      budget,
    };
  }

  const token = apifyToken();
  const costUsd = estimateRunCostUsd(plannedResults);

  const ctx: RunContext = {
    sourceId: INSTAGRAM_SOURCE_ID,
    target: HASHTAG_WALK_TARGET,
    label: `словам поиска (${tags.join(', ')})`,
    startedAt,
    minCategories,
    actor: input.actor,
    note:
      `Обход без перечня: ${tags.length} слов по ${limitPerTag} публикаций, ` +
      `до ${plannedResults} результатов, ожидаемая стоимость ${costUsd.toFixed(2)} $. ` +
      `Слова: ${tags.join(', ')}.`,
    costUsd,
  };

  if (!token) {
    const note = {
      ru:
        'Обход не выполнялся: не задан ключ APIFY_TOKEN. Подменять поиск сохранённым ' +
        'образцом здесь нельзя — образец не может «найти неизвестного застройщика».',
      kk:
        'Айналып шығу орындалмады: APIFY_TOKEN кілті берілмеген. Іздеуді сақталған ' +
        'үлгімен ауыстыруға болмайды — үлгі «белгісіз құрылысшыны таба» алмайды.',
    };

    await recordSkippedWalk(db, { startedAt, minCategories, actor: input.actor, note: note.ru });
    return { skipped: { reason: 'NO_KEY', note }, run: null, tags, plannedResults, costUsd: 0, budget };
  }

  let raw: RawItem[];
  try {
    const payload = await runApifyActor(
      instagramHashtagInput(tags, { limitPerTag, newerThan: input.newerThan ?? null }),
      { token },
    );
    raw = parseApifyPosts(payload, { sourceId: INSTAGRAM_SOURCE_ID });
  } catch (error) {
    const message =
      error instanceof ApifyParseError || error instanceof HttpError
        ? error.message
        : 'Непредвиденная ошибка при обходе страниц тегов.';

    await recordFailedRun(db, ctx, message);
    throw error instanceof HttpError ? error : new HttpError('PRECONDITION', message);
  }

  const run = await finishRun(db, ctx, raw);
  await markWalked(db, tags, run.stats.kept, startedAt);

  return { skipped: null, run, tags, plannedResults, costUsd, budget };
}

/**
 * Несостоявшийся обход — тоже строка в истории.
 *
 * Статус отдельный, не FAILED: сбой и отказ по пределу — разные события, и
 * лечатся они по-разному. Цена нулевая, потому что запроса не было, и
 * отказанный обход не должен съедать остаток следующего дня.
 */
async function recordSkippedWalk(
  db: PrismaClient,
  input: { startedAt: Date; minCategories: number; actor: string; note: string },
): Promise<void> {
  await db.collectRun.create({
    data: {
      sourceId: INSTAGRAM_SOURCE_ID,
      target: HASHTAG_WALK_TARGET,
      startedAt: input.startedAt,
      finishedAt: new Date(),
      status: 'SKIPPED',
      minCategories: input.minCategories,
      note: input.note,
      startedBy: input.actor,
      costUsd: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// Чтение прогонов
// ---------------------------------------------------------------------------

export async function listCollectRuns(db: Db, limit = 20) {
  return db.collectRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      sourceId: true,
      target: true,
      startedAt: true,
      finishedAt: true,
      status: true,
      error: true,
      minCategories: true,
      total: true,
      kept: true,
      skipped: true,
      note: true,
      startedBy: true,
      /*
       * Стоимость отдаётся на экран, а не только пишется в базу. История
       * прогонов — единственное место, где счёт Apify в конце месяца можно
       * сверить с тем, за что платили; без цены в строке такая сверка
       * упирается в чужую консоль.
       */
      costUsd: true,
    },
  });
}

/**
 * Задан ли ключ к платному сборщику.
 *
 * Возвращается именно булево значение, а не сам ключ и не его начало: экран
 * должен уметь сказать «ключа нет, прогон будет демонстрационным», и для
 * этого ему достаточно одного бита. Ключ в браузер не попадает.
 */
export function apifyConfigured(): boolean {
  return apifyToken() !== null;
}

export interface CollectedItemFilters {
  runId?: string;
  verdict?: 'KEPT' | 'SKIPPED';
  /** Только то, что ждёт решения аналитика. */
  queue?: boolean;
  limit: number;
  offset: number;
}

/**
 * Лента элементов сбора.
 *
 * Текст отдаётся целиком: карточка подсвечивает в нём найденные слова по
 * сохранённым позициям, и обрезанный текст сделал бы позиции неверными.
 */
export async function listCollectedItems(db: Db, filters: CollectedItemFilters) {
  const where: Prisma.CollectedItemWhereInput = {
    ...(filters.runId && { runId: filters.runId }),
    ...(filters.verdict && { verdict: filters.verdict }),
    ...(filters.queue && { verdict: 'KEPT', publicationId: null, dismissedAt: null }),
  };

  const [rows, total] = await Promise.all([
    db.collectedItem.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { externalId: 'desc' }],
      take: filters.limit,
      skip: filters.offset,
      include: { run: { select: { target: true, startedAt: true } } },
    }),
    db.collectedItem.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      sourceId: row.sourceId,
      externalId: row.externalId,
      url: row.url,
      author: row.author,
      publishedAt: row.publishedAt,
      text: row.rawText,
      verdict: row.verdict,
      reason: row.reason,
      explanation: { ru: row.explanationRu, kk: row.explanationKk },
      hits: safeHits(row.hitsJson),
      publicationId: row.publicationId,
      dismissedAt: row.dismissedAt,
      dismissedComment: row.dismissedComment,
      channel: row.run.target,
      collectedAt: row.run.startedAt,
    })),
    total,
  };
}

/** Разбор сохранённых совпадений. Испорченный JSON не должен ронять ленту. */
function safeHits(json: string): TermHit[] {
  try {
    return JSON.parse(json) as TermHit[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Решение аналитика по элементу
// ---------------------------------------------------------------------------

/**
 * Принять элемент в работу: завести из него публикацию.
 *
 * Дальше объявление идёт общим путём — разбор ИИ, гипотезы, привязка к
 * объекту, факторы. Слой сбора на риск не влияет и влиять не должен:
 * слово-ловушка говорит «на это стоит посмотреть», а не «здесь нарушение».
 */
export async function acceptCollectedItem(db: PrismaClient, id: string, actor: string) {
  const item = await db.collectedItem.findUnique({ where: { id } });
  if (!item) throw notFound('Элемент сбора');

  if (item.publicationId) {
    throw new HttpError('PRECONDITION', 'Элемент уже заведён как объявление.');
  }
  if (item.dismissedAt) {
    throw new HttpError('PRECONDITION', 'Элемент отклонён аналитиком. Сначала снимите отклонение.');
  }

  const source = findSource(item.sourceId);

  return db.$transaction(async (tx) => {
    const publication = await tx.publication.create({
      data: {
        platform: source?.platform ?? 'MANUAL_ENTRY',
        rawText: item.rawText,
        accountName: item.author,
        url: item.url,
        publishedAt: item.publishedAt,
        linkStatus: 'UNLINKED',
        /** Собранное в работе — не демонстрационные данные. */
        isDemo: false,
      },
    });

    await tx.collectedItem.update({
      where: { id },
      data: { publicationId: publication.id },
    });

    await writeAudit(tx, {
      entityType: 'CollectedItem',
      entityId: id,
      action: 'COLLECTED_ITEM_ACCEPTED',
      actor,
      after: { publicationId: publication.id, externalId: item.externalId },
      comment: `Элемент сбора принят в работу. ${item.explanationRu}`,
    });

    return publication;
  });
}

export async function dismissCollectedItem(
  db: PrismaClient,
  id: string,
  actor: string,
  comment: string,
) {
  const item = await db.collectedItem.findUnique({ where: { id } });
  if (!item) throw notFound('Элемент сбора');
  if (item.publicationId) {
    throw new HttpError('PRECONDITION', 'Из элемента уже заведено объявление.');
  }

  /**
   * Повторное отклонение запрещено, хотя технически это просто перезапись
   * трёх полей. Перезапись стёрла бы имя и причину того, кто решил первым,
   * и карточка стала бы утверждать, что элемент отклонил второй аналитик
   * по своей причине. Запись о первом решении осталась бы только в журнале,
   * куда при разборе спора смотрят в последнюю очередь.
   */
  if (item.dismissedAt) {
    throw new HttpError(
      'PRECONDITION',
      `Элемент уже отклонён${item.dismissedBy ? ` (${item.dismissedBy})` : ''}. Причина первого решения не переписывается.`,
    );
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.collectedItem.update({
      where: { id },
      data: { dismissedAt: new Date(), dismissedBy: actor, dismissedComment: comment },
    });

    /**
     * Причина обязательна. Отклонение без причины неотличимо от ошибки:
     * через месяц никто не вспомнит, было объявление безобидным или его
     * пропустили второпях.
     */
    await writeAudit(tx, {
      entityType: 'CollectedItem',
      entityId: id,
      action: 'COLLECTED_ITEM_DISMISSED',
      actor,
      before: { verdict: item.verdict, reason: item.reason },
      comment,
    });

    return { id: updated.id, dismissedAt: updated.dismissedAt };
  });
}
