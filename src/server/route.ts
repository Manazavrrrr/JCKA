/**
 * Переходник между маршрутами Next.js и слоем HTTP.
 *
 * Отдельный модуль нужен из-за проверяемости. В http.ts собрана вся логика
 * разбора запроса и преобразования ошибок, и он не зависит ни от Next.js, ни
 * от Prisma — поэтому проверяется тестами без сервера и без базы. Здесь живёт
 * то, что без Next.js не работает: обёртка NextResponse. Её три строки.
 *
 * Обработчик маршрута благодаря этому выглядит так:
 *
 *   export const GET = route(async () => listProjects(prisma, filters));
 *
 * Ни одного try/catch в маршрутах. Это не экономия символов: единая обработка
 * означает, что отказ по предусловию невозможно случайно превратить в 500,
 * забыв поймать ScoringError в одном из двадцати обработчиков.
 */

import { NextResponse } from 'next/server';

import { type ApiResponse, statusOf, toApiError } from './http';

/** Успешный ответ. */
export function ok<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ ok: true as const, data }, { status });
}

/**
 * Ответ с ошибкой.
 *
 * Непредвиденный сбой пишется в журнал сервера целиком, а наружу уходит без
 * подробностей: в ответе не должно быть ни путей к файлам, ни текста запроса
 * к базе. Отказы предметной области в журнал не пишутся — это штатная работа
 * системы, а не происшествие.
 */
export function fail(error: unknown): NextResponse<ApiResponse<never>> {
  const apiError = toApiError(error);

  if (apiError.code === 'INTERNAL') {
    console.error('[api] непредвиденная ошибка:', error);
  }

  return NextResponse.json({ ok: false as const, error: apiError }, { status: statusOf(apiError) });
}

/** Контекст динамического маршрута Next.js 15: параметры приходят промисом. */
export interface RouteContext<P extends Record<string, string> = Record<string, string>> {
  params: Promise<P>;
}

/**
 * Оборачивает обработчик: возвращённое значение становится { ok: true, data },
 * выброшенное — ответом с кодом из таблицы HTTP_STATUS.
 */
export function route<P extends Record<string, string>, T>(
  handler: (request: Request, context: RouteContext<P>) => Promise<T>,
): (request: Request, context: RouteContext<P>) => Promise<NextResponse> {
  return async (request, context) => {
    try {
      return ok(await handler(request, context));
    } catch (error) {
      return fail(error);
    }
  };
}

/** Обработчик, создающий сущность: тот же разбор ошибок, но ответ 201. */
export function created<P extends Record<string, string>, T>(
  handler: (request: Request, context: RouteContext<P>) => Promise<T>,
): (request: Request, context: RouteContext<P>) => Promise<NextResponse> {
  return async (request, context) => {
    try {
      return ok(await handler(request, context), 201);
    } catch (error) {
      return fail(error);
    }
  };
}
