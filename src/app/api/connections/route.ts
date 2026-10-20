/**
 * GET /api/connections — группы связанных размещений.
 *
 * Признак, который не виден в карточке одного объявления: один телефон
 * или один аккаунт, продающий квартиры в нескольких ЖК. Сам по себе он
 * не нарушение — агентство вправе работать с несколькими застройщиками, —
 * но это ровно та картина, которую нужно увидеть целиком, прежде чем
 * решать, куда смотреть дальше.
 *
 * Фильтр projectId не сужает поиск, а отбирает готовые группы: связь
 * существует между карточками, и поиск только внутри одного объекта
 * скрыл бы именно то, что требуется найти. Подробнее — в комментарии
 * к listConnections.
 *
 * Группы, собранные по совпадению имени аккаунта, помечены основанием
 * ACCOUNT и слабее телефонных: имена совпадают случайно. Транслитерация
 * намеренно не склеивается — обратное преобразование неоднозначно и
 * связывало бы посторонних.
 */

import { z } from 'zod';

import { prisma } from '../../../lib/db';
import { parseQuery } from '../../../server/http';
import { listConnections } from '../../../server/queries';
import { route } from '../../../server/route';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  projectId: z.string().optional(),
  /** Только межобъектные группы — с них начинается разбор. */
  crossProjectOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const GET = route(async (request) => {
  const filters = parseQuery(request.url, querySchema);

  const result = await listConnections(prisma, filters);

  return {
    ...result,
    summary: {
      clusters: result.total,
      crossProject: result.items.filter((item) => item.crossProject).length,
      /** Размещения в группах, не привязанные ни к одному объекту:
       *  зацепка для разбора очереди неразобранных объявлений. */
      unlinked: result.items.reduce((sum, item) => sum + item.unlinkedCount, 0),
      byPhone: result.items.filter((item) => item.basis.includes('PHONE')).length,
      byAccount: result.items.filter((item) => item.basis.includes('ACCOUNT')).length,
    },
  };
});
