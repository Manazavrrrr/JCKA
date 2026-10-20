/**
 * Контракт результата разбора объявления.
 *
 * Схемы здесь — общие для обоих провайдеров. Движок на правилах строит
 * результат и прогоняет его через ту же схему, через которую проходит ответ
 * языковой модели. Это даёт два важных свойства:
 *
 *   1. Интерфейс и API работают с одной формой данных и не знают, кто её
 *      произвёл. Переключение AI_PROVIDER не требует правок выше этого слоя.
 *   2. Ответ модели проверяется строго. Если модель вернула выдуманный код
 *      фактора, уверенность больше единицы или позиции цитаты, которых нет
 *      в тексте, — валидация падает, и система откатывается на правила,
 *      а не показывает аналитику мусор.
 *
 * Отдельно ограничен список кодов факторов: схема гипотезы принимает только
 * AI_PROPOSABLE_FACTORS. Поэтому даже языковая модель, которой в промпте
 * «очень хочется» начислить R1 за то, что в объявлении не упомянуто
 * разрешение, не сможет этого сделать — её ответ не пройдёт схему.
 */

import { z } from 'zod';

import { aiProviderIdSchema, type Label } from '../domain/enums';
import { AI_PROPOSABLE_FACTORS, PAYMENT_CATEGORIES } from './dictionary';

// ---------------------------------------------------------------------------
// Базовые элементы
// ---------------------------------------------------------------------------

export const labelSchema = z.object({
  ru: z.string().min(1),
  kk: z.string().min(1),
});

/**
 * Цитата с позицией в исходном тексте.
 *
 * Позиции обязательны: без них подсветка в интерфейсе и ссылка на источник
 * в сигнальной карточке невозможны, а утверждение ИИ становится непроверяемым.
 */
export const spanShape = {
  fragment: z.string().min(1),
  charStart: z.number().int().min(0),
  charEnd: z.number().int().min(0),
};

export const spanBaseSchema = z.object(spanShape);

export const spanSchema = spanBaseSchema.refine((span) => span.charEnd > span.charStart, {
  message: 'charEnd должен быть больше charStart',
});

export type Span = z.infer<typeof spanBaseSchema>;

/** Код фактора, который разрешено предлагать ИИ. */
export const proposableFactorSchema = z.enum(AI_PROPOSABLE_FACTORS);
export type ProposableFactor = z.infer<typeof proposableFactorSchema>;

export const confidenceSchema = z.number().min(0).max(1);

// ---------------------------------------------------------------------------
// Извлечённые сущности
// ---------------------------------------------------------------------------

export const paymentTermSchema = spanBaseSchema.extend({
  category: z.enum(PAYMENT_CATEGORIES),
  /** false — законный способ расчётов, такая запись риск не формирует. */
  riskBearing: z.boolean(),
  label: labelSchema,
  note: labelSchema,
  /** Сумма рядом с формулировкой, если она найдена в тексте. */
  amount: z.number().nullable().default(null),
});

export type PaymentTerm = z.infer<typeof paymentTermSchema>;

export const phoneMentionSchema = spanBaseSchema.extend({
  normalized: z.string().regex(/^\+7\d{10}$/),
});

export const amountMentionSchema = spanBaseSchema.extend({
  amount: z.number().nullable(),
});

export const percentMentionSchema = spanBaseSchema.extend({
  value: z.number().min(0).max(100),
});

export const yearMentionSchema = spanBaseSchema.extend({
  year: z.number().int().min(2000).max(2100),
});

export const nameMentionSchema = spanBaseSchema.extend({
  /** Нормализованное написание — для поиска по реестру. */
  normalized: z.string(),
});

export const extractedSchema = z.object({
  projectNames: z.array(nameMentionSchema).default([]),
  addresses: z.array(spanBaseSchema).default([]),
  phones: z.array(phoneMentionSchema).default([]),
  amounts: z.array(amountMentionSchema).default([]),
  paymentTerms: z.array(paymentTermSchema).default([]),
  readinessMentions: z.array(percentMentionSchema).default([]),
  completionYears: z.array(yearMentionSchema).default([]),
  /** Упоминания заявленного правового основания. Полярность положительная. */
  legalBasisClaims: z.array(spanBaseSchema).default([]),
  delayMentions: z.array(spanBaseSchema).default([]),
});

export type Extracted = z.infer<typeof extractedSchema>;

// ---------------------------------------------------------------------------
// Гипотезы по факторам
// ---------------------------------------------------------------------------

