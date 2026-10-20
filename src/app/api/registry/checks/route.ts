/**
 * Проверки в реестрах: чтение истории и запуск новой.
 *
 * GET отдаёт сохранённые проверки — все, а не только удачные. Проверка со
 * статусом «ответ не получен» нужна на экране не меньше найденной записи:
 * без неё недоступность службы и отсутствие записи выглядят одинаково.
 *
 * POST делает одно из двух, в зависимости от поля mode. AUTO идёт в
 * data.egov.kz по БИН застройщика; MANUAL заносит выписку, которую
 * аналитик получил глазами на портале без API. Разделения на два маршрута
 * нет намеренно: это один журнал проверок с одним набором полей, и ручная
 * запись отличается от машинной только источником сведений, а не смыслом.
 *
 * Ни тот, ни другой вызов не меняет балл объекта. Ответ содержит поле
 * affectsScore со значением false — это не вежливость, а тип из ядра:
 * слой реестров не умеет начислять факторы вовсе.
 */

import { z } from 'zod';

import { registryAnswerSchema } from '../../../../core/registry';
import { prisma } from '../../../../lib/db';
import { actorFrom, intParam, parseBody, parseQuery } from '../../../../server/http';
import { listRegistryChecks, recordManualCheck, runRegistryCheck } from '../../../../server/registry';
import { created, route } from '../../../../server/route';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  sourceId: z.string().optional(),
  developerId: z.string().optional(),
  projectId: z.string().optional(),
  limit: intParam({ min: 1, max: 200, fallback: 50 }),
  offset: intParam({ min: 0, max: 100_000, fallback: 0 }),
});

export const GET = route(async (request) =>
  listRegistryChecks(prisma, parseQuery(request.url, querySchema)),
);

const comparisonRowSchema = z.object({
  key: z.string().min(1),
  labelRu: z.string().min(1),
  labelKk: z.string().min(1),
  declared: z.string().nullable(),
  registry: z.string().nullable(),
});

const bodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('AUTO'),
    sourceId: z.string().min(1),
    developerId: z.string().min(1),
    projectId: z.string().min(1).optional(),
  }),
  z.object({
    mode: z.literal('MANUAL'),
    sourceId: z.string().min(1),
    developerId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    answer: registryAnswerSchema,
    /**
     * Пояснение обязательно уже на уровне схемы. Ручная проверка — это
     * утверждение человека о том, что он видел на чужом сайте, и без
     * описания проверить его потом нечем.
     */
    note: z.string().min(10, 'Опишите, что проверено и что найдено.'),
    attachment: z.string().optional(),
    requestUrl: z.string().url().optional(),
    comparison: z.array(comparisonRowSchema).max(20).optional(),
  }),
]);

export const POST = created(async (request) => {
  const body = await parseBody(request, bodySchema);
  const actor = actorFrom(request.headers);

  if (body.mode === 'AUTO') {
    return runRegistryCheck(prisma, {
      sourceId: body.sourceId,
      developerId: body.developerId,
      ...(body.projectId && { projectId: body.projectId }),
      actor,
    });
  }

  return recordManualCheck(prisma, {
    sourceId: body.sourceId,
    developerId: body.developerId,
    ...(body.projectId && { projectId: body.projectId }),
    answer: body.answer,
    note: body.note,
    ...(body.attachment && { attachment: body.attachment }),
    ...(body.requestUrl && { requestUrl: body.requestUrl }),
    ...(body.comparison && { comparison: body.comparison }),
    actor,
  });
});
