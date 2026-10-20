/**
 * Провайдер на основе языковой модели.
 *
 * Подключается, если задан ключ в окружении, и решает одну задачу, с которой
 * словарь шаблонов справляется плохо: формулировки, которых в словаре нет.
 * Объявления пишут живым языком, и перечислить все способы сказать
 * «переведите деньги до оформления документов» шаблонами невозможно.
 *
 * При этом модель здесь жёстко ограничена, и ограничения — не формальность:
 *
 *   1. Ответ проходит ту же Zod-схему, что и результат правил. Код фактора
 *      вне списка разрешённых, уверенность больше единицы, пустое обоснование —
 *      ответ отбрасывается целиком.
 *
 *   2. Позициям цитат из ответа не доверяют вовсе. Модель называет цитату
 *      текстом, а офсеты пересчитываются поиском этой строки в исходном
 *      объявлении. Цитата, которой в тексте нет, удаляется вместе с гипотезой.
 *      Так из результата исключается выдуманное «подтверждение».
 *
 *   3. Результат модели объединяется с результатом правил, а не заменяет его.
 *      Извлечённые сущности (суммы, телефоны, проценты, адреса) берутся только
 *      из правил: это арифметика и шаблоны, здесь модель не нужна и способна
 *      лишь ошибиться в цифре.
 *
 *   4. Любой сбой — сеть, таймаут, невалидный JSON, непрошедшая схема —
 *      возвращает результат правил с пометкой в warnings. Система не остаётся
 *      без разбора и не показывает аналитику пустой экран.
 *
 * И главное: ни один путь в этом файле не влияет на балл. Модель предлагает
 * гипотезы, балл считается по подтверждённым аналитиком факторам в
 * src/core/scoring. Поэтому включение или отключение LLM не меняет оценку
 * ни одного уже проверенного объекта — требование воспроизводимости
 * выполняется независимо от провайдера.
 */

import { LOW_CONFIDENCE_THRESHOLD, type Label } from '../domain/enums';
import { analyzeWithRules } from './rules-provider';
import type { AiProvider, AnalyzeInput } from './provider';
import {
  analysisResultSchema,
  llmResponseSchema,
  type AnalysisResult,
  type FactorHypothesis,
  type LlmResponse,
  type Span,
} from './schemas';
import { expandToSentence, fold } from './text';

// ---------------------------------------------------------------------------
// Конфигурация
// ---------------------------------------------------------------------------

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export function readLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: env.LLM_BASE_URL?.trim() || 'https://api.openai.com/v1',
    model: env.LLM_MODEL?.trim() || 'gpt-4o-mini',
    timeoutMs: Number.parseInt(env.LLM_TIMEOUT_MS ?? '20000', 10) || 20000,
  };
}

// ---------------------------------------------------------------------------
// Промпт
// ---------------------------------------------------------------------------

/**
 * Инструкция модели.
 *
 * Запрет на R1 и R4 продублирован здесь текстом, хотя он уже обеспечен схемой.
 * Схема — защита, промпт — экономия: модель, которой объяснили причину запрета,
 * не тратит ответ на гипотезы, которые всё равно будут отброшены.
 */
