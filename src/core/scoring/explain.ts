/**
 * Объяснение балла.
 *
 * Раздел 6 ТЗ требует, чтобы по каждому объекту было видно, «из чего именно
 * сложился балл и почему присвоена зона». Этот модуль превращает набор
 * факторов в структуру, которую интерфейс и PDF-карточка показывают без
 * дополнительных вычислений: вклад каждого фактора, формулу, причину зоны
 * и список открытых вопросов.
 *
 * Модуль чистый и детерминированный. Он не ходит в БД и не зовёт ИИ:
 * текст объяснения собирается из констант модели, поэтому одинаковые
 * подтверждённые данные всегда дают одинаковое объяснение — это и есть
 * воспроизводимость из раздела 6.
 */

import {
  FACTOR_CODES,
  FACTOR_STATUS_LABELS,
  RISK_ZONE_ACTIONS,
  RISK_ZONE_LABELS,
  type FactorCode,
  type FactorOrigin,
  type FactorStatus,
  type Label,
  type RiskZone,
} from '../domain/enums';
import {
  FACTOR_CRITERIA,
  FACTOR_TITLES,
  FACTOR_WEIGHTS,
  MAX_SCORE,
  RED_THRESHOLD,
  RED_ZONE_COMBINATION,
  YELLOW_THRESHOLD,
  computeScore,
  hasRedZoneCombination,
  resolveZone,
  sortFactorCodes,
} from './model';

// ---------------------------------------------------------------------------
// Входные данные
// ---------------------------------------------------------------------------

/** Фактор в том виде, в котором он нужен объяснению. */
export interface ExplainableFactor {
  code: FactorCode;
  status: FactorStatus;
  origin?: FactorOrigin;
  rationale?: string | null;
  confirmedBy?: string | null;
  confirmedAt?: Date | string | null;
  evidenceCount?: number;
}

/** Вклад одного фактора в итоговый балл. */
export interface FactorContribution {
  code: FactorCode;
  status: FactorStatus;
  statusLabel: Label;
  title: Label;
  criteria: Label;
  /** Вес фактора по ТЗ. */
  weight: number;
  /** Сколько баллов фактор фактически добавил: вес при CONFIRMED, иначе 0. */
  applied: number;
  origin?: FactorOrigin;
  rationale: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  evidenceCount: number;
}

/** Полное объяснение балла и зоны. */
export interface ScoreExplanation {
  score: number;
  zone: RiskZone;
  zoneLabel: Label;
  zoneAction: Label;
  /** Сумма весов до применения ограничения в 100 баллов. */
  rawSum: number;
  /** true, если сумма была урезана порогом MAX_SCORE. */
  capped: boolean;
  confirmedCodes: FactorCode[];
  needsCheckCodes: FactorCode[];
  /** Вклад всех шести факторов, включая нулевые — панель показывает их целиком. */
  contributions: FactorContribution[];
  /** Формула в текстовом виде: «R1(+35) + R2(+25) + R3(+10) = 70». */
  formula: string;
  /** Почему присвоена именно эта зона. */
  zoneReason: Label;
  /** Что изменит зону: условие перехода вверх или вниз. */
  zoneBoundary: Label | null;
  /** Открытые вопросы — факторы в статусе «нужна проверка». */
  openQuestions: Label[];
  /** Есть ли подтверждённые факторы без автора или даты решения. */
  integrityWarnings: Label[];
}

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function codesWithStatus(
  factors: readonly ExplainableFactor[],
  status: FactorStatus,
): FactorCode[] {
  return sortFactorCodes(
    factors.filter((factor) => factor.status === status).map((factor) => factor.code),
  );
}

function listCodes(codes: readonly FactorCode[]): string {
  return codes.join(', ');
}

// ---------------------------------------------------------------------------
// Причина зоны
// ---------------------------------------------------------------------------

/**
 * Текст причины зоны.
 *
 * Отдельная функция, потому что самый важный для демонстрации случай —
 * жёлтая зона при 60+ баллах. Формулировка должна прямо называть,
 * какого фактора из комбинации R1+R2 не хватает: именно здесь видно,
 * что зона считается не по одному баллу.
 */
