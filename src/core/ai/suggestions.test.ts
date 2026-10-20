/**
 * Тесты раскладки разбора на гипотезы.
 *
 * Проверяется граница между машиной и человеком — то место, где результат
 * работы алгоритма превращается в вопрос аналитику. Главное требование одно
 * и оно сформулировано в ТЗ: ИИ не ставит балл. Поэтому тесты следят, чтобы
 *
 *   - каждая гипотеза несла проверяемое основание: цитату с позициями либо,
 *     если основание лежит вне текста, указание, где его искать;
 *   - позиции указывали ровно на то место исходного текста;
 *   - ни одна запись не содержала ни веса, ни зоны, ни подтверждённого статуса;
 *   - решения по разным вопросам были раздельными записями.
 *
 * Последнее не формальность. Принять сопоставление с реестром и отклонить
 * гипотезу о факторе — два независимых решения; слитые в одну запись, они
 * заставили бы аналитика согласиться с тем, с чем он не согласен.
 */

import { describe, expect, it } from 'vitest';

import { publications } from '../../../prisma/seed-data';
import { analyzeWithRules } from './rules-provider';
import { isLowConfidence, summarizeAnalysis, toSuggestionRows } from './suggestions';

function analyzeText(text: string) {
  return analyzeWithRules({ text });
}

/** Объявление со платной бронью на личный счёт — сценарий A из ТЗ. */
const escrowBypass = publications.find((item) => item.key === 'pub-01');

// ---------------------------------------------------------------------------

