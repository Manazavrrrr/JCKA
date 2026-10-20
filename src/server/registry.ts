/**
 * Слой реестров со стороны сервера: сеть, база и журнал действий.
 *
 * Граница с ядром та же, что и в слое сбора: здесь всё, чего нельзя
 * повторить в тесте — запрос к data.egov.kz, запись в базу, текущее время.
 * Решения — как сравнивать значения, что считать расхождением, влияет ли
 * ответ на фактор R1 — приняты в src/core/registry и сюда приходят готовыми.
 *
 * Четыре решения этого файла, которые стоит объяснить.
 *
 * Первое. Проверка сохраняется в любом исходе, включая неудачный, и
 * неудачная получает ответ UNAVAILABLE с текстом ошибки. Без такой записи
 * «служба не ответила» и «записи нет» выглядели бы на экране одинаково —
 * а это противоположные вещи: второе приближает к выводу, первое не
 * говорит вообще ничего.
 *
 * Второе. Перед запросом коннектор читает карту полей набора и выбирает
 * настоящее имя колонки с БИН. Это лишний сетевой вызов, и он здесь
 * намеренно: data.egov.kz на запрос по несуществующему полю отвечает не
 * ошибкой, а пустым списком, и без этой проверки опечатка в имени поля
 * превратилась бы в «записей нет», то есть в результат проверки, которой
 * не было.
 *
 * Третье. Вердикты сверки не читаются из базы, а пересчитываются функцией
 * reconcile при каждом показе. В базе лежат значения сторон — что сказала
 * карточка и что ответил реестр; как эти значения соотносятся, решает
 * ядро. Так правило сравнения остаётся одно на всю систему, и исправление
 * в ядре не оставляет позади старые строки с прежним вердиктом.
 *
 * Четвёртое. Контрольный разряд БИН проверяется, но не запрещает запрос.
 * Это сознательный выбор: БИН в карточку вносит человек, а инструмент
 * надзорного органа не должен отказываться отправлять запрос из-за
 * собственного подозрения. Несошедшийся разряд показывается
 * предупреждением рядом с результатом — проверять догадку будет аналитик.
 *
 * И общее: ни одна функция этого файла не меняет баллы. Ответ реестра
 * может дать основание снять фактор R1, но снимает его человек в карточке
 * объекта, обычным механизмом факторов, с записью в журнале.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import {
  type ComparedField,
  type CompareFieldInput,
  EgovParseError,
  EgovQueryError,
  type EgovRecord,
  type RegistryAnswer,
  type RegistrySource,
  binQuery,
  egovDetailedUrl,
  egovMappingUrl,
  fieldsFor,
  findRegistrySource,
  formatBin,
  hasValidBinChecksum,
  normalizeBin,
  parseEgovMapping,
  parseEgovResponse,
  pickText,
  reconcile,
  resolveFieldName,
} from '../core/registry';
import { writeAudit } from '../core/scoring/service';
import { HttpError, notFound } from './http';

export type Db = PrismaClient | Prisma.TransactionClient;

/** Сколько ждём ответ портала, мс. Дольше — считаем службу недоступной. */
const FETCH_TIMEOUT_MS = 20_000;

/** Как подписываемся при запросе к государственному порталу. */
const USER_AGENT = 'SAQ-QURYLYS/1.0 (regional housing oversight, open data client)';

// ---------------------------------------------------------------------------
// Чтение сохранённых проверок
// ---------------------------------------------------------------------------

export interface RegistryCheckFilters {
  sourceId?: string;
  developerId?: string;
  projectId?: string;
  limit: number;
  offset: number;
}