export function explainZone(
  score: number,
  confirmedCodes: readonly FactorCode[],
): { zone: RiskZone; reason: Label; boundary: Label | null } {
  const zone = resolveZone(score, confirmedCodes);
  const confirmed = new Set(confirmedCodes);
  const missingForRed = RED_ZONE_COMBINATION.filter((code) => !confirmed.has(code));
  const combination = listCodes(RED_ZONE_COMBINATION);

  if (zone === 'RED') {
    return {
      zone,
      reason: {
        ru: `${score} баллов — не ниже ${RED_THRESHOLD}, и одновременно подтверждена комбинация ${combination}.`,
        kk: `${score} балл — ${RED_THRESHOLD} баллдан кем емес және ${combination} комбинациясы расталған.`,
      },
      boundary: {
        ru: `Зона снизится до жёлтой, если любой из факторов ${combination} перестанет быть подтверждённым.`,
        kk: `${combination} факторларының біреуі расталмаса, аймақ сарыға дейін төмендейді.`,
      },
    };
  }

  if (zone === 'YELLOW' && score >= RED_THRESHOLD) {
    return {
      zone,
      reason: {
        ru:
          `${score} баллов достигают порога красной зоны, но комбинация ${combination} не подтверждена ` +
          `(не хватает: ${listCodes(missingForRed)}). По правилу раздела 5 ТЗ зона остаётся жёлтой: ` +
          'высокий балл сам по себе красную зону не открывает.',
        kk:
          `${score} балл қызыл аймақ шегіне жетеді, бірақ ${combination} комбинациясы расталмаған ` +
          `(жетіспейді: ${listCodes(missingForRed)}). Аймақ сары болып қалады.`,
      },
      boundary: {
        ru: `Зона станет красной только после подтверждения ${listCodes(missingForRed)}.`,
        kk: `Аймақ ${listCodes(missingForRed)} расталғаннан кейін ғана қызыл болады.`,
      },
    };
  }

  if (zone === 'YELLOW') {
    return {
      zone,
      reason: {
        ru: `${score} баллов — в интервале ${YELLOW_THRESHOLD}–${RED_THRESHOLD - 1}.`,
        kk: `${score} балл — ${YELLOW_THRESHOLD}–${RED_THRESHOLD - 1} аралығында.`,
      },
      boundary: {
        ru: `Для красной зоны нужны ${RED_THRESHOLD}+ баллов и подтверждённая комбинация ${combination}.`,
        kk: `Қызыл аймақ үшін ${RED_THRESHOLD}+ балл және расталған ${combination} комбинациясы қажет.`,
      },
    };
  }

  return {
    zone,
    reason: {
      ru: `${score} баллов — меньше ${YELLOW_THRESHOLD}, порог жёлтой зоны не достигнут.`,
      kk: `${score} балл — ${YELLOW_THRESHOLD}-дан кем, сары аймақ шегіне жетпеген.`,
    },
    boundary: {
      ru: `Жёлтая зона начинается с ${YELLOW_THRESHOLD} баллов.`,
      kk: `Сары аймақ ${YELLOW_THRESHOLD} баллдан басталады.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Основная функция
// ---------------------------------------------------------------------------

/**
 * Собирает объяснение балла по набору факторов.
 *
 * Факторы, отсутствующие во входном массиве, считаются непроверенными
 * (NEEDS_CHECK) и попадают в объяснение с нулевым вкладом: панель скоринга
 * обязана показывать все шесть строк, иначе непроверенный фактор визуально
 * не отличается от отклонённого.
 */
export function explainScore(factors: readonly ExplainableFactor[]): ScoreExplanation {
  const byCode = new Map(factors.map((factor) => [factor.code, factor]));

  const contributions: FactorContribution[] = FACTOR_CODES.map((code) => {
    const factor = byCode.get(code);
    const status: FactorStatus = factor?.status ?? 'NEEDS_CHECK';
    return {
      code,
      status,
      statusLabel: FACTOR_STATUS_LABELS[status],
      title: FACTOR_TITLES[code],
      criteria: FACTOR_CRITERIA[code],
      weight: FACTOR_WEIGHTS[code],
      applied: status === 'CONFIRMED' ? FACTOR_WEIGHTS[code] : 0,
      origin: factor?.origin,
      rationale: factor?.rationale?.trim() ? factor.rationale.trim() : null,
      confirmedBy: factor?.confirmedBy ?? null,
      confirmedAt: toIsoOrNull(factor?.confirmedAt),
      evidenceCount: factor?.evidenceCount ?? 0,
    };
  });

  const confirmedCodes = codesWithStatus(factors, 'CONFIRMED');
  const needsCheckCodes = sortFactorCodes(
    FACTOR_CODES.filter((code) => (byCode.get(code)?.status ?? 'NEEDS_CHECK') === 'NEEDS_CHECK'),
  );

  const rawSum = confirmedCodes.reduce((sum, code) => sum + FACTOR_WEIGHTS[code], 0);
  const score = computeScore(confirmedCodes);
  const { zone, reason, boundary } = explainZone(score, confirmedCodes);

  const formula = confirmedCodes.length
    ? `${confirmedCodes.map((code) => `${code}(+${FACTOR_WEIGHTS[code]})`).join(' + ')} = ${rawSum}` +
      (rawSum > MAX_SCORE ? ` → ${score} (ограничение ${MAX_SCORE})` : '')
    : 'Подтверждённых факторов нет = 0';

  const openQuestions: Label[] = needsCheckCodes.map((code) => ({
    ru: `${code}. ${FACTOR_TITLES[code].ru} — требуется проверка.`,
    kk: `${code}. ${FACTOR_TITLES[code].kk} — тексеру қажет.`,
  }));

  const integrityWarnings: Label[] = [];
  for (const item of contributions) {
    if (item.status !== 'CONFIRMED') continue;
    if (!item.confirmedBy || !item.confirmedAt) {
      integrityWarnings.push({
        ru: `${item.code}: фактор подтверждён, но не зафиксированы автор и дата решения.`,
        kk: `${item.code}: фактор расталған, бірақ шешім авторы мен күні тіркелмеген.`,
      });
    }
    if (!item.rationale) {
      integrityWarnings.push({
        ru: `${item.code}: не заполнено обоснование решения.`,
        kk: `${item.code}: шешімнің негіздемесі толтырылмаған.`,
      });
    }
  }

  return {
    score,
    zone,
    zoneLabel: RISK_ZONE_LABELS[zone],
    zoneAction: RISK_ZONE_ACTIONS[zone],
    rawSum,
    capped: rawSum > MAX_SCORE,
    confirmedCodes,
    needsCheckCodes,
    contributions,
    formula,
    zoneReason: reason,
    zoneBoundary: boundary,
    openQuestions,
    integrityWarnings,
  };
}

/**
 * Короткая сводка для списка объектов и для сигнальной карточки.
 * Намеренно без ИИ: текст должен быть одинаковым при каждом открытии.
 */
export function summarizeScore(explanation: ScoreExplanation, locale: 'ru' | 'kk' = 'ru'): string {
  const zone = explanation.zoneLabel[locale].toLowerCase();
  if (explanation.confirmedCodes.length === 0) {
    return locale === 'ru'
      ? `0 баллов, ${zone} зона. Подтверждённых факторов риска нет.`
      : `0 балл, ${zone} аймақ. Расталған қауіп факторлары жоқ.`;
  }

  const codes = listCodes(explanation.confirmedCodes);
  const open = explanation.needsCheckCodes.length;

  if (locale === 'kk') {
    return (
      `${explanation.score} балл, ${zone} аймақ. Расталған факторлар: ${codes}.` +
      (open > 0 ? ` Тексеруді талап ететіндер: ${open}.` : '')
    );
  }

  return (
    `${explanation.score} баллов, ${zone} зона. Подтверждённые факторы: ${codes}.` +
    (open > 0 ? ` Требуют проверки: ${open}.` : '')
  );
}

/** Признак того, что объект можно выносить в сигнальную карточку без оговорок. */
export function isReportReady(explanation: ScoreExplanation): boolean {
  return explanation.confirmedCodes.length > 0 && explanation.integrityWarnings.length === 0;
}

export { hasRedZoneCombination };
