/**
 * GET /api/suggestions — очередь гипотез ИИ на рассмотрение.
 *
 * Это рабочий список аналитика, и порядок в нём не случаен: сначала
 * нерассмотренные, внутри — по убыванию уверенности. Рассмотренные остаются
 * доступными, но уходят вниз: они нужны для разбора решений, а не для работы.
 *
 * Очередь существует отдельно от списка объявлений потому, что единица
 * работы здесь другая. В ленте объявлений аналитик решает, относится ли
 * текст к делу. В очереди гипотез он отвечает на конкретные вопросы:
 * «действительно ли здесь требуют платную бронь», «тот ли это ЖК».
 */

import { z } from 'zod';

import { SUGGESTION_KINDS, SUGGESTION_STATUSES } from '../../../core/domain/enums';
import { prisma } from '../../../lib/db';
import { intParam, listParam, parseQuery } from '../../../server/http';
import { listSuggestions } from '../../../server/queries';
import { route } from '../../../server/route';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  status: listParam(z.enum(SUGGESTION_STATUSES)),
  kind: listParam(z.enum(SUGGESTION_KINDS)),
  publicationId: z.string().optional(),
  projectId: z.string().optional(),
  limit: intParam({ min: 1, max: 200, fallback: 50 }),
  offset: intParam({ min: 0, max: 100_000, fallback: 0 }),
});

export const GET = route(async (request) => {
  const filters = parseQuery(request.url, querySchema);

  const [page, pending] = await Promise.all([
    listSuggestions(prisma, filters),
    prisma.aiSuggestion.count({ where: { status: 'PENDING' } }),
  ]);

  // Счётчик по всей очереди, а не по странице: он показывается в навигации.
  return { ...page, pendingTotal: pending };
});
