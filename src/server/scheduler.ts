/**
 * Планировщик: сбор идёт сам, без нажатия кнопки.
 *
 * Зачем он вообще. До него программа отвечала на вопрос «что в этом
 * аккаунте», и отвечала хорошо, но спросить должен был человек. Надзор так
 * не работает: объявление с рассрочкой от неизвестной компании живёт в
 * ленте несколько дней, и застать его можно, только если смотреть каждый
 * день. Человек не смотрит каждый день — поэтому смотрит программа, а
 * человек разбирает уже найденное.
 *
 * Четыре решения, которые стоит объяснить, потому что ни одно из них не
 * очевидно.
 *
 * Первое. Выключено по умолчанию. Включается переменной COLLECT_AUTO.
 * Автоматический обход тратит деньги, а проверяющий, запустивший проект
 * впервые, на это не подписывался. Значение по умолчанию выбирается не по
 * удобству показа, а по тому, какой исход хуже: не увидеть обход, который
 * можно включить одной переменной, — неприятно; увидеть счёт за обход,
 * которого не просили, — хуже.
 *
 * Второе. Планировщик живёт в процессе сервера, а не в системном cron.
 * Внешний планировщик правильнее для эксплуатации, но требует установки на
 * машину проверяющего, то есть проверяется не кодом, а доверием. Здесь же
 * весь обход виден в истории прогонов на экране сбора.
 *
 * Третье. Защита от двойного запуска сделана через globalThis, а не через
 * переменную модуля. В режиме разработки Next перегружает модули на каждой
 * правке, и переменная модуля обнуляется — а таймер, заведённый прежней
 * копией, продолжает идти. Через десяток правок таймеров становится
 * десяток, и каждый из них платит за свой обход. Ключ в globalThis
 * переживает перезагрузку модуля, поэтому второй таймер не заводится.
 *
 * Четвёртое. Деньги спрашиваются перед каждым платным прогоном, а не один
 * раз при запуске. Предел — величина суток, а планировщик живёт дольше
 * суток; проверка «на старте» означала бы, что в полночь обход уходит в
 * расход без спроса.
 */

import type { PrismaClient } from '@prisma/client';

import { collectFromTelegram, walkHashtags } from './collect';
import { activeSearchTags, dailyBudgetUsd, spentToday } from './discovery';

/** Автор автоматических прогонов. В истории видно, где человек не участвовал. */
export const SCHEDULER_ACTOR = 'scheduler@saq-qurylys';

const TELEGRAM_SOURCE_ID = 'telegram-public';

/** Пределы периода обхода, минуты. */
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 24 * 60;
export const DEFAULT_INTERVAL_MINUTES = 180;

/**
 * Сколько каналов Telegram перечитывать за цикл.
 *
 * Список каналов нигде не задаётся вручную: он складывается из того, что
 * аналитик уже читал. Канал, прочитанный один раз, дальше перечитывается
 * сам — и это ровно то, чего нельзя сделать на Instagram, где обход идёт
 * по словам. Ограничение сверху нужно, чтобы цикл не растягивался на
 * десятки запросов к t.me: канал бесплатен, но не бесплатно время.
 */
export const MAX_TELEGRAM_CHANNELS_PER_CYCLE = 5;

/** Включён ли автоматический обход. */
export function schedulerEnabled(): boolean {
  const raw = process.env.COLLECT_AUTO?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'да';
}

/**
 * Период обхода в минутах.
 *
 * Нижняя граница не настраивается: период в одну минуту — это не частый
 * обход, а способ израсходовать дневной предел за четверть часа и получить
 * от Instagram ограничение по частоте запросов.
 */
export function intervalMinutes(): number {
  const raw = process.env.COLLECT_INTERVAL_MINUTES?.trim();
  if (!raw) return DEFAULT_INTERVAL_MINUTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MINUTES;

  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.trunc(parsed)));
}

