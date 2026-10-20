/**
 * GET  /api/collect/runs — история прогонов сбора.
 * POST /api/collect/runs — прогон по каналу Telegram или профилю Instagram.
 *
 * Прогон — это запись, а не действие без следа. У него есть автор, время
 * начала и окончания, имя канала, порог отбора и итог: сколько прочитано,
 * сколько взято, сколько отброшено и по какой причине. Надзорный орган
 * должен уметь ответить, откуда взялось объявление в деле, а ответ
 * «система нашла» таким ответом не является.
 *
 * Неудачный прогон тоже сохраняется — со статусом FAILED и текстом отказа.
 * Если падения не записывать, молчание канала и недоступность канала
 * выглядят одинаково, и аналитик решит, что рекламы просто нет.
 *
 * Порог minCategories передаётся запросом, а не берётся из настроек жёстко:
 * по умолчанию нужно совпадение по двум разным группам слов, но аналитик
 * вправе разово опустить порог до единицы, когда проверяет новый канал и
 * готов просмотреть лишнее. Выбранный порог сохраняется в прогоне, поэтому
 * потом видно, какой выборка была на самом деле.
 *
 * Источник выбирается не отдельным полем, а формой запроса: channel — это
 * Telegram, account — это Instagram. Поле «какой источник» рядом с полем
 * «что читать» допускало бы несочетаемую пару (источник Instagram, имя
 * канала Telegram), которую пришлось бы проверять и отвергать. Здесь такой
 * пары не существует.
 */

import { z } from 'zod';

import { MAX_POSTS_LIMIT, POSITIVE_CATEGORIES } from '../../../../core/collect';
import { prisma } from '../../../../lib/db';
import {
  collectFromInstagram,
  collectFromTelegram,
  listCollectRuns,
} from '../../../../server/collect';
import { actorFrom, intParam, parseBody, parseQuery } from '../../../../server/http';
import { created, route } from '../../../../server/route';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  limit: intParam({ min: 1, max: 100, fallback: 20 }),
});

export const GET = route(async (request) => {
  const { limit } = parseQuery(request.url, querySchema);
  return { runs: await listCollectRuns(prisma, limit) };
});

const minCategoriesField = z
  .number()
  .int()
  .min(1)
  .max(POSITIVE_CATEGORIES.length)
  .optional();

const telegramSchema = z.object({
  /**
   * Имя канала в любом виде: «@ukg_novostroyki», «t.me/ukg_novostroyki»,
   * адрес витрины. Разбор и проверку делает normalizeChannel в ядре —
   * схема только отсекает пустую строку и явную длину.
   */
  channel: z.string().trim().min(2).max(200),
  minCategories: minCategoriesField,
});

const instagramSchema = z.object({
  /** Имя аккаунта в любом виде: «@monterosa.kz», ссылка, адрес профиля. */
  account: z.string().trim().min(1).max(200),
  /**
   * Сколько публикаций запросить. Потолок берётся из ядра, а не пишется
   * числом: сбор платный, и предел должен быть один и тот же в схеме
   * запроса, в коннекторе и на экране.
   */
  limit: z.number().int().min(1).max(MAX_POSTS_LIMIT).optional(),
  /** Отсечка по давности в формате актора: «7 days», «2026-10-01». */
  newerThan: z.string().trim().min(1).max(40).optional(),
  minCategories: minCategoriesField,
});

const startSchema = z.union([telegramSchema, instagramSchema]);

export const POST = created(async (request) => {
  const body = await parseBody(request, startSchema);
  const actor = actorFrom(request.headers);

  if ('channel' in body) {
    return collectFromTelegram(prisma, {
      channel: body.channel,
      ...(body.minCategories !== undefined && { minCategories: body.minCategories }),
      actor,
    });
  }

  return collectFromInstagram(prisma, {
    account: body.account,
    ...(body.limit !== undefined && { limit: body.limit }),
    ...(body.newerThan !== undefined && { newerThan: body.newerThan }),
    ...(body.minCategories !== undefined && { minCategories: body.minCategories }),
    actor,
  });
});
