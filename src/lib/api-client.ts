/**
 * Вызов собственного API из браузера.
 *
 * Все ответы приложения имеют одну форму — { ok, data } либо
 * { ok, error } — поэтому разбор ответа написан один раз здесь, а не
 * в каждой кнопке.
 *
 * Главное решение этого файла: отказ по предусловию доносится до
 * интерфейса целиком. Сервер отвечает на попытку подтвердить фактор не
 * словом «нельзя», а перечнем недостающих условий на двух языках. Если
 * бы клиент сводил такой ответ к строке «ошибка 409», аналитик видел бы
 * запрет без причины и не знал, что именно нужно добавить. Поэтому
 * ApiCallError несёт и код, и подробности по полям, и объяснение
 * предусловия.
 */

import type { ApiError, ApiResponse } from '../server/http';

export class ApiCallError extends Error {
  constructor(readonly payload: ApiError) {
    super(payload.message);
    this.name = 'ApiCallError';
  }

  get code() {
    return this.payload.code;
  }

  /** Перечень недостающих условий — то, что аналитик должен прочитать. */
  get missing(): string[] {
    const items = this.payload.eligibility?.missing ?? [];
    return items.map((item) => item.ru);
  }

  /** Разбор по полям для подсветки неверно заполненной формы. */
  get details(): Record<string, string[]> {
    return this.payload.details ?? {};
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiCallError({
      code: 'INTERNAL',
      message: `Сервер ответил ${response.status} без разбираемого тела.`,
    });
  }

  if (!payload.ok) throw new ApiCallError(payload.error);
  return payload.data;
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body ?? {}),
  /**
   * Удаление. Тела нет намеренно: что удаляют, сказано адресом, а
   * пустой объект в теле заставил бы сервер разбирать то, чего нет.
   */
  del: <T>(path: string) => call<T>('DELETE', path),
};

/** Человеческий текст ошибки для показа в интерфейсе. */
export function errorText(error: unknown): string {
  if (error instanceof ApiCallError) {
    const missing = error.missing;
    return missing.length > 0 ? `${error.message} ${missing.join(' ')}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Непредвиденная ошибка.';
}
