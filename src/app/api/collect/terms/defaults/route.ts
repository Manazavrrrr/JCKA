/**
 * POST /api/collect/terms/defaults — вернуть набор слов-ловушек по умолчанию.
 *
 * Отдельный маршрут, а не признак в теле добавления, — по той же причине, что
 * у слов поиска: добавление принимает одно введённое слово, возврат набора
 * ничего не принимает и отвечает за список целиком. Признак в общем теле
 * превратил бы опечатку в «долить семь десятков слов».
 *
 * Тела у запроса нет намеренно: набор лежит в ядре
 * (`src/core/collect/defaults.ts`), и принимать его списком снаружи значило бы
 * завести второй набор по умолчанию — тот, что пришёл в запросе.
 *
 * Ответ 200, а не 201: действие идемпотентно по смыслу. Второе нажатие
 * ничего не создаёт и честно отвечает, что весь набор уже на месте.
 */

import { restoreDefaultWatchTerms } from '../../../../../server/collect';
import { prisma } from '../../../../../lib/db';
import { actorFrom } from '../../../../../server/http';
import { route } from '../../../../../server/route';

export const dynamic = 'force-dynamic';

export const POST = route(async (request) => {
  return restoreDefaultWatchTerms(prisma, actorFrom(request.headers));
});
