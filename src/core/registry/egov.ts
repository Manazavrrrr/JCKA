/**
 * Клиент открытого API data.egov.kz — сборка адресов и разбор ответов.
 *
 * Что это за API. На data.egov.kz выложены наборы данных государственных
 * органов, и к каждому есть машинный доступ четвёртой версии: запрос
 * уходит GET-ом, условия отбора передаются в параметре source как JSON
 * в стиле Elasticsearch, токен и вход не требуются. Это важное свойство
 * для надзорного органа: ответ воспроизводим, адрес запроса можно вписать
 * в протокол, и проверяющий повторит его из своего браузера.
 *
 * Чего этот модуль не делает. Он не ходит в сеть. На вход разбору дают уже
 * полученное тело ответа, на выход он отдаёт записи. Причина та же, что и
 * в коннекторе Telegram: чужая служба недоступна в тестах и не обязана
 * отвечать одинаково, а строка — обязана разбираться одинаково всегда.
 *
 * Чего мы про этот API честно не знаем. Имена полей внутри набора нигде
 * не стандартизованы: в одном наборе застройщик лежит в поле «bin»,
 * в другом — в «bin_zastroyshika», в третьем — в «BIN». Проверить это
 * без сетевого запроса нельзя, а выдумывать имя поля в коде надзорного
 * инструмента нельзя тем более. Поэтому имя поля здесь всегда приходит
 * снаружи явным параметром (см. matchQuery), а для чтения значения из
 * записи есть pickField с перечнем допустимых написаний — и он честно
 * возвращает undefined, если не нашёл ни одного.
 *
 * Отдельно про пустой ответ. Пустой список — это не «нарушений нет».
 * Это либо «в наборе нет такой записи», либо «мы спросили не то поле».
 * Различить их здесь невозможно, поэтому модуль не пытается: он отдаёт
 * ровно то, что пришло, а толкование остаётся за слоем сверки, где
 * у аналитика есть кнопка «ответ реестра не получен».
 *
 * Модуль чистый: ни сети, ни Prisma, ни текущего времени.
 */

// ---------------------------------------------------------------------------
// Адреса
// ---------------------------------------------------------------------------

const API_ROOT = 'https://data.egov.kz';

/**
 * Наш собственный потолок на размер страницы.
 *
 * Документированного предела у службы мы не видели, а ставить его надо:
 * запрос на десятки тысяч записей из интерфейса надзорного органа — это
 * не проверка застройщика, а выгрузка набора, и делать её случайным
 * нажатием кнопки не нужно. Пятьсот записей с запасом перекрывают любую
 * осмысленную сверку по одному БИН.
 */
export const EGOV_MAX_PAGE_SIZE = 500;

/** Условие отбора: имя поля в наборе → искомое значение. Условия складываются по И. */
export type EgovMatch = Readonly<Record<string, string>>;

export interface EgovQuery {
  /** Машинное имя набора, apiUri. Например, gbd_ul. */
  readonly dataset: string;
  /** Версия набора в том виде, в каком её публикует служба: v1, v40, v91. */
  readonly version: string;
  /** Условия отбора. Пустой объект означает «выдать первую страницу набора». */
  readonly match?: EgovMatch;
  /** Сколько записей вернуть. По умолчанию десять, больше EGOV_MAX_PAGE_SIZE нельзя. */
  readonly size?: number;
  /** Сколько записей пропустить. Постраничный обход. */
  readonly from?: number;
}

export class EgovQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgovQueryError';
  }
}

/** Машинные имена наборов и версии: латиница, цифры, подчёркивание. */
const DATASET_PATTERN = /^[a-z0-9_]{2,64}$/i;
const VERSION_PATTERN = /^v\d{1,4}$/i;

function assertDataset(dataset: string): void {
  if (!DATASET_PATTERN.test(dataset)) {
    throw new EgovQueryError(
      `Недопустимое имя набора «${dataset}». Ожидается машинное имя вида gbd_ul.`,
    );
  }
}

function assertVersion(version: string): void {
  if (!VERSION_PATTERN.test(version)) {
    throw new EgovQueryError(
      `Недопустимая версия набора «${version}». Ожидается запись вида v1 или v91.`,
    );
  }
}

