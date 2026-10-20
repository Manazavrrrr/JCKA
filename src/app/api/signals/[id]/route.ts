/**
 * GET /api/signals/[id] — карточка для просмотра и печати.
 *
 * Отдаётся снимок, а не текущее состояние объекта. Вместе с ним приходит
 * признак divergedFromProject: если объект с момента формирования
 * изменился, карточка остаётся верной на свою дату, но интерфейс обязан
 * сказать об этом, иначе аналитик решит, что видит актуальные цифры.
 *
 * Сравнение идёт с кэшем в Project намеренно, без пересчёта: вопрос здесь
 * не «правилен ли балл объекта», а «тот же он, что в документе».
 */

import { prisma } from '../../../../lib/db';
import { signalDetail } from '../../../../server/queries';
import { type RouteContext, route } from '../../../../server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async (_request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;

  const signal = await signalDetail(prisma, id);

  return {
    signal,
    divergedFromProject:
      signal.score !== signal.project.riskScore || signal.zone !== signal.project.riskZone,
    current: { score: signal.project.riskScore, zone: signal.project.riskZone },
  };
});
