/**
 * GET /api/collect/sources — каталог источников с режимом доступа.
 *
 * Маршрут отдаёт не только то, что система умеет читать, но и то, чего она
 * читать не может, вместе с причиной. Это сознательное решение.
 *
 * Реклама новостроек в Instagram и Facebook существует, и именно она чаще
 * всего попадается жителям. Автоматически брать её неоткуда: Ad Library API
 * отдаёт коммерческие объявления только по странам Евросоюза и
 * Великобритании — это требование DSA, — а по Казахстану возвращает лишь
 * политическую и социальную рекламу. Веб-версия библиотеки Казахстан ищет,
 * но её автоматический разбор нарушает условия площадки. Поэтому такой
 * источник помечен «только ручной ввод» и несёт объяснение, а не
 * отсутствует в списке: отсутствие выглядело бы как недоделка, а это
 * ограничение площадки, которое надзорный орган обязан учитывать.
 *
 * Отдельно отдаётся слепое пятно источника: текст, нарисованный на картинке
 * сторис, фильтр по словам не видит. Распознавания изображений в этой
 * версии нет, и честнее сказать об этом в интерфейсе, чем молчать.
 *
 * Публикации застройщика в Instagram — третий случай, не сводящийся ни к
 * «читаем» ни к «не можем». Технически их читает сторонний сборщик, но
 * сбор платный и противоречит условиям Meta, поэтому у источника режим
 * «нужен ключ и решение органа»: вместе с ним отдаются цена прогона и
 * правовая оговорка, а поле ready говорит, задан ли ключ. Сам ключ наружу
 * не выходит ни в каком виде — только булево «задан или нет».
 */

import {
  COLLECT_SOURCES,
  SOURCE_ACCESS_MODE_HINTS,
  SOURCE_ACCESS_MODE_LABELS,
  SOURCE_ACCESS_MODES,
} from '../../../../core/collect';
import { PLATFORM_LABELS } from '../../../../core/domain/enums';
import { apifyConfigured } from '../../../../server/collect';
import { route } from '../../../../server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const keyPresent = apifyConfigured();

  return {
    sources: COLLECT_SOURCES.map((source) => ({
      id: source.id,
      name: source.name,
      platform: source.platform,
      platformLabel: PLATFORM_LABELS[source.platform],
      accessMode: source.accessMode,
      accessModeLabel: SOURCE_ACCESS_MODE_LABELS[source.accessMode],
      method: source.method,
      limitation: source.limitation,
      reference: source.reference,
      blindSpot: source.blindSpot,
      cost: source.cost,
      caveat: source.caveat,
      /**
       * Готов ли источник к живому сбору. У источников, которым ключ не
       * нужен, всегда true; у платных — зависит от настроек сервера.
       */
      ready: source.accessMode === 'KEY_REQUIRED' ? keyPresent : true,
    })),
    accessModes: SOURCE_ACCESS_MODES.map((mode) => ({
      value: mode,
      label: SOURCE_ACCESS_MODE_LABELS[mode],
      hint: SOURCE_ACCESS_MODE_HINTS[mode],
    })),
  };
});
