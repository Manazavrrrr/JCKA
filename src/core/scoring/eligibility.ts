/**
 * Предусловия начисления факторов риска.
 *
 * Это защитный слой между интерфейсом и баллом. Аналитик не может поставить
 * фактору статус CONFIRMED, если данные объекта не удовлетворяют условию
 * из раздела 5 ТЗ. Проверка выполняется на сервере при каждой записи,
 * а не только в интерфейсе: иначе правило «отсутствие данных ≠ отсутствие
 * основания» держалось бы на дисциплине пользователя.
 *
 * Модуль чистый: ни БД, ни сети, ни обращения к текущему времени.
 * На вход подаётся контекст, который одинаково собирается и из Prisma-записи,
 * и из seed-набора, и из теста.
 */

import {
  isUnderConstruction,
  type EvidenceKind,
  type FactorCode,
  type Label,
  type LegalBasisStatus,
  type ProjectStage,
} from '../domain/enums';
import {
  DELAY_THRESHOLD_DAYS,
  FACTOR_CRITERIA,
  FACTOR_TITLES,
  READINESS_GAP_THRESHOLD_PP,
  readinessGapPp,
} from './model';

// ---------------------------------------------------------------------------
// Контекст проверки
// ---------------------------------------------------------------------------

/** Доказательство в том минимальном виде, который нужен проверке. */
export interface EligibilityEvidence {
  kind: EvidenceKind;
  excerpt?: string | null;
}

/**
 * Данные объекта, от которых зависит допустимость факторов.
 * Сознательно описан структурно, а не через тип Prisma: тогда один и тот же
 * код работает и в приложении, и в скриптах проверки набора данных.
 */
export interface EligibilityContext {
  stage: ProjectStage;
  legalBasisStatus: LegalBasisStatus;
  declaredReadinessPct?: number | null;
  declaredReadinessSource?: string | null;
  verifiedReadinessPct?: number | null;
  verifiedReadinessSource?: string | null;
  actualDelayDays?: number | null;
  /** Количество обращений со статусом VERIFIED. Неподтверждённые не считаются. */
  verifiedAppealCount: number;
  /** Доказательства, уже прикреплённые к каждому фактору. */
  evidenceByFactor: Partial<Record<FactorCode, readonly EligibilityEvidence[]>>;
}

/** Результат проверки одного фактора. */
export interface EligibilityVerdict {
  code: FactorCode;
  title: Label;
  /** Условие начисления из ТЗ — показывается рядом с фактором в интерфейсе. */
  requirement: Label;
  /** Можно ли сейчас поставить статус CONFIRMED. */
  allowed: boolean;
  /**
   * Применим ли фактор к объекту в принципе.
   * false означает, что корректный статус — NOT_APPLICABLE, а не NEEDS_CHECK:
   * спрашивать про рекламу строящегося жилья у сданного дома бессмысленно.
   */
  applicable: boolean;
  /** Короткое объяснение вердикта. */
  reason: Label;
  /** Чего конкретно не хватает. Пусто, когда allowed = true. */
  missing: Label[];
}

/** Ошибка попытки подтвердить фактор без выполненного условия. */
export class FactorEligibilityError extends Error {
  readonly code: FactorCode;
  readonly verdict: EligibilityVerdict;

  constructor(verdict: EligibilityVerdict) {
    const missing = verdict.missing.map((item) => item.ru).join('; ');
    super(
      `Фактор ${verdict.code} нельзя подтвердить: ${verdict.reason.ru}` +
        (missing ? ` Не хватает: ${missing}` : ''),
    );
    this.name = 'FactorEligibilityError';
    this.code = verdict.code;
    this.verdict = verdict;
  }
}

// ---------------------------------------------------------------------------
// Вспомогательные предикаты
// ---------------------------------------------------------------------------

/** Доказательства, которые годятся как фиксация публикации. */
const PUBLICATION_EVIDENCE: readonly EvidenceKind[] = ['TEXT_FRAGMENT', 'SCREENSHOT'];

/** Доказательства, которые годятся как документальное подтверждение. */
const DOCUMENTARY_EVIDENCE: readonly EvidenceKind[] = ['DOCUMENT', 'FIELD_CHECK', 'REGISTRY_RECORD'];

function evidenceOf(context: EligibilityContext, code: FactorCode): readonly EligibilityEvidence[] {
  return context.evidenceByFactor[code] ?? [];
}

function hasEvidenceOfKind(
  context: EligibilityContext,
  code: FactorCode,
  kinds: readonly EvidenceKind[],
): boolean {
  return evidenceOf(context, code).some((item) => kinds.includes(item.kind));
}

