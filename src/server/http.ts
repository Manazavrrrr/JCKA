/**
 * Общий слой HTTP для маршрутов API.
 *
 * Весь разбор запроса и формирование ответа собраны здесь по двум причинам.
 *
 * Первая — предсказуемость для интерфейса: любой ответ имеет одну и ту же
 * форму { ok, data } или { ok, error }, поэтому клиент обрабатывает ошибку
 * одинаково независимо от того, какой маршрут её вернул.
 *
 * Вторая — ошибки предметной области. ScoringError возникает тогда, когда
 * аналитик пытается подтвердить фактор, предусловия которого не выполнены:
 * R1 без проверки основания, R5 без второго значения готовности. Это не сбой
 * сервера, а отказ в операции, и он обязан дойти до аналитика текстом,
 * объясняющим, чего не хватает. Поэтому такая ошибка превращается в 409
 * с человеческим сообщением, а не в 500 с «Internal Server Error».
 *
 * Модуль намеренно не зависит ни от Prisma, ни от Next.js: он проверяется
 * тестами без базы и без сервера.
 */

import { z } from 'zod';

import {
  FactorEligibilityError,
  type EligibilityVerdict,
} from '../core/scoring/eligibility';
import { ScoringError } from '../core/scoring/errors';

// ---------------------------------------------------------------------------
// Форма ответа
// ---------------------------------------------------------------------------

export interface ApiError {
  /** Машинный код: по нему интерфейс выбирает поведение. */
  code: ApiErrorCode;
  /** Сообщение для аналитика. Русский текст, пригодный для показа. */
  message: string;
  /** Подробности по полям — для формы ввода. */
  details?: Record<string, string[]>;
  /**
   * Разбор отказа по фактору: вердикт с двуязычным перечнем недостающих
   * условий. Заполняется при отказе подтвердить фактор, чтобы интерфейс
   * показал не «ошибку», а список того, что нужно донести.
   */
  eligibility?: EligibilityVerdict;
}

export const API_ERROR_CODES = [
  /** Запрос не прошёл проверку схемы. */
  'VALIDATION',
  /** Объект не найден. */
  'NOT_FOUND',
  /** Операция отклонена правилами предметной области. */
  'PRECONDITION',
  /** Внутренний сбой. */
  'INTERNAL',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Код ответа HTTP для каждого кода ошибки. */
export const HTTP_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  PRECONDITION: 409,
  INTERNAL: 500,
};

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// ---------------------------------------------------------------------------
// Ошибки, выбрасываемые маршрутами
// ---------------------------------------------------------------------------

/** Ошибка с заранее известным кодом ответа. */
export class HttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFound(what: string): HttpError {
  return new HttpError('NOT_FOUND', `${what} не найден.`);
}

// ---------------------------------------------------------------------------
// Преобразование ошибки в ответ
// ---------------------------------------------------------------------------

/** Разворачивает ошибки Zod в карту «поле → список сообщений». */
export function zodDetails(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    details[key] = [...(details[key] ?? []), issue.message];
  }
  return details;
}

/**
 * Приводит любую пойманную ошибку к ответу API.
 *
 * ScoringError отображается в PRECONDITION с сохранением текста: сообщение
 * этой ошибки написано для аналитика и объясняет, какого условия не хватает.
 * Всё непредвиденное становится INTERNAL без подробностей — подробности
 * уходят в журнал сервера, а не в ответ.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof HttpError) {
    return { code: error.code, message: error.message, ...(error.details && { details: error.details }) };
  }

  if (error instanceof z.ZodError) {
    return {
      code: 'VALIDATION',
      message: 'Запрос не прошёл проверку: исправьте перечисленные поля.',
      details: zodDetails(error),
    };
  }

  /**
   * Отказ подтвердить фактор — самая содержательная ошибка системы.
   * Вердикт передаётся целиком: аналитику нужен не факт отказа, а перечень
   * того, что нужно донести, и на том языке, который у него выбран.
   */
  if (error instanceof FactorEligibilityError) {
    return {
      code: 'PRECONDITION',
      message: error.message,
      eligibility: error.verdict,
    };
  }

  if (error instanceof ScoringError) {
    return {
      code: error.status === 404 ? 'NOT_FOUND' : 'PRECONDITION',
      message: error.message,
    };
  }

  return {
    code: 'INTERNAL',
    message: 'Внутренняя ошибка сервера. Операция не выполнена.',
  };
}

export function statusOf(error: ApiError): number {
  return HTTP_STATUS[error.code];
}

// ---------------------------------------------------------------------------
// Разбор запроса
// ---------------------------------------------------------------------------

/**
 * Проверяет тело запроса схемой.
 *
 * Отдельная функция, а не просто schema.parse, нужна из-за пустого тела:
 * `request.json()` на пустом запросе выбрасывает SyntaxError, который без
 * обработки стал бы ответом 500. Пустое тело — это ошибка запроса, 400.
 */
export async function parseBody<T extends z.ZodTypeAny>(
  request: { json: () => Promise<unknown> },
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError('VALIDATION', 'Тело запроса должно быть корректным JSON.');
  }
  return schema.parse(raw);
}

/** Проверяет параметры строки запроса схемой. */
export function parseQuery<T extends z.ZodTypeAny>(url: string, schema: T): z.infer<T> {
  const params = new URL(url, 'http://localhost').searchParams;
  const raw: Record<string, string | string[]> = {};

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key).filter((value) => value !== '');
    if (values.length === 0) continue;
    raw[key] = values.length > 1 ? values : (values[0] as string);
  }

  return schema.parse(raw);
}

// ---------------------------------------------------------------------------
// Общие схемы параметров
// ---------------------------------------------------------------------------

/** Целое число из строки запроса с границами и значением по умолчанию. */
export function intParam(options: { min: number; max: number; fallback: number }) {
  return z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value === undefined ? options.fallback : Number(value)))
    .pipe(z.number().int().min(options.min).max(options.max));
}

/** Приводит одиночное значение и список к списку. */
export function listParam<T extends z.ZodTypeAny>(item: T) {
  return z
    .union([item, z.array(item)])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return (Array.isArray(value) ? value : [value]) as z.infer<T>[];
    });
}

export const paginationSchema = z.object({
  limit: intParam({ min: 1, max: 200, fallback: 50 }),
  offset: intParam({ min: 0, max: 100_000, fallback: 0 }),
});

// ---------------------------------------------------------------------------
// Действующее лицо
// ---------------------------------------------------------------------------

/**
 * Кто выполняет операцию.
 *
 * В прототипе нет входа по паролю, но у каждого действия обязан быть автор:
 * без автора журнал действий теряет смысл, а подтверждение фактора перестаёт
 * быть решением человека. Поэтому автор берётся из заголовка X-Actor,
 * а при его отсутствии используется демонстрационный аналитик.
 *
 * Такая подстановка допустима только потому, что роль автора в системе —
 * быть прослеживаемым, а не ограничивать доступ. При переходе к реальной
 * эксплуатации меняется одна эта функция.
 */
export const DEFAULT_ACTOR = 'analyst@demo.local';

export function actorFrom(headers: { get: (name: string) => string | null }): string {
  const value = headers.get('x-actor')?.trim();
  return value && value.length > 0 ? value : DEFAULT_ACTOR;
}
