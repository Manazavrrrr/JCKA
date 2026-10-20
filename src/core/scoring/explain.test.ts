/**
 * Тесты объяснения балла.
 *
 * ТЗ требует, чтобы по объекту было видно, из чего сложился балл и почему
 * присвоена зона. Проверяется, что объяснение полное (все шесть факторов),
 * честное (отмечает подтверждения без автора и обоснования) и
 * воспроизводимое (одинаковый вход — одинаковый текст).
 */

import { describe, expect, it } from 'vitest';

import {
  explainScore,
  explainZone,
  isReportReady,
  summarizeScore,
  type ExplainableFactor,
} from './explain';

const ANALYST = 'analyst@demo.local';
const AT = new Date('2026-10-01T09:00:00.000Z');

function confirmed(code: ExplainableFactor['code'], evidenceCount = 1): ExplainableFactor {
  return {
    code,
    status: 'CONFIRMED',
    origin: 'MANUAL',
    rationale: `Обоснование по фактору ${code}.`,
    confirmedBy: ANALYST,
    confirmedAt: AT,
    evidenceCount,
  };
}

function rejected(code: ExplainableFactor['code']): ExplainableFactor {
  return {
    code,
    status: 'REJECTED',
    origin: 'MANUAL',
    rationale: `Проверено, ${code} не подтвердился.`,
    confirmedBy: ANALYST,
    confirmedAt: AT,
    evidenceCount: 0,
  };
}

// ---------------------------------------------------------------------------

