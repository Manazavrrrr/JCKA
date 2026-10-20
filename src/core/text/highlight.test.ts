/**
 * Проверка разрезания текста под подсветку.
 *
 * Два свойства здесь важнее остальных и проверяются в первую очередь.
 *
 * Первое: полное покрытие. Склейка кусков обязана давать исходный текст
 * символ в символ. Нарушение этого свойства означает, что аналитик видит
 * объявление с потерянным или удвоенным фрагментом — и принимает решение
 * по искажённому документу.
 *
 * Второе: пересечение ролей не теряется. Если фрагмент одновременно
 * предложен алгоритмом и подтверждён человеком, кусок должен нести обе
 * роли. Выбор одной из двух превратил бы гипотезу в доказательство или
 * наоборот — ровно та подмена, которую разделение подсветок и должно
 * предотвращать.
 */

import { describe, expect, it } from 'vitest';

import {
  type HighlightSpan,
  clipSegments,
  segmentClass,
  toSegments,
  usableSpans,
} from './highlight';

const TEXT = 'Продам 2-комнатную в ЖК Алтай Арман. Бронирование 150 000 тенге, срок сдачи 2027.';

function joined(text: string, spans: HighlightSpan[]): string {
  return toSegments(text, spans)
    .map((segment) => segment.text)
    .join('');
}

describe('полное покрытие текста', () => {
  it('без фрагментов текст остаётся одним куском', () => {
    const segments = toSegments(TEXT, []);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe(TEXT);
    expect(segments[0]?.roles).toEqual([]);
  });

  it('склейка кусков равна исходному тексту', () => {
    const spans: HighlightSpan[] = [
      { charStart: 21, charEnd: 35, role: 'AI' },
      { charStart: 37, charEnd: 63, role: 'EVIDENCE' },
    ];
    expect(joined(TEXT, spans)).toBe(TEXT);
  });

  it('склейка сохраняется и при пересекающихся фрагментах', () => {
    const spans: HighlightSpan[] = [
      { charStart: 37, charEnd: 63, role: 'AI' },
      { charStart: 37, charEnd: 49, role: 'EVIDENCE' },
      { charStart: 50, charEnd: 75, role: 'EVIDENCE' },
    ];
    expect(joined(TEXT, spans)).toBe(TEXT);
  });

  it('смещения кусков идут подряд и без разрывов', () => {
    const segments = toSegments(TEXT, [
      { charStart: 0, charEnd: 6, role: 'AI' },
      { charStart: 37, charEnd: 49, role: 'EVIDENCE' },
    ]);

    let cursor = 0;
    for (const segment of segments) {
      expect(segment.charStart).toBe(cursor);
      expect(segment.text).toBe(TEXT.slice(segment.charStart, segment.charEnd));
      cursor = segment.charEnd;
    }
    expect(cursor).toBe(TEXT.length);
  });

  it('пустой текст даёт пустой список, а не кусок с пустой строкой', () => {
    expect(toSegments('', [{ charStart: 0, charEnd: 3, role: 'AI' }])).toEqual([]);
  });
});

describe('роли на кусках', () => {
  it('фрагмент получает свою роль', () => {
    const segments = toSegments(TEXT, [{ charStart: 37, charEnd: 49, role: 'AI' }]);
    const marked = segments.filter((segment) => segment.roles.length > 0);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.text).toBe('Бронирование');
    expect(marked[0]?.roles).toEqual(['AI']);
  });

  /** Главный тест модуля. */
  it('пересечение гипотезы и доказательства несёт обе роли', () => {
    const segments = toSegments(TEXT, [
      { charStart: 37, charEnd: 63, role: 'AI' },
      { charStart: 37, charEnd: 49, role: 'EVIDENCE' },
    ]);

    const both = segments.filter((segment) => segment.roles.length === 2);
    expect(both).toHaveLength(1);
    expect(both[0]?.text).toBe('Бронирование');
    expect(both[0]?.roles).toEqual(['AI', 'EVIDENCE']);

    // Остаток цитаты ИИ остаётся только гипотезой.
    const aiOnly = segments.filter((segment) => segment.roles.length === 1);
    expect(aiOnly).toHaveLength(1);
    expect(aiOnly[0]?.roles).toEqual(['AI']);
    expect(aiOnly[0]?.text.trim()).toBe('150 000 тенге');
  });

  it('три пересекающихся фрагмента дают куски с устойчивым порядком ролей', () => {
    const segments = toSegments(TEXT, [
      { charStart: 37, charEnd: 75, role: 'EVIDENCE' },
      { charStart: 40, charEnd: 63, role: 'AI' },
      { charStart: 45, charEnd: 50, role: 'AI' },
    ]);

    for (const segment of segments) {
      if (segment.roles.length === 2) {
        expect(segment.roles).toEqual(['AI', 'EVIDENCE']);
      }
    }
    expect(joined(TEXT, [])).toBe(TEXT);
  });

  it('подсказки всех накрывших фрагментов собираются без повторов', () => {
    const segments = toSegments(TEXT, [
      { charStart: 37, charEnd: 63, role: 'AI', title: 'R2 — платная бронь' },
      { charStart: 37, charEnd: 49, role: 'EVIDENCE', title: 'Доказательство к R2' },
      { charStart: 37, charEnd: 49, role: 'EVIDENCE', title: 'Доказательство к R2' },
    ]);

    const both = segments.find((segment) => segment.roles.length === 2);
    expect(both?.titles).toEqual(['R2 — платная бронь', 'Доказательство к R2']);
  });

  it('идентификаторы источников доходят до куска для перехода', () => {
    const segments = toSegments(TEXT, [
      { charStart: 0, charEnd: 6, role: 'AI', refId: 'sug-1' },
    ]);
    expect(segments[0]?.refIds).toEqual(['sug-1']);
  });
});

