/**
 * POST /api/publications/[id]/link — привязка объявления к объекту реестра.
 *
 * Привязку подтверждает человек, даже когда сопоставление предложил
 * алгоритм. Нечёткое сравнение названий ошибается, а неверная привязка —
 * это ложный риск на конкретном застройщике: балл начисляется объекту,
 * и объявление чужого ЖК испортит оценку добросовестной компании.
 *
 * Снятие привязки выполняется этим же эндпоинтом с projectId: null.
 * Объявление возвращается в очередь неразобранных, а в журнале остаётся,
 * кто и когда счёл связь ошибочной.
 */

import { z } from 'zod';

import { prisma } from '../../../../../lib/db';
import { linkPublication } from '../../../../../server/analysis';
import { actorFrom, parseBody } from '../../../../../server/http';
import { type RouteContext, route } from '../../../../../server/route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** null — снять привязку. */
  projectId: z.string().min(1).nullable(),
  comment: z.string().trim().optional(),
});

export const POST = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const body = await parseBody(request, bodySchema);

  return linkPublication(prisma, {
    publicationId: id,
    projectId: body.projectId,
    actor: actorFrom(request.headers),
    comment: body.comment ?? null,
  });
});
