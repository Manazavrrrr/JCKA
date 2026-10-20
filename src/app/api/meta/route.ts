/**
 * GET /api/meta — словари, модель риска и состав провайдеров ИИ.
 *
 * Интерфейс не содержит ни одного зашитого названия стадии, статуса или
 * фактора: всё приходит отсюда вместе с подписями на двух языках. Это не
 * абстракция ради абстракции. Переключение языка в интерфейсе обязано
 * менять подписи у всего, включая значения перечислений; если бы подписи
 * жили в компонентах, казахская версия отставала бы от русской на каждом
 * изменении, а состав зон и факторов пришлось бы поддерживать в двух местах.
 *
 * Здесь же отдаётся модель риска — веса, пороги и критерии. Интерфейс
 * показывает их аналитику как есть: вопрос «почему 60 баллов, а не 55»
 * должен иметь ответ в самой системе, а не в документации.
 */

import { describeProviders } from '../../../core/ai';
import { AI_PROPOSABLE_FACTORS } from '../../../core/ai/dictionary';
import {
  APPEAL_STATUSES,
  EVIDENCE_KINDS,
  EVIDENCE_KIND_LABELS,
  FACTOR_CODES,
  FACTOR_ORIGINS,
  FACTOR_ORIGIN_LABELS,
  FACTOR_STATUSES,
  FACTOR_STATUS_LABELS,
  LEGAL_BASIS_STATUSES,
  LEGAL_BASIS_STATUS_LABELS,
  LEGAL_BASIS_TYPES,
  LEGAL_BASIS_TYPE_LABELS,
  LINK_STATUSES,
  LINK_STATUS_LABELS,
  LOW_CONFIDENCE_THRESHOLD,
  PLATFORMS,
  PLATFORM_LABELS,
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  RISK_ZONES,
  RISK_ZONE_ACTIONS,
  RISK_ZONE_LABELS,
  SIGNAL_STATUSES,
  SIGNAL_STATUS_LABELS,
  SUGGESTION_KINDS,
  SUGGESTION_STATUSES,
} from '../../../core/domain/enums';
import {
  DELAY_THRESHOLD_DAYS,
  FACTOR_CRITERIA,
  FACTOR_TITLES,
  FACTOR_WEIGHTS,
  MAX_SCORE,
  READINESS_GAP_THRESHOLD_PP,
  RED_THRESHOLD,
  RED_ZONE_COMBINATION,
  YELLOW_THRESHOLD,
} from '../../../core/scoring/model';
import { route } from '../../../server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({
  /**
   * Модель риска целиком. Поле redZoneCombination — ответ на главную
   * тонкость ТЗ: зона определяется не только суммой. Шестьдесят баллов без
   * пары R1+R2 остаются жёлтой зоной, и интерфейс обязан объяснить это
   * аналитику, а не показывать «60 — но почему-то жёлтый».
   */
  risk: {
    factors: FACTOR_CODES.map((code) => ({
      code,
      weight: FACTOR_WEIGHTS[code],
      title: FACTOR_TITLES[code],
      criteria: FACTOR_CRITERIA[code],
      aiProposable: (AI_PROPOSABLE_FACTORS as readonly string[]).includes(code),
    })),
    maxScore: MAX_SCORE,
    thresholds: { yellow: YELLOW_THRESHOLD, red: RED_THRESHOLD },
    redZoneCombination: RED_ZONE_COMBINATION,
    readinessGapThresholdPp: READINESS_GAP_THRESHOLD_PP,
    delayThresholdDays: DELAY_THRESHOLD_DAYS,
    lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
  },

  /** Перечисления с подписями на двух языках. */
  enums: {
    projectStage: withLabels(PROJECT_STAGES, PROJECT_STAGE_LABELS),
    riskZone: withLabels(RISK_ZONES, RISK_ZONE_LABELS).map((item) => ({
      ...item,
      /** Что делать в этой зоне — требование ТЗ к интерпретации результата. */
      action: RISK_ZONE_ACTIONS[item.value],
    })),
    legalBasisStatus: withLabels(LEGAL_BASIS_STATUSES, LEGAL_BASIS_STATUS_LABELS),
    legalBasisType: withLabels(LEGAL_BASIS_TYPES, LEGAL_BASIS_TYPE_LABELS),
    factorStatus: withLabels(FACTOR_STATUSES, FACTOR_STATUS_LABELS),
    factorOrigin: withLabels(FACTOR_ORIGINS, FACTOR_ORIGIN_LABELS),
    platform: withLabels(PLATFORMS, PLATFORM_LABELS),
    linkStatus: withLabels(LINK_STATUSES, LINK_STATUS_LABELS),
    evidenceKind: withLabels(EVIDENCE_KINDS, EVIDENCE_KIND_LABELS),
    signalStatus: withLabels(SIGNAL_STATUSES, SIGNAL_STATUS_LABELS),
    suggestionKind: SUGGESTION_KINDS,
    suggestionStatus: SUGGESTION_STATUSES,
    appealStatus: APPEAL_STATUSES,
  },

  /**
   * Какой разбор работает сейчас и воспроизводим ли он. Поле выводится в
   * интерфейсе: проверяющий должен видеть, что расчёт риска не зависит от
   * языковой модели, даже когда модель подключена.
   */
  ai: describeProviders(),
}));

/** Склеивает значения перечисления с их подписями. */
function withLabels<T extends string>(
  values: readonly T[],
  labels: Record<T, { ru: string; kk: string }>,
) {
  return values.map((value) => ({ value, label: labels[value] }));
}
