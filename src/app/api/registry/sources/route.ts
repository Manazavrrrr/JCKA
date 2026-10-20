/**
 * GET /api/registry/sources — каталог реестров с режимом доступа.
 *
 * Маршрут отдаёт все девять источников, включая те, которые система читать
 * не может, и тот, который проверен и отклонён. Это главный результат
 * разведки, и прятать его нельзя.
 *
 * Самое важное в ответе — поле bearing. Из девяти источников на фактор R1
 * влияют четыре, и ни один из них машинно не читается: разрешений МИО на
 * привлечение денег дольщиков в открытых данных Казахстана нет вовсе.
 * Машина читает три набора data.egov.kz, и все три говорят о застройщике
 * как о юридическом лице — налоги, регистрация, аттестаты, — то есть на
 * балл не влияют и влиять не должны.
 *
 * Отсюда форма ответа: не «вот что мы умеем», а «вот что существует, вот
 * что из этого можно спросить машиной и вот почему остальное нельзя».
 */

import {
  REGISTRY_ACCESS_MODES,
  REGISTRY_ACCESS_MODE_HINTS,
  REGISTRY_ACCESS_MODE_LABELS,
  REGISTRY_BEARINGS,
  REGISTRY_BEARING_HINTS,
  REGISTRY_BEARING_LABELS,
  REGISTRY_SOURCES,
  egovDatasetPageUrl,
  fieldsFor,
} from '../../../../core/registry';
import { route } from '../../../../server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({
  sources: REGISTRY_SOURCES.map((source) => ({
    id: source.id,
    name: source.name,
    authority: source.authority,
    accessMode: source.accessMode,
    accessModeLabel: REGISTRY_ACCESS_MODE_LABELS[source.accessMode],
    bearing: source.bearing,
    bearingLabel: REGISTRY_BEARING_LABELS[source.bearing],
    provides: source.provides,
    limitation: source.limitation,
    refreshed: source.refreshed,
    reference: source.reference,
    dataset: source.dataset,
    datasetVersion: source.datasetVersion,
    datasetPage: source.dataset === null ? null : egovDatasetPageUrl(source.dataset),
    /** Что именно коннектор сверяет с карточкой. Пусто у ручных источников. */
    compares: fieldsFor(source.id)?.compare.map((field) => field.label) ?? [],
  })),
  accessModes: REGISTRY_ACCESS_MODES.map((mode) => ({
    value: mode,
    label: REGISTRY_ACCESS_MODE_LABELS[mode],
    hint: REGISTRY_ACCESS_MODE_HINTS[mode],
  })),
  bearings: REGISTRY_BEARINGS.map((bearing) => ({
    value: bearing,
    label: REGISTRY_BEARING_LABELS[bearing],
    hint: REGISTRY_BEARING_HINTS[bearing],
  })),
}));
