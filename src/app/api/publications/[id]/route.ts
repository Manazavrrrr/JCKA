/**
 * GET /api/publications/[id] — карточка объявления.
 *
 * Отдаётся полный текст и два набора фрагментов к нему: гипотезы ИИ и
 * подтверждённые доказательства. Раздельно, а не одним списком «найденное».
 *
 * Это определяет вид карточки. Подсветка цитаты, которую предложил
 * алгоритм, и подсветка фрагмента, который аналитик приложил к фактору как
 * доказательство, обязаны выглядеть по-разному: первое — вопрос, второе —
 * утверждение, за которым стоит человек. Слитые в один список, они
 * превратили бы предположение в факт одним цветом.
 *
 * Группы связанных размещений приходят тем же ответом. Открыв объявление,
 * аналитик должен сразу видеть, что тот же телефон встречается ещё в трёх
 * размещениях по двум другим ЖК — это невозможно заметить, просматривая
 * карточки по очереди.
 */

import { connectionsOf } from '../../../../core/connections/graph';
import { prisma } from '../../../../lib/db';
import { publicationDetail } from '../../../../server/queries';
import { type RouteContext, route } from '../../../../server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async (_request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;

  const publication = await publicationDetail(prisma, id);

  /**
   * Связи ищутся по всем публикациям, а не по соседям этого объекта:
   * смысл признака как раз в том, что он выходит за пределы одного ЖК.
   */
  const all = await prisma.publication.findMany({
    select: {
      id: true,
      projectId: true,
      platform: true,
      accountName: true,
      contactPhone: true,
      publishedAt: true,
      project: { select: { name: true } },
    },
  });

  const connections = connectionsOf(
    all.map((item) => ({
      id: item.id,
      projectId: item.projectId,
      projectName: item.project?.name ?? null,
      platform: item.platform,
      accountName: item.accountName,
      contactPhone: item.contactPhone,
      publishedAt: item.publishedAt?.toISOString() ?? null,
    })),
    id,
  );

  const { aiSuggestions, evidence, ...rest } = publication;

  return {
    publication: rest,
    /** Гипотезы: предположения алгоритма, ожидающие решения человека. */
    suggestions: aiSuggestions,
    /** Доказательства: фрагменты, приложенные аналитиком к факторам. */
    evidence,
    connections,
  };
});
