/**
 * Проверка главного обещания платного источника: демонстрация не выдаёт себя
 * за живой сбор.
 *
 * Разбор ответа актора проверен юнит-тестами на записанном образце, но они не
 * доходят до записи. Проверять надо именно запись: обещание состоит в том, что
 * в базе не останется строки, утверждающей, будто профиль прочитали, когда к
 * нему не обращались. Это свойство живёт в collectFromInstagram, а не в ядре.
 *
 * База здесь поддельная — ровно те шесть методов, которые вызывает слой. Это
 * сознательный выбор, а не обход неудобства: настоящая база проверила бы
 * заодно и Prisma, но потребовала бы файла, миграции и порядка запуска, и
 * тест перестал бы отвечать на один вопрос. Что поля схемы названы верно,
 * проверяет tsc; что запись происходит в нужный момент и с нужным содержимым,
 * проверяется здесь.
 *
 * Ключ к Apify в тестах не задаётся никогда: тест, который тратит деньги при
 * неудачном совпадении окружения, — плохой тест. Поэтому APIFY_TOKEN
 * снимается явно перед каждым прогоном, и живой путь остаётся недостижимым.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_WATCH_TERMS } from '../core/collect';
import { APIFY_FIXTURE_ACCOUNT, APIFY_FIXTURE_POSTS } from '../core/collect/apify.fixture';
import { HttpError } from './http';
import { apifyConfigured, collectFromInstagram } from './collect';

/** Строки, которые поддельная база приняла за прогон этого теста. */
interface Recorded {
  runs: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
}

/**
 * Поддельная база: шесть методов, которые вызывает слой сбора.
 *
 * Термины отдаются из набора по умолчанию — того же, которым заполняется
 * настоящая база при db:seed, — поэтому отбор в тесте ведёт себя так же, как
 * на демонстрации, а не на специально подобранных словах.
 */
function fakeDb(recorded: Recorded) {
  let nextId = 1;

  const db = {
    watchTerm: {
      findMany: async () =>
        DEFAULT_WATCH_TERMS.map((term, index) => ({
          id: term.id ?? `term-${index}`,
          category: term.category,
          language: term.language,
          text: term.text,
          active: term.active,
          noteRu: term.note?.ru ?? null,
          noteKk: term.note?.kk ?? null,
        })),
    },
    collectedItem: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        recorded.items.push(data);
        return data;
      },
    },
    collectRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const run = { id: `run-${nextId++}`, ...data };
        recorded.runs.push(run);
        return run;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        recorded.audit.push(data);
        return data;
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  };

  return db;
}

function empty(): Recorded {
  return { runs: [], items: [], audit: [] };
}

/** То же приведение, что в маршрутах: слой ждёт PrismaClient, получает подделку. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (db: unknown) => db as any;

describe('прогон по Instagram без ключа', () => {
  beforeEach(() => {
    delete process.env.APIFY_TOKEN;
  });

  it('ключ не задан, значит живой путь недостижим', () => {
    expect(apifyConfigured()).toBe(false);
  });

  it('в поле «что читали» стоит аккаунт образца, а не запрошенный', async () => {
    const recorded = empty();

    await collectFromInstagram(asClient(fakeDb(recorded)), {
      account: '@monterosa.kz',
      limit: 20,
      minCategories: 1,
      actor: 'test@demo.local',
    });

    const run = recorded.runs[0];
    expect(run?.target).toBe(APIFY_FIXTURE_ACCOUNT);
    /*
     * Главная проверка файла: по строке в базе нельзя заключить, что
     * monterosa.kz читали. Запрошенное имя встречается только в пометке — и
     * там оно названо непрочитанным.
     */
    expect(String(run?.target)).not.toContain('monterosa');
  });

  it('пометка прогона прямо называет запрошенный аккаунт непрочитанным', async () => {
    const recorded = empty();

    await collectFromInstagram(asClient(fakeDb(recorded)), {
      account: 'monterosa.kz',
      minCategories: 1,
      actor: 'test@demo.local',
    });

    const note = String(recorded.runs[0]?.note ?? '');
    expect(note).toContain('Ключа Apify нет');
    expect(note).toContain('сохранённом образце');
    expect(note).toContain('@monterosa.kz прочитан не был');
  });

  it('пометка попадает и в журнал действий, а не только в таблицу прогонов', async () => {
    const recorded = empty();

    await collectFromInstagram(asClient(fakeDb(recorded)), {
      account: 'monterosa.kz',
      minCategories: 1,
      actor: 'test@demo.local',
    });

    const entry = recorded.audit[0];
    expect(entry?.action).toBe('COLLECT_RUN_FINISHED');
    expect(entry?.actor).toBe('test@demo.local');
    expect(String(entry?.comment)).toContain(APIFY_FIXTURE_ACCOUNT);
    expect(String(entry?.comment)).toContain('Ключа Apify нет');
  });

  it('публикация без текста не доходит до базы, остальные доходят', async () => {
    const recorded = empty();

    const { stats } = await collectFromInstagram(asClient(fakeDb(recorded)), {
      account: 'monterosa.kz',
      minCategories: 1,
      actor: 'test@demo.local',
    });

    // В образце четыре записи, одна без подписи — её отбрасывает разбор.
    expect(stats.total).toBe(APIFY_FIXTURE_POSTS.length - 1);
    expect(recorded.items).toHaveLength(stats.total);
    expect(stats.kept + stats.skipped).toBe(stats.total);
    expect(stats.kept).toBeGreaterThan(0);
  });

  it('у каждого сохранённого элемента есть ссылка на исходную публикацию', async () => {
    const recorded = empty();

    await collectFromInstagram(asClient(fakeDb(recorded)), {
      account: 'monterosa.kz',
      minCategories: 1,
      actor: 'test@demo.local',
    });

    for (const item of recorded.items) {
      expect(String(item.url)).toContain('instagram.com');
      expect(String(item.externalId).length).toBeGreaterThan(0);
    }
  });

  it('дата публикации разобрана: без неё не считается давность рекламы', async () => {
    const recorded = empty();

    await collectFromInstagram(asClient(fakeDb(recorded)), {
      account: 'monterosa.kz',
      minCategories: 1,
      actor: 'test@demo.local',
    });

    expect(recorded.items.some((item) => item.publishedAt instanceof Date)).toBe(true);
  });

  it('негодное имя аккаунта отвергается до прогона и ничего не пишет в базу', async () => {
    const recorded = empty();

    await expect(
      collectFromInstagram(asClient(fakeDb(recorded)), {
        account: 'https://www.instagram.com/p/DEMOpost001/',
        actor: 'test@demo.local',
      }),
    ).rejects.toBeInstanceOf(HttpError);

    // Ни строки прогона, ни пустого прогона: отказ произошёл до записи.
    expect(recorded.runs).toHaveLength(0);
    expect(recorded.items).toHaveLength(0);
  });
});
