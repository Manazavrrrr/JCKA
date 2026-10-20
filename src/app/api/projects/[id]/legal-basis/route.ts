/**
 * POST /api/projects/[id]/legal-basis — результат проверки правового основания.
 *
 * Отдельная операция, а не поле в форме редактирования объекта, по двум
 * причинам.
 *
 * Первая. От этого значения зависит фактор R1 — самый тяжёлый в модели
 * (35 баллов) и единственный, который вместе с R2 переводит объект в красную
 * зону. Решение такого веса обязано иметь источник, автора и дату, поэтому
 * источник требуется схемой, а не рекомендацией.
 *
 * Вторая. Состояние здесь трёхзначное, и это принципиально. «Не проверено» —
 * не то же самое, что «основание отсутствует». Пока проверка не проведена,
 * R1 начислить нельзя: отсутствие сведений не является сведением об
 * отсутствии. Баллы даёт только CONFIRMED_ABSENT — проверенное отсутствие
 * основания.
 *
 * Обратный случай обрабатывается автоматически: если основание признано
 * подтверждённым, а R1 уже был начислен, фактор переводится в «проверен,
 * не подтвердился». Иначе объект остался бы с 35 баллами за риск, которого
 * больше нет.
 */

import { z } from 'zod';

import { LEGAL_BASIS_STATUSES, LEGAL_BASIS_TYPES } from '../../../../../core/domain/enums';
import { setLegalBasis } from '../../../../../core/scoring/service';
import { prisma } from '../../../../../lib/db';
import { actorFrom, parseBody } from '../../../../../server/http';
import { resolveProjectId } from '../../../../../server/queries';
import { type RouteContext, route } from '../../../../../server/route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  status: z.enum(LEGAL_BASIS_STATUSES),
  /** Способ организации долевого участия по Закону РК (ст. 7, 8). */
  type: z.enum(LEGAL_BASIS_TYPES),
  /**
   * Источник вывода: номер разрешения, запись реестра, письмо оператора.
   * Обязателен для любого результата, кроме «не проверено» — это требование
   * ядра, здесь оно не дублируется, чтобы текст отказа был один.
   */
  source: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export const POST = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const projectId = await resolveProjectId(prisma, id);
  const body = await parseBody(request, bodySchema);

  return setLegalBasis(prisma, {
    projectId,
    status: body.status,
    type: body.type,
    source: body.source ?? null,
    note: body.note ?? null,
    actor: actorFrom(request.headers),
  });
});
