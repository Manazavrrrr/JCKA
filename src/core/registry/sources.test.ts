/**
 * Тесты каталога реестров.
 *
 * Проверяется честность описания, а не поведение. Источник, который нельзя
 * читать машиной, обязан нести при себе причину: иначе через месяц в
 * каталоге появится строка «только вручную» без объяснения, и отличить
 * продуманное ограничение от недоделанного коннектора станет невозможно.
 *
 * Отдельно закреплено главное ограничение слоя: на правовое основание
 * работает только R1, а сведения о застройщике — налоги, ГБД ЮЛ,
 * аттестаты — не влияют на оценку вообще. Шкала на сто баллов
 * откалибрована под шесть факторов, и седьмой в неё не поместится.
 */

import { describe, expect, it } from 'vitest';

import {
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
  rejectedRegistrySources,
  sourcesByBearing,
} from './sources';

describe('каталог реестров', () => {
  it('идентификаторы уникальны', () => {
    const ids = REGISTRY_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('название, орган и состав сведений заполнены на обоих языках', () => {
    for (const source of REGISTRY_SOURCES) {
      for (const field of ['name', 'authority', 'provides'] as const) {
        expect(source[field].ru.length, `${source.id}.${field}.ru`).toBeGreaterThan(0);
        expect(source[field].kk.length, `${source.id}.${field}.kk`).toBeGreaterThan(0);
      }
    }
  });

  it('у каждого источника есть ссылка на первоисточник', () => {
    for (const source of REGISTRY_SOURCES) {
      expect(source.reference, `источник ${source.id}`).toMatch(/^https:\/\//);
    }
  });

  it('подписи и пояснения есть для каждого режима и назначения', () => {
    for (const mode of REGISTRY_ACCESS_MODES) {
      expect(REGISTRY_ACCESS_MODE_LABELS[mode].kk.length).toBeGreaterThan(0);
      expect(REGISTRY_ACCESS_MODE_HINTS[mode].ru.length).toBeGreaterThan(20);
    }
    for (const bearing of REGISTRY_BEARINGS) {
      expect(REGISTRY_BEARING_LABELS[bearing].kk.length).toBeGreaterThan(0);
      expect(REGISTRY_BEARING_HINTS[bearing].ru.length).toBeGreaterThan(20);
    }
  });
});

describe('режимы доступа', () => {
  it('машинный источник знает своё имя набора и версию', () => {
    const machine = machineReadableSources();
    expect(machine.length).toBeGreaterThan(0);

    for (const source of machine) {
      expect(source.dataset, `источник ${source.id}`).toMatch(/^[a-z0-9_]+$/i);
      expect(source.datasetVersion, `источник ${source.id}`).toMatch(/^v\d+$/);
      expect(source.limitation, `источник ${source.id}`).toBeNull();
    }
  });

  it('у ручного источника есть причина на обоих языках', () => {
    const manual = manualRegistrySources();
    expect(manual.length).toBeGreaterThan(0);

    for (const source of manual) {
      expect(source.limitation, `источник ${source.id} без объяснения`).not.toBeNull();
      expect(source.limitation?.ru.length ?? 0).toBeGreaterThan(40);
      expect(source.limitation?.kk.length ?? 0).toBeGreaterThan(40);
      expect(source.dataset, `источник ${source.id}`).toBeNull();
    }
  });

  it('отклонённый источник объясняет, почему он отклонён', () => {
    const rejected = rejectedRegistrySources();
    expect(rejected.length).toBeGreaterThan(0);

    for (const source of rejected) {
      expect(source.limitation?.ru.length ?? 0).toBeGreaterThan(40);
    }
  });

  it('режимы не пересекаются и покрывают весь каталог', () => {
    const total =
      machineReadableSources().length +
      manualRegistrySources().length +
      rejectedRegistrySources().length;
    expect(total).toBe(REGISTRY_SOURCES.length);
  });
});

describe('что к чему относится', () => {
  it('разрешения МИО нигде не читаются машиной', () => {
    for (const source of sourcesByBearing('LEGAL_BASIS')) {
      expect(source.accessMode, `источник ${source.id}`).not.toBe('OPEN_API');
    }
  });

  it('сведения о застройщике — это именно то, что читается машиной', () => {
    expect(machineReadableSources().every((source) => source.bearing === 'DEVELOPER_PROFILE')).toBe(
      true,
    );
  });

  it('оба назначения представлены', () => {
    expect(sourcesByBearing('LEGAL_BASIS').length).toBeGreaterThan(0);
    expect(sourcesByBearing('DEVELOPER_PROFILE').length).toBeGreaterThan(0);
  });
});

describe('отдельные источники', () => {
  it('реестр уведомлений о начале СМР помечен как заброшенный', () => {
    const smr = findRegistrySource('egov-smr-notices');

    expect(smr?.accessMode).toBe('ARCHIVED');
    expect(smr?.limitation?.ru).toContain('2021');
    expect(smr?.limitation?.ru).toContain('Алмат');
  });

  it('набор Ashyq Data честно сообщает про хеш БИН', () => {
    const ashyq = findRegistrySource('ashyq-equity-objects');

    expect(ashyq?.accessMode).toBe('WEB_ONLY');
    expect(ashyq?.limitation?.ru).toContain('хеш');
  });

  it('elicense отмечен как закрытый проверкой на робота', () => {
    expect(findRegistrySource('elicense')?.accessMode).toBe('WEB_ONLY');
  });

  it('несуществующий источник возвращает null', () => {
    expect(findRegistrySource('нет такого')).toBeNull();
  });
});
