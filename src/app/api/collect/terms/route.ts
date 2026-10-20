/**
 * GET  /api/collect/terms — список слов-ловушек со счётчиком срабатываний.
 * POST /api/collect/terms — добавление слова.
 *
 * Слова-ловушки — данные, а не код. Состав признаков рекламы меняется
 * быстрее, чем выходят сборки: сегодня застройщики пишут «бронь», завтра
 * «закрепление цены». Если держать список в исходниках, аналитик окажется
 * в очереди к разработчику ради одного слова, и фильтр отстанет от рынка.
 *
 * Вместе со списком отдаются группы с подписями и подсказками: интерфейс
 * не должен сам знать, что такое «предложение денег» и чем оно отличается
 * от «предмета». Счётчик caught показывает, сколько объявлений поймало
 * слово за всё время — по нему видно слова, которые давно не ловят ничего.
 */

import {
  POSITIVE_CATEGORIES,
  WATCH_TERM_CATEGORIES,
  WATCH_TERM_CATEGORY_HINTS,
  WATCH_TERM_CATEGORY_LABELS,
  WATCH_TERM_LANGUAGES,
  WATCH_TERM_LANGUAGE_LABELS,
  DEFAULT_COLLECT_RULE,
  watchTermInputSchema,
} from '../../../../core/collect';
import { prisma } from '../../../../lib/db';
import { createWatchTerm, listWatchTerms } from '../../../../server/collect';
import { actorFrom, parseBody } from '../../../../server/http';
import { created, route } from '../../../../server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({
  terms: await listWatchTerms(prisma),
  categories: WATCH_TERM_CATEGORIES.map((category) => ({
    value: category,
    label: WATCH_TERM_CATEGORY_LABELS[category],
    hint: WATCH_TERM_CATEGORY_HINTS[category],
    /** Стоп-слово в счёт групп не идёт: оно отменяет отбор, а не подтверждает. */
    counts: (POSITIVE_CATEGORIES as readonly string[]).includes(category),
  })),
  languages: WATCH_TERM_LANGUAGES.map((language) => ({
    value: language,
    label: WATCH_TERM_LANGUAGE_LABELS[language],
  })),
  /** Порог отбора показывается аналитику: правило не должно быть тайным. */
  rule: DEFAULT_COLLECT_RULE,
}));

export const POST = created(async (request) => {
  const body = await parseBody(request, watchTermInputSchema);
  return createWatchTerm(prisma, body, actorFrom(request.headers));
});
