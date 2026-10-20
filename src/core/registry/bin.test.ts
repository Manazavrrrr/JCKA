/**
 * Тесты разбора БИН.
 *
 * Контрольные номера взяты не из жизни, а собраны по самому алгоритму:
 * брать настоящие БИН действующих организаций в тесты надзорного
 * инструмента незачем, а проверяется здесь арифметика, а не чей-то факт
 * регистрации. Номера, у которых контрольный разряд намеренно испорчен,
 * получены из верных заменой последней цифры.
 */

import { describe, expect, it } from 'vitest';

import {
  binSubjectKind,
  binUnitKind,
  formatBin,
  hasValidBinChecksum,
  isSubdivisionBin,
  normalizeBin,
  parseBin,
} from './bin';

/** Досчитывает двенадцатый разряд по одиннадцати заданным. */
function withChecksum(eleven: string): string {
  const digits = [...eleven].map(Number);
  const weighted = (weights: number[]): number =>
    digits.reduce((sum, digit, index) => sum + digit * (weights[index] ?? 0), 0) % 11;

  let remainder = weighted([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  if (remainder === 10) remainder = weighted([3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]);
  return `${eleven}${remainder}`;
}

const VALID = withChecksum('04054000123');

describe('приведение БИН к единому виду', () => {
  it('снимает пробелы, дефисы и подписи', () => {
    expect(normalizeBin(` БИН ${VALID.slice(0, 3)} ${VALID.slice(3, 6)}-${VALID.slice(6)} `)).toBe(
      VALID,
    );
  });

  it('отказывает, если цифр не двенадцать', () => {
    expect(normalizeBin('12345678901')).toBeNull();
    expect(normalizeBin('1234567890123')).toBeNull();
    expect(normalizeBin('')).toBeNull();
    expect(normalizeBin('ТОО Монтероса')).toBeNull();
  });
});

describe('контрольный разряд', () => {
  it('принимает правильно посчитанный номер', () => {
    expect(hasValidBinChecksum(VALID)).toBe(true);
  });

  it('отвергает номер с испорченным последним разрядом', () => {
    const broken = `${VALID.slice(0, 11)}${(Number(VALID[11]) + 1) % 10}`;
    expect(hasValidBinChecksum(broken)).toBe(false);
  });

  it('ловит перестановку соседних цифр', () => {
    // Перестановка двух соседних разрядов меняет взвешенную сумму на разность
    // этих цифр, то есть почти всегда сбивает остаток. Берём заведомо разные.
    const swapped = `${VALID.slice(0, 2)}${VALID[3]}${VALID[2]}${VALID.slice(4)}`;
    expect(VALID[2]).not.toBe(VALID[3]);
    expect(hasValidBinChecksum(swapped)).toBe(false);
  });

  it('не принимает строку не из двенадцати цифр', () => {
    expect(hasValidBinChecksum('12345678901')).toBe(false);
    expect(hasValidBinChecksum('abcdefghijkl')).toBe(false);
  });

  it('разбор за один шаг совпадает с двумя', () => {
    expect(parseBin(` ${VALID} `)).toBe(VALID);
    expect(parseBin('000000000000')).toBe('000000000000');
    expect(parseBin('111111111111')).toBeNull();
  });
});

describe('что читается из самого номера', () => {
  it('пятый разряд даёт тип субъекта', () => {
    expect(binSubjectKind(withChecksum('04054000123'))).toBe('RESIDENT');
    expect(binSubjectKind(withChecksum('04055000123'))).toBe('NON_RESIDENT');
    expect(binSubjectKind(withChecksum('04056000123'))).toBe('JOINT_VENTURE');
  });

  it('неизвестный код — это null, а не ошибка', () => {
    expect(binSubjectKind(withChecksum('04059000123'))).toBeNull();
    expect(binUnitKind(withChecksum('04054900123'))).toBeNull();
  });

  it('шестой разряд отличает филиал от головной организации', () => {
    expect(binUnitKind(withChecksum('04054000123'))).toBe('HEAD');
    expect(binUnitKind(withChecksum('04054100123'))).toBe('BRANCH');
    expect(binUnitKind(withChecksum('04054200123'))).toBe('REPRESENTATION');

    expect(isSubdivisionBin(withChecksum('04054000123'))).toBe(false);
    expect(isSubdivisionBin(withChecksum('04054100123'))).toBe(true);
    expect(isSubdivisionBin(withChecksum('04054200123'))).toBe(true);
  });

  it('запись для показа разбита по три цифры', () => {
    expect(formatBin('123456789012')).toBe('123 456 789 012');
  });
});
