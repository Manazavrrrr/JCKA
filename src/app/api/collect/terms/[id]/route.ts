/**
 * PATCH  /api/collect/terms/[id] — изменить слово или выключить его.
 * DELETE /api/collect/terms/[id] — удалить слово.
 *
 * Выключение и удаление — разные операции, и обе нужны. Выключенное слово
 * остаётся в списке со своим счётчиком: аналитик видит, что оно когда-то
 * ловило, и может вернуть его одним переключателем. Удаление применяют
 * к опечаткам и явно лишнему.
 *
 * Ни то, ни другое не переписывает прошлые решения. Объяснение к каждому
 * собранному элементу сохранено готовой строкой, и оно остаётся правдой
 * о том, почему элемент взяли тогда: иначе удаление одного слова задним
 * числом сделало бы необъяснимыми десятки карточек.
 */

import { z } from 'zod';

import { MAX_TERM_LENGTH, MIN_TERM_LENGTH, watchTermLanguageSchema } from '../../../../../core/collect';
import { prisma } from '../../../../../lib/db';
import { deleteWatchTerm, updateWatchTerm } from '../../../../../server/collect';
import { actorFrom, parseBody } from '../../../../../server/http';
import { type RouteContext, route } from '../../../../../server/route';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  text: z
    .string()
    .trim()
    .min(MIN_TERM_LENGTH)
    .max(MAX_TERM_LENGTH)
    .refine((value) => /[\p{L}\p{N}]/u.test(value), 'Слово должно содержать букву или цифру')
    .optional(),
  active: z.boolean().optional(),
  language: watchTermLanguageSchema.optional(),
  note: z
    .object({ ru: z.string().trim().min(1), kk: z.string().trim().min(1) })
    .nullable()
    .optional(),
});

export const PATCH = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const body = await parseBody(request, patchSchema);

  return updateWatchTerm(prisma, id, body, actorFrom(request.headers));
});

export const DELETE = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;

  return deleteWatchTerm(prisma, id, actorFrom(request.headers));
});