/**
 * Гипотеза ИИ по фактору риска.
 *
 * Это не факт и не балл. Поле confirmable зафиксировано в false на уровне
 * схемы: гипотеза сама по себе никогда не попадает в расчёт, её обязан
 * принять аналитик, после чего создаётся отдельная запись RiskFactor
 * с происхождением AI_ACCEPTED и доказательством.
 */
export const factorHypothesisSchema = z.object({
  code: proposableFactorSchema,
  confidence: confidenceSchema,
  /** Маркер «вывод неуверенный» — вычисляется, но хранится явно для UI. */
  lowConfidence: z.boolean(),
  /** Цитата, на которой держится гипотеза. */
  span: spanSchema.nullable().default(null),
  rationale: labelSchema,
  /** Что именно аналитик должен сделать, чтобы превратить гипотезу в факт. */
  verification: labelSchema,
  confirmable: z.literal(false).default(false),
});

export type FactorHypothesis = z.infer<typeof factorHypothesisSchema>;

// ---------------------------------------------------------------------------
// Сопоставление с объектом
// ---------------------------------------------------------------------------

/**
 * Предложение связать публикацию с объектом реестра.
 *
 * requiresConfirmation всегда true. Нечёткое сопоставление названий
 * ошибается, а неверная привязка объявления к ЖК — это ложный риск
 * на конкретном застройщике, поэтому связь подтверждает человек.
 */
export const projectMatchSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  score: confidenceSchema,
  matchedOn: z.array(z.enum(['NAME', 'ADDRESS', 'PHONE', 'DEVELOPER'])).min(1),
  span: spanSchema.nullable().default(null),
  rationale: labelSchema,
  requiresConfirmation: z.literal(true).default(true),
});

export type ProjectMatch = z.infer<typeof projectMatchSchema>;

// ---------------------------------------------------------------------------
// Итоговый результат
// ---------------------------------------------------------------------------

export const analysisResultSchema = z.object({
  provider: aiProviderIdSchema,
  /** Имя модели, если разбор выполняла языковая модель. */
  model: z.string().nullable().default(null),
  /** Сколько миллисекунд занял разбор — для панели качества в интерфейсе. */
  durationMs: z.number().min(0).default(0),

  /** Относится ли текст к рекламе жилья вообще. */
  isHousingAd: z.boolean(),
  /** Есть ли в тексте прямые признаки незавершённого строительства. */
  mentionsUnderConstruction: z.boolean(),

  extracted: extractedSchema,
  factorHypotheses: z.array(factorHypothesisSchema).default([]),
  projectMatches: z.array(projectMatchSchema).default([]),

  /**
   * Пункты обязательной ручной проверки.
   * Сюда всегда попадает проверка правового основания в реестре —
   * по тексту объявления этот вопрос не решается ни правилами, ни моделью.
   */
  checks: z.array(labelSchema).default([]),
  /** Замечания к самому разбору: сомнительные места, отказ модели, откат. */
  warnings: z.array(labelSchema).default([]),

  summary: labelSchema,
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

// ---------------------------------------------------------------------------
// Схема ответа языковой модели
// ---------------------------------------------------------------------------

/**
 * То, что разрешено просить у языковой модели.
 *
 * Модель отвечает узким подмножеством: признаки текста, гипотезы и краткое
 * описание. Позиции цитат модель тоже возвращает, но им не доверяют —
 * llm-provider пересчитывает их поиском фрагмента в исходном тексте
 * и отбрасывает цитату, которой в тексте нет. Так из ответа модели
 * исключаются выдуманные цитаты.
 */
export const llmResponseSchema = z.object({
  isHousingAd: z.boolean(),
  mentionsUnderConstruction: z.boolean(),
  projectNameGuess: z.string().nullable().default(null),
  addressGuess: z.string().nullable().default(null),
  paymentTermQuotes: z.array(z.string().min(1)).max(20).default([]),
  readinessQuote: z.string().nullable().default(null),
  delayQuote: z.string().nullable().default(null),
  legalBasisQuote: z.string().nullable().default(null),
  hypotheses: z
    .array(
      z.object({
        code: proposableFactorSchema,
        confidence: confidenceSchema,
        quote: z.string().nullable().default(null),
        rationaleRu: z.string().min(1).max(600),
        rationaleKk: z.string().min(1).max(600).nullable().default(null),
      }),
    )
    .max(6)
    .default([]),
  summaryRu: z.string().min(1).max(600),
  summaryKk: z.string().min(1).max(600).nullable().default(null),
});

export type LlmResponse = z.infer<typeof llmResponseSchema>;

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

/** Пустая подпись — чтобы не плодить литералы в коде провайдеров. */
export function label(ru: string, kk: string): Label {
  return { ru, kk };
}