function hasTextFragment(context: EligibilityContext, code: FactorCode): boolean {
  return evidenceOf(context, code).some(
    (item) => item.kind === 'TEXT_FRAGMENT' && Boolean(item.excerpt?.trim()),
  );
}

function allow(code: FactorCode, reason: Label): EligibilityVerdict {
  return {
    code,
    title: FACTOR_TITLES[code],
    requirement: FACTOR_CRITERIA[code],
    allowed: true,
    applicable: true,
    reason,
    missing: [],
  };
}

function deny(code: FactorCode, reason: Label, missing: Label[]): EligibilityVerdict {
  return {
    code,
    title: FACTOR_TITLES[code],
    requirement: FACTOR_CRITERIA[code],
    allowed: false,
    applicable: true,
    reason,
    missing,
  };
}

function notApplicable(code: FactorCode, reason: Label): EligibilityVerdict {
  return {
    code,
    title: FACTOR_TITLES[code],
    requirement: FACTOR_CRITERIA[code],
    allowed: false,
    applicable: false,
    reason,
    missing: [],
  };
}

// ---------------------------------------------------------------------------
// Правила по факторам
// ---------------------------------------------------------------------------

/**
 * R1 (+35) — установленное отсутствие правового основания.
 *
 * Самое ответственное правило модели. Начисление возможно исключительно при
 * legalBasisStatus = CONFIRMED_ABSENT. Статус NOT_CHECKED — это «не знаем»,
 * и он не конвертируется в риск ни при каком количестве других признаков.
 * Дополнительно требуется ссылка на источник проверки: вывод «основания нет»
 * обязан быть проверяемым, иначе по нему нельзя готовить сигнальную карточку.
 */
function checkR1(context: EligibilityContext): EligibilityVerdict {
  const code: FactorCode = 'R1';

  if (context.legalBasisStatus === 'CONFIRMED_PRESENT') {
    return deny(
      code,
      {
        ru: 'Правовое основание подтверждено — фактор начислять нельзя.',
        kk: 'Құқықтық негіздеме расталған — факторды есептеуге болмайды.',
      },
      [],
    );
  }

  if (context.legalBasisStatus === 'NOT_CHECKED') {
    return deny(
      code,
      {
        ru: 'Основание не проверено. Отсутствие данных не является отсутствием основания.',
        kk: 'Негіздеме тексерілмеген. Деректің жоқтығы негіздеменің жоқтығы емес.',
      },
      [
        {
          ru: 'Результат проверки правового основания: нужен статус «Установлено отсутствие основания» со ссылкой на источник.',
          kk: 'Құқықтық негіздемені тексеру нәтижесі: көзге сілтемемен «Негіздеменің жоқтығы анықталған» мәртебесі қажет.',
        },
      ],
    );
  }

  if (!hasEvidenceOfKind(context, code, DOCUMENTARY_EVIDENCE)) {
    return deny(
      code,
      {
        ru: 'Отсутствие основания зафиксировано, но не приложено проверяемое доказательство.',
        kk: 'Негіздеменің жоқтығы тіркелген, бірақ тексерілетін дәлел қосылмаған.',
      },
      [
        {
          ru: 'Запись реестра, документ или акт проверки, подтверждающий отсутствие основания.',
          kk: 'Негіздеменің жоқтығын растайтын тізілім жазбасы, құжат немесе тексеру актісі.',
        },
      ],
    );
  }

  return allow(code, {
    ru: 'Проверкой установлено отсутствие применимого основания, доказательство приложено.',
    kk: 'Тексеру қолданылатын негіздеменің жоқтығын анықтады, дәлел қосылған.',
  });
}

/**
 * R2 (+25) — прямое предложение внести деньги.
 *
 * Требуется именно текст или снимок с предложением платежа. Фактор не может
 * опираться на пересказ аналитика: сигнальная карточка должна содержать
 * цитату, которую проверяющий увидит своими глазами.
 */
function checkR2(context: EligibilityContext): EligibilityVerdict {
  const code: FactorCode = 'R2';

  if (!hasEvidenceOfKind(context, code, PUBLICATION_EVIDENCE)) {
    return deny(
      code,
      {
        ru: 'Нет зафиксированного фрагмента публикации с предложением платежа.',
        kk: 'Төлем ұсынысы бар жарияланым үзіндісі тіркелмеген.',
      },
      [
        {
          ru: 'Цитата из публикации или снимок экрана с предложением брони, депозита либо взноса.',
          kk: 'Брондау, депозит немесе жарна ұсынысы бар жарияланымнан дәйексөз немесе экран суреті.',
        },
      ],
    );
  }

  return allow(code, {
    ru: 'Предложение внести деньги подтверждено материалом публикации.',
    kk: 'Ақша салу туралы ұсыныс жарияланым материалымен расталған.',
  });
}

