/**
 * Тесты формулы балла и правила зоны.
 *
 * Это самая ответственная часть системы: ошибка здесь означает неверную
 * зону у реального объекта. Поэтому проверяются не только нормальные случаи,
 * но и все границы из раздела 5 ТЗ, включая те, на которых легко ошибиться.
 */

import { describe, expect, it } from 'vitest';

import type { FactorCode } from '../domain/enums';
import {
  FACTOR_WEIGHTS,
  MAX_SCORE,
  READINESS_GAP_THRESHOLD_PP,
  RED_THRESHOLD,
  YELLOW_THRESHOLD,
  computeScore,
  hasRedZoneCombination,
  meetsReadinessGapThreshold,
  readinessGapPp,
  resolveZone,
  sortFactorCodes,
} from './model';

const ALL: FactorCode[] = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];

describe('веса факторов', () => {
  it('совпадают со значениями из ТЗ', () => {
    expect(FACTOR_WEIGHTS).toEqual({ R1: 35, R2: 25, R3: 10, R4: 15, R5: 10, R6: 5 });
  });

  it('в сумме дают 100 — верхняя граница достигается только полным набором', () => {
    const total = ALL.reduce((sum, code) => sum + FACTOR_WEIGHTS[code], 0);
    expect(total).toBe(MAX_SCORE);
  });
});

describe('computeScore', () => {
  it('без подтверждённых факторов даёт 0', () => {
    expect(computeScore([])).toBe(0);
  });

  it('суммирует веса подтверждённых факторов', () => {
    expect(computeScore(['R1', 'R2'])).toBe(60);
    expect(computeScore(['R2', 'R3'])).toBe(35);
    expect(computeScore(['R3', 'R4', 'R5'])).toBe(35);
  });

  it('не зависит от порядка кодов', () => {
    expect(computeScore(['R6', 'R1', 'R3'])).toBe(computeScore(['R1', 'R3', 'R6']));
  });

  it('учитывает повторяющийся код только один раз', () => {
    expect(computeScore(['R1', 'R1', 'R1'])).toBe(35);
  });

  it('ограничен сотней баллов', () => {
    expect(computeScore(ALL)).toBe(100);
    expect(computeScore([...ALL, 'R1', 'R2'])).toBe(100);
  });
});

describe('resolveZone', () => {
  it('зелёная зона — до 25 баллов', () => {
    expect(resolveZone(0, [])).toBe('GREEN');
    expect(resolveZone(10, ['R3'])).toBe('GREEN');
    expect(resolveZone(24, ['R3', 'R6'])).toBe('GREEN');
  });

  it('жёлтая зона начинается ровно с 25 баллов', () => {
    expect(resolveZone(YELLOW_THRESHOLD - 1, ['R4'])).toBe('GREEN');
    expect(resolveZone(YELLOW_THRESHOLD, ['R2'])).toBe('YELLOW');
  });

  it('59 баллов — ещё жёлтая', () => {
    expect(resolveZone(RED_THRESHOLD - 1, ['R2', 'R4', 'R3', 'R6'])).toBe('YELLOW');
  });

  it('красная зона требует и 60 баллов, и подтверждённой комбинации R1+R2', () => {
    expect(resolveZone(60, ['R1', 'R2'])).toBe('RED');
    expect(resolveZone(70, ['R1', 'R2', 'R3'])).toBe('RED');
  });

  /**
   * Главная ловушка модели. Объект может набрать 60, 75 и даже 95 баллов,
   * но без одновременного подтверждения R1 и R2 он остаётся жёлтым.
   * Реализация «зона по баллу» этот тест не пройдёт.
   */
  it('60+ баллов без комбинации R1+R2 остаются жёлтыми', () => {
    expect(resolveZone(75, ['R1', 'R3', 'R4', 'R5', 'R6'])).toBe('YELLOW');
    expect(resolveZone(65, ['R2', 'R3', 'R4', 'R5', 'R6'])).toBe('YELLOW');
    expect(resolveZone(60, ['R1', 'R4', 'R3'])).toBe('YELLOW');
  });

  it('комбинация R1+R2 при балле ниже 60 красную зону не открывает', () => {
    // Недостижимо арифметически (R1+R2 = 60), но правило должно быть явным:
    // проверяются два независимых условия, а не одно.
    expect(resolveZone(59, ['R1', 'R2'])).toBe('YELLOW');
  });

  it('полный набор факторов — красная зона', () => {
    expect(resolveZone(computeScore(ALL), ALL)).toBe('RED');
  });
});

