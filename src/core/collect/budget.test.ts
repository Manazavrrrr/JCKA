/**
 * Проверка дневного предела расходов.
 *
 * Модуль маленький, но ошибка в нём стоит денег органа и обнаруживается
 * счётом в конце месяца, а не падением. Поэтому проверяется не «в целом
 * работает», а три места, где такие модули ломаются молча: граница суток,
 * сложение денег и сама граница предела.
 */

import { describe, expect, it } from 'vitest';

import { estimateRunCostUsd } from './apify';
import {
  DEFAULT_DAILY_BUDGET_USD,
  LOCAL_UTC_OFFSET_MINUTES,
  MAX_DAILY_BUDGET_USD,
  type SpentRun,
  clampDailyBudgetUsd,
  decideBudget,
  maxAffordableResults,
  spentTodayUsd,
  startOfLocalDay,
} from './budget';

/** Короткая запись момента по UTC. */
const utc = (iso: string) => new Date(iso);

describe('граница суток', () => {
  it('сутки начинаются в местную полночь, то есть в 19:00 UTC предыдущего дня', () => {
    // UTC+5: 18 октября 00:00 местного — это 17 октября 19:00 UTC.
    expect(startOfLocalDay(utc('2026-10-18T07:00:00Z')).toISOString()).toBe(
      '2026-10-17T19:00:00.000Z',
    );
  });

  it('смещение именно то, которым живёт Казахстан', () => {
    expect(LOCAL_UTC_OFFSET_MINUTES).toBe(300);
  });

  it('19:00 UTC — уже следующие местные сутки, 18:59 — ещё прежние', () => {
    const before = startOfLocalDay(utc('2026-10-17T18:59:00Z'));
    const after = startOfLocalDay(utc('2026-10-17T19:01:00Z'));
    expect(before.toISOString()).toBe('2026-10-16T19:00:00.000Z');
    expect(after.toISOString()).toBe('2026-10-17T19:00:00.000Z');
    expect(before.getTime()).toBeLessThan(after.getTime());
  });

  it('расход ночью после местной полуночи не засчитывается во вчерашний день', () => {
    /*
     * Главное, ради чего сутки местные. Прогон в 01:00 по Усть-Каменогорску
     * — это 20:00 UTC предыдущего дня. На счёте по UTC он лёг бы во
     * вчерашний день, то есть предел на новые сутки оказался бы уже
     * надкусанным.
     */
    const nightRun: SpentRun = { startedAt: utc('2026-10-17T20:00:00Z'), costUsd: 0.27 };
    const nowSameLocalDay = utc('2026-10-18T05:00:00Z'); // 10:00 местного 18-го

    expect(spentTodayUsd([nightRun], nowSameLocalDay)).toBe(0.27);
  });

  it('вчерашние прогоны в счёт не идут', () => {
    const yesterday: SpentRun = { startedAt: utc('2026-10-17T10:00:00Z'), costUsd: 0.27 };
    expect(spentTodayUsd([yesterday], utc('2026-10-18T07:00:00Z'))).toBe(0);
  });
});

describe('сложение денег', () => {
  it('десять прогонов по 27 центов дают ровно 2,70, а не 2,7000000000000006', () => {
    const runs: SpentRun[] = Array.from({ length: 10 }, () => ({
      startedAt: utc('2026-10-18T07:00:00Z'),
      costUsd: 0.27,
    }));
    const total = spentTodayUsd(runs, utc('2026-10-18T08:00:00Z'));

    expect(total).toBe(2.7);
    // Проверка именно на точность: наивное сложение здесь даёт хвост.
    expect(String(total)).toBe('2.7');
  });

  it('классический случай с долями: 0,10 и 0,20 дают 0,30', () => {
    const runs: SpentRun[] = [
      { startedAt: utc('2026-10-18T07:00:00Z'), costUsd: 0.1 },
      { startedAt: utc('2026-10-18T07:30:00Z'), costUsd: 0.2 },
    ];
    expect(spentTodayUsd(runs, utc('2026-10-18T08:00:00Z'))).toBe(0.3);
  });

  it('бесплатные прогоны приходят в счёт, но на сумму не влияют', () => {
    const runs: SpentRun[] = [
      { startedAt: utc('2026-10-18T07:00:00Z'), costUsd: 0 },
      { startedAt: utc('2026-10-18T07:10:00Z'), costUsd: 0.05 },
    ];
    expect(spentTodayUsd(runs, utc('2026-10-18T08:00:00Z'))).toBe(0.05);
  });
});

describe('выставление предела', () => {
  it('предел по умолчанию не выше потолка', () => {
    expect(DEFAULT_DAILY_BUDGET_USD).toBeLessThanOrEqual(MAX_DAILY_BUDGET_USD);
  });

  it('лишний нуль в поле ввода упирается в потолок', () => {
    expect(clampDailyBudgetUsd(50)).toBe(MAX_DAILY_BUDGET_USD);
  });

  it('отрицательный предел — это ноль, а не отрицательные деньги', () => {
    expect(clampDailyBudgetUsd(-1)).toBe(0);
  });

  it('мусор вместо числа возвращает значение по умолчанию', () => {
    expect(clampDailyBudgetUsd(Number.NaN)).toBe(DEFAULT_DAILY_BUDGET_USD);
  });
});

