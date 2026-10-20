/**
 * POST /api/analyze — разбор произвольного текста объявления.
 *
 * Ключевой эндпоинт для проверки системы. ТЗ требует, чтобы ИИ работал на
 * новом тексте, а не только на подготовленных примерах, поэтому здесь
 * принимается любое объявление: вставленное проверяющим, присланное
 * жителем, скопированное с площадки, которой в демо-данных нет.
 *
 * Эндпоинт ничего не записывает. Это намеренно:
 *
 *   - текст чужой, объекта реестра для него может не существовать;
 *   - во время демонстрации нельзя засорять реестр проверочными данными;
 *   - разбор должен быть безопасной операцией, которую не страшно повторить.
 *
 * Для сохранения результата есть POST /api/publications/[id]/analyze —
 * там текст уже принадлежит системе и у разбора есть адресат.
 *
 * Ответ содержит только гипотезы. Ни балла, ни зоны в нём нет и быть не
 * может: балл складывается из подтверждённых аналитиком факторов, а разбор
 * текста ничего не подтверждает.
 */

import { z } from 'zod';

import { prisma } from '../../../lib/db';
import { analyzeText } from '../../../server/analysis';
import { parseBody } from '../../../server/http';
import { route } from '../../../server/route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  text: z.string().min(1, 'Текст объявления обязателен.'),
  /** Заголовок объявления, если площадка отдаёт его отдельно от текста. */
  title: z.string().optional(),
  /** Язык подписей в ответе. */
  locale: z.enum(['ru', 'kk']).optional(),
  /**
   * false — не сопоставлять с реестром.
   * Нужно для проверки самого разбора: видно, что найдено в тексте,
   * без подсказок от восьми известных объектов.
   */
  useRegistry: z.boolean().optional(),
});

export const POST = route(async (request) => {
  const body = await parseBody(request, bodySchema);
  const result = await analyzeText(prisma, body);

  return {
    provider: result.analysis.provider,
    model: result.analysis.model,
    durationMs: result.analysis.durationMs,

    isHousingAd: result.analysis.isHousingAd,
    mentionsUnderConstruction: result.analysis.mentionsUnderConstruction,

    extracted: result.analysis.extracted,
    factorHypotheses: result.analysis.factorHypotheses,
    projectMatches: result.analysis.projectMatches,

    /** Что нельзя установить по тексту и нужно проверить в реестре. */
    checks: result.analysis.checks,
    warnings: result.analysis.warnings,
    summary: result.analysis.summary,

    counts: result.summary,

    /**
     * Прямое утверждение в теле ответа, а не только в документации:
     * разбор текста не начисляет баллов и не меняет зону объекта.
     */
    disclaimer: {
      ru:
        'Это гипотезы для проверки, а не оценка риска. Балл и зона объекта ' +
        'складываются только из факторов, подтверждённых аналитиком с документами.',
      kk:
        'Бұл — тексеруге арналған болжамдар, қатер бағасы емес. Нысанның балы мен ' +
        'аймағы талдаушы құжатпен растаған факторлардан ғана құралады.',
    },
  };
});
