/**
 * Тесты решения по элементу потока.
 *
 * Главная проверка здесь не «взяли или не взяли», а «сказано ли почему».
 * Отброшенное объявление нигде больше не всплывёт, поэтому причина отказа —
 * единственное, по чему аналитик поймёт, что фильтр настроен неверно.
 * Поэтому в каждом случае проверяется и вердикт, и то, что в объяснении
 * названы конкретные слова, а не общая формулировка.
 *
 * Тексты объявлений взяты близко к настоящим: так же устроены реальные
 * размещения по Усть-Каменогорску, включая те, по которым система честно
 * признаёт, что одних слов мало.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_WATCH_TERMS } from './defaults';
import { decide, fingerprint } from './decision';
import type { WatchTerm } from './terms';

function term(partial: Partial<WatchTerm> & Pick<WatchTerm, 'id' | 'text' | 'category'>): WatchTerm {
  return { language: 'RU', active: true, note: null, ...partial };
}

const TERMS: WatchTerm[] = [
  term({ id: 's1', text: 'квартир*', category: 'SUBJECT' }),
  term({ id: 'a1', text: 'застройщик*', category: 'ACTOR' }),
  term({ id: 'o1', text: 'брон*', category: 'OFFER' }),
  term({ id: 'c1', text: 'строящ*', category: 'CONSTRUCTION' }),
  term({ id: 'x1', text: 'посуточн*', category: 'EXCLUDE' }),
];

describe('decide — вердикт', () => {
  it('берёт объявление при совпадении двух групп', () => {
    const decision = decide('Квартиры в строящемся доме, старт продаж', TERMS);

    expect(decision.verdict).toBe('KEPT');
    expect(decision.reason).toBe('MATCHED');
    expect(decision.categories).toEqual(['SUBJECT', 'CONSTRUCTION']);
  });

  it('отбрасывает текст без единого совпадения', () => {
    const decision = decide('Продам гараж в кооперативе', TERMS);

    expect(decision.verdict).toBe('SKIPPED');
    expect(decision.reason).toBe('NO_MATCH');
    expect(decision.hits).toHaveLength(0);
  });

  it('отбрасывает по стоп-слову даже при совпадениях', () => {
    const decision = decide('Сдам квартиру посуточно, бронь по телефону', TERMS);

    expect(decision.verdict).toBe('SKIPPED');
    expect(decision.reason).toBe('EXCLUDED');
    expect(decision.excludedBy.map((hit) => hit.termId)).toEqual(['x1']);
    // Положительные совпадения сохраняются: аналитик должен видеть,
    // что именно стоп-слово перевесило.
    expect(decision.hits.length).toBeGreaterThan(0);
  });

  it('отбрасывает совпадение по одной группе', () => {
    const decision = decide('Продаю квартиру, срочно', TERMS);

    expect(decision.verdict).toBe('SKIPPED');
    expect(decision.reason).toBe('TOO_NARROW');
    expect(decision.categories).toEqual(['SUBJECT']);
  });

  it('порог групп настраивается', () => {
    const decision = decide('Продаю квартиру, срочно', TERMS, { rule: { minCategories: 1 } });

    expect(decision.verdict).toBe('KEPT');
  });

  it('повтор отбрасывается отдельной причиной', () => {
    const text = 'Квартиры в строящемся доме';
    const decision = decide(text, TERMS, { seen: new Set([fingerprint(text)]) });

    expect(decision.reason).toBe('DUPLICATE');
  });
});

describe('decide — объяснение', () => {
  it('называет пойманные слова и их категории', () => {
    const decision = decide('Бронь квартиры у застройщика', TERMS);

    expect(decision.explanation.ru).toContain('«брон*»');
    expect(decision.explanation.ru).toContain('«квартир*»');
    expect(decision.explanation.ru).toContain('предложение денег');
    expect(decision.explanation.kk).toContain('«брон*»');
  });

  it('называет сработавшее стоп-слово', () => {
    const decision = decide('Квартира посуточно у застройщика', TERMS);

    expect(decision.explanation.ru).toContain('«посуточн*»');
  });

  it('при узком совпадении объясняет, чего не хватило', () => {
    const decision = decide('Продаю квартиру', TERMS);

    expect(decision.explanation.ru).toContain('минимум по 2');
    expect(decision.explanation.ru).toContain('«квартир*»');
  });

  it('объяснение заполнено на обоих языках в любом случае', () => {
    const texts = [
      'Квартиры в строящемся доме',
      'Продам гараж',
      'Квартира посуточно',
      'Продаю квартиру',
    ];

    for (const text of texts) {
      const decision = decide(text, TERMS);
      expect(decision.explanation.ru.length).toBeGreaterThan(10);
      expect(decision.explanation.kk.length).toBeGreaterThan(10);
    }
  });
});

describe('fingerprint — отпечаток текста', () => {
  it('не зависит от регистра, пробелов и значков', () => {
    expect(fingerprint('Бронь  квартиры! 🔥')).toBe(fingerprint('бронь квартиры'));
  });

  it('различает разные тексты', () => {
    expect(fingerprint('Бронь квартиры')).not.toBe(fingerprint('Бронь студии'));
  });

  it('детерминирован и имеет постоянную длину', () => {
    const print = fingerprint('ЖК «Алтай Арман», старт продаж');
    expect(print).toBe(fingerprint('ЖК «Алтай Арман», старт продаж'));
    expect(print).toHaveLength(16);
  });
});

describe('набор по умолчанию на текстах, похожих на настоящие', () => {
  it('берёт объявление со скидкой, бронью и стройкой', () => {
    const decision = decide(
      'СКИДКИ ДО −15% на квартиры в строящихся домах. Бронь — 50 000 ₸. Звоните: +7 700 038 66 06',
      DEFAULT_WATCH_TERMS,
    );

    expect(decision.verdict).toBe('KEPT');
    expect(decision.categories).toContain('SUBJECT');
    expect(decision.categories).toContain('OFFER');
    expect(decision.categories).toContain('CONSTRUCTION');
  });

  it('берёт казахское объявление', () => {
    const decision = decide(
      'Тұрғын үй кешені салынып жатыр. Брондау басталды.',
      DEFAULT_WATCH_TERMS,
    );

    expect(decision.verdict).toBe('KEPT');
  });

  it('отбрасывает аренду', () => {
    const decision = decide(
      'Сдам 2-комнатную квартиру посуточно, центр города, аренда от суток',
      DEFAULT_WATCH_TERMS,
    );

    expect(decision.reason).toBe('EXCLUDED');
  });

  /**
   * Этот случай показывает границу метода честно.
   *
   * Так устроена типичная сторис премиум-сегмента: «название, город,
   * премиум класс, 8 жилых этажей, какую квартиру вы ищете?». Признак
   * стройки в ней есть — число этажей и ход работ, — но он нарисован
   * на картинке, а в подписи остаётся только предмет. Система такое
   * объявление не берёт и прямо пишет, какой группы не хватило: это
   * и есть то место, где аналитик добавит слово или внесёт объявление
   * вручную.
   */
  it('честно отбрасывает рекламу, где признак стройки только на картинке', () => {
    const decision = decide(
      'ПРЕМИУМ ХАУС ДЕМО. Усть-Каменогорск. Премиум класс. Какую квартиру вы ищете?',
      DEFAULT_WATCH_TERMS,
    );

    expect(decision.reason).toBe('TOO_NARROW');
    expect(decision.categories).toEqual(['SUBJECT']);
  });
});
