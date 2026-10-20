/**
 * Возврат наборов по умолчанию: слов поиска и слов-ловушек.
 *
 * Проверяется не «кнопка работает», а то одно обещание, из-за которого
 * аналитик решается её нажать: возврат доливает недостающее и не отменяет
 * принятых решений. Обещание важнее механики, потому что нажатие,
 * включившее бы выключенное слово поиска, означало бы платный обход по тегу,
 * от которого человек сознательно отказался, — и узнал бы он об этом из
 * счёта, а не из интерфейса.
 *
 * Оба набора проверяются в одном файле, хотя живут в разных модулях: правило
 * у них общее, и разъехаться они могут только здесь. Если однажды возврат
 * ловушек начнёт перезаписывать имеющееся, а возврат слов поиска нет,
 * сломается тест, стоящий рядом с тем, который продолжает проходить.
 *
 * База поддельная и по тем же причинам, что в соседних файлах: настоящая
 * проверяла бы заодно Prisma и требовала бы файла с миграцией, а здесь нужен
 * ответ на один вопрос — что осталось в таблице после нажатия.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_SEARCH_QUERIES, DEFAULT_WATCH_TERMS, MAX_ACTIVE_QUERIES } from '../core/collect';
import { restoreDefaultWatchTerms } from './collect';
import { restoreDefaultSearchQueries } from './discovery';

interface Row extends Record<string, unknown> {
  id: string;
}

/** Поддельная база: только то, к чему обращается возврат набора. */
function fakeDb(seed: { queries?: Partial<Row>[]; terms?: Partial<Row>[] } = {}) {
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;

  const queries: Row[] = (seed.queries ?? []).map((row, index) => ({
    id: `q-${index}`,
    sourceId: 'instagram-apify',
    tag: 'тег',
    active: true,
    noteRu: null,
    noteKk: null,
    ...row,
  }));

  const terms: Row[] = (seed.terms ?? []).map((row, index) => ({
    id: `t-${index}`,
    category: 'SUBJECT',
    language: 'RU',
    text: 'квартир*',
    active: true,
    noteRu: null,
    noteKk: null,
    ...row,
  }));

  const audit: Row[] = [];

  const active = (rows: Row[]) => rows.filter((row) => row.active === true).length;

  const db = {
    searchQuery: {
      findMany: async () => queries,
      count: async (args?: { where?: { active?: boolean } }) =>
        args?.where?.active === undefined ? queries.length : active(queries),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id('q'), ...data } as Row;
        queries.push(row);
        return row;
      },
    },
    watchTerm: {
      findMany: async () => terms,
      count: async (args?: { where?: { active?: boolean } }) =>
        args?.where?.active === undefined ? terms.length : active(terms),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id('t'), ...data } as Row;
        terms.push(row);
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

  return { db, queries, terms, audit };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (db: unknown) => db as any;

const ACTOR = 'test@demo.local';

describe('возврат набора слов поиска', () => {
  it('на пустом списке набор появляется целиком', async () => {
    /*
     * Это состояние базы сразу после db:push: таблица создана, данных в ней
     * нет. Без возврата экран слов — тупик, а обход отказывается навсегда.
     */
    const fake = fakeDb({ queries: [] });

    const result = await restoreDefaultSearchQueries(asClient(fake.db), ACTOR);

    expect(result.added).toHaveLength(DEFAULT_SEARCH_QUERIES.length);
    expect(result.kept).toHaveLength(0);
    expect(fake.queries).toHaveLength(DEFAULT_SEARCH_QUERIES.length);
  });

  it('выключенное слово остаётся выключенным, а не возвращается включённым', async () => {
    const off = DEFAULT_SEARCH_QUERIES.find((seed) => seed.active)?.tag ?? 'оскемен';
    const fake = fakeDb({ queries: [{ tag: off, active: false, noteRu: 'моё пояснение' }] });

    const result = await restoreDefaultSearchQueries(asClient(fake.db), ACTOR);

    expect(result.kept).toContain(off);
    expect(fake.queries.find((row) => row.tag === off)?.active).toBe(false);
    expect(fake.queries.find((row) => row.tag === off)?.noteRu).toBe('моё пояснение');
  });

  it('второе нажатие ничего не добавляет', async () => {
    const fake = fakeDb({ queries: [] });

    await restoreDefaultSearchQueries(asClient(fake.db), ACTOR);
    const again = await restoreDefaultSearchQueries(asClient(fake.db), ACTOR);

    expect(again.added).toHaveLength(0);
    expect(again.kept).toHaveLength(DEFAULT_SEARCH_QUERIES.length);
    expect(fake.queries).toHaveLength(DEFAULT_SEARCH_QUERIES.length);
  });

  it('за потолком слова добавляются выключенными, а не теряются с отказом', async () => {
    /*
     * Отказ целиком был бы хуже: он оставил бы список в том же неполном виде
     * и ничего не объяснил. Потолок включённых слов — это потолок расхода на
     * один обход, а слово, лежащее выключенным, денег не стоит.
     */
    const fake = fakeDb({
      queries: Array.from({ length: MAX_ACTIVE_QUERIES }, (_, index) => ({
        tag: `чужойтег${index}`,
        active: true,
      })),
    });

    const result = await restoreDefaultSearchQueries(asClient(fake.db), ACTOR);

    expect(result.added).toHaveLength(DEFAULT_SEARCH_QUERIES.length);
    expect(result.addedDisabled.length).toBeGreaterThan(0);
    expect(result.activeCount).toBe(MAX_ACTIVE_QUERIES);
    for (const tag of result.addedDisabled) {
      expect(fake.queries.find((row) => row.tag === tag)?.active).toBe(false);
    }
  });

  it('каждое добавленное слово попадает в журнал с названной причиной', async () => {
    const fake = fakeDb({ queries: [] });

    const result = await restoreDefaultSearchQueries(asClient(fake.db), ACTOR);

    expect(fake.audit).toHaveLength(result.added.length);
    expect(String(fake.audit[0]?.comment)).toContain('возвратом набора');
    expect(fake.audit[0]?.actor).toBe(ACTOR);
  });
});