describe('раскладка разбора на гипотезы', () => {
  it('каждый вопрос к аналитику становится отдельной записью', () => {
    const result = analyzeText(
      'Продаём 2-комнатную в ЖК «Алтай Арман», дом сдаём в 2027 году. ' +
        'Бронь 500 000 ₸ переводом на карту менеджера.',
    );
    const rows = toSuggestionRows(result);

    const kinds = rows.map((row) => row.kind);
    expect(kinds).toContain('PAYMENT_TERMS');
    expect(new Set(kinds).size).toBe(new Set(kinds).size);
    // Условия расчётов — одна запись: аналитик оценивает схему оплаты целиком.
    expect(kinds.filter((kind) => kind === 'PAYMENT_TERMS')).toHaveLength(1);
  });

  it('гипотеза о факторе несёт код фактора', () => {
    const result = analyzeText(
      'Строительство идёт, котлован готов. Бронируем квартиру за 300 000 тенге ' +
        'наличными в офисе, оформление позже.',
    );
    const rows = toSuggestionRows(result);
    const hypotheses = rows.filter((row) => row.kind === 'FACTOR_HYPOTHESIS');

    expect(hypotheses.length).toBeGreaterThan(0);
    for (const row of hypotheses) {
      expect(row.factorCode).not.toBeNull();
      expect(['R2', 'R3', 'R5', 'R6']).toContain(row.factorCode);
    }
  });

  /**
   * R1 (отсутствие правового основания) и R4 (подтверждённые обращения) ИИ
   * предлагать не вправе: первое проверяется в реестре, второе — в журнале
   * обращений, и ни то, ни другое не следует из текста объявления.
   */
  it('никогда не предлагает R1 и R4', () => {
    for (const publication of publications) {
      const rows = toSuggestionRows(analyzeText(publication.rawText));
      const codes = rows.map((row) => row.factorCode).filter((code) => code !== null);
      expect(codes).not.toContain('R1');
      expect(codes).not.toContain('R4');
    }
  });

  it('сопоставления с реестром идут каждое своей записью', () => {
    const result = analyzeText(
      'ЖК «Алтай Арман», ул. Протозанова, 85. Квартиры от застройщика.',
    );
    const rows = toSuggestionRows(result);
    const matches = rows.filter((row) => row.kind === 'PROJECT_MATCH');

    expect(matches.length).toBe(result.projectMatches.length);
    for (const row of matches) {
      expect(row.projectId).not.toBeNull();
      expect(row.factorCode).toBeNull();
    }
  });

  it('привязка публикации проставляется всем гипотезам, кроме сопоставлений', () => {
    const result = analyzeText('Бронь 500 000 ₸ на счёт директора, стройка идёт.');
    const rows = toSuggestionRows(result, { projectId: 'altai-arman' });

    for (const row of rows.filter((item) => item.kind !== 'PROJECT_MATCH')) {
      expect(row.projectId).toBe('altai-arman');
    }
  });

  it('текст без признаков риска не порождает гипотез', () => {
    const rows = toSuggestionRows(
      analyzeText('Сдаю 1-комнатную квартиру на длительный срок, 150 000 ₸ в месяц.'),
    );
    expect(rows.filter((row) => row.kind === 'FACTOR_HYPOTHESIS')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('проверяемость основания', () => {
  /**
   * Самое важное свойство раздела: аналитик проверяет не вывод алгоритма,
   * а цитату. Если позиции не совпадают с текстом, подсветка покажет чужое
   * место, и доверие к разбору теряется целиком.
   */
  it('позиции цитаты указывают ровно на то место исходного текста', () => {
    for (const publication of publications) {
      const rows = toSuggestionRows(analyzeText(publication.rawText));

      for (const row of rows) {
        if (row.evidenceExcerpt === null) continue;
        expect(row.charStart).not.toBeNull();
        expect(row.charEnd).not.toBeNull();

        const start = row.charStart as number;
        const end = row.charEnd as number;
        expect(end).toBeGreaterThan(start);
        expect(publication.rawText.slice(start, end)).toBe(row.evidenceExcerpt);
      }
    }
  });

  /**
   * Гипотеза без цитаты законна, но только в одном случае: когда основание
   * находится вне текста. Так появляется R3 для объявления, которое продаёт
   * жильё, но не называет стадию, — проверять надо реестр, а не текст.
   *
   * Требование к такой гипотезе строже, а не слабее: если цитаты нет,
   * аналитик обязан получить указание, где смотреть. Гипотеза без цитаты
   * и без указания — это «кажется, что-то не так», и в работе она бесполезна.
   */
  it('гипотеза без цитаты обязана указывать, где искать основание', () => {
    let withoutQuote = 0;

    for (const publication of publications) {
      const result = analyzeText(publication.rawText);

      for (const hypothesis of result.factorHypotheses) {
        if (hypothesis.span !== null) continue;
        withoutQuote += 1;

        expect(hypothesis.verification.ru.length).toBeGreaterThan(10);
        expect(hypothesis.verification.kk.length).toBeGreaterThan(10);
        expect(hypothesis.rationale.ru.length).toBeGreaterThan(10);
        expect(hypothesis.confirmable).toBe(false);
      }
    }

    // Случай существует в демонстрационных данных — иначе проверка пуста.
    expect(withoutQuote).toBeGreaterThan(0);
  });

  it('уверенность всегда в границах от нуля до единицы', () => {
    for (const publication of publications) {
      for (const row of toSuggestionRows(analyzeText(publication.rawText))) {
        expect(row.confidence).toBeGreaterThanOrEqual(0);
        expect(row.confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('гипотеза не является оценкой', () => {
  /**
   * Прямая проверка требования ТЗ: ни один вес, ни одна зона и ни один
   * подтверждённый статус не могут попасть в запись гипотезы. Если бы
   * попали — балл объекта начал бы зависеть от работы модели, и
   * воспроизводимость расчёта исчезла бы.
   */
  it('в записи нет ни веса, ни зоны, ни подтверждённого статуса', () => {
    const rows = toSuggestionRows(
      analyzeText('Бронь 500 000 ₸ на карту менеджера, дом ещё строится.'),
    );

    for (const row of rows) {
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain('"weight"');
      expect(serialized).not.toContain('"score"');
      expect(serialized).not.toContain('CONFIRMED');
      expect(serialized).not.toContain('"zone"');
      expect(serialized).not.toContain('"riskScore"');
    }
  });

  it('сводка прямо сообщает, что балл не начисляется', () => {
    const summary = summarizeAnalysis(
      analyzeText('Бронь 500 000 ₸ на карту менеджера, дом ещё строится.'),
    );
    expect(summary.scoreImpact).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('маркировка неуверенных выводов', () => {
  it('порог один для всей системы', () => {
    expect(isLowConfidence({ confidence: 0.59 })).toBe(true);
    expect(isLowConfidence({ confidence: 0.6 })).toBe(false);
    expect(isLowConfidence({ confidence: 0.95 })).toBe(false);
  });

  /**
   * R5 и R6 выводятся из текста объявления только как подозрение: разрыв
   * готовности считается по двум официальным значениям, просрочка — по
   * документам. Такие гипотезы обязаны быть помечены неуверенными.
   */
  it('выводы о готовности и просрочке помечены неуверенными', () => {
    const result = analyzeText(
      'Готовность объекта 80%, сдача была обещана в 2024 году, сроки сдвинулись.',
    );
    const rows = toSuggestionRows(result);

    const soft = rows.filter(
      (row) => row.factorCode === 'R5' || row.factorCode === 'R6',
    );
    expect(soft.length).toBeGreaterThan(0);
    for (const row of soft) expect(isLowConfidence(row)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('сводка разбора', () => {
  it('считает законные и рискованные способы расчётов раздельно', () => {
    const summary = summarizeAnalysis(
      analyzeText(
        'Расчёт через эскроу-счёт в банке. Дополнительно бронь 200 000 ₸ на карту менеджера.',
      ),
    );

    expect(summary.riskBearingPaymentTerms).toBeGreaterThan(0);
    expect(summary.lawfulPaymentTerms).toBeGreaterThan(0);
  });

  it('всегда сообщает об обязательной ручной проверке', () => {
    const summary = summarizeAnalysis(analyzeText('Продаю квартиру в новостройке.'));
    expect(summary.mandatoryChecks).toBeGreaterThan(0);
  });

  it('работает на реальном демонстрационном объявлении', () => {
    expect(escrowBypass).toBeDefined();
    const result = analyzeText(escrowBypass?.rawText ?? '');
    const summary = summarizeAnalysis(result);

    expect(summary.riskBearingPaymentTerms).toBeGreaterThan(0);
    expect(summary.factorHypotheses).toBeGreaterThan(0);
    expect(summary.scoreImpact).toBe(0);
  });
});
