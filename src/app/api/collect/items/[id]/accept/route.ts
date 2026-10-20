/**
 * POST /api/collect/items/[id]/accept — завести из элемента объявление.
 *
 * Здесь проходит граница между машиной и человеком. Слово-ловушка говорит
 * «на это стоит посмотреть»; объявлением элемент становится только тогда,
 * когда посмотрел аналитик. Автоматического перевода в публикации нет
 * намеренно: иначе одно неудачное слово в настройках залило бы реестр
 * сотнями объявлений, за которые никто не отвечает.
 *
 * Тела у запроса нет. Принять — это согласиться с тем, что уже записано:
 * текст, ссылка, дата и объяснение отбора сохранены при сборе, и
 * переписывать их на этом шаге нельзя, иначе принятое объявление
 * перестанет совпадать с тем, что было в канале.
 */

import { prisma } from '../../../../../../lib/db';
import { acceptCollectedItem } from '../../../../../../server/collect';
import { actorFrom } from '../../../../../../server/http';
import { type RouteContext, created } from '../../../../../../server/route';

export const dynamic = 'force-dynamic';

export const POST = created(async (request, context: RouteContext<{ id: string }>) => {
  const { id } = await context.params;

  return acceptCollectedItem(prisma, id, actorFrom(request.headers));
});