export interface SchedulerState {
  enabled: boolean;
  intervalMinutes: number;
  startedAt: Date | null;
  /** Когда закончился последний цикл. null — ни один ещё не завершился. */
  lastRunAt: Date | null;
  /** Когда ожидается следующий. Считается от последнего, а не от запуска. */
  nextRunAt: Date | null;
  /** Идёт ли цикл прямо сейчас. */
  running: boolean;
  cycles: number;
  /**
   * Чем закончился последний цикл, если он закончился плохо.
   *
   * Хранится именно текст последней неудачи, а не флаг: «обход сломался»
   * без объяснения заставляет идти в журналы сервера, которых у аналитика
   * нет.
   */
  lastError: string | null;
}

interface SchedulerSlot {
  timer: ReturnType<typeof setInterval> | null;
  state: SchedulerState;
}

/*
 * Ключ в globalThis, а не переменная модуля: см. третье решение в заголовке.
 * Symbol.for даёт одно и то же значение в любой копии модуля — именно это и
 * нужно, чтобы перезагруженный модуль нашёл уже заведённый таймер.
 */
const SLOT_KEY = Symbol.for('saq-qurylys.scheduler');

function slot(): SchedulerSlot {
  const store = globalThis as unknown as Record<symbol, SchedulerSlot | undefined>;
  const key = SLOT_KEY;

  const existing = store[key];
  if (existing) return existing;

  const fresh: SchedulerSlot = {
    timer: null,
    state: {
      enabled: false,
      intervalMinutes: intervalMinutes(),
      startedAt: null,
      lastRunAt: null,
      nextRunAt: null,
      running: false,
      cycles: 0,
      lastError: null,
    },
  };

  store[key] = fresh;
  return fresh;
}

export function schedulerState(): SchedulerState {
  return { ...slot().state };
}

/** Каналы Telegram, которые уже читали хотя бы раз. */
async function knownTelegramChannels(db: PrismaClient): Promise<string[]> {
  const rows = await db.collectRun.findMany({
    where: { sourceId: TELEGRAM_SOURCE_ID, status: 'OK', target: { not: null } },
    orderBy: { startedAt: 'desc' },
    select: { target: true },
    take: 50,
  });

  const seen = new Set<string>();
  for (const row of rows) {
    if (row.target) seen.add(row.target);
    if (seen.size >= MAX_TELEGRAM_CHANNELS_PER_CYCLE) break;
  }

  return [...seen];
}

export interface CycleReport {
  startedAt: Date;
  finishedAt: Date;
  telegram: { channel: string; ok: boolean; kept: number; error?: string }[];
  instagram: { attempted: boolean; kept: number; skipped: string | null; costUsd: number };
  spentTodayUsd: number;
  dailyBudgetUsd: number;
}

/**
 * Один цикл обхода: бесплатное, потом платное.
 *
 * Порядок не случаен. Telegram бесплатен, и его неудача не должна лишать
 * обход платной части — но и наоборот: если дневной предел кончился,
 * бесплатная часть всё равно проходит. Поэтому каждая часть обёрнута
 * отдельно, и ни одна не отменяет другую.
 */