export const SYSTEM_PROMPT = `Ты помогаешь аналитику местного исполнительного органа разбирать объявления о продаже жилья в Казахстане.

Задача: прочитать текст объявления и вернуть строгий JSON. Ты не выносишь решений и не начисляешь баллы — ты только отмечаешь, что в тексте написано, и приводишь дословные цитаты.

Правила, которые нельзя нарушать:
1. Цитаты приводи ДОСЛОВНО из присланного текста, символ в символ. Не перефразируй, не исправляй опечатки. Если подходящей цитаты нет — ставь null.
2. Никогда не предлагай фактор R1 (отсутствие правового основания). Отсутствие упоминания разрешения в рекламе НЕ означает его отсутствия. Этот вопрос решается только по реестру.
3. Никогда не предлагай фактор R4 (коллективные обращения): его источник — журнал обращений, а не объявление.
4. Разрешённые коды: R2, R3, R5, R6.
   R2 — приём денег (бронь, депозит, аванс, предварительный договор, перевод на карту) до оформления законной схемы.
   R3 — реклама продажи жилья в объекте, строительство которого не завершено.
   R5 — заявленный процент готовности, который требует сверки с проверенным значением.
   R6 — упоминание переноса срока сдачи или остановки работ.
5. Эскроу-счёт, аккредитив, расчёт через уполномоченный банк второго уровня, ипотека и гарантия Единого оператора жилищного строительства — ЗАКОННЫЕ способы расчётов. Если расчёт описан через них, это не нарушение; снижай уверенность или не выдавай гипотезу R2 вовсе.
6. Уверенность — число от 0 до 1. Если сомневаешься, ставь ниже 0.6.
7. Отвечай только JSON без пояснений и без markdown-разметки.

Формат ответа:
{
  "isHousingAd": boolean,
  "mentionsUnderConstruction": boolean,
  "projectNameGuess": string|null,
  "addressGuess": string|null,
  "paymentTermQuotes": string[],
  "readinessQuote": string|null,
  "delayQuote": string|null,
  "legalBasisQuote": string|null,
  "hypotheses": [{ "code": "R2"|"R3"|"R5"|"R6", "confidence": number, "quote": string|null, "rationaleRu": string, "rationaleKk": string|null }],
  "summaryRu": string,
  "summaryKk": string|null
}`;

export function buildUserPrompt(input: AnalyzeInput): string {
  const title = input.title ? `Заголовок: ${input.title}\n` : '';
  return `${title}Текст объявления:\n"""\n${input.text}\n"""`;
}

// ---------------------------------------------------------------------------
// Проверка цитат
// ---------------------------------------------------------------------------

/**
 * Находит цитату модели в исходном тексте и возвращает её позицию.
 *
 * Сначала ищется точное совпадение, затем совпадение по свёрнутому тексту —
 * модель может поменять регистр или казахскую букву на русскую, и это
 * приемлемо, потому что посимвольная нормализация не сдвигает позиции.
 * Если цитата не находится ни так, ни так, она считается выдуманной.
 */
export function locateQuote(text: string, quote: string | null | undefined): Span | null {
  if (!quote) return null;
  const trimmed = quote.trim();
  if (trimmed.length < 3) return null;

  // Сначала дословное совпадение, затем совпадение по свёрнутому тексту.
  // Третьей попытки нет: сжимать пробелы нельзя — это сдвигает позиции,
  // а неточная подсветка цитаты хуже её отсутствия.
  let index = text.indexOf(trimmed);
  if (index === -1) {
    index = fold(text).indexOf(fold(trimmed));
  }
  if (index === -1) return null;

  const sentence = expandToSentence(text, index, index + trimmed.length);
  return {
    fragment: sentence.fragment,
    charStart: sentence.charStart,
    charEnd: sentence.charEnd,
  };
}

// ---------------------------------------------------------------------------
// Объединение с результатом правил
// ---------------------------------------------------------------------------

/**
 * Собирает итоговый результат из разбора правилами и ответа модели.
 *
 * Правила дают основу: сущности, обязательные проверки, сопоставление
 * с реестром. Модель добавляет гипотезы по тем факторам, которых правила
 * не нашли, и уточняет формулировку сводки. Гипотеза модели по фактору,
 * который правила уже нашли, не затирает её: обоснование по шаблону
 * проверяемо, обоснование модели — нет.
 */