/**
 * Собирает тело параметра source — условия отбора в том виде, в каком их
 * ждёт четвёртая версия API.
 *
 * Вынесено отдельно от сборки адреса, потому что это единственная часть,
 * которую имеет смысл показывать аналитику в протоколе проверки: по ней
 * видно, что именно спросили у реестра.
 */
export function buildEgovSource(query: EgovQuery): Record<string, unknown> {
  const size = query.size ?? 10;
  if (!Number.isInteger(size) || size < 1 || size > EGOV_MAX_PAGE_SIZE) {
    throw new EgovQueryError(
      `Размер страницы должен быть целым от 1 до ${EGOV_MAX_PAGE_SIZE}, получено ${String(size)}.`,
    );
  }

  const from = query.from ?? 0;
  if (!Number.isInteger(from) || from < 0) {
    throw new EgovQueryError(`Смещение должно быть целым неотрицательным, получено ${String(from)}.`);
  }

  const source: Record<string, unknown> = { size, from };

  const conditions = Object.entries(query.match ?? {});
  if (conditions.length > 0) {
    source.query = {
      bool: {
        must: conditions.map(([field, value]) => {
          if (field.trim().length === 0) {
            throw new EgovQueryError('Имя поля в условии отбора не может быть пустым.');
          }
          return { match: { [field]: value } };
        }),
      },
    };
  }

  return source;
}

/**
 * Адрес выборки данных.
 *
 * Адрес намеренно собирается целиком и возвращается строкой, а не
 * разбирается на части внутри запроса: его надо сохранить в карточке
 * проверки дословно. Проверка, которую нельзя повторить по сохранённому
 * адресу, для надзорного органа не доказательство.
 */
export function egovDataUrl(query: EgovQuery): string {
  assertDataset(query.dataset);
  assertVersion(query.version);
  const source = encodeURIComponent(JSON.stringify(buildEgovSource(query)));
  return `${API_ROOT}/api/v4/${query.dataset}/${query.version}?source=${source}`;
}

/**
 * Тот же запрос, но к «подробной» ветке: в ответе дополнительно приходит
 * общее число найденных записей. Нужен там, где важно отличить «нашли одну»
 * от «нашли одну из тысячи похожих».
 */
export function egovDetailedUrl(query: EgovQuery): string {
  assertDataset(query.dataset);
  assertVersion(query.version);
  const source = encodeURIComponent(JSON.stringify(buildEgovSource(query)));
  return `${API_ROOT}/api/detailed/${query.dataset}/${query.version}?source=${source}`;
}

/** Адрес описания полей набора: какие поля есть и какого они типа. */
export function egovMappingUrl(dataset: string): string {
  assertDataset(dataset);
  return `${API_ROOT}/api/v4/mapping/${dataset}`;
}

/** Адрес паспорта набора: название, описание, перечень полей с подписями. */
export function egovMetaUrl(dataset: string, version: string): string {
  assertDataset(dataset);
  assertVersion(version);
  return `${API_ROOT}/meta/${dataset}/${version}`;
}

/**
 * Человекочитаемая страница набора. Её показывают аналитику рядом с
 * результатом: он должен иметь возможность открыть первоисточник и
 * посмотреть глазами, а не верить нашему разбору на слово.
 */
export function egovDatasetPageUrl(dataset: string): string {
  assertDataset(dataset);
  return `${API_ROOT}/datasets/view?index=${dataset}`;
}

// ---------------------------------------------------------------------------
// Разбор ответа
// ---------------------------------------------------------------------------

export type EgovRecord = Readonly<Record<string, unknown>>;

export type EgovParseProblem =
  /** Тело ответа — не JSON. Обычно это страница ошибки или заглушка. */
  | 'NOT_JSON'
  /** JSON разобрался, но внутри не список записей. */
  | 'NOT_A_RECORD_LIST'
  /** Служба вернула JSON с описанием ошибки вместо данных. */
  | 'ERROR_PAYLOAD';

/**
 * Разбор ответа не удался. Текст написан так, чтобы его можно было показать
 * аналитику: он должен понять, что произошло, не заглядывая в журнал сервера.
 */
export class EgovParseError extends Error {
  readonly problem: EgovParseProblem;

