/**
 * Перечисления предметной области.
 *
 * SQLite не умеет enum, поэтому в БД они лежат строками. Здесь — единственный
 * источник истины: Zod-схема для валидации на границе API и типы для кода.
 * Подписи RU/KZ живут рядом со значениями, чтобы при добавлении нового значения
 * его нельзя было забыть перевести (TypeScript не даст собрать Record).
 */

import { z } from 'zod';

/** Пара подписей для двуязычного интерфейса. */
export interface Label {
  ru: string;
  kk: string;
}

// ---------------------------------------------------------------------------
// Стадия строительства
// ---------------------------------------------------------------------------

export const PROJECT_STAGES = [
  'PLANNING',
  'FOUNDATION',
  'FRAME',
  'FACADE',
  'FINISHING',
  'COMMISSIONED',
] as const;

export const projectStageSchema = z.enum(PROJECT_STAGES);
export type ProjectStage = z.infer<typeof projectStageSchema>;

export const PROJECT_STAGE_LABELS: Record<ProjectStage, Label> = {
  PLANNING: { ru: 'Подготовка', kk: 'Дайындық' },
  FOUNDATION: { ru: 'Котлован / фундамент', kk: 'Қазаншұңқыр / іргетас' },
  FRAME: { ru: 'Возведение каркаса', kk: 'Қаңқа тұрғызу' },
  FACADE: { ru: 'Фасадные работы', kk: 'Қасбет жұмыстары' },
  FINISHING: { ru: 'Отделочные работы', kk: 'Әрлеу жұмыстары' },
  COMMISSIONED: { ru: 'Введён в эксплуатацию', kk: 'Пайдалануға берілген' },
};

/**
 * Объект считается строящимся до ввода в эксплуатацию.
 * Используется фактором R3: реклама сданного дома — это обычная продажа,
 * а не реклама строящегося жилья.
 */
export function isUnderConstruction(stage: ProjectStage): boolean {
  return stage !== 'COMMISSIONED';
}

// ---------------------------------------------------------------------------
// Правовое основание привлечения средств
// ---------------------------------------------------------------------------

/**
 * Трёхзначный статус проверки — ключевой элемент всей модели.
 *
 * ТЗ, раздел 5: «Проверенными данными установлено отсутствие применимого
 * законного основания; отсутствие доступа к реестру или "нет данных"
 * не считается его отсутствием».
 *
 * Поэтому NOT_CHECKED и CONFIRMED_ABSENT — принципиально разные состояния,
 * и только второе даёт право начислить +35 баллов по R1.
 */
export const LEGAL_BASIS_STATUSES = [
  'NOT_CHECKED',
  'CONFIRMED_PRESENT',
  'CONFIRMED_ABSENT',
] as const;

export const legalBasisStatusSchema = z.enum(LEGAL_BASIS_STATUSES);
export type LegalBasisStatus = z.infer<typeof legalBasisStatusSchema>;

export const LEGAL_BASIS_STATUS_LABELS: Record<LegalBasisStatus, Label> = {
  NOT_CHECKED: { ru: 'Не проверено — нужна проверка', kk: 'Тексерілмеген — тексеру қажет' },
  CONFIRMED_PRESENT: { ru: 'Основание подтверждено', kk: 'Негіздеме расталған' },
  CONFIRMED_ABSENT: { ru: 'Установлено отсутствие основания', kk: 'Негіздеменің жоқтығы анықталған' },
};

/**
 * Способы организации долевого участия по Закону РК
 * «О долевом участии в жилищном строительстве» (ст. 7, 8).
 *
 * Важно: отсутствие именно разрешения МИО не означает отсутствия основания —
 * гарантия Единого оператора и участие банка второго уровня являются
 * самостоятельными законными способами.
 */
export const LEGAL_BASIS_TYPES = [
  'UNKNOWN',
  'GUARANTEE_OPERATOR',
  'BANK_PARTICIPATION',
  'MIO_PERMIT',
  'OWN_FUNDS_AFTER_FRAME',
  'NONE',
] as const;

export const legalBasisTypeSchema = z.enum(LEGAL_BASIS_TYPES);
export type LegalBasisType = z.infer<typeof legalBasisTypeSchema>;

