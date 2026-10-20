/**
 * GET /api/publications — лента отслеживаемых объявлений.
 * POST /api/publications — добавление объявления вручную.
 *
 * Лента отдаёт текст обрезанным. Полный текст нужен только карточке, где
 * по нему рисуется подсветка цитат; в списке он добавил бы к ответу десятки
 * килобайт, которые никто не прочитает.
 *
 * Добавление вручную — не вспомогательная функция, а рабочий сценарий.
 * Обращение жителя приходит со ссылкой или скриншотом, а не из выгрузки
 * площадки, и такое объявление должно попадать в систему тем же путём,
 * что и остальные: с датой фиксации, сохранённой копией текста и
 * возможностью разбора.
 */

import { z } from 'zod';

import { LINK_STATUSES, PLATFORMS } from '../../../core/domain/enums';
import { prisma } from '../../../lib/db';
import { writeAudit } from '../../../core/scoring/service';
import { actorFrom, intParam, listParam, parseBody, parseQuery } from '../../../server/http';
import { listPublications } from '../../../server/queries';
import { created, route } from '../../../server/route';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  platform: listParam(z.enum(PLATFORMS)),
  linkStatus: listParam(z.enum(LINK_STATUSES)),
  projectId: z.string().optional(),
  /** Только объявления без привязки — основная очередь работы аналитика. */
  unlinked: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  q: z.string().optional(),
  limit: intParam({ min: 1, max: 200, fallback: 50 }),
  offset: intParam({ min: 0, max: 100_000, fallback: 0 }),
});

export const GET = route(async (request) =>
  listPublications(prisma, parseQuery(request.url, querySchema)),
);

const createSchema = z.object({
  platform: z.enum(PLATFORMS),
  /**
   * Текст объявления. Хранится локальной копией намеренно: исходник
   * удаляют, а офсеты цитат в доказательствах считаются по этому полю,
   * и после удаления объявления они должны остаться проверяемыми.
   */
  rawText: z.string().trim().min(20, 'Текст объявления слишком короткий.'),
  accountName: z.string().trim().optional(),
  accountUrl: z.string().url().optional(),
  contactPhone: z.string().trim().optional(),
  url: z.string().url().optional(),
  publishedAt: z.string().datetime().optional(),
  /** Объект реестра, если он известен заранее. */
  projectId: z.string().optional(),
});

export const POST = created(async (request) => {
  const body = await parseBody(request, createSchema);
  const actor = actorFrom(request.headers);

  return prisma.$transaction(async (tx) => {
    const publication = await tx.publication.create({
      data: {
        platform: body.platform,
        rawText: body.rawText,
        accountName: body.accountName ?? null,
        accountUrl: body.accountUrl ?? null,
        contactPhone: body.contactPhone ?? null,
        url: body.url ?? null,
        publishedAt: body.publishedAt ? new Date(body.publishedAt) : null,
        projectId: body.projectId ?? null,
        linkStatus: body.projectId ? 'CONFIRMED' : 'UNLINKED',
        ...(body.projectId && { linkedBy: actor, linkedAt: new Date() }),
        /**
         * Добавленное вручную объявление не является демонстрационным:
         * сброс демо-данных не должен удалять сведения, внесённые в работе.
         */
        isDemo: false,
      },
    });

    await writeAudit(tx, {
      entityType: 'Publication',
      entityId: publication.id,
      action: 'PUBLICATION_CREATED',
      actor,
      /**
       * Сериализацию делает writeAudit: журнал принимает значение, а не
       * готовую строку. Передать сюда JSON.stringify значило бы записать
       * в столбец строку с экранированной строкой.
       */
      after: {
        platform: publication.platform,
        projectId: publication.projectId,
        textLength: publication.rawText.length,
      },
      comment: 'Объявление внесено вручную.',
    });

    return publication;
  });
});
