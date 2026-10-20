/**
 * Тесты HTTP-слоя.
 *
 * Проверяется ровно то, от чего зависит поведение интерфейса при отказе:
 *
 *   - отказ подтвердить фактор приходит как 409 с перечнем недостающих
 *     условий, а не как 500 «внутренняя ошибка»;
 *   - несуществующий объект приходит как 404, а не как 400;
 *   - непредвиденная ошибка не выносит наружу подробности реализации;
 *   - разбор параметров не падает на пустых и повторяющихся значениях.
 *
 * Первый пункт — самый важный. Если отказ по предусловию выглядит как сбой
 * сервера, аналитик видит «что-то сломалось» вместо «нужно приложить акт
 * проверки готовности», и работа встаёт.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FactorEligibilityError, checkFactorEligibility } from '../core/scoring/eligibility';
import { ScoringError } from '../core/scoring/errors';
import {
  DEFAULT_ACTOR,
  HttpError,
  actorFrom,
  intParam,
  listParam,
  notFound,
  parseBody,
  parseQuery,
  statusOf,
  toApiError,
  zodDetails,
} from './http';

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

function body(value: unknown) {
  return { json: async () => value };
}

// ---------------------------------------------------------------------------

describe('преобразование ошибок в ответ', () => {
  it('ошибка схемы становится 400 с разбором по полям', () => {
    const schema = z.object({ rationale: z.string().min(1), code: z.enum(['R1', 'R2']) });
    const result = schema.safeParse({ rationale: '', code: 'R9' });
    expect(result.success).toBe(false);

    const error = toApiError(result.success ? null : result.error);
    expect(error.code).toBe('VALIDATION');
    expect(statusOf(error)).toBe(400);
    expect(Object.keys(error.details ?? {})).toEqual(['rationale', 'code']);
  });

  /**
   * Ключевой тест слоя: отказ по предусловию обязан дойти до аналитика
   * вместе с перечнем недостающего, иначе отказ невозможно исправить.
   */
  it('отказ подтвердить фактор становится 409 с перечнем недостающих условий', () => {
    const verdict = checkFactorEligibility('R1', {
      stage: 'FRAME',
      legalBasisStatus: 'NOT_CHECKED',
      verifiedAppealCount: 0,
      evidenceByFactor: {},
    });
    expect(verdict.allowed).toBe(false);

    const error = toApiError(new FactorEligibilityError(verdict));
    expect(error.code).toBe('PRECONDITION');
    expect(statusOf(error)).toBe(409);
    expect(error.eligibility?.code).toBe('R1');
    expect(error.eligibility?.missing.length).toBeGreaterThan(0);
    expect(error.eligibility?.missing[0]?.kk).toBeTruthy();
  });

  it('ScoringError со статусом 404 становится NOT_FOUND', () => {
    const error = toApiError(new ScoringError('Объект demo не найден.', 404));
    expect(error.code).toBe('NOT_FOUND');
    expect(statusOf(error)).toBe(404);
    expect(error.message).toContain('не найден');
  });

  it('ScoringError без статуса становится отказом по предусловию', () => {
    const error = toApiError(new ScoringError('Обоснование решения обязательно.'));
    expect(error.code).toBe('PRECONDITION');
    expect(error.message).toContain('Обоснование');
  });

  it('HttpError передаёт свой код и подробности', () => {
    const error = toApiError(
      new HttpError('VALIDATION', 'Проверьте поля.', { code: ['Недопустимый код.'] }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.details?.code).toEqual(['Недопустимый код.']);
  });

  it('notFound формирует читаемое сообщение', () => {
    expect(toApiError(notFound('Публикация')).message).toBe('Публикация не найден.');
  });

  /** Подробности непредвиденного сбоя остаются в журнале сервера. */
  it('непредвиденная ошибка не выносит наружу подробности', () => {
    const error = toApiError(new Error('SQLITE_BUSY: database is locked at /var/db/demo.db'));
    expect(error.code).toBe('INTERNAL');
    expect(statusOf(error)).toBe(500);
    expect(error.message).not.toContain('SQLITE');
    expect(error.message).not.toContain('/var/db');
  });

  it('значение, не являющееся ошибкой, тоже обрабатывается', () => {
    expect(toApiError('строка').code).toBe('INTERNAL');
    expect(toApiError(null).code).toBe('INTERNAL');
  });
});

