/**
 * GET  /api/collect/queries — слова, по которым идёт поиск без перечня.
 * POST /api/collect/queries — добавить слово.
 *
 * Разница со словами-ловушками не в формате, а в том, к чему слово
 * применяется, и путать их нельзя. Слово-ловушка применяется к уже
 * прочитанному тексту: лишняя ловушка портит отбор, но не стоит денег.
 * Слово поиска решает, какую страницу открыть, — лишнее слово поиска
 * стоит денег на каждом обходе, и поэтому у включённых слов есть потолок.
 *
 * Вместе со списком отдаются три вещи, без которых экран не сможет быть
 * честным. Первая — адрес страницы тега: аналитик открывает её в браузере и
 * видит то же, что увидит обход, не доверяя системе на слово. Вторая —
 * признак привязки к месту: слово без неё («рассрочка») собирает рекламу по
 * всему русскоязычному Instagram и расходует предел на чужие регионы.
 * Третья — состояние денег: сколько израсходовано за сутки, сколько
 * осталось и во что обойдётся обход по включённым словам.
 */

import {
  DEFAULT_HASHTAG_LIMIT,
  MAX_ACTIVE_QUERIES,
  MAX_RESULTS_PER_WALK,
  estimateRunCostUsd,
  plannedWalkResults,
} from '../../../../core/collect';
import { prisma } from '../../../../lib/db';
import { apifyConfigured } from '../../../../server/collect';
import {
  budgetStatus,
  createSearchQuery,
  dailyBudgetUsd,
  listSearchQueries,
} from '../../../../server/discovery';
import { actorFrom, parseBody } from '../../../../server/http';
import { created, route } from '../../../../server/route';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  /**
   * Слово принимается почти в любом виде: с решёткой, словами через пробел,
   * ссылкой на страницу тега. Приведение делает ядро и возвращает признак
   * «изменено» — экран обязан показать результат до запуска обхода.
   */
  tag: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
  noteRu: z.string().trim().min(1).max(400).nullable().optional(),
  noteKk: z.string().trim().min(1).max(400).nullable().optional(),
});

export const GET = route(async () => {
  const queries = await listSearchQueries(prisma);
  const active = queries.filter((query) => query.active);
  const plannedResults = plannedWalkResults(active.length, DEFAULT_HASHTAG_LIMIT);
  const budget = await budgetStatus(prisma, { plannedResults });

  return {
    queries,
    limits: {
      maxActive: MAX_ACTIVE_QUERIES,
      limitPerTag: DEFAULT_HASHTAG_LIMIT,
      maxResultsPerWalk: MAX_RESULTS_PER_WALK,
    },
    walk: {
      activeCount: active.length,
      plannedResults,
      plannedCostUsd: estimateRunCostUsd(plannedResults),
      /** Задан ли ключ. Сам ключ наружу не отдаётся ни в каком виде. */
      ready: apifyConfigured(),
    },
    budget: {
      dailyUsd: dailyBudgetUsd(),
      spentUsd: budget.spentUsd,
      remainingUsd: budget.remainingUsd,
      verdict: budget.verdict,
      allowed: budget.allowed,
      note: budget.note,
      affordableResults: budget.affordableResults,
    },
  };
});

export const POST = created(async (request) => {
  const body = await parseBody(request, createSchema);

  return createSearchQuery(prisma, { ...body, actor: actorFrom(request.headers) });
});