export const LEGAL_BASIS_TYPE_LABELS: Record<LegalBasisType, Label> = {
  UNKNOWN: { ru: 'Сведения отсутствуют', kk: 'Мәліметтер жоқ' },
  GUARANTEE_OPERATOR: {
    ru: 'Гарантия Единого оператора жилищного строительства',
    kk: 'Тұрғын үй құрылысының Бірыңғай операторының кепілдігі',
  },
  BANK_PARTICIPATION: {
    ru: 'Участие банка второго уровня',
    kk: 'Екінші деңгейдегі банктің қатысуы',
  },
  MIO_PERMIT: {
    ru: 'Разрешение местного исполнительного органа',
    kk: 'Жергілікті атқарушы органның рұқсаты',
  },
  OWN_FUNDS_AFTER_FRAME: {
    ru: 'Собственные средства после возведения каркаса',
    kk: 'Қаңқа тұрғызылғаннан кейінгі меншікті қаражат',
  },
  NONE: { ru: 'Применимое основание отсутствует', kk: 'Қолданылатын негіздеме жоқ' },
};

// ---------------------------------------------------------------------------
// Факторы риска
// ---------------------------------------------------------------------------

export const FACTOR_CODES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] as const;
export const factorCodeSchema = z.enum(FACTOR_CODES);
export type FactorCode = z.infer<typeof factorCodeSchema>;

/**
 * Статус фактора.
 * Баллы начисляет только CONFIRMED. NEEDS_CHECK — это явное «не знаем»,
 * которое даёт 0 баллов и отдельно показывается аналитику.
 */
export const FACTOR_STATUSES = ['CONFIRMED', 'NEEDS_CHECK', 'REJECTED', 'NOT_APPLICABLE'] as const;
export const factorStatusSchema = z.enum(FACTOR_STATUSES);
export type FactorStatus = z.infer<typeof factorStatusSchema>;

export const FACTOR_STATUS_LABELS: Record<FactorStatus, Label> = {
  CONFIRMED: { ru: 'Подтверждён', kk: 'Расталған' },
  NEEDS_CHECK: { ru: 'Нужна проверка', kk: 'Тексеру қажет' },
  REJECTED: { ru: 'Проверен, не подтвердился', kk: 'Тексерілді, расталмады' },
  NOT_APPLICABLE: { ru: 'Неприменим', kk: 'Қолданылмайды' },
};

/** Происхождение записи: что проверил человек, а что пришло из ИИ. */
export const FACTOR_ORIGINS = ['MANUAL', 'AI_ACCEPTED', 'RULE'] as const;
export const factorOriginSchema = z.enum(FACTOR_ORIGINS);
export type FactorOrigin = z.infer<typeof factorOriginSchema>;

export const FACTOR_ORIGIN_LABELS: Record<FactorOrigin, Label> = {
  MANUAL: { ru: 'Внесено аналитиком', kk: 'Талдаушы енгізген' },
  AI_ACCEPTED: { ru: 'Гипотеза ИИ, принята аналитиком', kk: 'ЖИ болжамы, талдаушы қабылдаған' },
  RULE: { ru: 'Выведено правилом по данным объекта', kk: 'Нысан деректері бойынша ереже шығарған' },
};

// ---------------------------------------------------------------------------
// Зоны риска
// ---------------------------------------------------------------------------

export const RISK_ZONES = ['GREEN', 'YELLOW', 'RED'] as const;
export const riskZoneSchema = z.enum(RISK_ZONES);
export type RiskZone = z.infer<typeof riskZoneSchema>;

export const RISK_ZONE_LABELS: Record<RiskZone, Label> = {
  GREEN: { ru: 'Зелёная', kk: 'Жасыл' },
  YELLOW: { ru: 'Жёлтая', kk: 'Сары' },
  RED: { ru: 'Красная', kk: 'Қызыл' },
};