describe('hasRedZoneCombination', () => {
  it('требует оба фактора одновременно', () => {
    expect(hasRedZoneCombination(['R1'])).toBe(false);
    expect(hasRedZoneCombination(['R2'])).toBe(false);
    expect(hasRedZoneCombination(['R1', 'R2'])).toBe(true);
    expect(hasRedZoneCombination(['R2', 'R1', 'R6'])).toBe(true);
  });
});

describe('контрольные сценарии из раздела 5 ТЗ', () => {
  it('А. Реклама строящегося жилья, основание не проверено, есть призыв внести деньги → 35, жёлтая', () => {
    const codes: FactorCode[] = ['R2', 'R3'];
    const score = computeScore(codes);
    expect(score).toBe(35);
    expect(resolveZone(score, codes)).toBe('YELLOW');
  });

  it('А. Непроверенное основание не превращается в R1 — иначе был бы 70/красная', () => {
    const wrong: FactorCode[] = ['R1', 'R2', 'R3'];
    expect(computeScore(wrong)).toBe(70);
    expect(resolveZone(70, wrong)).toBe('RED');
    // Именно поэтому R1 управляется трёхзначным статусом, а не флагом:
    // разница между сценарием А и Б — это разница между жёлтой и красной зоной.
  });

  it('Б. Установлено отсутствие основания + депозит + реклама → 70, красная', () => {
    const codes: FactorCode[] = ['R1', 'R2', 'R3'];
    const score = computeScore(codes);
    expect(score).toBe(70);
    expect(resolveZone(score, codes)).toBe('RED');
  });

  it('В. Действующая гарантия, обычная реклама → 10, зелёная', () => {
    const codes: FactorCode[] = ['R3'];
    const score = computeScore(codes);
    expect(score).toBe(10);
    expect(resolveZone(score, codes)).toBe('GREEN');
  });
});

describe('readinessGapPp', () => {
  it('считает разницу в процентных пунктах по модулю', () => {
    expect(readinessGapPp(70, 45)).toBe(25);
    expect(readinessGapPp(45, 70)).toBe(25);
    expect(readinessGapPp(50, 50)).toBe(0);
  });

  it('возвращает null, если хотя бы одно значение неизвестно', () => {
    expect(readinessGapPp(70, null)).toBeNull();
    expect(readinessGapPp(null, 45)).toBeNull();
    expect(readinessGapPp(undefined, undefined)).toBeNull();
  });
});

describe('meetsReadinessGapThreshold', () => {
  it('порог ровно 20 п.п. считается достигнутым', () => {
    expect(READINESS_GAP_THRESHOLD_PP).toBe(20);
    expect(meetsReadinessGapThreshold(60, 40)).toBe(true);
    expect(meetsReadinessGapThreshold(60, 41)).toBe(false);
  });

  it('различает «не достигнут» и «неизвестно»', () => {
    expect(meetsReadinessGapThreshold(60, 50)).toBe(false);
    expect(meetsReadinessGapThreshold(60, null)).toBeNull();
  });
});

describe('sortFactorCodes', () => {
  it('упорядочивает по номеру и убирает дубликаты', () => {
    expect(sortFactorCodes(['R6', 'R2', 'R2', 'R1'])).toEqual(['R1', 'R2', 'R6']);
  });
});