/** Строки сверки из базы. Хранятся значения сторон, вердикт считается заново. */
function storedRows(comparisonJson: string | null): CompareFieldInput[] {
  if (comparisonJson === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(comparisonJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const rows: CompareFieldInput[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Partial<ComparedField>;
    if (typeof row.key !== 'string' || typeof row.label !== 'object' || row.label === null) continue;
    rows.push({
      key: row.key,
      label: row.label,
      declared: row.declared ?? null,
      registry: row.registry ?? null,
    });
  }
  return rows;
}

export async function listRegistryChecks(db: Db, filters: RegistryCheckFilters) {
  const where = {
    ...(filters.sourceId && { sourceId: filters.sourceId }),
    ...(filters.developerId && { developerId: filters.developerId }),
    ...(filters.projectId && { projectId: filters.projectId }),
  };

  const [rows, total] = await Promise.all([
    db.registryCheck.findMany({
      where,
      orderBy: { checkedAt: 'desc' },
      take: filters.limit,
      skip: filters.offset,
      include: {
        developer: { select: { id: true, name: true, nameKk: true, bin: true } },
        project: { select: { id: true, slug: true, name: true, nameKk: true } },
      },
    }),
    db.registryCheck.count({ where }),
  ]);

  const checks = rows.map((row) => {
    const answer = row.answer as RegistryAnswer;
    // Вердикты считаются ядром здесь и сейчас — см. третье решение в заголовке.
    const result = reconcile(row.sourceId, answer, storedRows(row.comparisonJson));
    const source = findRegistrySource(row.sourceId);

    return {
      id: row.id,
      sourceId: row.sourceId,
      sourceName: source?.name ?? null,
      sourceAuthority: source?.authority ?? null,
      accessMode: source?.accessMode ?? null,
      bearing: source?.bearing ?? null,
      answer,
      bin: row.bin,
      binLooksValid: row.bin === null ? null : hasValidBinChecksum(row.bin),
      requestUrl: row.requestUrl,
      responseJson: row.responseJson,
      error: row.error,
      fields: result.fields,
      disagreements: result.disagreements,
      bearingOnR1: result.bearingOnR1,
      affectsScore: result.affectsScore,
      manual: row.manual,
      attachment: row.attachment,
      note: row.note,
      checkedAt: row.checkedAt,
      checkedBy: row.checkedBy,
      developer: row.developer,
      project: row.project,
    };
  });

  return { checks, total };
}

/** Застройщики для выпадающего списка на экране проверки. */
export async function listDevelopersForRegistry(db: Db) {
  const rows = await db.developer.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      nameKk: true,
      bin: true,
      projects: { select: { id: true, slug: true, name: true }, orderBy: { name: 'asc' } },
    },
  });

  return rows.map((row) => ({
    ...row,
    binFormatted: formatBin(row.bin),
    binLooksValid: hasValidBinChecksum(row.bin),
  }));
}

// ---------------------------------------------------------------------------
// Запрос к порталу
// ---------------------------------------------------------------------------

/** Ответ портала вместе с адресом: адрес нужен в карточке проверки. */
async function fetchText(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(
      'PRECONDITION',
      `Портал data.egov.kz не ответил на запрос ${url}: ${reason}.`,
    );
  }

  if (!response.ok) {
    throw new HttpError(
      'PRECONDITION',
      `Портал data.egov.kz ответил кодом ${response.status} на запрос ${url}.`,
    );
  }

  return response.text();
}

// ---------------------------------------------------------------------------
// Машинная проверка по БИН
// ---------------------------------------------------------------------------

export interface RunRegistryCheckInput {
  sourceId: string;
  developerId: string;
  /** Пусто, если проверка запущена из общего списка, а не с карточки ЖК. */
  projectId?: string;
  actor: string;
}

/** Что именно произошло при попытке спросить реестр. */
interface Attempt {
  answer: RegistryAnswer;
  requestUrl: string | null;
  requestJson: string | null;
  responseJson: string | null;
  error: string | null;
  record: EgovRecord | null;
  totalCount: number | null;
}

/**
 * Один проход: карта полей → запрос по БИН → разбор ответа.
 *
 * Любая неудача возвращается как UNAVAILABLE с человеческим текстом, а не
 * выбрасывается наружу: проверка должна сохраниться в базе в любом случае,
 * иначе на экране не останется следа попытки.
 */
