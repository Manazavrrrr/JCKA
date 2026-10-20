/**
 * Тесты сверки.
 *
 * Самые важные здесь — не про сравнение строк, а про то, чего сверка
 * делать не должна: начислять R1 по ответу «нет данных», начислять R1 по
 * недоступности службы, вообще трогать баллы. Эти три запрета — то, за что
 * инструмент надзорного органа будут проверять в первую очередь, и
 * держаться они должны на тестах, а не на добрых намерениях.
 */

import { describe, expect, it } from 'vitest';

import {
  bearingOnR1,
  compareFields,
  compareValues,
  countDisagreements,
  normalizeForComparison,
  reconcile,
} from './check';
import { REGISTRY_SOURCES, sourcesByBearing } from './sources';

const LABEL = { ru: 'Застройщик', kk: 'Құрылыс салушы' };

describe('отношение ответа к фактору R1', () => {
  it('«нет данных» не даёт оснований ни по одному источнику', () => {
    for (const source of REGISTRY_SOURCES) {
      expect(bearingOnR1(source.id, 'NOT_FOUND'), `источник ${source.id}`).toBe('NO_BEARING');
    }
  });

  it('недоступность службы не даёт оснований ни по одному источнику', () => {
    for (const source of REGISTRY_SOURCES) {
      expect(bearingOnR1(source.id, 'UNAVAILABLE'), `источник ${source.id}`).toBe('NO_BEARING');
    }
  });

  it('найденное разрешение снимает R1', () => {
    for (const source of sourcesByBearing('LEGAL_BASIS')) {
      expect(bearingOnR1(source.id, 'FOUND'), `источник ${source.id}`).toBe('WITHDRAWS_R1');
    }
  });

  it('сведения о застройщике на R1 не влияют даже при найденной записи', () => {
    for (const source of sourcesByBearing('DEVELOPER_PROFILE')) {
      expect(bearingOnR1(source.id, 'FOUND'), `источник ${source.id}`).toBe('NO_BEARING');
    }
  });

  it('неизвестный источник ничего не начисляет', () => {
    expect(bearingOnR1('нет такого', 'FOUND')).toBe('NO_BEARING');
  });
});

describe('приведение значений к сравнимому виду', () => {
  it('регистр, кавычки и лишние пробелы не считаются расхождением', () => {
    expect(compareValues('ТОО «Монтероса»', 'тоо "монтероса"')).toBe('MATCH');
    expect(compareValues('ТОО  Монтероса ', 'ТОО Монтероса')).toBe('MATCH');
  });

  it('развёрнутая и сокращённая форма — одно и то же', () => {
    expect(
      compareValues('Товарищество с ограниченной ответственностью «Монтероса»', 'ТОО «Монтероса»'),
    ).toBe('MATCH');
  });

  it('разная организационно-правовая форма — это расхождение', () => {
    expect(compareValues('ТОО «Монтероса»', 'АО «Монтероса»')).toBe('MISMATCH');
  });

  it('«е» и «ё» не ссорят записи', () => {
    expect(normalizeForComparison('Берёзовая')).toBe(normalizeForComparison('Березовая'));
  });

  it('цифры и порядок слов не трогаются', () => {
    expect(compareValues('дом 12', 'дом 21')).toBe('MISMATCH');
    expect(compareValues('Монтероса Сити', 'Сити Монтероса')).toBe('MISMATCH');
  });

  it('отсутствие значения различается по стороне', () => {
    expect(compareValues('ТОО Пример', null)).toBe('ONLY_IN_CARD');
    expect(compareValues('   ', 'ТОО Пример')).toBe('ONLY_IN_REGISTRY');
    expect(compareValues(null, undefined)).toBe('ABSENT_BOTH');
  });
});

describe('строки сверки', () => {
  it('расхождением считается только прямое несовпадение', () => {
    const fields = compareFields([
      { key: 'developer', label: LABEL, declared: 'ТОО А', registry: 'ТОО Б' },
      { key: 'permit', label: LABEL, declared: '№ 12', registry: null },
      { key: 'address', label: LABEL, declared: null, registry: 'ул. Абая, 1' },
      { key: 'term', label: LABEL, declared: null, registry: null },
    ]);

    expect(fields.map((field) => field.verdict)).toEqual([
      'MISMATCH',
      'ONLY_IN_CARD',
      'ONLY_IN_REGISTRY',
      'ABSENT_BOTH',
    ]);
    expect(countDisagreements(fields)).toBe(1);
  });
});

describe('итог сверки', () => {
  const rows = [
    { key: 'developer', label: LABEL, declared: 'ТОО А', registry: 'ТОО Б' },
  ] as const;

  it('сверка не влияет на баллы', () => {
    expect(reconcile('egov-legal-entities', 'FOUND', rows).affectsScore).toBe(false);
  });

  it('без ответа сторона реестра пуста, а не взята из прошлого раза', () => {
    const result = reconcile('egov-legal-entities', 'UNAVAILABLE', rows);

    expect(result.fields[0]?.registry).toBeNull();
    expect(result.fields[0]?.verdict).toBe('ONLY_IN_CARD');
    expect(result.disagreements).toBe(0);
  });

  it('расхождение считается только при полученном ответе', () => {
    expect(reconcile('egov-legal-entities', 'FOUND', rows).disagreements).toBe(1);
    expect(reconcile('egov-legal-entities', 'NOT_FOUND', rows).disagreements).toBe(0);
  });

  it('отношение к R1 переносится в итог', () => {
    expect(reconcile('homeportal', 'FOUND', rows).bearingOnR1).toBe('WITHDRAWS_R1');
    expect(reconcile('homeportal', 'NOT_FOUND', rows).bearingOnR1).toBe('NO_BEARING');
  });
});
