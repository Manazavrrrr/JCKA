/**
 * PATCH /api/suggestions/[id] — решение аналитика по гипотезе ИИ.
 *
 * Здесь проходит граница между машиной и человеком, и её стоит описать
 * прямо, потому что устройство неочевидно.
 *
 * Принятие гипотезы НЕ подтверждает фактор и НЕ меняет балл. Оно создаёт
 * фактор в статусе «требует проверки», прикладывает к нему цитату из
 * объявления и помечает происхождение как AI_ACCEPTED. Подтверждение —
 * отдельная операция с обоснованием и проверкой предусловий.
 *
 * Причина в том, что согласие с гипотезой и подтверждение факта — разные
 * утверждения. «Да, в объявлении действительно требуют платную бронь» —
 * согласие с прочтением текста. «Да, объект нарушает порядок привлечения
 * средств» — вывод, за который аналитик отвечает. Если бы принятие
 * гипотезы сразу давало баллы, красную зону можно было бы получить
 * двенадцатью нажатиями «согласен», не открыв ни одного документа.
 *
 * Поэтому в ответе есть поле scoreDelta, и оно всегда равно нулю.
 */

import { z } from 'zod';

import { prisma } from '../../../../lib/db';
import { reviewSuggestion } from '../../../../server/analysis';
import { actorFrom, parseBody } from '../../../../server/http';
import { type RouteContext, route } from '../../../../server/route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  comment: z.string().trim().optional(),
});

export const PATCH = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const body = await parseBody(request, bodySchema);

  const result = await reviewSuggestion(prisma, {
    suggestionId: id,
    decision: body.decision,
    actor: actorFrom(request.headers),
    comment: body.comment ?? null,
  });

  return {
    ...result,
    note:
      result.status === 'ACCEPTED' && result.factorId
        ? {
            ru:
              'Фактор создан в статусе «требует проверки». Балл не изменился: ' +
              'для начисления нужно подтвердить фактор с обоснованием и документами.',
            kk:
              'Фактор «тексеру қажет» күйінде жасалды. Бал өзгермеді: ' +
              'есептеу үшін факторды негіздемемен және құжатпен растау қажет.',
          }
        : null,
  };
});
