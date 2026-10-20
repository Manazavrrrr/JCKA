/**
 * GET /api/collect/items — лента собранного.
 *
 * Лента показывает и взятое, и отброшенное. Отброшенное нужнее: по нему
 * видно, что фильтр выкинул лишнее или, наоборот, выкинул нужное. Список
 * только из взятого скрывал бы ошибки отбора — а именно их аналитик и
 * должен ловить, правя слова-ловушки.
 *
 * Параметр queue оставляет то, что ждёт решения: взято машиной, но ещё не
 * заведено объявлением и не отклонено. Это рабочий экран на каждый день,
 * тогда как verdict и runId нужны для разбора конкретного прогона.
 *
 * Текст элемента отдаётся целиком. В ленте публикаций он обрезан, здесь —
 * нет: карточка подсвечивает найденные слова по сохранённым позициям
 * символов, и обрезка сдвинула бы подсветку на чужие буквы.
 */

import { z } from 'zod';

import { prisma } from '../../../../lib/db';
import { listCollectedItems } from '../../../../server/collect';
import { intParam, parseQuery } from '../../../../server/http';
import { route } from '../../../../server/route';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  runId: z.string().optional(),
  verdict: z.enum(['KEPT', 'SKIPPED']).optional(),
  /** Только ожидающее решения: взято, но не заведено и не отклонено. */
  queue: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  limit: intParam({ min: 1, max: 200, fallback: 50 }),
  offset: intParam({ min: 0, max: 100_000, fallback: 0 }),
});

export const GET = route(async (request) =>
  listCollectedItems(prisma, parseQuery(request.url, querySchema)),
);
