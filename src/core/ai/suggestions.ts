/**
 * Превращение разбора ИИ в гипотезы для аналитика.
 *
 * Это граница между машиной и человеком, и она проведена здесь.
 *
 * Разбор объявления (AnalysisResult) — это мнение алгоритма. Запись
 * AiSuggestion — это мнение алгоритма, положенное в очередь на рассмотрение
 * человеком. Ни то, ни другое не является фактом и не влияет на балл.
 * Фактом становится RiskFactor со статусом CONFIRMED, а его ставит аналитик
 * с обоснованием.
 *
 * Поэтому у каждой гипотезы обязательны три вещи:
 *
 *   - вид (kind) — чтобы интерфейс показал её в правильном месте;
 *   - уверенность — чтобы неуверенный вывод был виден как неуверенный;
 *   - цитата с офсетами — чтобы аналитик проверял не вывод, а основание.
 *
 * Гипотеза без цитаты допустима только там, где цитировать нечего
 * (сопоставление с реестром по адресу), и тогда основание описывается
 * словами в payload.
 *
 * Модуль чистый: на вход результат разбора, на выход обычные объекты.
 * Запись в базу — в src/server/analysis.ts.
 */

import type { FactorCode, SuggestionKind } from '../domain/enums';
import { LOW_CONFIDENCE_THRESHOLD } from '../domain/enums';
import type { AnalysisResult } from './schemas';

// ---------------------------------------------------------------------------

/** Гипотеза в том виде, в котором она ложится в базу. */
export interface SuggestionRow {
  kind: SuggestionKind;
  /** Код предлагаемого фактора — только для FACTOR_HYPOTHESIS. */
  factorCode: FactorCode | null;
  /** Структурированное содержание гипотезы. */
  payload: unknown;
  confidence: number;
  evidenceExcerpt: string | null;
  charStart: number | null;
  charEnd: number | null;
  /** Объект реестра, к которому относится гипотеза, если он определён. */
  projectId: string | null;
}

export interface SuggestionContext {
  /** Объект, к которому публикация уже привязана. */
  projectId?: string | null;
}

// ---------------------------------------------------------------------------

/**
 * Раскладывает разбор на отдельные гипотезы.
 *
 * Одна запись — один вопрос к аналитику. Разбор целиком одной записью был бы
 * удобнее для хранения и бесполезен в работе: принять сопоставление с
 * реестром и отклонить гипотезу о факторе — два независимых решения, и
 * каждое должно иметь свой статус, автора и время.
 */
export function toSuggestionRows(
  result: AnalysisResult,
  context: SuggestionContext = {},
): SuggestionRow[] {
  const rows: SuggestionRow[] = [];
  const projectId = context.projectId ?? null;

  // --- Условия расчётов -----------------------------------------------------

  /**
   * Способы расчётов идут одной записью, а не по одной на термин: аналитик
   * оценивает схему оплаты целиком. «Бронь 500 000 ₸ на счёт директора» и
   * «эскроу» в одном объявлении — это один вопрос, а не два.
   */
  if (result.extracted.paymentTerms.length > 0) {
    const risky = result.extracted.paymentTerms.filter((term) => term.riskBearing);
    const first = risky[0] ?? result.extracted.paymentTerms[0];

    rows.push({
      kind: 'PAYMENT_TERMS',
      factorCode: null,
      payload: {
        terms: result.extracted.paymentTerms,
        riskBearingCount: risky.length,
        lawfulCount: result.extracted.paymentTerms.length - risky.length,
      },
      confidence: risky.length > 0 ? 0.7 : 0.5,
      evidenceExcerpt: first?.fragment ?? null,
      charStart: first?.charStart ?? null,
      charEnd: first?.charEnd ?? null,
      projectId,
    });
  }

  // --- Гипотезы о факторах --------------------------------------------------

  for (const hypothesis of result.factorHypotheses) {
    rows.push({
      kind: 'FACTOR_HYPOTHESIS',
      factorCode: hypothesis.code,
      payload: hypothesis,
      confidence: hypothesis.confidence,
      evidenceExcerpt: hypothesis.span?.fragment ?? null,
      charStart: hypothesis.span?.charStart ?? null,
      charEnd: hypothesis.span?.charEnd ?? null,
      projectId,
    });
  }

  // --- Сопоставление с реестром ---------------------------------------------

  /**
   * Сопоставления идут каждое своей записью: аналитик выбирает один объект
   * из нескольких предложенных, и отклонение неподошедших вариантов — такое
   * же решение, как принятие подошедшего.
   */
  for (const match of result.projectMatches) {
    rows.push({
      kind: 'PROJECT_MATCH',
      factorCode: null,
      payload: match,
      confidence: match.score,
      evidenceExcerpt: match.span?.fragment ?? null,
      charStart: match.span?.charStart ?? null,
      charEnd: match.span?.charEnd ?? null,
      projectId: match.projectId,
    });
  }

  return rows;
}

/**
 * Гипотеза, уверенность которой ниже порога, обязана быть помечена в
 * интерфейсе. Порог один для всей системы: пользователь не должен
 * догадываться, где «0.55» считается много, а где мало.
 */
export function isLowConfidence(row: Pick<SuggestionRow, 'confidence'>): boolean {
  return row.confidence < LOW_CONFIDENCE_THRESHOLD;
}

/**
 * Сводка по разбору для ответа API.
 *
 * Нужна интерфейсу, чтобы показать итог одной строкой, не пересчитывая
 * массивы на клиенте и не рискуя разойтись с сервером в арифметике.
 */
export function summarizeAnalysis(result: AnalysisResult) {
  const risky = result.extracted.paymentTerms.filter((term) => term.riskBearing);

  return {
    factorHypotheses: result.factorHypotheses.length,
    lowConfidenceHypotheses: result.factorHypotheses.filter((item) => isLowConfidence(item)).length,
    riskBearingPaymentTerms: risky.length,
    lawfulPaymentTerms: result.extracted.paymentTerms.length - risky.length,
    projectMatches: result.projectMatches.length,
    bestMatchScore: result.projectMatches[0]?.score ?? null,
    mandatoryChecks: result.checks.length,
    warnings: result.warnings.length,
    /**
     * Прямое утверждение: балл по разбору не начисляется. Поле попадает в
     * ответ API намеренно — интерфейс показывает его текстом, чтобы ни
     * аналитик, ни проверяющий не приняли гипотезы за оценку риска.
     */
    scoreImpact: 0 as const,
  };
}