export const RISK_ZONE_ACTIONS: Record<RiskZone, Label> = {
  GREEN: {
    ru: 'Плановый мониторинг, сохранение истории',
    kk: 'Жоспарлы мониторинг, тарихты сақтау',
  },
  YELLOW: {
    ru: 'Углублённая ручная проверка документов и публикаций',
    kk: 'Құжаттар мен жарияланымдарды тереңдетілген тексеру',
  },
  RED: {
    ru: 'Приоритетная сигнальная карточка для проверки аналитиком',
    kk: 'Талдаушы тексеруіне басым сигналдық карта',
  },
};

// ---------------------------------------------------------------------------
// Публикации
// ---------------------------------------------------------------------------

export const PLATFORMS = [
  'KRISHA_DEMO',
  'OLX_DEMO',
  'INSTAGRAM_DEMO',
  'TELEGRAM_DEMO',
  'FACEBOOK_DEMO',
  'DEVELOPER_SITE',
  'MANUAL_ENTRY',
] as const;
export const platformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof platformSchema>;

export const PLATFORM_LABELS: Record<Platform, Label> = {
  KRISHA_DEMO: { ru: 'Доска объявлений (демо)', kk: 'Хабарландыру тақтасы (демо)' },
  OLX_DEMO: { ru: 'Доска объявлений 2 (демо)', kk: 'Хабарландыру тақтасы 2 (демо)' },
  INSTAGRAM_DEMO: { ru: 'Соцсеть, фотолента (демо)', kk: 'Әлеуметтік желі, фотолента (демо)' },
  TELEGRAM_DEMO: { ru: 'Мессенджер, канал (демо)', kk: 'Мессенджер, арна (демо)' },
  FACEBOOK_DEMO: { ru: 'Соцсеть, страница (демо)', kk: 'Әлеуметтік желі, бет (демо)' },
  DEVELOPER_SITE: { ru: 'Сайт застройщика (демо)', kk: 'Құрылыс салушы сайты (демо)' },
  MANUAL_ENTRY: { ru: 'Добавлено вручную', kk: 'Қолмен енгізілген' },
};

export const LINK_STATUSES = ['UNLINKED', 'AI_SUGGESTED', 'CONFIRMED', 'REJECTED'] as const;
export const linkStatusSchema = z.enum(LINK_STATUSES);
export type LinkStatus = z.infer<typeof linkStatusSchema>;

export const LINK_STATUS_LABELS: Record<LinkStatus, Label> = {
  UNLINKED: { ru: 'Не связано с объектом', kk: 'Нысанмен байланыспаған' },
  AI_SUGGESTED: { ru: 'Связь предложена ИИ', kk: 'Байланысты ЖИ ұсынған' },
  CONFIRMED: { ru: 'Связь подтверждена', kk: 'Байланыс расталған' },
  REJECTED: { ru: 'Связь отклонена', kk: 'Байланыс қабылданбады' },
};

// ---------------------------------------------------------------------------
// Доказательства, обращения, сигналы
// ---------------------------------------------------------------------------

export const EVIDENCE_KINDS = [
  'TEXT_FRAGMENT',
  'SCREENSHOT',
  'DOCUMENT',
  'REGISTRY_RECORD',
  'APPEAL',
  'FIELD_CHECK',
] as const;
export const evidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, Label> = {
  TEXT_FRAGMENT: { ru: 'Фрагмент текста публикации', kk: 'Жарияланым мәтінінің үзіндісі' },
  SCREENSHOT: { ru: 'Снимок экрана', kk: 'Экран суреті' },
  DOCUMENT: { ru: 'Документ', kk: 'Құжат' },
  REGISTRY_RECORD: { ru: 'Запись реестра', kk: 'Тізілім жазбасы' },
  APPEAL: { ru: 'Обращение', kk: 'Өтініш' },
  FIELD_CHECK: { ru: 'Выездная проверка', kk: 'Шығып тексеру' },
};

export const APPEAL_STATUSES = ['VERIFIED', 'UNVERIFIED'] as const;
export const appealStatusSchema = z.enum(APPEAL_STATUSES);
export type AppealStatus = z.infer<typeof appealStatusSchema>;

export const SIGNAL_STATUSES = ['DRAFT', 'CONFIRMED', 'RETURNED'] as const;
export const signalStatusSchema = z.enum(SIGNAL_STATUSES);
export type SignalStatus = z.infer<typeof signalStatusSchema>;

