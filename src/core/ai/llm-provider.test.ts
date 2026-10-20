/**
 * Тесты LLM-провайдера.
 *
 * Сеть здесь не используется. Проверяется то, что в реальной работе
 * определяет, можно ли доверять ответу модели:
 *
 *   - выдуманная цитата не попадает в результат;
 *   - запрещённые факторы не проходят схему, даже если модель их вернула;
 *   - при любом сбое система остаётся с полным разбором на правилах;
 *   - включение модели не меняет расчёт балла.
 *
 * Последний пункт проверяется косвенно, но строго: все гипотезы, добавленные
 * моделью, помечены confirmable: false, а значит ни одна из них не может
 * попасть в расчёт без отдельного действия аналитика.
 */

import { describe, expect, it } from 'vitest';

import { LOW_CONFIDENCE_THRESHOLD } from '../domain/enums';
import {
  createLlmProvider,
  locateQuote,
  mergeLlmIntoRules,
  readLlmConfig,
  SYSTEM_PROMPT,
} from './llm-provider';
import { analyzeWithRules } from './rules-provider';
import { llmResponseSchema, type LlmResponse } from './schemas';

const AD = `ЖК «Арман Сити» — дом на этапе возведения каркаса, сдача в 2028 году.
Чтобы закрепить квартиру, просим внести гарантийный платёж наличными в офисе.
Телефон: +7 701 555 44 33.`;