export function mergeLlmIntoRules(
  base: AnalysisResult,
  response: LlmResponse,
  text: string,
  model: string,
): AnalysisResult {
  const existing = new Set(base.factorHypotheses.map((item) => item.code));
  const added: FactorHypothesis[] = [];
  const warnings: Label[] = [...base.warnings];
  let droppedQuotes = 0;

  for (const item of response.hypotheses) {
    if (existing.has(item.code)) continue;

    const span = locateQuote(text, item.quote);
    if (item.quote && !span) {
      // Модель сослалась на фрагмент, которого в тексте нет.
      droppedQuotes += 1;
      continue;
    }

    // Гипотеза без проверяемой цитаты допускается только как неуверенная.
    const confidence = span
      ? Math.min(item.confidence, 0.9)
      : Math.min(item.confidence, LOW_CONFIDENCE_THRESHOLD - 0.05);

    added.push({
      code: item.code,
      confidence: Math.round(confidence * 100) / 100,
      lowConfidence: confidence < LOW_CONFIDENCE_THRESHOLD,
      span,
      rationale: {
        ru: `${item.rationaleRu} (вывод языковой модели, требует проверки аналитиком)`,
        kk: `${item.rationaleKk ?? item.rationaleRu} (тілдік модельдің тұжырымы, талдаушы тексеруі қажет)`,
      },
      verification: {
        ru: 'Проверить цитату в публикации и подтвердить фактор документом или фрагментом текста.',
        kk: 'Жарияланымдағы үзіндіні тексеріп, факторды құжатпен немесе мәтін үзіндісімен растау.',
      },
      confirmable: false,
    });
    existing.add(item.code);
  }

  if (droppedQuotes > 0) {
    warnings.push({
      ru: `Отброшено гипотез языковой модели: ${droppedQuotes}. Указанная цитата не найдена в тексте объявления дословно.`,
      kk: `Тілдік модельдің болжамдары алынып тасталды: ${droppedQuotes}. Көрсетілген үзінді мәтінде дәлме-дәл табылмады.`,
    });
  }

  const codes = [...base.factorHypotheses, ...added].map((item) => item.code).join(', ');

  return analysisResultSchema.parse({
    ...base,
    provider: 'llm',
    model,
    isHousingAd: base.isHousingAd || response.isHousingAd,
    mentionsUnderConstruction: base.mentionsUnderConstruction || response.mentionsUnderConstruction,
    factorHypotheses: [...base.factorHypotheses, ...added].sort((a, b) =>
      a.code.localeCompare(b.code),
    ),
    warnings,
    summary: {
      ru: codes
        ? `${response.summaryRu} Основания для проверки: ${codes}. Баллы начисляются только после подтверждения аналитиком; правовое основание (R1) по тексту не устанавливается.`
        : `${response.summaryRu} Оснований для гипотез по факторам риска не найдено.`,
      kk: `${response.summaryKk ?? response.summaryRu} Балл талдаушы растағаннан кейін ғана есептеледі.`,
    },
  });
}

// ---------------------------------------------------------------------------
// Вызов модели
// ---------------------------------------------------------------------------

function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('Ответ модели не содержит JSON');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

async function callModel(config: LlmConfig, input: AnalyzeInput): Promise<LlmResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        // Нулевая температура — попытка приблизить ответ к воспроизводимому.
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(input) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Модель ответила кодом ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('Пустой ответ модели');

    return llmResponseSchema.parse(extractJson(content));
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Провайдер
// ---------------------------------------------------------------------------

export function createLlmProvider(config: LlmConfig | null = readLlmConfig()): AiProvider {
  return {
    id: 'llm',
    description: {
      ru: 'Разбор языковой моделью поверх движка правил: модель ищет формулировки, которых нет в словаре, её цитаты проверяются по исходному тексту, ответ валидируется схемой, при любом сбое используется результат правил.',
      kk: 'Ережелер қозғалтқышының үстінен тілдік модельмен талдау: үзінділер бастапқы мәтін бойынша тексеріледі, жауап схемамен тексеріледі, кез келген ақауда ережелер нәтижесі қолданылады.',
    },
    isAvailable: () => config !== null,
    analyze: async (input) => {
      const startedAt = Date.now();
      const base = analyzeWithRules(input);

      if (!config) {
        return analysisResultSchema.parse({
          ...base,
          warnings: [
            ...base.warnings,
            {
              ru: 'Ключ языковой модели не задан — использован разбор на правилах.',
              kk: 'Тілдік модельдің кілті берілмеген — ережелер бойынша талдау қолданылды.',
            },
          ],
        });
      }

      try {
        const response = await callModel(config, input);
        const merged = mergeLlmIntoRules(base, response, input.text, config.model);
        return analysisResultSchema.parse({ ...merged, durationMs: Date.now() - startedAt });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'неизвестная ошибка';
        return analysisResultSchema.parse({
          ...base,
          durationMs: Date.now() - startedAt,
          warnings: [
            ...base.warnings,
            {
              ru: `Языковая модель недоступна (${reason}) — показан разбор на правилах. Результат полный, но без распознавания формулировок вне словаря.`,
              kk: `Тілдік модель қолжетімсіз (${reason}) — ережелер бойынша талдау көрсетілді.`,
            },
          ],
        });
      }
    },
  };
}