async function askRegistry(source: RegistrySource, bin: string): Promise<Attempt> {
  const empty: Attempt = {
    answer: 'UNAVAILABLE',
    requestUrl: null,
    requestJson: null,
    responseJson: null,
    error: null,
    record: null,
    totalCount: null,
  };

  const map = fieldsFor(source.id);
  if (map === null || source.dataset === null || source.datasetVersion === null) {
    return {
      ...empty,
      error:
        `Для источника «${source.id}» не описано, как читать набор. ` +
        'Запрос не отправлен: без описания полей ответ разобрать нечем.',
    };
  }

  // Шаг 1. Спросить портал, как называются поля набора.
  const mappingUrl = egovMappingUrl(source.dataset);
  let available: string[];
  try {
    available = parseEgovMapping(await fetchText(mappingUrl));
  } catch (error) {
    return {
      ...empty,
      requestUrl: mappingUrl,
      error:
        error instanceof HttpError || error instanceof EgovParseError
          ? error.message
          : 'Не удалось прочитать карту полей набора.',
    };
  }

  const binField = resolveFieldName(available, map.bin);
  if (binField === null) {
    return {
      ...empty,
      requestUrl: mappingUrl,
      error:
        `В наборе «${source.dataset}» нет поля с БИН среди ожидаемых написаний ` +
        `(${map.bin.join(', ')}). Запрос не отправлен: по неизвестному полю служба ` +
        'вернула бы пустой список, а пустой список читается как «записи нет».',
    };
  }

  // Шаг 2. Запрос по подтверждённому имени поля.
  let dataUrl: string;
  let requestJson: string;
  try {
    const query = binQuery(source.dataset, source.datasetVersion, binField, bin, 5);
    dataUrl = egovDetailedUrl(query);
    requestJson = JSON.stringify({ dataset: query.dataset, version: query.version, match: query.match });
  } catch (error) {
    return {
      ...empty,
      requestUrl: mappingUrl,
      error: error instanceof EgovQueryError ? error.message : 'Запрос к реестру собрать не удалось.',
    };
  }

  let body: string;
  try {
    body = await fetchText(dataUrl);
  } catch (error) {
    return {
      ...empty,
      requestUrl: dataUrl,
      requestJson,
      error: error instanceof HttpError ? error.message : 'Служба реестра недоступна.',
    };
  }

  // Шаг 3. Разбор. Неразобранный ответ — это UNAVAILABLE, а не пустой список.
  try {
    const page = parseEgovResponse(body);
    const record = page.records[0] ?? null;
    return {
      answer: record === null ? 'NOT_FOUND' : 'FOUND',
      requestUrl: dataUrl,
      requestJson,
      responseJson: JSON.stringify(page.records.slice(0, 5)),
      error: null,
      record,
      totalCount: page.totalCount,
    };
  } catch (error) {
    return {
      ...empty,
      requestUrl: dataUrl,
      requestJson,
      responseJson: body.slice(0, 2000),
      error: error instanceof EgovParseError ? error.message : 'Ответ реестра разобрать не удалось.',
    };
  }
}

export async function runRegistryCheck(db: PrismaClient, input: RunRegistryCheckInput) {
  const source = findRegistrySource(input.sourceId);
  if (source === null) throw notFound('Источник реестра');

  if (source.accessMode !== 'OPEN_API') {
    throw new HttpError(
      'PRECONDITION',
      `Источник «${source.name.ru}» машинного доступа не имеет: ` +
        `${source.limitation?.ru ?? 'открытого API нет'} ` +
        'Выписку получает аналитик и заносит её как ручную проверку.',
    );
  }

  const developer = await db.developer.findUnique({
    where: { id: input.developerId },
    select: { id: true, name: true, bin: true },
  });
  if (developer === null) throw notFound('Застройщик');

  const bin = normalizeBin(developer.bin);
  if (bin === null) {
    throw new HttpError(
      'PRECONDITION',
      `В карточке застройщика «${developer.name}» записан БИН «${developer.bin}», ` +
        'в котором не двенадцать цифр. Запрос по такому БИН отправить нельзя.',
    );
  }

  if (input.projectId !== undefined) {
    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { id: true },
    });
    if (project === null) throw notFound('Объект');
  }

  const attempt = await askRegistry(source, bin);
  const map = fieldsFor(source.id);

  // Строки сверки: слева карточка, справа ответ реестра.
  const rows: CompareFieldInput[] = (map?.compare ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    declared: field.key === 'bin' ? bin : field.key === 'name' ? developer.name : null,
    registry: attempt.record === null ? null : (pickText(attempt.record, field.candidates) ?? null),
  }));

  const result = reconcile(source.id, attempt.answer, rows);

  const check = await db.$transaction(async (tx) => {
    const created = await tx.registryCheck.create({
      data: {
        sourceId: source.id,
        developerId: developer.id,
        projectId: input.projectId ?? null,
        bin,
        requestUrl: attempt.requestUrl,
        requestJson: attempt.requestJson,
        answer: attempt.answer,
        responseJson: attempt.responseJson,
        error: attempt.error,
        comparisonJson: result.fields.length > 0 ? JSON.stringify(result.fields) : null,
        disagreements: result.disagreements,
        bearingOnR1: result.bearingOnR1,
        manual: false,
        note: null,
        checkedBy: input.actor,
        isDemo: false,
      },
    });

    await writeAudit(tx, {
      entityType: 'RegistryCheck',
      entityId: created.id,
      action: 'REGISTRY_CHECK_RUN',
      actor: input.actor,
      after: {
        sourceId: source.id,
        bin,
        answer: attempt.answer,
        disagreements: result.disagreements,
        bearingOnR1: result.bearingOnR1,
        requestUrl: attempt.requestUrl,
      },
      comment:
        `Проверка «${source.name.ru}» по БИН ${formatBin(bin)}: ` +
        `${attempt.answer === 'FOUND' ? 'запись найдена' : attempt.answer === 'NOT_FOUND' ? 'записи нет' : 'ответ не получен'}. ` +
        'На балл проверка не влияет.',
    });

    return created;
  });

  return {
    id: check.id,
    sourceId: source.id,
    answer: attempt.answer,
    error: attempt.error,
    requestUrl: attempt.requestUrl,
    totalCount: attempt.totalCount,
    fields: result.fields,
    disagreements: result.disagreements,
    bearingOnR1: result.bearingOnR1,
    affectsScore: result.affectsScore,
    binLooksValid: hasValidBinChecksum(bin),
  };
}