  constructor(problem: EgovParseProblem, message: string) {
    super(message);
    this.name = 'EgovParseError';
    this.problem = problem;
  }
}

export interface EgovPage {
  readonly records: readonly EgovRecord[];
  /**
   * Общее число найденных записей. Приходит только из «подробной» ветки;
   * из обычной — null. Не подменяем его длиной списка: это разные величины,
   * и на экране они означают разное.
   */
  readonly totalCount: number | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Вытаскивает список записей из чего угодно, что служба назвала ответом.
 *
 * Обычная ветка отдаёт голый массив. Подробная — объект, внутри которого
 * массив лежит под одним из служебных имён. Перечень имён здесь
 * намеренно открытый: мы не видели документации, закрепляющей ровно одно,
 * и подстроиться под несколько дешевле, чем сломаться на показе.
 *
 * Чего модуль не делает: не превращает непонятный ответ в пустой список.
 * Пустой список означает «реестр ответил и записей нет», и присваивать это
 * значение неразобранному ответу — значит сфабриковать результат проверки.
 */
export function parseEgovResponse(body: string): EgovPage {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    const head = body.trim().slice(0, 120);
    throw new EgovParseError(
      'NOT_JSON',
      `Служба data.egov.kz вернула не JSON. Начало ответа: «${head}». ` +
        'Обычно так выглядит страница с ошибкой: проверьте имя набора и версию.',
    );
  }

  if (Array.isArray(payload)) {
    return { records: payload.filter(isPlainObject), totalCount: null };
  }

  if (!isPlainObject(payload)) {
    throw new EgovParseError(
      'NOT_A_RECORD_LIST',
      'Служба data.egov.kz вернула значение, которое не является ни списком записей, ни объектом с ними.',
    );
  }

  const errorText = payload.error ?? payload.message ?? payload.errorMessage;
  if (typeof errorText === 'string' && errorText.trim().length > 0 && !('items' in payload)) {
    throw new EgovParseError(
      'ERROR_PAYLOAD',
      `Служба data.egov.kz ответила ошибкой: «${errorText.trim()}».`,
    );
  }

  for (const key of ['items', 'records', 'data', 'hits', 'result'] as const) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      const totalCount = typeof payload.totalCount === 'number' ? payload.totalCount : null;
      return { records: candidate.filter(isPlainObject), totalCount };
    }
  }

  throw new EgovParseError(
    'NOT_A_RECORD_LIST',
    'В ответе data.egov.kz не нашлось списка записей. ' +
      `Пришли поля: ${Object.keys(payload).join(', ') || '— ни одного'}.`,
  );
}

// ---------------------------------------------------------------------------
// Карта полей набора
// ---------------------------------------------------------------------------

/**
 * Имена полей набора из ответа /api/v4/mapping.
 *
 * Зачем это отдельным шагом. Имя колонки с БИН в каждом наборе своё: bin,
 * BIN, bin_ul, bin_zastroyshika. Если подставить в запрос угаданное имя,
 * служба ответит не ошибкой, а пустым списком — и на экране надзорного органа
 * это прочитается как «записи нет», то есть как результат проверки. Поэтому
 * коннектор сначала спрашивает у портала, как поля называются на самом деле,
 * и только найдя подходящее, отправляет запрос. Не нашлось — проверка
 * заканчивается ответом «ответ не получен» с объяснением, а не пустотой.
 *
 * Форма карты полей в документации не закреплена, поэтому разбираются три
 * вида: голый массив имён, массив объектов с полем name и объект, ключи
 * которого и есть имена (в том числе вложенный в properties или mappings).
 */
export function parseEgovMapping(body: string): string[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    const head = body.trim().slice(0, 120);
    throw new EgovParseError(
      'NOT_JSON',
      `Карта полей набора пришла не в JSON. Начало ответа: «${head}».`,
    );
  }

  const names = collectFieldNames(payload, 0);
  if (names.length === 0) {
    throw new EgovParseError(
      'NOT_A_RECORD_LIST',
      'В карте полей набора не нашлось ни одного имени поля. Запрос по БИН не ' +
        'отправлен: без подтверждённого имени поля пустой ответ ничем не ' +
        'отличался бы от ответа «записи нет».',
    );
  }
  return names;
}