describe('класс подсветки', () => {
  const segment = (roles: HighlightSpan['role'][]) => ({
    text: 'x',
    charStart: 0,
    charEnd: 1,
    roles,
    titles: [],
    refIds: [],
  });

  it('гипотеза и доказательство оформляются по-разному', () => {
    expect(segmentClass(segment(['AI']))).toBe('hl-ai');
    expect(segmentClass(segment(['EVIDENCE']))).toBe('hl-evidence');
  });

  it('пересечение получает собственный класс, а не один из двух', () => {
    const both = segmentClass(segment(['AI', 'EVIDENCE']));
    expect(both).toBe('hl-both');
    expect(both).not.toBe('hl-ai');
    expect(both).not.toBe('hl-evidence');
  });

  it('обычный текст не получает класса', () => {
    expect(segmentClass(segment([]))).toBeNull();
  });
});

describe('устойчивость к негодным смещениям', () => {
  it('фрагмент за границей текста отбрасывается, а текст показывается целиком', () => {
    const spans: HighlightSpan[] = [{ charStart: 500, charEnd: 520, role: 'AI' }];
    expect(usableSpans(TEXT, spans)).toEqual([]);
    expect(joined(TEXT, spans)).toBe(TEXT);
  });

  it('перевёрнутый и нулевой фрагмент отбрасываются', () => {
    expect(
      usableSpans(TEXT, [
        { charStart: 20, charEnd: 10, role: 'AI' },
        { charStart: 15, charEnd: 15, role: 'EVIDENCE' },
      ]),
    ).toEqual([]);
  });

  it('частично выходящий за текст фрагмент отбрасывается целиком', () => {
    // Подрезать его молча нельзя: обрезанная цитата — уже другая цитата,
    // и подсветка указала бы не на то, что утверждал источник.
    const spans: HighlightSpan[] = [{ charStart: TEXT.length - 3, charEnd: TEXT.length + 9, role: 'AI' }];
    expect(usableSpans(TEXT, spans)).toEqual([]);
  });

  it('дробные и отрицательные смещения отбрасываются', () => {
    expect(
      usableSpans(TEXT, [
        { charStart: 1.5, charEnd: 6, role: 'AI' },
        { charStart: -2, charEnd: 6, role: 'AI' },
      ]),
    ).toEqual([]);
  });

  it('годные фрагменты остаются, даже если рядом есть негодные', () => {
    const good: HighlightSpan = { charStart: 0, charEnd: 6, role: 'AI' };
    expect(usableSpans(TEXT, [good, { charStart: 900, charEnd: 999, role: 'AI' }])).toEqual([good]);
  });
});

describe('укорачивание для списка', () => {
  const spans: HighlightSpan[] = [
    { charStart: 0, charEnd: 6, role: 'AI' },
    { charStart: 37, charEnd: 49, role: 'EVIDENCE' },
  ];

  it('куски за пределом отбрасываются', () => {
    const clipped = clipSegments(toSegments(TEXT, spans), 20);
    expect(clipped.map((item) => item.text).join('')).toBe(TEXT.slice(0, 20));
  });

  it('кусок на границе подрезается вместе со смещением', () => {
    const clipped = clipSegments(toSegments(TEXT, spans), 42);
    const last = clipped[clipped.length - 1];
    expect(last?.charEnd).toBe(42);
    expect(clipped.map((item) => item.text).join('')).toBe(TEXT.slice(0, 42));
  });

  it('подсветка остаётся на своём месте после укорачивания', () => {
    // Предел 45 проходит внутри слова «Бронирование» (37..49): подсветка
    // обязана остаться на своих символах, а не съехать к началу строки.
    const clipped = clipSegments(toSegments(TEXT, spans), 45);
    const marked = clipped.filter((item) => item.roles.length > 0);
    expect(marked[0]?.text).toBe('Продам');
    expect(marked[1]?.text).toBe('Брониров');
    expect(marked[1]?.charStart).toBe(37);
  });

  it('предел больше длины текста ничего не меняет', () => {
    const segments = toSegments(TEXT, spans);
    expect(clipSegments(segments, TEXT.length + 100)).toEqual(segments);
  });
});
