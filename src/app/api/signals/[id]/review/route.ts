/**
 * POST /api/signals/[id]/review — подтверждение или возврат карточки.
 *
 * Это второй человек в процессе. Аналитик формирует карточку, но выносить
 * её наружу вправе только после рассмотрения: требование ТЗ «Контроль
 * решений» — у каждого статуса есть автор, дата и время.
 *
 * Возврат требует комментария, подтверждение — нет. Проверка живёт
 * в server/signals.ts, а не в схеме запроса: это правило предметной
 * области, и ошибка должна приходить с человеческим текстом (409), а не
 * как нарушение формата (400).
 */

import { z } from 'zod';

import { prisma } from '../../../../../lib/db';
import { actorFrom, parseBody } from '../../../../../server/http';
import { type RouteContext, route } from '../../../../../server/route';
import { reviewSignal } from '../../../../../server/signals';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  decision: z.enum(['CONFIRMED', 'RETURNED']),
  comment: z.string().trim().max(2000).optional(),
});

export const POST = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const body = await parseBody(request, bodySchema);

  return reviewSignal(prisma, {
    signalId: id,
    decision: body.decision,
    actor: actorFrom(request.headers),
    comment: body.comment ?? null,
  });
});
