/**
 * Тесты прогона сбора.
 *
 * Проверяется поведение, которое видно только на пачке: повторы внутри
 * одного прогона, счётчик срабатываний по каждому термину и то, что
 * отброшенное не исчезает, а остаётся в результате вместе с причиной.
 */

import { describe, expect, it } from 'vitest';

import { fingerprint } from './decision';
import { runCollection, type RawItem } from './run';
import type { WatchTerm } from './terms';

function term(partial: Partial<WatchTerm> & Pick<WatchTerm, 'id' | 'text' | 'category'>): WatchTerm {
  return { language: 'RU', active: true, note: null, ...partial };
}

const TERMS: WatchTerm[] = [
  term({ id: 's1', text: 'квартир*', category: 'SUBJECT' }),
  term({ id: 'o1', text: 'брон*', category: 'OFFER' }),
  term({ id: 'c1', text: 'строящ*', category: 'CONSTRUCTION' }),
  term({ id: 'dead', text: 'пентхаус*', category: 'SUBJECT' }),
  term({ id: 'x1', text: 'посуточн*', category: 'EXCLUDE' }),
];

function item(externalId: string, text: string): RawItem {
  return { sourceId: 'telegram-public', externalId, text };
}

describe('runCollection', () => {
  const items = [
    item('1', 'Бронь квартиры в строящемся доме'),
    item('2', 'Сдам квартиру посуточно'),
    item('3', 'Продам гараж'),
    item('4', 'Продаю квартиру'),
  ];

  it('возвращает все элементы, включая отброшенные', () => {
    const { items: result, stats } = runCollection(items, TERMS);

    expect(result).toHaveLength(4);
    expect(stats.total).toBe(4);
    expect(stats.kept).toBe(1);
    expect(stats.skipped).toBe(3);
  });

  it('считает причины отказа', () => {
    const { stats } = runCollection(items, TERMS);

    expect(stats.byReason.MATCHED).toBe(1);
    expect(stats.byReason.EXCLUDED).toBe(1);
    expect(stats.byReason.NO_MATCH).toBe(1);
    expect(stats.byReason.TOO_NARROW).toBe(1);
    expect(stats.byReason.DUPLICATE).toBe(0);
  });

  it('у каждого элемента есть отпечаток', () => {
    const { items: result } = runCollection(items, TERMS);

    for (const collected of result) {
      expect(collected.fingerprint).toBe(fingerprint(collected.text));
    }
  });

  it('повтор внутри прогона отбрасывается', () => {
    const { items: result, stats } = runCollection(
      [item('1', 'Бронь квартиры в строящемся доме'), item('2', 'бронь   КВАРТИРЫ в строящемся доме!')],
      TERMS,
    );

    expect(result[0]?.decision.verdict).toBe('KEPT');
    expect(result[1]?.decision.reason).toBe('DUPLICATE');
    expect(stats.kept).toBe(1);
  });

  it('повтор ранее собранного отбрасывается', () => {
    const text = 'Бронь квартиры в строящемся доме';
    const { stats } = runCollection([item('1', text)], TERMS, {
      seen: new Set([fingerprint(text)]),
    });

    expect(stats.byReason.DUPLICATE).toBe(1);
    expect(stats.kept).toBe(0);
  });

  it('отброшенное не попадает в набор повторов', () => {
    // Второй экземпляр отброшенного объявления должен получить настоящую
    // причину отказа, а не «уже есть в системе»: в системе его нет.
    const { items: result } = runCollection(
      [item('1', 'Сдам квартиру посуточно'), item('2', 'Сдам квартиру посуточно')],
      TERMS,
    );

    expect(result[1]?.decision.reason).toBe('EXCLUDED');
  });

  it('считает срабатывания по элементам, а не по вхождениям', () => {
    const { stats } = runCollection(
      [item('1', 'Квартиры, квартиры и ещё квартиры. Бронь.')],
      TERMS,
    );

    expect(stats.termUsage.find((usage) => usage.termId === 's1')?.items).toBe(1);
  });

  it('показывает термины, не поймавшие ничего', () => {
    const { stats } = runCollection(items, TERMS);
    const dead = stats.termUsage.find((usage) => usage.termId === 'dead');

    expect(dead).toBeDefined();
    expect(dead?.items).toBe(0);
  });

  it('выключенные термины в статистике не участвуют', () => {
    const terms = [...TERMS, term({ id: 'off', text: 'таунхаус*', category: 'SUBJECT', active: false })];
    const { stats } = runCollection(items, terms);

    expect(stats.termUsage.find((usage) => usage.termId === 'off')).toBeUndefined();
  });

  it('пустая пачка даёт пустой результат, а не ошибку', () => {
    const { items: result, stats } = runCollection([], TERMS);

    expect(result).toHaveLength(0);
    expect(stats.total).toBe(0);
    expect(stats.termUsage.length).toBeGreaterThan(0);
  });

  it('результат не зависит от повторного вызова', () => {
    const first = runCollection(items, TERMS);
    const second = runCollection(items, TERMS);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