describe('возврат набора слов-ловушек', () => {
  it('на пустом списке набор появляется целиком', async () => {
    const fake = fakeDb({ terms: [] });

    const result = await restoreDefaultWatchTerms(asClient(fake.db), ACTOR);

    expect(result.added).toHaveLength(DEFAULT_WATCH_TERMS.length);
    expect(result.kept).toBe(0);
    expect(fake.terms).toHaveLength(DEFAULT_WATCH_TERMS.length);
  });

  it('выключенная ловушка и правленый текст сохраняются', async () => {
    const seed = DEFAULT_WATCH_TERMS[0];
    const fake = fakeDb({
      terms: [
        {
          category: seed?.category,
          text: seed?.text,
          active: false,
          noteRu: 'выключил сам',
        },
      ],
    });

    const result = await restoreDefaultWatchTerms(asClient(fake.db), ACTOR);

    expect(result.kept).toBe(1);
    const row = fake.terms.find((item) => item.text === seed?.text);
    expect(row?.active).toBe(false);
    expect(row?.noteRu).toBe('выключил сам');
  });

  it('второе нажатие ничего не добавляет', async () => {
    const fake = fakeDb({ terms: [] });

    await restoreDefaultWatchTerms(asClient(fake.db), ACTOR);
    const again = await restoreDefaultWatchTerms(asClient(fake.db), ACTOR);

    expect(again.added).toHaveLength(0);
    expect(again.kept).toBe(DEFAULT_WATCH_TERMS.length);
    expect(fake.terms).toHaveLength(DEFAULT_WATCH_TERMS.length);
  });

  it('то же слово в другой группе считается отсутствующим в своей', async () => {
    /*
     * Группа у ловушки — не ярлык, а то, в какой из признаков рекламы она
     * складывается при отборе. Слово «ЖК», перенесённое в группу стоп-слов,
     * перестаёт быть признаком предмета, и набор без него неполон.
     */
    const seed = DEFAULT_WATCH_TERMS.find((term) => term.category === 'SUBJECT');
    const fake = fakeDb({ terms: [{ category: 'EXCLUDE', text: seed?.text, active: true }] });

    const result = await restoreDefaultWatchTerms(asClient(fake.db), ACTOR);

    expect(result.added).toContain(seed?.text);
    expect(result.kept).toBe(0);
  });

  it('ловушки возвращаются включёнными: потолка расхода у них нет', async () => {
    /*
     * Отличие от слов поиска, и оно по смыслу. Слово поиска открывает платную
     * страницу, поэтому включённых слов не больше потолка. Ловушка
     * применяется к уже прочитанному тексту и ничего не стоит — выключать её
     * при возврате было бы защитой от несуществующего расхода.
     */
    const fake = fakeDb({ terms: [] });

    const result = await restoreDefaultWatchTerms(asClient(fake.db), ACTOR);

    expect(result.activeCount).toBe(DEFAULT_WATCH_TERMS.filter((term) => term.active).length);
    expect(result.activeCount).toBeGreaterThan(MAX_ACTIVE_QUERIES);
  });

  it('каждое добавленное слово попадает в журнал с названной причиной', async () => {
    const fake = fakeDb({ terms: [] });

    const result = await restoreDefaultWatchTerms(asClient(fake.db), ACTOR);

    expect(fake.audit).toHaveLength(result.added.length);
    expect(String(fake.audit[0]?.comment)).toContain('возвратом набора');
    expect(fake.audit[0]?.actor).toBe(ACTOR);
  });
});
