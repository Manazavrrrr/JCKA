/**
 * Точка входа слоя реестров.
 *
 * Слой отвечает на три вопроса и ни на один больше: какие реестры вообще
 * существуют и что каждый из них честно отдаёт (sources), как спросить
 * у открытого API data.egov.kz и разобрать ответ (egov, bin), и чем ответ
 * реестра расходится с карточкой ЖК (check).
 *
 * Чего слой не делает: не начисляет баллы. Ответ реестра может дать
 * аналитику основание снять фактор R1, но сам фактор ставит и снимает
 * человек. Шкала на сто баллов откалибрована под шесть факторов, и
 * дописывать в неё седьмой «за налоговый долг» никто не будет.
 */

export {
  REGISTRY_ACCESS_MODES,
  REGISTRY_ACCESS_MODE_HINTS,
  REGISTRY_ACCESS_MODE_LABELS,
  REGISTRY_BEARINGS,
  REGISTRY_BEARING_HINTS,
  REGISTRY_BEARING_LABELS,
  REGISTRY_SOURCES,
  findRegistrySource,
  machineReadableSources,
  manualRegistrySources,
  registryAccessModeSchema,
  registryBearingSchema,
  rejectedRegistrySources,
  sourcesByBearing,
} from './sources';
export type { RegistryAccessMode, RegistryBearing, RegistrySource } from './sources';

export {
  BIN_SUBJECT_KINDS,
  BIN_UNIT_KINDS,
  binSubjectKind,
  binUnitKind,
  formatBin,
  hasValidBinChecksum,
  isSubdivisionBin,
  normalizeBin,
  parseBin,
} from './bin';
export type { BinSubjectKind, BinUnitKind } from './bin';

export {
  EGOV_MAX_PAGE_SIZE,
  EgovParseError,
  EgovQueryError,
  binQuery,
  buildEgovSource,
  egovDataUrl,
  egovDatasetPageUrl,
  egovDetailedUrl,
  egovMappingUrl,
  egovMetaUrl,
  parseEgovMapping,
  parseEgovResponse,
  pickField,
  pickNumber,
  pickText,
  resolveFieldName,
} from './egov';
export type { EgovMatch, EgovPage, EgovParseProblem, EgovQuery, EgovRecord } from './egov';

export { DATASET_FIELDS, allFieldsOf, fieldsFor } from './fields';
export type { DatasetFields, RegistryFieldMap } from './fields';

export {
  FIELD_VERDICTS,
  FIELD_VERDICT_LABELS,
  R1_BEARINGS,
  R1_BEARING_HINTS,
  R1_BEARING_LABELS,
  REGISTRY_ANSWERS,
  REGISTRY_ANSWER_HINTS,
  REGISTRY_ANSWER_LABELS,
  bearingOnR1,
  compareFields,
  compareValues,
  countDisagreements,
  fieldVerdictSchema,
  isDisagreement,
  normalizeForComparison,
  r1BearingSchema,
  reconcile,
  registryAnswerSchema,
} from './check';
export type {
  ComparedField,
  CompareFieldInput,
  FieldVerdict,
  R1Bearing,
  Reconciliation,
  RegistryAnswer,
} from './check';
