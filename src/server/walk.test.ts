/**
 * Проверка обхода без перечня — там, где он касается денег и честности.
 *
 * Арифметика цены и правила отказа проверены в ядре без базы. Здесь
 * проверяется то, чего в ядре нет: что именно остаётся в базе после обхода,
 * который не состоялся. Это и есть главный риск автоматического сбора.
 * Пока кнопку нажимал человек, несостоявшийся прогон он видел сам; обход,
 * который идёт сам, может молча не идти неделю, и заметить это можно только
 * по записи в истории.
 *
 * Отсюда три обещания, которые тест переводит в проверки.
 *
 * Первое: отказ записывается. Нет слов, кончились деньги, нет ключа — в
 * истории появляется строка со статусом SKIPPED и причиной человеческими
 * словами, а не отсутствие строки.
 *
 * Второе: отказ ничего не стоит. У несостоявшегося прогона цена ноль, иначе
 * пропущенные обходы съедали бы дневной предел следующих суток.
 *
 * Третье — самое важное. Без ключа обход не подменяется сохранённым
 * образцом, хотя для сбора по профилю такая подмена предусмотрена и
 * уместна. Разница в том, что обещает источник. Профиль обещает «вот что
 * опубликовано у этого застройщика», и образец показывает разбор такого
 * текста честно. Обход обещает «вот кого мы не знали» — и образец, в
 * котором лежат заранее известные публикации, выполнить это обещание не
 * может ни при какой пометке.
 *
 * Ключ к Apify здесь не задаётся никогда, как и в соседнем файле: тест,
 * который тратит деньги при неудачном совпадении окружения, — плохой тест.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_HASHTAG_LIMIT,
  DEFAULT_WATCH_TERMS,
  MAX_RESULTS_PER_WALK,
  estimateRunCostUsd,
} from '../core/collect';
import { HASHTAG_WALK_TARGET, walkHashtags } from './collect';
import { createSearchQuery, dailyBudgetUsd, listSearchQueries } from './discovery';
import { HttpError } from './http';

interface Row extends Record<string, unknown> {
  id: string;
}

/**
 * Поддельная база: только то, что вызывает обход.
 *
 * Отбор ведётся набором слов-ловушек по умолчанию — тем же, которым
 * заполняется настоящая база, — чтобы тест не зависел от специально
 * подобранных слов.
 */
function fakeDb(seed: { queries?: Partial<Row>[]; runs?: Partial<Row>[] } = {}) {
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;

  const queries: Row[] = (seed.queries ?? []).map((row, index) => ({
    id: `q-${index}`,
    sourceId: 'instagram-apify',
    tag: 'тег',
    active: true,
    noteRu: null,
    noteKk: null,
    lastWalkedAt: null,
    lastFound: 0,
    ...row,
  }));

  const runs: Row[] = (seed.runs ?? []).map((row, index) => ({
    id: `r-${index}`,
    sourceId: 'instagram-apify',
    target: HASHTAG_WALK_TARGET,
    startedAt: new Date(),
    status: 'OK',
    costUsd: 0,
    ...row,
  }));

  const items: Row[] = [];
  const audit: Row[] = [];

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
    searchQuery: {
      findMany: async (args?: { where?: { active?: boolean } }) =>
        queries.filter((row) => args?.where?.active === undefined || row.active === args.where.active),
      findUnique: async (args: {
        where: { id?: string; sourceId_tag?: { sourceId: string; tag: string } };
      }) =>
        queries.find(
          (row) =>
            (args.where.id !== undefined && row.id === args.where.id) ||
            (args.where.sourceId_tag !== undefined && row.tag === args.where.sourceId_tag.tag),
        ) ?? null,
      count: async (args?: { where?: { active?: boolean } }) =>
        queries.filter((row) => args?.where?.active === undefined || row.active === args.where.active)
          .length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = {
          id: id('q'),
          lastWalkedAt: null,
          lastFound: 0,
          ...data,
        } as Row;
        queries.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { tag?: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        const tags = where.tag?.in ?? [];
        for (const row of queries) {
          if (tags.includes(String(row.tag))) Object.assign(row, data);
        }
        return { count: tags.length };
      },
    },
    collectedItem: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        items.push(data as Row);
        return data;
      },
    },
    collectRun: {
      findMany: async (args?: { where?: { costUsd?: { gt: number } } }) =>
        runs.filter((row) =>
          args?.where?.costUsd === undefined ? true : Number(row.costUsd) > args.where.costUsd.gt,
        ),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = { id: id('r'), ...data } as Row;
        runs.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data as Row);
        return data;
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  };

  return { db, queries, runs, items, audit };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (db: unknown) => db as any;

const ACTOR = 'test@demo.local';

