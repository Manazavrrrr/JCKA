/**
 * GET /api/projects/[id]/audit — журнал действий по объекту.
 *
 * Требование ТЗ «Контроль решений»: у каждого действия аналитика
 * фиксируются статус, автор, дата и время. Журнал доступен только на
 * чтение — записи в нём не правятся и не удаляются, иначе он перестаёт
 * быть доказательством.
 *
 * Хранятся состояния до и после. Это позволяет ответить на вопрос, который
 * возникает при разборе спорного решения: не «кто подтвердил R1», а «что
 * видел человек в момент, когда подтверждал».
 */

import { z } from 'zod';

import { getProjectAudit } from '../../../../../core/scoring/service';
import { prisma } from '../../../../../lib/db';
import { intParam, parseQuery } from '../../../../../server/http';
import { resolveProjectId } from '../../../../../server/queries';
import { type RouteContext, route } from '../../../../../server/route';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  limit: intParam({ min: 1, max: 500, fallback: 100 }),
});

export const GET = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const projectId = await resolveProjectId(prisma, id);
  const { limit } = parseQuery(request.url, querySchema);

  const items = await getProjectAudit(prisma, projectId, limit);
  return { projectId, total: items.length, items };
});