// ---------------------------------------------------------------------------

describe('разбор тела запроса', () => {
  it('пустое или испорченное тело — это 400, а не 500', async () => {
    const broken = {
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    };

    await expect(parseBody(broken, z.object({}))).rejects.toThrow(HttpError);
    const error = await parseBody(broken, z.object({})).then(
      () => null,
      (item: unknown) => toApiError(item),
    );
    expect(error?.code).toBe('VALIDATION');
  });

  it('корректное тело проходит схему', async () => {
    const schema = z.object({ rationale: z.string().min(1) });
    await expect(parseBody(body({ rationale: 'Подтверждено актом.' }), schema)).resolves.toEqual({
      rationale: 'Подтверждено актом.',
    });
  });

  it('тело, не прошедшее схему, даёт разбор по полям', async () => {
    const schema = z.object({ rationale: z.string().min(1) });
    const error = await parseBody(body({ rationale: '' }), schema).then(
      () => null,
      (item: unknown) => toApiError(item),
    );
    expect(error?.code).toBe('VALIDATION');
    expect(error?.details?.rationale).toBeDefined();
  });
});

// ---------------------------------------------------------------------------

describe('разбор параметров строки запроса', () => {
  const schema = z.object({
    zone: listParam(z.enum(['GREEN', 'YELLOW', 'RED'])),
    limit: intParam({ min: 1, max: 200, fallback: 50 }),
    q: z.string().optional(),
  });

  it('подставляет значения по умолчанию', () => {
    expect(parseQuery('/api/projects', schema)).toEqual({
      zone: undefined,
      limit: 50,
      q: undefined,
    });
  });

  it('одиночное значение приводится к списку', () => {
    expect(parseQuery('/api/projects?zone=RED', schema).zone).toEqual(['RED']);
  });

  it('повторяющийся параметр собирается в список', () => {
    expect(parseQuery('/api/projects?zone=RED&zone=YELLOW', schema).zone).toEqual([
      'RED',
      'YELLOW',
    ]);
  });

  /** Пустой параметр из формы не должен ломать запрос. */
  it('пустое значение игнорируется', () => {
    expect(parseQuery('/api/projects?q=&zone=RED', schema).q).toBeUndefined();
  });

  it('недопустимое значение перечисления отклоняется', () => {
    expect(() => parseQuery('/api/projects?zone=PURPLE', schema)).toThrow(z.ZodError);
  });

  it('число за границами отклоняется, а не обрезается молча', () => {
    expect(() => parseQuery('/api/projects?limit=0', schema)).toThrow(z.ZodError);
    expect(() => parseQuery('/api/projects?limit=5000', schema)).toThrow(z.ZodError);
    expect(parseQuery('/api/projects?limit=10', schema).limit).toBe(10);
  });
});

// ---------------------------------------------------------------------------

describe('автор операции', () => {
  it('берётся из заголовка', () => {
    expect(actorFrom(headers({ 'x-actor': 'supervisor@demo.local' }))).toBe(
      'supervisor@demo.local',
    );
  });

  /**
   * Автор обязателен всегда: без него журнал действий теряет смысл,
   * а подтверждение фактора перестаёт быть решением человека.
   */
  it('никогда не бывает пустым', () => {
    expect(actorFrom(headers({}))).toBe(DEFAULT_ACTOR);
    expect(actorFrom(headers({ 'x-actor': '   ' }))).toBe(DEFAULT_ACTOR);
  });
});

// ---------------------------------------------------------------------------

describe('zodDetails', () => {
  it('группирует несколько сообщений по одному полю', () => {
    const schema = z.object({ rationale: z.string().min(5).max(10) });
    const result = schema.safeParse({ rationale: 'ок' });
    const details = zodDetails(result.success ? new z.ZodError([]) : result.error);
    expect(details.rationale?.length).toBeGreaterThan(0);
  });

  it('ошибку корня относит к ключу _', () => {
    const result = z.string().safeParse(42);
    const details = zodDetails(result.success ? new z.ZodError([]) : result.error);
    expect(details._).toBeDefined();
  });
});