describe('обход без включённых слов', () => {
  beforeEach(() => {
    delete process.env.APIFY_TOKEN;
    delete process.env.COLLECT_DAILY_BUDGET_USD;
  });

  it('не выполняется и записывает отказ, а не пустой прогон', async () => {
    const fake = fakeDb({ queries: [] });

    const result = await walkHashtags(asClient(fake.db), { actor: ACTOR });

    expect(result.skipped?.reason).toBe('NO_QUERIES');
    expect(result.run).toBeNull();
    expect(fake.runs).toHaveLength(1);
    expect(fake.runs[0]?.status).toBe('SKIPPED');
    expect(fake.runs[0]?.costUsd).toBe(0);
  });

  it('причина отказа написана словами и на двух языках', async () => {
    const fake = fakeDb({ queries: [] });

    const result = await walkHashtags(asClient(fake.db), { actor: ACTOR });

    expect(result.skipped?.note.ru).toContain('ни одно слово поиска не включено');
    expect(result.skipped?.note.kk.length).toBeGreaterThan(0);
  });

  it('ни одного элемента в базу не попадает', async () => {
    const fake = fakeDb({ queries: [] });
    await walkHashtags(asClient(fake.db), { actor: ACTOR });
    expect(fake.items).toHaveLength(0);
  });
});

describe('обход без ключа', () => {
  beforeEach(() => {
    delete process.env.APIFY_TOKEN;
    delete process.env.COLLECT_DAILY_BUDGET_USD;
  });

  it('не подменяется сохранённым образцом', async () => {
    /*
     * Центральная проверка файла. Для сбора по профилю подмена образцом
     * предусмотрена и честно помечена; здесь она запрещена, потому что
     * образец не может «найти неизвестного застройщика».
     */
    const fake = fakeDb({ queries: [{ tag: 'оскемен' }] });

    const result = await walkHashtags(asClient(fake.db), { actor: ACTOR });

    expect(result.run).toBeNull();
    expect(fake.items).toHaveLength(0);
    expect(fake.runs[0]?.status).toBe('SKIPPED');
    expect(String(fake.runs[0]?.note)).toContain('APIFY_TOKEN');
  });

  it('причина названа отсутствием ключа, а не нехваткой денег', async () => {
    /*
     * Разные причины лечатся разным: ключ заводится один раз в .env, а
     * дневной предел проходит сам к следующим суткам. Одно значение на
     * два случая заставило бы аналитика ждать того, что не наступит.
     */
    const fake = fakeDb({ queries: [{ tag: 'оскемен' }] });

    const result = await walkHashtags(asClient(fake.db), { actor: ACTOR });

    expect(result.skipped?.reason).toBe('NO_KEY');
    expect(result.budget?.allowed).toBe(true);
  });

  it('слово не помечается пройденным, раз по нему не ходили', async () => {
    /*
     * Иначе на экране слово выглядит проверенным, и аналитик делает из
     * пустого результата вывод «по этому тегу ничего нет» — тогда как по
     * нему просто не искали.
     */
    const fake = fakeDb({ queries: [{ tag: 'оскемен' }] });

    await walkHashtags(asClient(fake.db), { actor: ACTOR });

    expect(fake.queries[0]?.lastWalkedAt).toBeNull();
  });

  it('в поле «что читали» стоит обход, а не имя аккаунта', async () => {
    const fake = fakeDb({ queries: [{ tag: 'оскемен' }] });

    await walkHashtags(asClient(fake.db), { actor: ACTOR });

    expect(fake.runs[0]?.target).toBe(HASHTAG_WALK_TARGET);
  });

  it('автор прогона сохранён: по нему видно, что нажимал не человек', async () => {
    const fake = fakeDb({ queries: [{ tag: 'оскемен' }] });

    await walkHashtags(asClient(fake.db), { actor: 'scheduler@saq-qurylys' });

    expect(fake.runs[0]?.startedBy).toBe('scheduler@saq-qurylys');
  });
});