describe('решение о платном прогоне', () => {
  const now = utc('2026-10-18T07:00:00Z');
  const run = (costUsd: number): SpentRun => ({ startedAt: utc('2026-10-18T06:00:00Z'), costUsd });

  it('ноль в пределе — это выключенный платный сбор, а не исчерпанный', () => {
    const decision = decideBudget({ runs: [], dailyBudgetUsd: 0, plannedResults: 20, now });

    expect(decision.verdict).toBe('DISABLED');
    expect(decision.allowed).toBe(false);
    // Разница с исчерпанием важна для текста: ничего не тратили, это решение.
    expect(decision.note.ru).toContain('выключен');
    expect(decision.spentUsd).toBe(0);
  });

  it('при свободном пределе прогон разрешён', () => {
    const decision = decideBudget({ runs: [], dailyBudgetUsd: 0.5, plannedResults: 20, now });

    expect(decision.verdict).toBe('ALLOWED');
    expect(decision.allowed).toBe(true);
    expect(decision.plannedUsd).toBe(estimateRunCostUsd(20));
    expect(decision.remainingUsd).toBe(0.5);
  });

  it('прогон, занимающий остаток ровно целиком, проходит', () => {
    /*
     * Граница, а не «почти»: равенство должно пускать. Ошибка в знаке
     * сравнения проявилась бы только здесь — и только в последний прогон
     * суток, то есть раз в день и не каждый.
     */
    const planned = estimateRunCostUsd(20); // 0,06 $
    const decision = decideBudget({
      runs: [run(0.5 - planned)],
      dailyBudgetUsd: 0.5,
      plannedResults: 20,
      now,
    });

    expect(decision.remainingUsd).toBe(planned);
    expect(decision.verdict).toBe('ALLOWED');
  });

  it('прогон, вылезающий за остаток на цент, не проходит', () => {
    const planned = estimateRunCostUsd(20);
    const decision = decideBudget({
      runs: [run(0.5 - planned + 0.01)],
      dailyBudgetUsd: 0.5,
      plannedResults: 20,
      now,
    });

    expect(decision.verdict).toBe('WOULD_EXCEED');
    expect(decision.allowed).toBe(false);
  });

  it('исчерпанный предел отличается от невместившегося прогона', () => {
    const decision = decideBudget({
      runs: [run(0.5)],
      dailyBudgetUsd: 0.5,
      plannedResults: 20,
      now,
    });

    expect(decision.verdict).toBe('EXHAUSTED');
    expect(decision.remainingUsd).toBe(0);
    expect(decision.note.ru).toContain('исчерпан');
  });

  it('перерасход не делает остаток отрицательным', () => {
    const decision = decideBudget({
      runs: [run(0.9)],
      dailyBudgetUsd: 0.5,
      plannedResults: 20,
      now,
    });

    expect(decision.remainingUsd).toBe(0);
    expect(decision.affordableResults).toBe(0);
  });

  it('отказ называет остаток и во что он обходится в публикациях', () => {
    const decision = decideBudget({
      runs: [run(0.47)],
      dailyBudgetUsd: 0.5,
      plannedResults: 100,
      now,
    });

    expect(decision.verdict).toBe('WOULD_EXCEED');
    /*
     * Разделитель — запятая: текст читает человек, а не машина. «0.03 $»
     * в русском предложении выглядит как обрывок кода.
     */
    expect(decision.note.ru).toContain('0,03');
    expect(decision.note.ru).toContain('0,47');
    expect(decision.note.ru).toContain(String(decision.affordableResults));
  });

  it('ни в одном тексте отказа не осталось точки в роли разделителя', () => {
    for (const [budget, spent, planned] of [
      [0, 0, 100],
      [0.5, 0.5, 100],
      [0.5, 0.47, 100],
      [0.5, 0.1, 10],
    ] as const) {
      const decision = decideBudget({
        runs: spent > 0 ? [run(spent)] : [],
        dailyBudgetUsd: budget,
        plannedResults: planned,
        now,
      });

      expect(decision.note.ru).not.toMatch(/\d\.\d/);
      expect(decision.note.kk).not.toMatch(/\d\.\d/);
    }
  });

  it('у каждого отказа есть текст на обоих языках', () => {
    for (const budget of [0, 0.5]) {
      const decision = decideBudget({
        runs: [run(budget)],
        dailyBudgetUsd: budget,
        plannedResults: 100,
        now,
      });
      expect(decision.note.ru.length).toBeGreaterThan(0);
      expect(decision.note.kk.length).toBeGreaterThan(0);
    }
  });
});

describe('вместимость остатка', () => {
  it('на 27 центов умещается ровно сто публикаций — потолок прогона', () => {
    expect(maxAffordableResults(0.27)).toBe(100);
  });

  it('пустой и отрицательный остаток не вмещают ничего', () => {
    expect(maxAffordableResults(0)).toBe(0);
    expect(maxAffordableResults(-1)).toBe(0);
  });

  it('то, что названо вместимым, действительно умещается в остаток', () => {
    /*
     * Связка двух округлений: стоимость округляется вверх, вместимость вниз.
     * Если бы они округлялись в одну сторону, предел пробивался бы ровно на
     * прогоне «по остатку» — самом частом в автообходе.
     */
    for (let cents = 1; cents <= 500; cents += 1) {
      const remaining = cents / 100;
      const fits = maxAffordableResults(remaining);
      expect(estimateRunCostUsd(fits)).toBeLessThanOrEqual(remaining);
    }
  });

  it('взять на одну публикацию больше вместимого уже нельзя', () => {
    for (let cents = 3; cents <= 200; cents += 1) {
      const remaining = cents / 100;
      const fits = maxAffordableResults(remaining);
      expect(estimateRunCostUsd(fits + 1)).toBeGreaterThan(remaining);
    }
  });
});