/** Разбор карты полей. Глубина ограничена: это описание набора, а не дерево данных. */
function collectFieldNames(payload: unknown, depth: number): string[] {
  if (depth > 3) return [];

  if (Array.isArray(payload)) {
    const out: string[] = [];
    for (const item of payload) {
      if (typeof item === 'string' && item.trim().length > 0) {
        out.push(item.trim());
        continue;
      }
      if (!isPlainObject(item)) continue;
      const name = item.name ?? item.field ?? item.column;
      if (typeof name === 'string' && name.trim().length > 0) out.push(name.trim());
    }
    return out;
  }

  if (!isPlainObject(payload)) return [];

  for (const wrapper of ['properties', 'mappings', 'fields', 'columns'] as const) {
    if (wrapper in payload) {
      const inner = collectFieldNames(payload[wrapper], depth + 1);
      if (inner.length > 0) return inner;
    }
  }

  // Последний вариант: ключи самого объекта и есть имена полей.
  return Object.keys(payload).filter((key) => key.trim().length > 0);
}

/**
 * Выбирает из карты полей то, которое подходит под одно из ожидаемых имён.
 *
 * Возвращается настоящее имя из набора, а не ожидаемое: в запрос должно уйти
 * то написание, которое признаёт портал. Сравнение идёт без учёта регистра
 * и разделителей — тем же способом, что и чтение значения из записи.
 */
export function resolveFieldName(
  available: readonly string[],
  candidates: readonly string[],
): string | null {
  const flatten = (name: string): string => name.toLowerCase().replace(/[_\s-]/g, '');
  const index = new Map<string, string>();
  for (const name of available) {
    const key = flatten(name);
    if (!index.has(key)) index.set(key, name);
  }
  for (const candidate of candidates) {
    const found = index.get(flatten(candidate));
    if (found !== undefined) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Чтение полей записи
// ---------------------------------------------------------------------------

/**
 * Достаёт значение поля, перебирая допустимые написания имени.
 *
 * Имена полей в наборах data.egov.kz пишут кто как: bin, BIN, bin_ul,
 * binZastroyshika. Жёстко зашить одно — значит получить пустой экран на
 * наборе, где написание другое, и принять это за отсутствие записи.
 * Сравнение идёт без учёта регистра и подчёркиваний.
 *
 * Возвращает undefined, если ни одно написание не нашлось. Это не то же
 * самое, что null или пустая строка: «поля нет в ответе» и «поле пустое» —
 * разные факты, и на экране они должны выглядеть по-разному.
 */
export function pickField(record: EgovRecord, candidates: readonly string[]): unknown {
  const flatten = (name: string): string => name.toLowerCase().replace(/[_\s-]/g, '');
  const index = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    index.set(flatten(key), value);
  }
  for (const candidate of candidates) {
    const found = index.get(flatten(candidate));
    if (found !== undefined) return found;
  }
  return undefined;
}

/** То же, но приводит найденное к непустой строке. Иначе undefined. */
export function pickText(record: EgovRecord, candidates: readonly string[]): string | undefined {
  const value = pickField(record, candidates);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/** То же, но приводит найденное к конечному числу. Иначе undefined. */
export function pickNumber(record: EgovRecord, candidates: readonly string[]): number | undefined {
  const value = pickField(record, candidates);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/\s/g, '').replace(',', '.');
    if (cleaned.length === 0) return undefined;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Готовые запросы
// ---------------------------------------------------------------------------

/**
 * Запрос к набору по БИН.
 *
 * Имя поля передаётся явно и не угадывается: в каждом наборе оно своё,
 * проверить его можно только по карте полей (egovMappingUrl), и подставлять
 * сюда догадку в инструменте надзорного органа недопустимо.
 */
export function binQuery(
  dataset: string,
  version: string,
  binField: string,
  bin: string,
  size = 10,
): EgovQuery {
  if (!/^\d{12}$/.test(bin)) {
    throw new EgovQueryError(
      `В запрос к реестру передан не БИН: «${bin}». Ожидается двенадцать цифр.`,
    );
  }
  return { dataset, version, match: { [binField]: bin }, size };
}
