/**
 * GET /api/projects/[id]/history — история изменения риска во времени.
 *
 * Снимок создаётся только при фактическом изменении балла или зоны, поэтому
 * история — это не журнал обращений к объекту, а перечень событий: что
 * изменилось, когда и по какой причине.
 *
 * Зачем это нужно. Балл сам по себе отвечает на вопрос «насколько рискованно
 * сейчас». График отвечает на вопрос «куда двигается объект», а он для
 * надзора важнее: объект, поднявшийся с 25 до 55 за месяц, требует внимания
 * раньше, чем объект, стоящий на 60 баллах полгода с уже принятыми мерами.
 *
 * В каждом снимке хранится состав подтверждённых факторов, а не только
 * сумма. Поэтому по графику видно не «стало хуже», а «добавился R2 —
 * платная бронь вне правового основания».
 */

import { getScoreHistory } from '../../../../../core/scoring/service';
import { prisma } from '../../../../../lib/db';
import { resolveProjectId } from '../../../../../server/queries';
import { type RouteContext, route } from '../../../../../server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async (_request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const projectId = await resolveProjectId(prisma, id);
  const snapshots = await getScoreHistory(prisma, projectId);

  return {
    projectId,
    total: snapshots.length,
    items: snapshots,
  };
});
