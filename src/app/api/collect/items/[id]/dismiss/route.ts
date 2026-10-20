/**
 * POST /api/collect/items/[id]/dismiss — убрать элемент из очереди.
 *
 * Причина обязательна. Отклонение без причины неотличимо от ошибки: через
 * месяц никто не вспомнит, было объявление безобидным или его пропустили
 * второпях. Требование стоит в схеме запроса, потому что это требование
 * к форме обращения, а не правило предметной области: пустой комментарий
 * — это незаполненное поле (400), а не отказ по предусловию.
 *
 * Отклонение не меняет вердикт машины. Решение фильтра и решение человека
 * хранятся порознь и оба остаются видны: именно расхождение между ними
 * показывает, что список слов пора править.
 */

import { z } from 'zod';

import { prisma } from '../../../../../../lib/db';
import { dismissCollectedItem } from '../../../../../../server/collect';
import { actorFrom, parseBody } from '../../../../../../server/http';
import { type RouteContext, route } from '../../../../../../server/route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  comment: z
    .string()
    .trim()
    .min(3, 'Укажите, почему элемент не относится к делу.')
    .max(2000),
});

export const POST = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const body = await parseBody(request, bodySchema);

  return dismissCollectedItem(prisma, id, actorFrom(request.headers), body.comment);
});