function baseResponse(overrides: Partial<LlmResponse> = {}): LlmResponse {
  return llmResponseSchema.parse({
    isHousingAd: true,
    mentionsUnderConstruction: true,
    summaryRu: 'Объявление о продаже квартир в строящемся доме.',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------

describe('locateQuote — проверка цитат модели', () => {
  it('находит дословную цитату и возвращает позицию', () => {
    const span = locateQuote(AD, 'гарантийный платёж наличными');
    expect(span).not.toBeNull();
    expect(AD.slice(span?.charStart ?? 0, span?.charEnd ?? 0)).toBe(span?.fragment);
    expect(span?.fragment).toContain('гарантийный платёж');
  });

  it('находит цитату с изменённым регистром', () => {
    expect(locateQuote(AD, 'ГАРАНТИЙНЫЙ ПЛАТЁЖ')).not.toBeNull();
  });

  /**
   * Главная защита от выдуманного подтверждения: модель вполне способна
   * «процитировать» фразу, которой в объявлении нет. Такая цитата должна
   * исчезнуть, а не попасть в сигнальную карточку как доказательство.
   */
  it('отвергает цитату, которой в тексте нет', () => {
    expect(locateQuote(AD, 'переведите 500 000 тенге на карту директора')).toBeNull();
    expect(locateQuote(AD, 'разрешение МИО отсутствует')).toBeNull();
  });

  it('отвергает пересказ вместо цитаты', () => {
    expect(locateQuote(AD, 'в объявлении просят внести деньги до оформления')).toBeNull();
  });

  it('не принимает пустую и слишком короткую цитату', () => {
    expect(locateQuote(AD, null)).toBeNull();
    expect(locateQuote(AD, '')).toBeNull();
    expect(locateQuote(AD, 'ЖК')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('схема ответа модели', () => {
  it('не пропускает R1, даже если модель его вернула', () => {
    const result = llmResponseSchema.safeParse({
      isHousingAd: true,
      mentionsUnderConstruction: true,
      summaryRu: 'Нет разрешения.',
      hypotheses: [{ code: 'R1', confidence: 0.9, rationaleRu: 'Разрешение не упомянуто.' }],
    });
    expect(result.success).toBe(false);
  });

  it('не пропускает R4', () => {
    const result = llmResponseSchema.safeParse({
      isHousingAd: true,
      mentionsUnderConstruction: false,
      summaryRu: 'Жалобы дольщиков.',
      hypotheses: [{ code: 'R4', confidence: 0.8, rationaleRu: 'Упомянуты жалобы.' }],
    });
    expect(result.success).toBe(false);
  });

  it('не пропускает уверенность вне отрезка [0, 1]', () => {
    expect(
      llmResponseSchema.safeParse({
        isHousingAd: true,
        mentionsUnderConstruction: true,
        summaryRu: 'Текст.',
        hypotheses: [{ code: 'R2', confidence: 1.4, rationaleRu: 'Бронь.' }],
      }).success,
    ).toBe(false);
  });

  it('не пропускает пустое обоснование', () => {
    expect(
      llmResponseSchema.safeParse({
        isHousingAd: true,
        mentionsUnderConstruction: true,
        summaryRu: 'Текст.',
        hypotheses: [{ code: 'R2', confidence: 0.7, rationaleRu: '' }],
      }).success,
    ).toBe(false);
  });

  it('промпт прямо запрещает модели R1 и R4', () => {
    expect(SYSTEM_PROMPT).toContain('Никогда не предлагай фактор R1');
    expect(SYSTEM_PROMPT).toContain('Никогда не предлагай фактор R4');
    expect(SYSTEM_PROMPT).toContain('ДОСЛОВНО');
  });

  it('промпт перечисляет законные способы расчётов', () => {
    const prompt = SYSTEM_PROMPT.toLowerCase();
    for (const term of ['эскроу', 'аккредитив', 'ипотека', 'единого оператора']) {
      expect(prompt).toContain(term);
    }
  });
});

// ---------------------------------------------------------------------------

describe('объединение с разбором на правилах', () => {
  const base = analyzeWithRules({ text: AD });

  it('добавляет гипотезу модели по фактору, которого правила не нашли', () => {
    expect(base.factorHypotheses.map((item) => item.code)).not.toContain('R2');

    const merged = mergeLlmIntoRules(
      base,
      baseResponse({
        hypotheses: [
          {
            code: 'R2',
            confidence: 0.8,
            quote: 'гарантийный платёж наличными',
            rationaleRu: 'Предложено внести платёж наличными до оформления договора.',
            rationaleKk: null,
          },
        ],
      }),
      AD,
      'test-model',
    );

    const r2 = merged.factorHypotheses.find((item) => item.code === 'R2');
    expect(r2).toBeDefined();
    expect(r2?.span).not.toBeNull();
    expect(r2?.confirmable).toBe(false);
    expect(r2?.rationale.ru).toContain('требует проверки аналитиком');
  });

  it('отбрасывает гипотезу с выдуманной цитатой и предупреждает об этом', () => {
    const merged = mergeLlmIntoRules(
      base,
      baseResponse({
        hypotheses: [
          {
            code: 'R2',
            confidence: 0.95,
            quote: 'переведите деньги на карту директора',
            rationaleRu: 'В тексте предложен перевод на карту.',
            rationaleKk: null,
          },
        ],
      }),
      AD,
      'test-model',
    );

    expect(merged.factorHypotheses.map((item) => item.code)).not.toContain('R2');
    expect(merged.warnings.some((item) => item.ru.includes('Отброшено гипотез'))).toBe(true);
  });

  it('гипотеза без цитаты допускается только как неуверенная', () => {
    const merged = mergeLlmIntoRules(
      base,
      baseResponse({
        hypotheses: [
          {
            code: 'R2',
            confidence: 0.99,
            quote: null,
            rationaleRu: 'Из общего смысла текста следует приём денег.',
            rationaleKk: null,
          },
        ],
      }),
      AD,
      'test-model',
    );

    const r2 = merged.factorHypotheses.find((item) => item.code === 'R2');
    expect(r2?.span).toBeNull();
    expect(r2?.lowConfidence).toBe(true);
    expect(r2?.confidence ?? 1).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
  });

  /**
   * Обоснование по шаблону проверяемо, обоснование модели — нет.
   * Поэтому гипотеза правил не заменяется гипотезой модели.
   */
  it('не затирает гипотезу правил ответом модели', () => {
    const withR3 = analyzeWithRules({ text: AD });
    const original = withR3.factorHypotheses.find((item) => item.code === 'R3');
    expect(original).toBeDefined();

    const merged = mergeLlmIntoRules(
      withR3,
      baseResponse({
        hypotheses: [
          {
            code: 'R3',
            confidence: 0.1,
            quote: 'сдача в 2028 году',
            rationaleRu: 'Модель считает иначе.',
            rationaleKk: null,
          },
        ],
      }),
      AD,
      'test-model',
    );

    const after = merged.factorHypotheses.filter((item) => item.code === 'R3');
    expect(after).toHaveLength(1);
    expect(after[0]?.rationale.ru).toBe(original?.rationale.ru);
  });

  it('сохраняет извлечённые сущности и обязательные проверки из правил', () => {
    const merged = mergeLlmIntoRules(base, baseResponse(), AD, 'test-model');
    expect(merged.extracted.phones).toEqual(base.extracted.phones);
    expect(merged.checks).toEqual(base.checks);
    expect(merged.provider).toBe('llm');
    expect(merged.model).toBe('test-model');
  });

  it('все цитаты объединённого результата указывают на исходный текст', () => {
    const merged = mergeLlmIntoRules(
      base,
      baseResponse({
        hypotheses: [
          {
            code: 'R2',
            confidence: 0.7,
            quote: 'гарантийный платёж наличными',
            rationaleRu: 'Платёж наличными.',
            rationaleKk: null,
          },
        ],
      }),
      AD,
      'test-model',
    );

    for (const hypothesis of merged.factorHypotheses) {
      if (!hypothesis.span) continue;
      expect(AD.slice(hypothesis.span.charStart, hypothesis.span.charEnd)).toBe(
        hypothesis.span.fragment,
      );
    }
  });

  it('сводка объединённого результата сохраняет оговорку о порядке начисления', () => {
    const merged = mergeLlmIntoRules(base, baseResponse(), AD, 'test-model');
    expect(merged.summary.ru).toContain('после подтверждения аналитиком');
  });
});

// ---------------------------------------------------------------------------

describe('конфигурация и откат', () => {
  it('без ключа провайдер считается недоступным', () => {
    expect(readLlmConfig({})).toBeNull();
    expect(createLlmProvider(null).isAvailable()).toBe(false);
  });

  it('читает настройки из окружения и подставляет значения по умолчанию', () => {
    const config = readLlmConfig({ LLM_API_KEY: 'test-key' });
    expect(config?.model).toBe('gpt-4o-mini');
    expect(config?.timeoutMs).toBe(20000);

    const custom = readLlmConfig({
      LLM_API_KEY: 'test-key',
      LLM_MODEL: 'custom',
      LLM_TIMEOUT_MS: '5000',
      LLM_BASE_URL: 'https://example.invalid/v1',
    });
    expect(custom?.model).toBe('custom');
    expect(custom?.timeoutMs).toBe(5000);
    expect(custom?.baseUrl).toBe('https://example.invalid/v1');
  });

  it('без ключа возвращает полный разбор на правилах с предупреждением', async () => {
    const result = await createLlmProvider(null).analyze({ text: AD });
    const fromRules = analyzeWithRules({ text: AD });

    expect(result.factorHypotheses.map((item) => item.code)).toEqual(
      fromRules.factorHypotheses.map((item) => item.code),
    );
    expect(result.warnings.some((item) => item.ru.includes('Ключ языковой модели не задан'))).toBe(
      true,
    );
  });

  /** Недоступная сеть не должна оставлять аналитика без разбора. */
  it('при сбое обращения к модели откатывается на правила', async () => {
    const provider = createLlmProvider({
      apiKey: 'test-key',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'test-model',
      timeoutMs: 300,
    });

    const result = await provider.analyze({ text: AD });
    const fromRules = analyzeWithRules({ text: AD });

    expect(result.factorHypotheses.map((item) => item.code)).toEqual(
      fromRules.factorHypotheses.map((item) => item.code),
    );
    expect(result.warnings.some((item) => item.ru.includes('недоступна'))).toBe(true);
    expect(result.checks).toEqual(fromRules.checks);
  }, 10000);
});
