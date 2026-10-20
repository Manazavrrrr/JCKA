/**
 * POST /api/publications/[id]/analyze — разбор сохранённого объявления.
 *
 * Отличие от POST /api/analyze одно, но важное: здесь текст уже принадлежит
 * системе, поэтому гипотезы сохраняются и попадают в очередь на рассмотрение
 * аналитиком. Там — разовый разбор чужого текста без записи.
 *
 * Повторный разбор заменяет только нерассмотренные гипотезы. Решения
 * человека — принятые и отклонённые — остаются: их удаление ради чистоты
 * очереди уничтожило бы след решения, а именно он делает систему
 * проверяемой.
 */

import { prisma } from '../../../../../lib/db';
import { analyzePublication } from '../../../../../server/analysis';
import { actorFrom } from '../../../../../server/http';
import { type RouteContext, route } from '../../../../../server/route';

export const dynamic = 'force-dynamic';

export const POST = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;

  const result = await analyzePublication(prisma, id, actorFrom(request.headers));

  return {
    provider: result.analysis.provider,
    model: result.analysis.model,
    durationMs: result.analysis.durationMs,
    saved: result.saved,
    counts: result.summary,
    checks: result.analysis.checks,
    warnings: result.analysis.warnings,
    summary: result.analysis.summary,
    /**
     * Гипотезы возвращаются сразу, чтобы интерфейс показал их без второго
     * запроса. Баллов среди них нет: принятие гипотезы создаёт фактор
     * в статусе «требует проверки» и не меняет оценку объекта.
     */
    suggestions: result.suggestions,
  };
});
