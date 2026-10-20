/**
 * Тесты карты полей.
 *
 * Проверяется связность, а не содержание: описание поля существует только
 * для того источника, который машина действительно читает, и наоборот —
 * у каждого читаемого источника описание есть. Иначе коннектор однажды
 * пойдёт в набор, про который ничего не знает, и вернёт пустоту.
 *
 * Отдельно закреплено, что БИН входит в сверяемые строки каждого набора.
 * Отбор идёт по БИН, и если ответ пришёл с другим БИН, это первое, что
 * аналитик обязан увидеть.
 */

import { describe, expect, it } from 'vitest';

import { DATASET_FIELDS, allFieldsOf, fieldsFor } from './fields';
import { machineReadableSources } from './sources';

describe('карта полей', () => {
  it('описание есть ровно у машинно читаемых источников', () => {
    const described = DATASET_FIELDS.map((item) => item.sourceId).sort();
    const machine = machineReadableSources()
      .map((source) => source.id)
      .sort();

    expect(described).toEqual(machine);
  });

  it('у каждого набора есть ожидаемые написания БИН', () => {
    for (const item of DATASET_FIELDS) {
      expect(item.bin.length, `набор ${item.sourceId}`).toBeGreaterThan(0);
    }
  });

  it('БИН всегда сверяется, а не показывается справкой', () => {
    for (const item of DATASET_FIELDS) {
      const keys = item.compare.map((field) => field.key);
      expect(keys, `набор ${item.sourceId}`).toContain('bin');
    }
  });

  it('подписи заполнены на обоих языках и имена строк не повторяются', () => {
    for (const item of DATASET_FIELDS) {
      const keys = allFieldsOf(item).map((field) => field.key);
      expect(new Set(keys).size, `набор ${item.sourceId}`).toBe(keys.length);

      for (const field of allFieldsOf(item)) {
        expect(field.label.ru.length, `${item.sourceId}.${field.key}.ru`).toBeGreaterThan(0);
        expect(field.label.kk.length, `${item.sourceId}.${field.key}.kk`).toBeGreaterThan(0);
        expect(field.candidates.length, `${item.sourceId}.${field.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('у неизвестного источника описания нет', () => {
    expect(fieldsFor('homeportal')).toBeNull();
    expect(fieldsFor('нет такого')).toBeNull();
  });
});
