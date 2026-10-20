/**
 * Проверка поиска по словам.
 *
 * Два свойства здесь важнее остальных, и оба про деньги.
 *
 * Первое: обход по нескольким словам не может стоить больше потолка. Цена
 * растёт произведением, а произведение — это ровно то место, где
 * недосчитываются: «по двадцать с каждого» звучит как двадцать, а означает
 * сто. Проверяется не на удобных числах, а перебором.
 *
 * Второе: приведение слова к тегу никогда не происходит молча. Если
 * введённое изменили, об этом сказано флагом, и интерфейс обязан показать
 * результат до запуска. Прогон, тихо искавший не то, что просили, выглядит
 * как прогон, который ничего не нашёл.
 */

import { describe, expect, it } from 'vitest';

import { MAX_POSTS_LIMIT } from './apify';
import {
  DEFAULT_ACTIVE_QUERY_COUNT,
  DEFAULT_HASHTAG_LIMIT,
  DEFAULT_SEARCH_QUERIES,
  HASHTAG_PROBLEM_TEXT,
  MAX_ACTIVE_QUERIES,
  MAX_RESULTS_PER_WALK,
  hasGeoMarker,
  hashtagExploreUrl,
  instagramHashtagInput,
  limitPerTagWithinWalk,
  normalizeHashtag,
  plannedWalkResults,
} from './discovery';

describe('приведение слова к тегу', () => {
  it('решётка и регистр снимаются', () => {
    const result = normalizeHashtag('#ЖКУстьКаменогорск');
    expect(result.tag).toBe('жкустькаменогорск');
    expect(result.problem).toBeNull();
    expect(result.changed).toBe(true);
  });

  it('пробелы склеиваются, и об этом сказано', () => {
    /*
     * Центральный случай всего модуля: аналитик пишет словами, Instagram
     * ищет тегами. Склейка допустима, молчание о ней — нет.
     */
    const result = normalizeHashtag('жк усть каменогорск');
    expect(result.tag).toBe('жкустькаменогорск');
    expect(result.changed).toBe(true);
  });

  it('уже готовый тег не считается изменённым', () => {
    const result = normalizeHashtag('оскемен');
    expect(result.tag).toBe('оскемен');
    expect(result.changed).toBe(false);
  });

  it('адрес страницы тега, скопированный из браузера, понимается', () => {
    const result = normalizeHashtag('https://www.instagram.com/explore/tags/оскемен/');
    expect(result.tag).toBe('оскемен');
  });

  it('казахские буквы допустимы: без них теряется реклама на казахском', () => {
    expect(normalizeHashtag('өскемен').tag).toBe('өскемен');
    expect(normalizeHashtag('шығысқазақстан').tag).toBe('шығысқазақстан');
  });

  it('дефис склеивается так же, как пробел', () => {
    expect(normalizeHashtag('усть-каменогорск').tag).toBe('устькаменогорск');
  });

  it('пустое слово отвергается', () => {
    expect(normalizeHashtag('   ').problem).toBe('EMPTY');
    expect(normalizeHashtag('#').problem).toBe('EMPTY');
  });

  it('одна буква отвергается: по ней находится всё подряд', () => {
    expect(normalizeHashtag('ж').problem).toBe('TOO_SHORT');
  });

  it('знаки препинания отвергаются с объяснимой причиной', () => {
    expect(normalizeHashtag('жк!').problem).toBe('BAD_CHARACTERS');
    expect(normalizeHashtag('цена$').problem).toBe('BAD_CHARACTERS');
  });

  it('у каждой причины отказа есть текст на обоих языках', () => {
    for (const [, text] of Object.entries(HASHTAG_PROBLEM_TEXT)) {
      expect(text.ru.length).toBeGreaterThan(0);
      expect(text.kk.length).toBeGreaterThan(0);
    }
  });

  it('кириллица в адресе страницы кодируется', () => {
    const url = hashtagExploreUrl('оскемен');
    expect(url.startsWith('https://www.instagram.com/explore/tags/')).toBe(true);
    expect(url).not.toContain('оскемен');
    expect(decodeURIComponent(url)).toContain('оскемен');
  });
});

describe('стоимость обхода', () => {
  it('пять слов по двадцать — это сто результатов, а не двадцать', () => {
    expect(plannedWalkResults(5, 20)).toBe(100);
  });

  it('три слова по десять — тридцать', () => {
    expect(plannedWalkResults(3, 10)).toBe(30);
  });

  it('без слов обход ничего не запрашивает', () => {
    expect(plannedWalkResults(0, 20)).toBe(0);
  });

  it('потолок обхода не пробивается даже десятью словами по сотне', () => {
    expect(plannedWalkResults(10, MAX_POSTS_LIMIT)).toBe(MAX_RESULTS_PER_WALK);
  });
});

