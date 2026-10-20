/**
 * БИН застройщика: приведение к единому виду и проверка контрольного разряда.
 *
 * Зачем вообще отдельный модуль. Сверка с реестром идёт по БИН, и это
 * единственный ключ, который связывает объявление, карточку ЖК и ответ
 * государственной базы. Если в ЖК записан БИН с опечаткой, запрос в реестр
 * вернёт пустоту — а пустой ответ на экране надзорного органа читается как
 * «нарушений не найдено». Это ровно та тихая ошибка, которой в проекте быть
 * не должно: лучше отказать на вводе с внятным текстом, чем показать
 * успокаивающий ноль.
 *
 * Контрольный разряд ловит именно опечатки: переставленные цифры, сбитый
 * знак, лишний пробел. Он не доказывает, что организация существует, —
 * это отвечает уже реестр. Поэтому проверка здесь называется честно:
 * «похоже на БИН», а не «БИН действителен».
 *
 * Модуль чистый: ни сети, ни Prisma, ни текущего времени.
 */

// ---------------------------------------------------------------------------
// Приведение к единому виду
// ---------------------------------------------------------------------------

/**
 * Вынимает из введённого аналитиком двенадцать цифр.
 *
 * Человек копирует БИН откуда придётся: «БИН 123 456 789 012»,
 * «123456789012.», «БСН: 123-456-789-012». Всё это один и тот же номер,
 * и требовать ручной чистки незачем. Возвращает null, если после чистки
 * цифр не ровно двенадцать: это уже не опечатка в разделителях, а другой
 * номер, и молча его подрезать нельзя.
 */
export function normalizeBin(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return digits.length === 12 ? digits : null;
}

// ---------------------------------------------------------------------------
// Контрольный разряд
// ---------------------------------------------------------------------------

/** Веса первого прохода: 1…11 по одиннадцати значащим разрядам. */
const WEIGHTS_FIRST = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/** Веса второго прохода. Применяются, только если первый дал остаток 10. */
const WEIGHTS_SECOND = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2] as const;

function weightedRemainder(digits: readonly number[], weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < 11; i += 1) {
    sum += (digits[i] ?? 0) * (weights[i] ?? 0);
  }
  return sum % 11;
}

/**
 * Проверяет контрольный разряд двенадцатизначного номера.
 *
 * Схема общая для БИН и ИИН: одиннадцать первых разрядов взвешиваются
 * весами 1…11, остаток от деления на 11 и есть двенадцатый разряд. Если
 * остаток вышел равным 10, разряд так записать нельзя, и счёт повторяется
 * со вторым набором весов. Если и там 10 — такой номер не выдаётся.
 *
 * На вход ожидается уже очищенная строка из двенадцати цифр
 * (см. normalizeBin). Всё остальное — false.
 */
export function hasValidBinChecksum(bin: string): boolean {
  if (!/^\d{12}$/.test(bin)) return false;

  const digits = [...bin].map((character) => Number(character));

  let remainder = weightedRemainder(digits, WEIGHTS_FIRST);
  if (remainder === 10) {
    remainder = weightedRemainder(digits, WEIGHTS_SECOND);
  }
  if (remainder === 10) return false;

  return remainder === digits[11];
}

/**
 * Приводит введённое к виду БИН и проверяет контрольный разряд за один шаг.
 * Возвращает чистые двенадцать цифр или null.
 */
export function parseBin(input: string): string | null {
  const normalized = normalizeBin(input);
  if (normalized === null) return null;
  return hasValidBinChecksum(normalized) ? normalized : null;
}

// ---------------------------------------------------------------------------
// Что можно прочитать из самого номера
// ---------------------------------------------------------------------------

export const BIN_SUBJECT_KINDS = ['RESIDENT', 'NON_RESIDENT', 'JOINT_VENTURE'] as const;
export type BinSubjectKind = (typeof BIN_SUBJECT_KINDS)[number];

export const BIN_UNIT_KINDS = ['HEAD', 'BRANCH', 'REPRESENTATION', 'FARM'] as const;
export type BinUnitKind = (typeof BIN_UNIT_KINDS)[number];

/**
 * Пятый разряд БИН кодирует тип субъекта, шестой — тип подразделения.
 *
 * Зачем это надзорному органу: БИН филиала и БИН головной организации —
 * разные номера, и запрос по филиалу вернёт не ту карточку. Если аналитик
 * ввёл БИН филиала, экран должен сказать об этом прямо, а не выдать
 * «данных нет».
 *
 * Разбор остаётся подсказкой, а не проверкой: неизвестный код возвращает
 * null, и это не повод отказать во вводе. Номер мог быть выдан по правилам,
 * которых мы здесь не знаем, и выдумывать на этом основании ошибку нельзя.
 */
export function binSubjectKind(bin: string): BinSubjectKind | null {
  switch (bin[4]) {
    case '4':
      return 'RESIDENT';
    case '5':
      return 'NON_RESIDENT';
    case '6':
      return 'JOINT_VENTURE';
    default:
      return null;
  }
}

export function binUnitKind(bin: string): BinUnitKind | null {
  switch (bin[5]) {
    case '0':
      return 'HEAD';
    case '1':
      return 'BRANCH';
    case '2':
      return 'REPRESENTATION';
    case '3':
      return 'FARM';
    default:
      return null;
  }
}

/** Это БИН не головной организации, а обособленного подразделения. */
export function isSubdivisionBin(bin: string): boolean {
  const unit = binUnitKind(bin);
  return unit === 'BRANCH' || unit === 'REPRESENTATION';
}

/** Запись для показа: 123456789012 → «123 456 789 012». */
export function formatBin(bin: string): string {
  return bin.replace(/(\d{3})(?=\d)/g, '$1 ');
}
