/**
 * POST /api/projects/[id]/recalculate — пересчёт балла из факторов.
 *
 * Балл объекта — кэш: он складывается из факторов и хранится в объекте,
 * чтобы список восьмидесяти ЖК не пересчитывался при каждом открытии карты.
 * Кэш может разойтись с данными — например, после правки данных в обход
 * обычных операций или после загрузки новых сведений о готовности.
 *
 * Эндпоинт существует именно для того, чтобы расхождение можно было
 * устранить явным действием, а не «перезапуском». Признак stale в карточке
 * объекта показывает расхождение, эта операция его закрывает.
 *
 * Операция идемпотентна по результату: повторный вызов без изменений
 * в факторах не создаёт ни снимка в истории, ни записи в журнале. Иначе
 * нажатие «обновить» засоряло бы и график динамики, и журнал решений.
 */

import { z } from 'zod';

import { recalculateProject } from '../../../../../core/scoring/service';
import { prisma } from '../../../../../lib/db';
import { actorFrom, parseBody } from '../../../../../server/http';
import { resolveProjectId } from '../../../../../server/queries';
import { type RouteContext, route } from '../../../../../server/route';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    /** Причина пересчёта попадает в историю рядом со снимком балла. */
    reason: z.string().trim().min(1).optional(),
  })
  .optional()
  .default({});

export const POST = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const projectId = await resolveProjectId(prisma, id);

  // Тело необязательно: пересчёт без пояснения — штатная операция.
  const body = await parseBody(request, bodySchema).catch(() => ({}) as { reason?: string });

  return recalculateProject(prisma, projectId, {
    actor: actorFrom(request.headers),
    reason: body.reason ?? 'Пересчёт по запросу аналитика.',
  });
});
