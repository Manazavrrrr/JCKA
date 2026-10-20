/**
 * Тесты слов-ловушек.
 *
 * Проверяется ровно то, чем этот слой рискует. Во-первых, безопасность:
 * термин пишет аналитик, и любой символ, который он введёт, не должен ни
 * уронить прогон, ни превратиться в регулярное выражение с неожиданным
 * смыслом. Во-вторых, позиции: найденное слово подсвечивается в исходном
 * тексте, поэтому офсет обязан указывать на тот же символ, что и в
 * оригинале. В-третьих, двуязычность: «пәтер» в объявлении и «патер»
 * в термине — одно и то же слово.
 */

import { describe, expect, it } from 'vitest';

import {
  compileTerm,
  distinctTerms,
  hitCategories,
  matchTerms,
  termPatternSource,
  watchTermInputSchema,
  type WatchTerm,
} from './terms';

function term(partial: Partial<WatchTerm> & Pick<WatchTerm, 'id' | 'text' | 'category'>): WatchTerm {
  return { language: 'RU', active: true, note: null, ...partial };
}

describe('termPatternSource — компиляция термина', () => {
  it('оборачивает термин границами слова', () => {
    expect(termPatternSource('застройщик')).toBe('\\bзастройщик\\b');
  });

  it('звёздочка становится остатком слова', () => {
    expect(termPatternSource('рассрочк*')).toBe('\\bрассрочк\\w*\\b');
  });

  it('пробел между словами допускает дефис и тире', () => {
    expect(termPatternSource('первоначальный взнос')).toBe(
      '\\bпервоначальный[\\s\\-–—]+взнос\\b',
    );
  });

  it('экранирует спецсимволы регулярных выражений', () => {
    const source = termPatternSource('цена (от)');
    expect(source).toContain('\\(');
    expect(source).toContain('\\)');
    expect(() => new RegExp(source)).not.toThrow();
  });

  it('не падает на мусорном вводе', () => {
    for (const text of ['((((', '[a-z', '+++', '\\', '?*+']) {
      expect(() => compileTerm(text)).not.toThrow();
    }
  });
});

describe('matchTerms — поиск в тексте', () => {
  const terms = [
    term({ id: 's1', text: 'квартир*', category: 'SUBJECT' }),
    term({ id: 'o1', text: 'рассрочк*', category: 'OFFER' }),
    term({ id: 'a1', text: 'застройщик*', category: 'ACTOR' }),
  ];

  it('ловит слово в любой падежной форме', () => {
    const hits = matchTerms('Продаются квартиры в рассрочку от застройщика.', terms);
    expect(hits.map((hit) => hit.termId)).toEqual(['s1', 'o1', 'a1']);
  });

  it('позиции указывают на исходный текст', () => {
    const text = 'Рассрочка без процентов на квартиры.';
    const hits = matchTerms(text, terms);

    for (const hit of hits) {
      expect(text.slice(hit.charStart, hit.charEnd)).toBe(hit.fragment);
    }
  });

  it('не ловит слово внутри другого слова', () => {
    // «ЖК» не должно находиться внутри «ЖКХ»: иначе в выборку попадут
    // объявления коммунальных служб.
    const hits = matchTerms('Задолженность по ЖКХ и ремонт', [
      term({ id: 'jk', text: 'ЖК', category: 'SUBJECT' }),
    ]);
    expect(hits).toHaveLength(0);
  });

  it('находит отдельно стоящее ЖК', () => {
    const hits = matchTerms('ЖК «Алтай Арман», старт продаж', [
      term({ id: 'jk', text: 'ЖК', category: 'SUBJECT' }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.fragment).toBe('ЖК');
  });

  it('казахский термин совпадает с казахским текстом', () => {
    const hits = matchTerms('Пәтерлер сатылымы басталды', [
      term({ id: 'k1', text: 'пәтер*', category: 'SUBJECT', language: 'KK' }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.fragment).toBe('Пәтерлер');
  });

  it('термин с пробелом совпадает через дефис', () => {
    const hits = matchTerms('Первоначальный-взнос 10%', [
      term({ id: 'o2', text: 'первоначальный взнос', category: 'OFFER' }),
    ]);
    expect(hits).toHaveLength(1);
  });

  it('выключенный термин не участвует', () => {
    const hits = matchTerms('Продаются квартиры', [
      term({ id: 's1', text: 'квартир*', category: 'SUBJECT', active: false }),
    ]);
    expect(hits).toHaveLength(0);
  });

  it('к каждому совпадению прилагается предложение целиком', () => {
    const hits = matchTerms('Дом сдан. Продаются квартиры в рассрочку. Звоните.', terms);
    expect(hits[0]?.quote).toBe('Продаются квартиры в рассрочку.');
  });

  it('совпадения отсортированы по позиции', () => {
    const hits = matchTerms('Застройщик предлагает квартиры в рассрочку.', terms);
    const starts = hits.map((hit) => hit.charStart);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe('distinctTerms и hitCategories', () => {
  const terms = [
    term({ id: 's1', text: 'квартир*', category: 'SUBJECT' }),
    term({ id: 'o1', text: 'брон*', category: 'OFFER' }),
  ];

  it('повторное срабатывание термина схлопывается', () => {
    const hits = matchTerms('Квартиры, квартиры и ещё раз квартиры. Бронь.', terms);
    expect(hits.length).toBeGreaterThan(2);
    expect(distinctTerms(hits).map((hit) => hit.termId)).toEqual(['s1', 'o1']);
  });

  it('категории возвращаются в порядке объявления', () => {
    const hits = matchTerms('Бронь на квартиры', terms);
    expect(hitCategories(hits)).toEqual(['SUBJECT', 'OFFER']);
  });
});

describe('watchTermInputSchema — проверка ввода', () => {
  const base = { category: 'SUBJECT', language: 'RU', active: true } as const;

  it('принимает двухбуквенный термин', () => {
    expect(watchTermInputSchema.safeParse({ ...base, text: 'ЖК' }).success).toBe(true);
  });

  it('отклоняет однобуквенный термин', () => {
    expect(watchTermInputSchema.safeParse({ ...base, text: 'к' }).success).toBe(false);
  });

  it('отклоняет термин без букв и цифр', () => {
    expect(watchTermInputSchema.safeParse({ ...base, text: '***' }).success).toBe(false);
  });

  it('отклоняет целый абзац вместо термина', () => {
    expect(watchTermInputSchema.safeParse({ ...base, text: 'а'.repeat(200) }).success).toBe(false);
  });

  it('обрезает пробелы по краям', () => {
    const parsed = watchTermInputSchema.safeParse({ ...base, text: '  застройщик  ' });
    expect(parsed.success && parsed.data.text).toBe('застройщик');
  });
});