export const SIGNAL_STATUS_LABELS: Record<SignalStatus, Label> = {
  DRAFT: { ru: 'Черновик', kk: 'Жоба' },
  CONFIRMED: { ru: 'Подтверждён аналитиком', kk: 'Талдаушы растаған' },
  RETURNED: { ru: 'Возвращён на доработку', kk: 'Пысықтауға қайтарылған' },
};

// ---------------------------------------------------------------------------
// ИИ
// ---------------------------------------------------------------------------

export const SUGGESTION_KINDS = [
  'PAYMENT_TERMS',
  'PROJECT_MATCH',
  'FACTOR_HYPOTHESIS',
  'RISK_EXPLANATION',
] as const;
export const suggestionKindSchema = z.enum(SUGGESTION_KINDS);
export type SuggestionKind = z.infer<typeof suggestionKindSchema>;

/**
 * Названия видов гипотез.
 *
 * Формулировки намеренно вопросительные по смыслу: «предполагаемый фактор»,
 * «возможный объект». Гипотеза не утверждает — она показывает аналитику
 * место в тексте и ждёт решения. Назвать FACTOR_HYPOTHESIS «фактором риска»
 * означало бы стереть границу, на которой держится вся система.
 */
export const SUGGESTION_KIND_LABELS: Record<SuggestionKind, Label> = {
  PAYMENT_TERMS: { ru: 'Условие оплаты', kk: 'Төлем шарты' },
  PROJECT_MATCH: { ru: 'Возможный объект реестра', kk: 'Ықтимал тізілім объектісі' },
  FACTOR_HYPOTHESIS: { ru: 'Предполагаемый фактор риска', kk: 'Болжамды қауіп факторы' },
  RISK_EXPLANATION: { ru: 'Пояснение к риску', kk: 'Қауіпке түсініктеме' },
};

export const SUGGESTION_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export const suggestionStatusSchema = z.enum(SUGGESTION_STATUSES);
export type SuggestionStatus = z.infer<typeof suggestionStatusSchema>;

/**
 * Состояния гипотезы.
 *
 * «Согласовано аналитиком» — а не «подтверждено»: согласие с прочтением
 * текста не подтверждает фактор и не начисляет баллов. Подтверждение —
 * отдельное решение с обоснованием и документами.
 */
export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, Label> = {
  PENDING: { ru: 'Не рассмотрена', kk: 'Қарастырылмаған' },
  ACCEPTED: { ru: 'Согласовано аналитиком', kk: 'Талдаушы келіскен' },
  REJECTED: { ru: 'Отклонена аналитиком', kk: 'Талдаушы қабылдамаған' },
};

export const AI_PROVIDER_IDS = ['rules', 'llm'] as const;
export const aiProviderIdSchema = z.enum(AI_PROVIDER_IDS);
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

/**
 * Порог, ниже которого гипотеза ИИ явно помечается как неуверенная.
 * Требование ТЗ: «Недостоверные или неуверенные выводы маркируются».
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Журнал действий
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  'PROJECT_UPDATED',
  'FACTOR_CONFIRMED',
  'FACTOR_REJECTED',
  'FACTOR_NEEDS_CHECK',
  'SCORE_RECALCULATED',
  'PUBLICATION_CREATED',
  'PUBLICATION_LINKED',
  'PUBLICATION_UNLINKED',
  'AI_SUGGESTION_CREATED',
  'AI_SUGGESTION_ACCEPTED',
  'AI_SUGGESTION_REJECTED',
  'SIGNAL_CREATED',
  'SIGNAL_CONFIRMED',
  'SIGNAL_RETURNED',
  // Слой сбора. Правка слов-ловушек меняет состав будущих выборок, поэтому
  // журналируется наравне с решениями по факторам: «почему это объявление
  // к нам не попало» — законный вопрос проверяющего, и ответ на него должен
  // быть в журнале, а не в памяти аналитика.
  'WATCH_TERM_CREATED',
  'WATCH_TERM_UPDATED',
  'WATCH_TERM_DELETED',
  'COLLECT_RUN_FINISHED',
  'COLLECTED_ITEM_ACCEPTED',
  'COLLECTED_ITEM_DISMISSED',
] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;
