/**
 * Что и под каким именем искать в каждом наборе открытых данных.
 *
 * Это самый скучный файл слоя и при этом самый опасный, поэтому стоит
 * объяснить, почему он устроен именно так.
 *
 * Имена колонок в наборах data.egov.kz не унифицированы. В одном наборе
 * БИН лежит в поле bin, в другом — в bin_ul, в третьем — в
 * bin_zastroyshika. Беда не в разнообразии, а в том, как служба отвечает
 * на запрос по несуществующему полю: не ошибкой, а пустым списком.
 * Для надзорного органа это худший из возможных исходов — опечатка в имени
 * поля превращается в «записей нет», то есть в результат проверки, которой
 * на самом деле не было.
 *
 * Отсюда два решения.
 *
 * Первое: здесь хранятся не имена, а списки ожидаемых написаний. Перед
 * запросом коннектор читает карту полей набора (/api/v4/mapping) и
 * выбирает из неё настоящее имя, подходящее под одно из ожидаемых. Если
 * ни одно не подошло — запрос не отправляется вовсе, а проверка
 * завершается ответом «ответ не получен» с объяснением. Лучше честное
 * «не смогли спросить», чем пустой список, выданный за проверку.
 *
 * Второе: списки написаний взяты из опубликованных описаний наборов, а не
 * из живого ответа службы — доступа к сети при разработке не было. Это
 * ограничение, и оно не замаскировано: именно поэтому имя поля
 * подтверждается картой полей при каждом запросе, а не считается известным.
 *
 * Отдельно про состав строк сверки. Сверяется только то, что аналитик уже
 * внёс в карточку: наименование и БИН застройщика. Адрес из ГБД ЮЛ — это
 * юридический адрес организации, а не адрес стройки, и сличать его с
 * адресом ЖК значило бы показывать расхождение там, где его нет.
 *
 * Модуль чистый: ни сети, ни Prisma, ни текущего времени.
 */

import type { Label } from '../domain/enums';

/** Строка сверки: что сравниваем и где это искать в ответе реестра. */
export interface RegistryFieldMap {
  /** Машинное имя строки. Попадает в протокол сверки. */
  key: string;
  label: Label;
  /** Ожидаемые написания имени колонки в наборе. */
  candidates: readonly string[];
}

/** Как читать конкретный набор. */
export interface DatasetFields {
  sourceId: string;
  /** Ожидаемые написания колонки с БИН. По ней идёт отбор записей. */
  bin: readonly string[];
  /** Строки, которые имеет смысл сверить с карточкой. */
  compare: readonly RegistryFieldMap[];
  /**
   * Поля, которые показываются как справка, но ни с чем не сверяются:
   * в карточке ЖК такого значения нет и быть не должно.
   */
  context: readonly RegistryFieldMap[];
}

const BIN_LABEL: Label = { ru: 'БИН застройщика', kk: 'Құрылыс салушының БСН-і' };
const NAME_LABEL: Label = { ru: 'Наименование застройщика', kk: 'Құрылыс салушының атауы' };

/** Распространённые написания БИН. Перебираются в этом порядке. */
const BIN_CANDIDATES = [
  'bin',
  'bin_ul',
  'binul',
  'bin_rnn',
  'bin_zastroyshika',
  'taxpayer_bin',
  'bin_iin',
  'iin_bin',
] as const;

export const DATASET_FIELDS: readonly DatasetFields[] = [
  {
    sourceId: 'egov-legal-entities',
    bin: BIN_CANDIDATES,
    compare: [
      { key: 'bin', label: BIN_LABEL, candidates: BIN_CANDIDATES },
      {
        key: 'name',
        label: NAME_LABEL,
        candidates: ['name_ru', 'namerus', 'name', 'fullname_ru', 'full_name', 'nameru'],
      },
    ],
    context: [
      {
        key: 'registeredAt',
        label: { ru: 'Дата регистрации', kk: 'Тіркелген күні' },
        candidates: ['registr_date', 'date_registration', 'registration_date', 'regdate'],
      },
      {
        key: 'okedName',
        label: { ru: 'Основной вид деятельности', kk: 'Қызметтің негізгі түрі' },
        candidates: ['oked_name_ru', 'okedname', 'oked', 'activity', 'oked_name'],
      },
      {
        key: 'director',
        label: { ru: 'Первый руководитель', kk: 'Бірінші басшысы' },
        candidates: ['director', 'head', 'fio_head', 'rukovoditel', 'head_fio'],
      },
      {
        key: 'legalAddress',
        label: { ru: 'Юридический адрес организации', kk: 'Ұйымның заңды мекенжайы' },
        candidates: ['address', 'legal_address', 'adres', 'full_address'],
      },
    ],
  },
  {
    sourceId: 'egov-tax-debt-legal',
    bin: BIN_CANDIDATES,
    compare: [{ key: 'bin', label: BIN_LABEL, candidates: BIN_CANDIDATES }],
    context: [
      {
        key: 'taxpayerName',
        label: { ru: 'Налогоплательщик по данным КГД', kk: 'МКК дерегі бойынша салық төлеуші' },
        candidates: ['name_ru', 'taxpayer_name', 'name', 'nameru'],
      },
      {
        key: 'totalDebt',
        label: { ru: 'Сумма задолженности, тенге', kk: 'Берешек сомасы, теңге' },
        candidates: ['total_debt', 'summa', 'debt_sum', 'sum_debt', 'totaldebt'],
      },
      {
        key: 'debtMonths',
        label: { ru: 'Месяцев без погашения', kk: 'Өтелмеген айлар саны' },
        candidates: ['debt_months', 'months', 'period_months', 'debtmonths'],
      },
    ],
  },
  {
    sourceId: 'egov-construction-licenses',
    bin: BIN_CANDIDATES,
    compare: [{ key: 'bin', label: BIN_LABEL, candidates: BIN_CANDIDATES }],
    context: [
      {
        key: 'holder',
        label: { ru: 'Держатель аттестата', kk: 'Аттестат иесі' },
        candidates: ['name_ru', 'organization', 'name', 'company', 'nameru'],
      },
      {
        key: 'licenseNumber',
        label: { ru: 'Номер аттестата', kk: 'Аттестат нөмірі' },
        candidates: ['number', 'license_number', 'nomer', 'attestat_number', 'licensenumber'],
      },
      {
        key: 'issuedAt',
        label: { ru: 'Дата выдачи', kk: 'Берілген күні' },
        candidates: ['date_issue', 'issue_date', 'date_begin', 'dateissue'],
      },
      {
        key: 'scope',
        label: { ru: 'Вид работ', kk: 'Жұмыс түрі' },
        candidates: ['work_type', 'podvid', 'scope', 'vid_rabot', 'worktype'],
      },
    ],
  },
];

export function fieldsFor(sourceId: string): DatasetFields | null {
  return DATASET_FIELDS.find((item) => item.sourceId === sourceId) ?? null;
}

/** Все строки набора — и сверяемые, и справочные. Для показа одной таблицей. */
export function allFieldsOf(fields: DatasetFields): RegistryFieldMap[] {
  return [...fields.compare, ...fields.context];
}