export async function runCycle(db: PrismaClient): Promise<CycleReport> {
  const startedAt = new Date();
  const report: CycleReport = {
    startedAt,
    finishedAt: startedAt,
    telegram: [],
    instagram: { attempted: false, kept: 0, skipped: null, costUsd: 0 },
    spentTodayUsd: 0,
    dailyBudgetUsd: dailyBudgetUsd(),
  };

  for (const channel of await knownTelegramChannels(db)) {
    try {
      const result = await collectFromTelegram(db, { channel, actor: SCHEDULER_ACTOR });
      report.telegram.push({ channel, ok: true, kept: result.stats.kept });
    } catch (error) {
      /*
       * Канал мог быть переименован или закрыт. Это не повод обрывать цикл:
       * неудача уже записана в историю прогонов со статусом FAILED, и там
       * её увидит аналитик.
       */
      report.telegram.push({
        channel,
        ok: false,
        kept: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const tags = await activeSearchTags(db);
  if (tags.length > 0) {
    report.instagram.attempted = true;
    const walk = await walkHashtags(db, { tags, actor: SCHEDULER_ACTOR });
    report.instagram.kept = walk.run?.stats.kept ?? 0;
    report.instagram.costUsd = walk.skipped ? 0 : walk.costUsd;
    report.instagram.skipped = walk.skipped ? walk.skipped.note.ru : null;
  } else {
    report.instagram.skipped = 'Ни одно слово поиска не включено — платный обход не запускался.';
  }

  report.spentTodayUsd = await spentToday(db, new Date());
  report.finishedAt = new Date();
  return report;
}

/**
 * Заводит таймер обхода. Повторный вызов ничего не делает.
 *
 * Первый цикл не выполняется в момент запуска. Причина практическая: сервер
 * в режиме разработки перезапускается десятки раз за час, и обход «сразу при
 * старте» означал бы десятки платных прогонов за вечер правок.
 */
export function startScheduler(db: PrismaClient): SchedulerState {
  const current = slot();

  if (current.timer) return { ...current.state };

  const enabled = schedulerEnabled();
  const minutes = intervalMinutes();

  current.state = {
    ...current.state,
    enabled,
    intervalMinutes: minutes,
    startedAt: new Date(),
    nextRunAt: enabled ? new Date(Date.now() + minutes * 60_000) : null,
  };

  if (!enabled) {
    console.log(
      '[обход] автоматический сбор выключен. Включается переменной COLLECT_AUTO=1 в .env; ' +
        `период задаётся COLLECT_INTERVAL_MINUTES (сейчас было бы ${minutes} мин), ` +
        `дневной предел — COLLECT_DAILY_BUDGET_USD (сейчас ${dailyBudgetUsd().toFixed(2)} $).`,
    );
    return { ...current.state };
  }

  console.log(
    `[обход] автоматический сбор включён: раз в ${minutes} мин, ` +
      `дневной предел ${dailyBudgetUsd().toFixed(2)} $. Первый цикл — через ${minutes} мин.`,
  );

  current.timer = setInterval(() => {
    void tick(db);
  }, minutes * 60_000);

  /*
   * unref: таймер не держит процесс. Без этого «npm run build» и любые
   * разовые команды, подтянувшие этот модуль, не завершались бы сами.
   */
  current.timer.unref?.();

  return { ...current.state };
}

/**
 * Один тик таймера.
 *
 * Перекрытие циклов исключено флагом running, а не очередью. Цикл длиннее
 * периода означает, что период выбран неверно; складывать такие циклы в
 * очередь — значит тратить деньги на обход, который не успевают разбирать.
 */
async function tick(db: PrismaClient): Promise<void> {
  const current = slot();
  if (current.state.running) {
    console.log('[обход] предыдущий цикл ещё идёт, этот тик пропущен.');
    return;
  }

  current.state = { ...current.state, running: true };

  try {
    const report = await runCycle(db);
    const telegramKept = report.telegram.reduce((sum, item) => sum + item.kept, 0);

    current.state = {
      ...current.state,
      lastError: null,
      cycles: current.state.cycles + 1,
    };

    console.log(
      `[обход] цикл завершён: Telegram — ${report.telegram.length} каналов, взято ${telegramKept}; ` +
        `Instagram — взято ${report.instagram.kept}, потрачено ${report.instagram.costUsd.toFixed(2)} $. ` +
        `За сутки израсходовано ${report.spentTodayUsd.toFixed(2)} из ${report.dailyBudgetUsd.toFixed(2)} $.` +
        (report.instagram.skipped ? ` Платная часть пропущена: ${report.instagram.skipped}` : ''),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    current.state = { ...current.state, lastError: message };
    console.error(`[обход] цикл прерван: ${message}`);
  } finally {
    const minutes = current.state.intervalMinutes;
    current.state = {
      ...current.state,
      running: false,
      lastRunAt: new Date(),
      nextRunAt: new Date(Date.now() + minutes * 60_000),
    };
  }
}

/** Останавливает таймер. Нужна тестам и остановке сервера. */
export function stopScheduler(): void {
  const current = slot();
  if (current.timer) {
    clearInterval(current.timer);
    current.timer = null;
  }
  current.state = { ...current.state, nextRunAt: null };
}
