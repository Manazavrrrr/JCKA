/**
 * PATCH  /api/collect/queries/[id] — включить, выключить или пояснить слово.
 * DELETE /api/collect/queries/[id] — удалить слово.
 *
 * Выключение здесь важнее, чем у слов-ловушек, и по другой причине.
 * Выключенная ловушка просто не участвует в отборе; выключенное слово
 * поиска перестаёт тратить деньги на каждом обходе, оставаясь в списке со
 * своей историей — когда по нему ходили и сколько оно принесло. По этой
 * истории и решают, вернуть его или удалить.
 *
 * Удаление слова не удаляет найденное по нему: элементы сбора привязаны к
 * прогону, а не к слову. Иначе удаление слова стирало бы из истории
 * объявления, по которым аналитик уже принял решение.
 */

import { z } from 'zod';

import { prisma } from '../../../../../lib/db';
import { deleteSearchQuery, updateSearchQuery } from '../../../../../server/discovery';
import { actorFrom, parseBody } from '../../../../../server/http';
import { type RouteContext, route } from '../../../../../server/route';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  active: z.boolean().optional(),
  noteRu: z.string().trim().min(1).max(400).nullable().optional(),
  noteKk: z.string().trim().min(1).max(400).nullable().optional(),
});

export const PATCH = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const body = await parseBody(request, patchSchema);

  return updateSearchQuery(prisma, id, body, actorFrom(request.headers));
});

export const DELETE = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;

  await deleteSearchQuery(prisma, id, actorFrom(request.headers));
  return { deleted: id };
});