describe('обход и дневной предел', () => {
  beforeEach(() => {
    delete process.env.APIFY_TOKEN;
    delete process.env.COLLECT_DAILY_BUDGET_USD;
  });

  it('при исчерпанном пределе отказ наступает до обращения к источнику', async () => {
    process.env.COLLECT_DAILY_BUDGET_USD = '0.10';

    const fake = fakeDb({
      queries: [{ tag: 'оскемен' }],
      runs: [{ costUsd: 0.27, startedAt: new Date() }],
    });

    const result = await walkHashtags(asClient(fake.db), { actor: ACTOR });

    expect(result.skipped?.reason).toBe('BUDGET');
    expect(result.costUsd).toBe(0);
    expect(result.budget?.verdict).toBe('EXHAUSTED');
  });

  it('отказ по пределу объясняет, сколько израсходовано и сколько осталось', async () => {
    process.env.COLLECT_DAILY_BUDGET_USD = '0.30';

    const fake = fakeDb({
      queries: [{ tag: 'оскемен' }, { tag: 'жкустькаменогорск' }],
      runs: [{ costUsd: 0.27, startedAt: new Date() }],
    });

    const result = await walkHashtags(asClient(fake.db), { actor: ACTOR });

    expect(result.skipped?.reason).toBe('BUDGET');
    expect(result.skipped?.note.ru).toContain('0,27');
    expect(result.skipped?.note.ru).toContain('0,03');
  });

  it('обход не урезается молча под остаток дня', async () => {
    /*
     * Прогон, тихо прошедший по двум словам из пяти, в истории неотличим
     * от прогона, где по трём словам не нашлось публикаций. Поэтому
     * недостаток денег отклоняет обход целиком.
     */
    process.env.COLLECT_DAILY_BUDGET_USD = '0.05';

    const fake = fakeDb({ queries: [{ tag: 'оскемен' }, { tag: 'жкустькаменогорск' }] });

    const result = await walkHashtags(asClient(fake.db), { actor: ACTOR });

    expect(result.skipped?.reason).toBe('BUDGET');
    expect(result.tags).toHaveLength(2);
    expect(fake.runs[0]?.status).toBe('SKIPPED');
  });

  it('задуманный размер обхода считается произведением и не пробивает потолок', async () => {
    const tags = Array.from({ length: 8 }, (_, index) => ({ tag: `тег${index}` }));
    const fake = fakeDb({ queries: tags });

    const result = await walkHashtags(asClient(fake.db), { actor: ACTOR, limitPerTag: 50 });

    expect(result.plannedResults).toBeLessThanOrEqual(MAX_RESULTS_PER_WALK);
    expect(estimateRunCostUsd(result.plannedResults)).toBeLessThanOrEqual(
      estimateRunCostUsd(MAX_RESULTS_PER_WALK),
    );
  });

  it('пять слов по умолчанию умещаются в предел по умолчанию', async () => {
    /*
     * Свойство демонстрации: со значениями из .env.example обход проходит,
     * а не упирается в деньги на первом же цикле.
     */
    const fake = fakeDb({
      queries: Array.from({ length: 5 }, (_, index) => ({ tag: `тег${index}` })),
    });

    const result = await walkHashtags(asClient(fake.db), { actor: ACTOR });

    expect(result.skipped?.reason).not.toBe('BUDGET');
    expect(result.plannedResults).toBe(5 * DEFAULT_HASHTAG_LIMIT);
  });
});

describe('дневной предел из окружения', () => {
  beforeEach(() => {
    delete process.env.COLLECT_DAILY_BUDGET_USD;
  });

  it('без переменной берётся значение по умолчанию', () => {
    expect(dailyBudgetUsd()).toBeGreaterThan(0);
  });

  it('запятая как разделитель понимается: её пишут чаще точки', () => {
    process.env.COLLECT_DAILY_BUDGET_USD = '1,50';
    expect(dailyBudgetUsd()).toBe(1.5);
  });

  it('опечатка не превращается в «обход выключен»', () => {
    /*
     * Ноль был бы хуже умолчания: предел, прочитанный как нуль, молча
     * останавливает весь автоматический сбор.
     */
    process.env.COLLECT_DAILY_BUDGET_USD = 'полтора доллара';
    expect(dailyBudgetUsd()).toBeGreaterThan(0);
  });

  it('завышенное значение режется потолком', () => {
    process.env.COLLECT_DAILY_BUDGET_USD = '1000';
    expect(dailyBudgetUsd()).toBeLessThanOrEqual(5);
  });
});

describe('добавление слова поиска', () => {
  it('приведение к виду тега возвращается признаком, а не происходит молча', async () => {
    const fake = fakeDb();

    const result = await createSearchQuery(asClient(fake.db), {
      tag: 'ЖК Усть Каменогорск',
      actor: ACTOR,
    });

    expect(result.query.tag).toBe('жкустькаменогорск');
    expect(result.changed).toBe(true);
  });

  it('повтор отвергается: два одинаковых слова — двойная плата за один тег', async () => {
    const fake = fakeDb({ queries: [{ tag: 'оскемен' }] });

    await expect(
      createSearchQuery(asClient(fake.db), { tag: '#Оскемен', actor: ACTOR }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('негодное слово отвергается с объяснимой причиной', async () => {
    const fake = fakeDb();

    await expect(
      createSearchQuery(asClient(fake.db), { tag: 'ж', actor: ACTOR }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('за потолком включённых слов добавить нельзя', async () => {
    const fake = fakeDb({
      queries: Array.from({ length: 10 }, (_, index) => ({ tag: `тег${index}`, active: true })),
    });

    await expect(
      createSearchQuery(asClient(fake.db), { tag: 'ещёодинтег', actor: ACTOR }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('в списке у каждого слова есть адрес страницы и признак привязки к месту', async () => {
    const fake = fakeDb({ queries: [{ tag: 'оскемен' }, { tag: 'рассрочка' }] });

    const list = await listSearchQueries(asClient(fake.db));

    expect(list[0]?.exploreUrl).toContain('instagram.com/explore/tags/');
    expect(list.find((row) => row.tag === 'оскемен')?.geoAnchored).toBe(true);
    expect(list.find((row) => row.tag === 'рассрочка')?.geoAnchored).toBe(false);
  });
});