describe('сколько брать с одного слова', () => {
  it('пока произведение умещается, берётся запрошенное', () => {
    expect(limitPerTagWithinWalk(5, 20)).toBe(20);
  });

  it('когда не умещается, доля урезается до целого', () => {
    // 100 / 7 = 14,28 — берём 14, иначе обход вылезет за потолок.
    expect(limitPerTagWithinWalk(7, 20)).toBe(14);
  });

  it('слов больше, чем результатов в потолке, — брать нечего', () => {
    expect(limitPerTagWithinWalk(200, 20)).toBe(0);
  });
});

describe('вход сборщика для обхода', () => {
  it('на каждое слово — свой адрес страницы тега', () => {
    const input = instagramHashtagInput(['оскемен', 'жкусткаменогорск']);
    expect(input.directUrls).toHaveLength(2);
    expect(input.resultsType).toBe('posts');
    expect(input.skipPinnedPosts).toBe(true);
  });

  it('повторы отбрасываются: платить дважды за один тег незачем', () => {
    const input = instagramHashtagInput(['оскемен', 'оскемен', 'оскемен']);
    expect(input.directUrls).toHaveLength(1);
  });

  it('список слов обрезается по потолку включённых', () => {
    const many = Array.from({ length: 50 }, (_, index) => `тег${index}`);
    expect(instagramHashtagInput(many).directUrls).toHaveLength(MAX_ACTIVE_QUERIES);
  });

  it('отсечка по давности передаётся, если задана, и отсутствует, если нет', () => {
    expect(instagramHashtagInput(['оскемен']).onlyPostsNewerThan).toBeUndefined();
    expect(instagramHashtagInput(['оскемен'], { newerThan: '7 days' }).onlyPostsNewerThan).toBe(
      '7 days',
    );
    expect(instagramHashtagInput(['оскемен'], { newerThan: '  ' }).onlyPostsNewerThan).toBeUndefined();
  });

  it('обход по любому числу слов укладывается в потолок результатов', () => {
    /*
     * Главное свойство модуля, проверенное перебором, а не примером.
     * Сборщик берёт resultsLimit на каждый адрес, поэтому вылезти за
     * потолок можно на любом неудобном числе слов, а не только на круглом.
     */
    for (let count = 1; count <= 30; count += 1) {
      for (const desired of [1, 10, 20, 50, MAX_POSTS_LIMIT]) {
        const tags = Array.from({ length: count }, (_, index) => `тег${index}`);
        const input = instagramHashtagInput(tags, { limitPerTag: desired });
        const total = input.directUrls.length * input.resultsLimit;
        expect(total).toBeLessThanOrEqual(MAX_RESULTS_PER_WALK);
      }
    }
  });
});

describe('слова по умолчанию', () => {
  it('каждое слово уже приведено к виду тега и не меняется при проверке', () => {
    /*
     * Иначе демонстрация ищет не то, что написано в списке: аналитик видит
     * одно слово, в адрес уходит другое.
     */
    for (const seed of DEFAULT_SEARCH_QUERIES) {
      const result = normalizeHashtag(seed.tag);
      expect(result.tag).toBe(seed.tag);
      expect(result.changed).toBe(false);
    }
  });

  it('повторов в списке нет', () => {
    const tags = DEFAULT_SEARCH_QUERIES.map((seed) => seed.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('у каждого слова есть пояснение на обоих языках', () => {
    for (const seed of DEFAULT_SEARCH_QUERIES) {
      expect(seed.note.ru.length).toBeGreaterThan(0);
      expect(seed.note.kk.length).toBeGreaterThan(0);
    }
  });

  it('включённые по умолчанию слова все имеют привязку к месту', () => {
    /*
     * Обещание из описания списка, переведённое в проверку: без привязки
     * платный обход уходит на чужие регионы. Широкие слова в списке есть,
     * но лежат выключенными.
     */
    for (const seed of DEFAULT_SEARCH_QUERIES.filter((item) => item.active)) {
      expect(hasGeoMarker(seed.tag)).toBe(true);
    }
  });

  it('выключенные широкие слова объясняют, почему они выключены', () => {
    for (const seed of DEFAULT_SEARCH_QUERIES.filter((item) => !item.active)) {
      expect(seed.note.ru).toContain('Выключено');
    }
  });

  it('включённых слов не больше потолка, и обход по ним укладывается в деньги', () => {
    expect(DEFAULT_ACTIVE_QUERY_COUNT).toBeGreaterThan(0);
    expect(DEFAULT_ACTIVE_QUERY_COUNT).toBeLessThanOrEqual(MAX_ACTIVE_QUERIES);
    expect(plannedWalkResults(DEFAULT_ACTIVE_QUERY_COUNT, DEFAULT_HASHTAG_LIMIT)).toBeLessThanOrEqual(
      MAX_RESULTS_PER_WALK,
    );
  });
});
