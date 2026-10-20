/**
 * Точка входа ИИ-модуля.
 *
 * Выбор провайдера делается один раз по переменной окружения AI_PROVIDER.
 * Значение по умолчанию — rules: система должна работать сразу после
 * клонирования репозитория, без ключей и без сети.
 *
 * Весь остальной код (API, интерфейс) обращается только к функции analyze
 * и не знает, какой провайдер активен. Это и есть требуемая заменяемость:
 * эмуляция и реальная модель подключаются через один интерфейс.
 */

import { aiProviderIdSchema, type AiProviderId } from '../domain/enums';
import { createLlmProvider, readLlmConfig } from './llm-provider';
import { rulesProvider } from './rules-provider';
import type { AiProvider, AnalyzeInput } from './provider';
import type { AnalysisResult } from './schemas';

export function resolveProviderId(
  env: Record<string, string | undefined> = process.env,
): AiProviderId {
  const parsed = aiProviderIdSchema.safeParse(env.AI_PROVIDER?.trim());
  return parsed.success ? parsed.data : 'rules';
}

/**
 * Возвращает активный провайдер.
 *
 * Если запрошен llm, но ключа нет, возвращается llm-провайдер — он сам
 * выполнит разбор правилами и добавит предупреждение в результат. Так
 * аналитик видит в интерфейсе причину, по которой модель не использовалась,
 * вместо молчаливой подмены.
 */
export function getAiProvider(
  env: Record<string, string | undefined> = process.env,
): AiProvider {
  return resolveProviderId(env) === 'llm' ? createLlmProvider(readLlmConfig(env)) : rulesProvider;
}

/** Разбор текста активным провайдером. */
export async function analyze(
  input: AnalyzeInput,
  env: Record<string, string | undefined> = process.env,
): Promise<AnalysisResult> {
  return getAiProvider(env).analyze(input);
}

/** Сведения о провайдерах для панели «как это работает». */
export function describeProviders(env: Record<string, string | undefined> = process.env) {
  const active = resolveProviderId(env);
  const llm = createLlmProvider(readLlmConfig(env));

  return {
    active,
    providers: [
      {
        id: rulesProvider.id,
        description: rulesProvider.description,
        available: rulesProvider.isAvailable(),
        deterministic: true,
      },
      {
        id: llm.id,
        description: llm.description,
        available: llm.isAvailable(),
        deterministic: false,
      },
    ],
  };
}

export { rulesProvider, analyzeWithRules } from './rules-provider';
export { createLlmProvider, readLlmConfig, locateQuote, SYSTEM_PROMPT } from './llm-provider';
export { APPEALS_CHECK, LEGAL_BASIS_CHECK } from './provider';
export type { AiProvider, AnalyzeInput, ProjectCandidate } from './provider';
export type {
  AnalysisResult,
  Extracted,
  FactorHypothesis,
  PaymentTerm,
  ProjectMatch,
  Span,
} from './schemas';
export { analysisResultSchema, llmResponseSchema } from './schemas';
export {
  AI_PROPOSABLE_FACTORS,
  ALWAYS_LOW_CONFIDENCE_FACTORS,
  PAYMENT_CATEGORIES,
  PAYMENT_TERMS,
} from './dictionary';
export type { PaymentCategory } from './dictionary';