describe('explainScore — состав объяснения', () => {
  it('показывает все шесть факторов, даже если часть не заполнена', () => {
    const explanation = explainScore([confirmed('R3')]);
    expect(explanation.contributions).toHaveLength(6);
    expect(explanation.contributions.map((item) => item.code)).toEqual([
      'R1',
      'R2',
      'R3',
      'R4',
      'R5',
      'R6',
    ]);
  });

  it('отсутствующий фактор считается непроверенным, а не отклонённым', () => {
    const explanation = explainScore([confirmed('R3')]);
    const r1 = explanation.contributions.find((item) => item.code === 'R1');
    expect(r1?.status).toBe('NEEDS_CHECK');
    expect(r1?.applied).toBe(0);
    expect(explanation.needsCheckCodes).toContain('R1');
  });

  it('вклад фактора равен весу только при подтверждении', () => {
    const explanation = explainScore([confirmed('R1'), rejected('R2')]);
    const byCode = new Map(explanation.contributions.map((item) => [item.code, item]));
    expect(byCode.get('R1')?.applied).toBe(35);
    expect(byCode.get('R2')?.applied).toBe(0);
    expect(byCode.get('R2')?.weight).toBe(25);
  });

  it('балл и зона совпадают с расчётом модели', () => {
    const explanation = explainScore([confirmed('R1'), confirmed('R2'), confirmed('R3')]);
    expect(explanation.score).toBe(70);
    expect(explanation.zone).toBe('RED');
  });

  it('формула перечисляет подтверждённые факторы с весами', () => {
    const explanation = explainScore([confirmed('R1'), confirmed('R2'), confirmed('R3')]);
    expect(explanation.formula).toBe('R1(+35) + R2(+25) + R3(+10) = 70');
  });

  it('формула показывает ограничение в 100 баллов', () => {
    const all = (['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] as const).map((code) => confirmed(code));
    const explanation = explainScore(all);
    expect(explanation.rawSum).toBe(100);
    expect(explanation.score).toBe(100);
    expect(explanation.capped).toBe(false);
  });

  it('при отсутствии подтверждённых факторов формула это проговаривает', () => {
    const explanation = explainScore([]);
    expect(explanation.score).toBe(0);
    expect(explanation.formula).toContain('Подтверждённых факторов нет');
  });

  it('детерминирован: одинаковый вход даёт идентичный результат', () => {
    const input = [confirmed('R1'), confirmed('R3'), rejected('R2')];
    expect(JSON.stringify(explainScore(input))).toBe(JSON.stringify(explainScore(input)));
  });

  it('не зависит от порядка факторов на входе', () => {
    const a = explainScore([confirmed('R3'), confirmed('R1')]);
    const b = explainScore([confirmed('R1'), confirmed('R3')]);
    expect(a.formula).toBe(b.formula);
    expect(a.confirmedCodes).toEqual(b.confirmedCodes);
  });
});

// ---------------------------------------------------------------------------

describe('explainZone — формулировка причины', () => {
  it('для красной зоны называет оба условия', () => {
    const { zone, reason } = explainZone(70, ['R1', 'R2', 'R3']);
    expect(zone).toBe('RED');
    expect(reason.ru).toContain('R1, R2');
    expect(reason.ru).toContain('70');
  });

  /**
   * Ключевой случай демонстрации: высокий балл без комбинации R1+R2.
   * Объяснение обязано прямо назвать недостающий фактор, иначе аналитик
   * решит, что система ошиблась с зоной.
   */
  it('для 60+ без комбинации объясняет, какого фактора не хватает', () => {
    const { zone, reason, boundary } = explainZone(75, ['R1', 'R3', 'R4', 'R5', 'R6']);
    expect(zone).toBe('YELLOW');
    expect(reason.ru).toContain('не хватает: R2');
    expect(reason.ru).toContain('высокий балл сам по себе красную зону не открывает');
    expect(boundary?.ru).toContain('R2');
  });

  it('для обычной жёлтой зоны называет интервал', () => {
    const { reason } = explainZone(35, ['R2', 'R3']);
    expect(reason.ru).toContain('25–59');
  });

  it('для зелёной зоны называет порог жёлтой', () => {
    const { zone, boundary } = explainZone(10, ['R3']);
    expect(zone).toBe('GREEN');
    expect(boundary?.ru).toContain('25');
  });

  it('причина зоны заполнена на двух языках', () => {
    for (const [score, codes] of [
      [70, ['R1', 'R2', 'R3']],
      [75, ['R1', 'R3', 'R4', 'R5', 'R6']],
      [35, ['R2', 'R3']],
      [0, []],
    ] as const) {
      const { reason } = explainZone(score, codes);
      expect(reason.ru.length).toBeGreaterThan(10);
      expect(reason.kk.length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------

describe('контроль качества решений', () => {
  it('подтверждение без автора и даты попадает в предупреждения', () => {
    const explanation = explainScore([
      { code: 'R2', status: 'CONFIRMED', rationale: 'Есть цитата.', evidenceCount: 1 },
    ]);
    expect(explanation.integrityWarnings.some((item) => item.ru.includes('автор'))).toBe(true);
    expect(isReportReady(explanation)).toBe(false);
  });

  it('подтверждение без обоснования попадает в предупреждения', () => {
    const explanation = explainScore([
      { code: 'R2', status: 'CONFIRMED', confirmedBy: ANALYST, confirmedAt: AT, evidenceCount: 1 },
    ]);
    expect(explanation.integrityWarnings.some((item) => item.ru.includes('обоснование'))).toBe(true);
  });

  it('корректно заполненный объект готов к выгрузке в сигнальную карточку', () => {
    const explanation = explainScore([confirmed('R1'), confirmed('R2'), confirmed('R3')]);
    expect(explanation.integrityWarnings).toHaveLength(0);
    expect(isReportReady(explanation)).toBe(true);
  });

  it('объект без подтверждённых факторов не выносится в карточку', () => {
    expect(isReportReady(explainScore([rejected('R1')]))).toBe(false);
  });

  it('непроверенные факторы перечислены как открытые вопросы', () => {
    const explanation = explainScore([confirmed('R2'), confirmed('R3'), rejected('R4')]);
    expect(explanation.openQuestions).toHaveLength(3); // R1, R5, R6
    expect(explanation.openQuestions[0]?.ru).toContain('R1');
  });
});

// ---------------------------------------------------------------------------

describe('summarizeScore', () => {
  it('русская сводка содержит балл, зону и коды факторов', () => {
    const summary = summarizeScore(explainScore([confirmed('R1'), confirmed('R2'), confirmed('R3')]));
    expect(summary).toContain('70 баллов');
    expect(summary).toContain('красная зона');
    expect(summary).toContain('R1, R2, R3');
  });

  it('упоминает количество открытых вопросов', () => {
    const summary = summarizeScore(explainScore([confirmed('R2'), confirmed('R3')]));
    expect(summary).toContain('Требуют проверки: 4');
  });

  it('для объекта без факторов сообщает об отсутствии подтверждений', () => {
    expect(summarizeScore(explainScore([]))).toContain('Подтверждённых факторов риска нет');
  });

  it('казахская сводка не содержит русского текста', () => {
    const summary = summarizeScore(explainScore([confirmed('R3')]), 'kk');
    expect(summary).toContain('балл');
    expect(summary).not.toContain('баллов');
    expect(summary).not.toContain('зона');
  });
});
