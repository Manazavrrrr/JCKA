/**
 * GET /api/signals — список сигнальных карточек.
 * POST /api/signals — формирование карточки по объекту.
 *
 * Создание возвращает 409, если объект к карточке не готов: нет
 * подтверждённых факторов либо есть подтверждения без автора или даты.
 * Отказ приходит с текстом для аналитика и списком изъянов в details,
 * чтобы интерфейс показал, что именно починить, а не просто «ошибка».
 */

import { z } from 'zod';

import { SIGNAL_STATUSES } from '../../../core/domain/enums';
import { prisma } from '../../../lib/db';
import { actorFrom, intParam, listParam, parseBody, parseQuery } from '../../../server/http';
import { listSignals } from '../../../server/queries';
import { created, route } from '../../../server/route';
import { createSignal } from '../../../server/signals';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  status: listParam(z.enum(SIGNAL_STATUSES)),
  projectId: z.string().optional(),
  limit: intParam({ min: 1, max: 200, fallback: 50 }),
  offset: intParam({ min: 0, max: 100_000, fallback: 0 }),
});

export const GET = route(async (request) => {
  const filters = parseQuery(request.url, querySchema);

  const [page, drafts] = await Promise.all([
    listSignals(prisma, filters),
    prisma.signal.count({ where: { status: 'DRAFT' } }),
  ]);

  return { ...page, draftTotal: drafts };
});

const bodySchema = z.object({
  /** Идентификатор или slug объекта — удобнее для ссылок из интерфейса. */
  project: z.string().min(1),
  /** Приписка аналитика. Пустая — в карточку попадёт машинная сводка. */
  note: z.string().trim().max(2000).optional(),
});

export const POST = created(async (request) => {
  const body = await parseBody(request, bodySchema);

  return createSignal(prisma, {
    project: body.project,
    actor: actorFrom(request.headers),
    note: body.note ?? null,
  });
});