/**
 * R3 (+10) — активная реклама строящегося жилья.
 *
 * Для сданного дома фактор неприменим: продажа квартир после ввода
 * в эксплуатацию — обычная сделка, а не признак нарушения.
 */
function checkR3(context: EligibilityContext): EligibilityVerdict {
  const code: FactorCode = 'R3';

  if (!isUnderConstruction(context.stage)) {
    return notApplicable(code, {
      ru: 'Объект введён в эксплуатацию — реклама продажи квартир не является риском.',
      kk: 'Нысан пайдалануға берілген — пәтер сату жарнамасы қауіп болып саналмайды.',
    });
  }

  if (!hasEvidenceOfKind(context, code, PUBLICATION_EVIDENCE)) {
    return deny(
      code,
      {
        ru: 'Публикация о продаже или продвижении квартир не зафиксирована.',
        kk: 'Пәтер сату немесе жылжыту туралы жарияланым тіркелмеген.',
      },
      [
        {
          ru: 'Привязанная публикация с фрагментом текста или снимком экрана.',
          kk: 'Мәтін үзіндісі немесе экран суреті бар байланыстырылған жарияланым.',
        },
      ],
    );
  }

  return allow(code, {
    ru: 'Зафиксирована публикация о продаже квартир до ввода объекта в эксплуатацию.',
    kk: 'Нысан пайдалануға берілгенге дейін пәтер сату туралы жарияланым тіркелген.',
  });
}

/**
 * R4 (+15) — подтверждённое коллективное обращение.
 *
 * Считаются только обращения со статусом VERIFIED. Анонимная жалоба или
 * неподтверждённое сообщение риск не формируют.
 */
function checkR4(context: EligibilityContext): EligibilityVerdict {
  const code: FactorCode = 'R4';

  if (context.verifiedAppealCount < 1) {
    return deny(
      code,
      {
        ru: 'Проверенных коллективных обращений по объекту нет.',
        kk: 'Нысан бойынша тексерілген ұжымдық өтініштер жоқ.',
      },
      [
        {
          ru: 'Коллективное обращение со статусом «проверено» и регистрационной ссылкой.',
          kk: '«Тексерілген» мәртебесі және тіркеу сілтемесі бар ұжымдық өтініш.',
        },
      ],
    );
  }

  return allow(code, {
    ru: `Зарегистрировано проверенных обращений: ${context.verifiedAppealCount}.`,
    kk: `Тексерілген өтініштер тіркелді: ${context.verifiedAppealCount}.`,
  });
}

/**
 * R5 (+10) — расхождение заявленной и подтверждённой готовности.
 *
 * Два независимых условия:
 *   1) разница достигает 20 процентных пунктов;
 *   2) у обоих значений указан источник — иначе сравнивать нечего с чем.
 */
function checkR5(context: EligibilityContext): EligibilityVerdict {
  const code: FactorCode = 'R5';
  const gap = readinessGapPp(context.declaredReadinessPct, context.verifiedReadinessPct);
  const missing: Label[] = [];

  if (gap === null) {
    return deny(
      code,
      {
        ru: 'Нет пары значений готовности: заявленной и подтверждённой.',
        kk: 'Дайындықтың мәлімделген және расталған мәндерінің жұбы жоқ.',
      },
      [
        {
          ru: 'Заявленная и подтверждённая готовность в процентах, каждая со своим источником и датой.',
          kk: 'Мәлімделген және расталған дайындық пайызбен, әрқайсысы өз көзі мен күнімен.',
        },
      ],
    );
  }

  if (gap < READINESS_GAP_THRESHOLD_PP) {
    missing.push({
      ru: `Расхождение ${gap} п.п. ниже порога ${READINESS_GAP_THRESHOLD_PP} п.п.`,
      kk: `Айырма ${gap} п.т. ${READINESS_GAP_THRESHOLD_PP} п.т. шегінен төмен.`,
    });
  }

  if (!context.declaredReadinessSource?.trim()) {
    missing.push({
      ru: 'Источник заявленной готовности.',
      kk: 'Мәлімделген дайындықтың көзі.',
    });
  }

  if (!context.verifiedReadinessSource?.trim()) {
    missing.push({
      ru: 'Источник подтверждённой готовности.',
      kk: 'Расталған дайындықтың көзі.',
    });
  }

  if (missing.length > 0) {
    return deny(
      code,
      {
        ru: `Условие не выполнено при расхождении ${gap} п.п.`,
        kk: `${gap} п.т. айырмада шарт орындалмады.`,
      },
      missing,
    );
  }

  return allow(code, {
    ru: `Расхождение готовности ${gap} п.п. при пороге ${READINESS_GAP_THRESHOLD_PP} п.п., оба значения имеют источники.`,
    kk: `Дайындық айырмасы ${gap} п.т., шек ${READINESS_GAP_THRESHOLD_PP} п.т., екі мәннің де көздері бар.`,
  });
}

