/**
 * GET /api/projects — реестр объектов для карты и списка.
 *
 * Один эндпоинт обслуживает и карту, и таблицу: данные для них одни и те же,
 * различается только отображение. Разделять их значило бы поддерживать два
 * набора фильтров и получать расхождения между «на карте три красных» и
 * «в списке четыре».
 *
 * Сводка по зонам приходит тем же ответом и считается по всему реестру,
 * а не по текущей странице выдачи: «красных объектов: 2» должно оставаться
 * верным при любом фильтре и любой пагинации.
 */

import { z } from 'zod';

import { RISK_ZONES, PROJECT_STAGES } from '../../../core/domain/enums';
import { prisma } from '../../../lib/db';
import { intParam, listParam, parseQuery } from '../../../server/http';
import { listProjects, zoneSummary } from '../../../server/queries';
import { route } from '../../../server/route';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  zone: listParam(z.enum(RISK_ZONES)),
  stage: listParam(z.enum(PROJECT_STAGES)),
  q: z.string().optional(),
  /** Только объекты, где есть непроверенное: основание или факторы. */
  needsAttention: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  limit: intParam({ min: 1, max: 200, fallback: 50 }),
  offset: intParam({ min: 0, max: 100_000, fallback: 0 }),
});

export const GET = route(async (request) => {
  const filters = parseQuery(request.url, querySchema);

  const [page, summary] = await Promise.all([
    listProjects(prisma, filters),
    zoneSummary(prisma),
  ]);

  return { ...page, summary };
});