// ---------------------------------------------------------------------------
// Ручная проверка
// ---------------------------------------------------------------------------

export interface ManualCheckInput {
  sourceId: string;
  developerId: string;
  projectId?: string;
  answer: RegistryAnswer;
  note: string;
  attachment?: string;
  requestUrl?: string;
  comparison?: Array<{
    key: string;
    labelRu: string;
    labelKk: string;
    declared: string | null;
    registry: string | null;
  }>;
  actor: string;
}

/**
 * Занесение проверки, сделанной человеком глазами.
 *
 * Пояснение обязательно и не имеет значения по умолчанию. Ручная проверка
 * — это утверждение аналитика о том, что он видел на чужом сайте; без
 * текста о том, что именно он там искал и нашёл, через месяц такая запись
 * неотличима от нажатой случайно кнопки.
 *
 * Ответ FOUND по источнику правового основания снимает R1 — и снимает его
 * не эта функция, а аналитик в карточке объекта. Здесь только фиксируется
 * основание, и в ответе оно названо прямо, чтобы на экране было видно, что
 * делать дальше.
 */
export async function recordManualCheck(db: PrismaClient, input: ManualCheckInput) {
  const source = findRegistrySource(input.sourceId);
  if (source === null) throw notFound('Источник реестра');

  const note = input.note.trim();
  if (note.length < 10) {
    throw new HttpError(
      'VALIDATION',
      'Опишите, что именно проверено и что найдено: не меньше десяти символов. ' +
        'Запись без пояснения через месяц невозможно отличить от ошибочной.',
    );
  }

  const developer = await db.developer.findUnique({
    where: { id: input.developerId },
    select: { id: true, name: true, bin: true },
  });
  if (developer === null) throw notFound('Застройщик');

  if (input.projectId !== undefined) {
    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { id: true },
    });
    if (project === null) throw notFound('Объект');
  }

  const rows: CompareFieldInput[] = (input.comparison ?? []).map((row) => ({
    key: row.key,
    label: { ru: row.labelRu, kk: row.labelKk },
    declared: row.declared,
    registry: row.registry,
  }));

  const result = reconcile(source.id, input.answer, rows);

  const check = await db.$transaction(async (tx) => {
    const created = await tx.registryCheck.create({
      data: {
        sourceId: source.id,
        developerId: developer.id,
        projectId: input.projectId ?? null,
        bin: normalizeBin(developer.bin),
        requestUrl: input.requestUrl ?? source.reference,
        requestJson: null,
        answer: input.answer,
        responseJson: null,
        error: null,
        comparisonJson: result.fields.length > 0 ? JSON.stringify(result.fields) : null,
        disagreements: result.disagreements,
        bearingOnR1: result.bearingOnR1,
        manual: true,
        attachment: input.attachment?.trim() || null,
        note,
        checkedBy: input.actor,
        isDemo: false,
      },
    });

    await writeAudit(tx, {
      entityType: 'RegistryCheck',
      entityId: created.id,
      action: 'REGISTRY_CHECK_RECORDED',
      actor: input.actor,
      after: {
        sourceId: source.id,
        answer: input.answer,
        attachment: created.attachment,
        bearingOnR1: result.bearingOnR1,
      },
      comment: `Ручная проверка «${source.name.ru}»: ${note}`,
    });

    return created;
  });

  return {
    id: check.id,
    sourceId: source.id,
    answer: input.answer,
    fields: result.fields,
    disagreements: result.disagreements,
    bearingOnR1: result.bearingOnR1,
    affectsScore: result.affectsScore,
  };
}