/**
 * R6 (+5) — подтверждённый простой или значимая просрочка.
 *
 * Нужны и число, и документ: просрочка от порога плюс акт, документ или
 * запись проверки. Срок сам по себе может сдвинуться законно, поэтому
 * одного превышения недостаточно.
 */
function checkR6(context: EligibilityContext): EligibilityVerdict {
  const code: FactorCode = 'R6';
  const delay = context.actualDelayDays ?? null;
  const documented = hasEvidenceOfKind(context, code, DOCUMENTARY_EVIDENCE);
  const missing: Label[] = [];

  if (delay === null || delay < DELAY_THRESHOLD_DAYS) {
    missing.push({
      ru:
        delay === null
          ? 'Отклонение от заявленного срока не зафиксировано.'
          : `Просрочка ${delay} дн. не достигает порога ${DELAY_THRESHOLD_DAYS} дн.`,
      kk:
        delay === null
          ? 'Мәлімделген мерзімнен ауытқу тіркелмеген.'
          : `${delay} күн кешігу ${DELAY_THRESHOLD_DAYS} күн шегіне жетпейді.`,
    });
  }

  if (!documented) {
    missing.push({
      ru: 'Документ, акт выездной проверки или запись реестра, фиксирующие простой.',
      kk: 'Тоқтап қалуды тіркейтін құжат, шығып тексеру актісі немесе тізілім жазбасы.',
    });
  }

  if (missing.length > 0) {
    return deny(
      code,
      {
        ru: 'Существенное отклонение от сроков не подтверждено документально.',
        kk: 'Мерзімдерден елеулі ауытқу құжатпен расталмаған.',
      },
      missing,
    );
  }

  return allow(code, {
    ru: `Просрочка ${delay} дн. подтверждена документом.`,
    kk: `${delay} күн кешігу құжатпен расталған.`,
  });
}

// ---------------------------------------------------------------------------
// Публичный интерфейс
// ---------------------------------------------------------------------------

const CHECKS: Record<FactorCode, (context: EligibilityContext) => EligibilityVerdict> = {
  R1: checkR1,
  R2: checkR2,
  R3: checkR3,
  R4: checkR4,
  R5: checkR5,
  R6: checkR6,
};

/** Вердикт по одному фактору. */
export function checkFactorEligibility(
  code: FactorCode,
  context: EligibilityContext,
): EligibilityVerdict {
  return CHECKS[code](context);
}

/** Вердикты по всем шести факторам сразу — для панели скоринга. */
export function checkAllFactors(context: EligibilityContext): Record<FactorCode, EligibilityVerdict> {
  return {
    R1: checkR1(context),
    R2: checkR2(context),
    R3: checkR3(context),
    R4: checkR4(context),
    R5: checkR5(context),
    R6: checkR6(context),
  };
}

/**
 * Бросает исключение, если фактор подтвердить нельзя.
 * Вызывается в service.ts перед записью статуса CONFIRMED.
 */
export function assertFactorConfirmable(code: FactorCode, context: EligibilityContext): void {
  const verdict = checkFactorEligibility(code, context);
  if (!verdict.allowed) {
    throw new FactorEligibilityError(verdict);
  }
}

/**
 * Проверяет, что фрагмент-доказательство действительно присутствует
 * в тексте публикации, и возвращает его позицию для подсветки.
 *
 * Позиции не хранятся «на веру»: если текст публикации изменился,
 * подсветка не должна молча сдвинуться на другой фрагмент.
 */
export function locateExcerpt(
  rawText: string,
  excerpt: string,
): { charStart: number; charEnd: number } | null {
  const trimmed = excerpt.trim();
  if (!trimmed) return null;
  const charStart = rawText.indexOf(trimmed);
  if (charStart < 0) return null;
  return { charStart, charEnd: charStart + trimmed.length };
}
