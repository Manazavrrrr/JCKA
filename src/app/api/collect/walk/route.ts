/**
 * GET  /api/collect/walk — состояние автоматического обхода.
 * POST /api/collect/walk — выполнить обход прямо сейчас.
 *
 * Кнопка остаётся, хотя обход идёт сам, и это не дублирование. У ручного
 * запуска две задачи, которых у таймера нет: проверить, что обход работает,
 * не дожидаясь срока, — и собрать внеурочно, когда появился повод. Обе
 * проходят через тот же дневной предел, что и автоматический обход:
 * «нажать самому» не должно быть способом обойти ограничение расхода.
 *
 * GET отдаёт и состояние таймера, и состояние денег, потому что на экране
 * это один вопрос: «идёт ли сбор и будет ли он идти дальше». Выключенный
 * обход и обход с исчерпанным пределом выглядят одинаково по результату, но
 * лечатся по-разному, поэтому в ответе они различимы.
 */

import { prisma } from '../../../../lib/db';
import { walkHashtags } from '../../../../server/collect';
import { budgetStatus, dailyBudgetUsd } from '../../../../server/discovery';
import { actorFrom, parseBody } from '../../../../server/http';
import { route } from '../../../../server/route';
import {
  DEFAULT_INTERVAL_MINUTES,
  MAX_TELEGRAM_CHANNELS_PER_CYCLE,
  schedulerState,
} from '../../../../server/scheduler';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  /** Сколько публикаций брать с одного слова. Сверху режется потолком обхода. */
  limitPerTag: z.number().int().min(1).max(100).optional(),
  /** Отсечка по давности в формате сборщика: «7 days», «2026-10-01». */
  newerThan: z.string().trim().min(1).max(40).nullable().optional(),
  minCategories: z.number().int().min(1).max(5).optional(),
});

export const GET = route(async () => {
  const state = schedulerState();
  const budget = await budgetStatus(prisma, { plannedResults: 0 });

  return {
    scheduler: {
      ...state,
      /**
       * Период по умолчанию отдаётся отдельно от действующего: на экране
       * нужно уметь сказать «обход выключен, а если включить — будет раз
       * в столько-то», не заставляя аналитика читать .env.example.
       */
      defaultIntervalMinutes: DEFAULT_INTERVAL_MINUTES,
      telegramChannelsPerCycle: MAX_TELEGRAM_CHANNELS_PER_CYCLE,
    },
    budget: {
      dailyUsd: dailyBudgetUsd(),
      spentUsd: budget.spentUsd,
      remainingUsd: budget.remainingUsd,
      affordableResults: budget.affordableResults,
    },
  };
});

export const POST = route(async (request) => {
  const body = await parseBody(request, postSchema);

  const result = await walkHashtags(prisma, {
    limitPerTag: body.limitPerTag,
    newerThan: body.newerThan ?? null,
    minCategories: body.minCategories,
    actor: actorFrom(request.headers),
  });

  return {
    skipped: result.skipped,
    tags: result.tags,
    plannedResults: result.plannedResults,
    costUsd: result.costUsd,
    runId: result.run?.run.id ?? null,
    stats: result.run?.stats ?? null,
    budget: result.budget,
  };
});
