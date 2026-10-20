/**
 * POST /api/projects/[id]/factors — решение аналитика по фактору риска.
 *
 * Самая ответственная операция системы: именно здесь меняется балл объекта.
 * Поэтому у запроса три обязательных свойства.
 *
 * Обоснование обязательно. Фактор без обоснования — это балл, который никто
 * не может объяснить, а решение по объекту долевого строительства обязано
 * быть объяснимым и через полгода, когда автор решения в отпуске.
 *
 * Предусловия проверяются на сервере. Интерфейс показывает недоступную
 * кнопку, но запрос может прийти и мимо интерфейса, поэтому отказ выдаёт
 * ядро, а не форма. Отказ приходит кодом 409 с перечнем недостающих
 * условий на двух языках — аналитик видит, что именно донести, а не
 * «ошибка сервера».
 *
 * Балл пересчитывается в той же транзакции. Объект не может остаться
 * с подтверждённым фактором и прежним баллом.
 */

import { z } from 'zod';

import { EVIDENCE_KINDS, FACTOR_CODES, FACTOR_STATUSES } from '../../../../../core/domain/enums';
import { setFactorStatus } from '../../../../../core/scoring/service';
import { prisma } from '../../../../../lib/db';
import { actorFrom, parseBody } from '../../../../../server/http';
import { resolveProjectId } from '../../../../../server/queries';
import { type RouteContext, route } from '../../../../../server/route';

export const dynamic = 'force-dynamic';

const evidenceSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  excerpt: z.string().optional(),
  /** Публикация-источник: по ней офсеты цитаты указывают на текст. */
  publicationId: z.string().optional(),
  sourceLabel: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  note: z.string().optional(),
});

const bodySchema = z.object({
  code: z.enum(FACTOR_CODES),
  status: z.enum(FACTOR_STATUSES),
  /**
   * Обоснование решения. Минимальная длина — не формальность: «ок» и «да»
   * не объясняют решение и делают журнал бесполезным.
   */
  rationale: z.string().trim().min(10, 'Обоснование должно объяснять решение, а не подтверждать его.'),
  evidence: z.array(evidenceSchema).optional(),
});

export const POST = route(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;
  const projectId = await resolveProjectId(prisma, id);
  const body = await parseBody(request, bodySchema);

  const result = await setFactorStatus(prisma, {
    projectId,
    code: body.code,
    status: body.status,
    rationale: body.rationale,
    actor: actorFrom(request.headers),
    origin: 'MANUAL',
    ...(body.evidence && { evidence: body.evidence }),
  });

  return result;
});
