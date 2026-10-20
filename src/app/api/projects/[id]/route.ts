/**
 * GET /api/projects/[id] — карточка объекта.
 *
 * Отдаётся не только состояние объекта, но и разбор его балла: вклад каждого
 * фактора, объяснение зоны и допустимость подтверждения по каждому коду.
 *
 * Последнее — не удобство, а требование к интерфейсу. Кнопка «подтвердить
 * фактор» должна быть недоступна заранее, если предусловия не выполнены,
 * и рядом с ней должно быть видно, чего именно не хватает. Иначе аналитик
 * узнаёт об отказе только после нажатия, и это выглядит как сбой системы.
 *
 * Адрес принимает и id, и slug: ссылка /api/projects/altai-arman читается
 * в журнале и в отчёте лучше, чем cuid.
 */

import { prisma } from '../../../../lib/db';
import { getProjectScoring } from '../../../../core/scoring/service';
import { projectDetail, resolveProjectId } from '../../../../server/queries';
import { type RouteContext, route } from '../../../../server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async (_request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const projectId = await resolveProjectId(prisma, id);

  const [project, scoring] = await Promise.all([
    projectDetail(prisma, projectId),
    getProjectScoring(prisma, projectId),
  ]);

  return {
    project,
    /** Разбор балла: вклад факторов и объяснение зоны на двух языках. */
    explanation: scoring.explanation,
    /** По каждому коду: можно ли подтвердить и чего не хватает. */
    eligibility: scoring.eligibility,
    summary: scoring.summary,
    /**
     * true, если кэш балла в объекте расходится с расчётом из факторов.
     * Интерфейс обязан показать это явно, а не выдать устаревшее значение
     * за актуальное: расхождение означает, что нужен пересчёт.
     */
    stale: scoring.stale,
  };
});
