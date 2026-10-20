/**
 * Тесты клиента data.egov.kz.
 *
 * Сети здесь нет и быть не должно: проверяется, что адрес собирается
 * предсказуемо и что непонятный ответ превращается в ошибку, а не в пустой
 * список. Второе важнее первого. Пустой список на экране надзорного органа
 * читается как «нарушений не найдено», и если туда попадёт страница ошибки,
 * разобранная «как получится», инструмент начнёт врать молча.
 */

import { describe, expect, it } from 'vitest';

import {
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
  pickNumber,
  pickText,
  resolveFieldName,
} from './egov';

describe('сборка условий отбора', () => {
  it('без условий отдаёт только размер и смещение', () => {
    expect(buildEgovSource({ dataset: 'gbd_ul', version: 'v1' })).toEqual({ size: 10, from: 0 });
  });

  it('условия складываются по И', () => {
    const source = buildEgovSource({
      dataset: 'gbd_ul',
      version: 'v1',
      match: { bin: '123456789012', region: 'ВКО' },
      size: 25,
      from: 50,
    });

    expect(source).toEqual({
      size: 25,
      from: 50,
      query: {
        bool: {
          must: [{ match: { bin: '123456789012' } }, { match: { region: 'ВКО' } }],
        },
      },
    });
  });

  it('отказывает на размере страницы сверх потолка', () => {
    expect(() =>
      buildEgovSource({ dataset: 'gbd_ul', version: 'v1', size: EGOV_MAX_PAGE_SIZE + 1 }),
    ).toThrow(EgovQueryError);
    expect(() => buildEgovSource({ dataset: 'gbd_ul', version: 'v1', size: 0 })).toThrow(
      EgovQueryError,
    );
  });

  it('отказывает на отрицательном смещении', () => {
    expect(() => buildEgovSource({ dataset: 'gbd_ul', version: 'v1', from: -1 })).toThrow(
      EgovQueryError,
    );
  });
});

describe('адреса', () => {
  it('адрес выборки собирается с экранированным параметром', () => {
    const url = egovDataUrl({ dataset: 'gbd_ul', version: 'v1', match: { bin: '123456789012' } });

    expect(url.startsWith('https://data.egov.kz/api/v4/gbd_ul/v1?source=')).toBe(true);
    expect(url).not.toContain('{');
    expect(url).not.toContain(' ');

    const source = new URL(url).searchParams.get('source') ?? '';
    expect(JSON.parse(source)).toMatchObject({
      query: { bool: { must: [{ match: { bin: '123456789012' } }] } },
    });
  });

  it('подробная ветка отличается только путём', () => {
    const query = { dataset: 'gbd_ul', version: 'v1' } as const;
    expect(egovDetailedUrl(query)).toContain('/api/detailed/gbd_ul/v1');
    expect(new URL(egovDetailedUrl(query)).searchParams.get('source')).toBe(
      new URL(egovDataUrl(query)).searchParams.get('source'),
    );
  });

  it('служебные адреса собираются по тем же именам', () => {
    expect(egovMappingUrl('gbd_ul')).toBe('https://data.egov.kz/api/v4/mapping/gbd_ul');
    expect(egovMetaUrl('gbd_ul', 'v91')).toBe('https://data.egov.kz/meta/gbd_ul/v91');
    expect(egovDatasetPageUrl('gbd_ul')).toBe('https://data.egov.kz/datasets/view?index=gbd_ul');
  });

  it('чужой путь в имя набора не подставить', () => {
    expect(() => egovDataUrl({ dataset: '../../etc/passwd', version: 'v1' })).toThrow(
      EgovQueryError,
    );
    expect(() => egovDataUrl({ dataset: 'gbd_ul', version: '1' })).toThrow(EgovQueryError);
    expect(() => egovMappingUrl('gbd ul')).toThrow(EgovQueryError);
  });
});

describe('разбор ответа', () => {
  it('голый массив — это страница без общего счёта', () => {
    const page = parseEgovResponse('[{"bin":"123456789012","name":"ТОО Пример"}]');

    expect(page.records).toHaveLength(1);
    expect(page.totalCount).toBeNull();
  });

  it('объект с items отдаёт и записи, и общее число', () => {
    const page = parseEgovResponse('{"totalCount":137,"items":[{"bin":"123456789012"}]}');

    expect(page.records).toHaveLength(1);
    expect(page.totalCount).toBe(137);
  });

  it('пустой ответ остаётся пустым, а не ошибкой', () => {
    expect(parseEgovResponse('[]').records).toEqual([]);
  });

  it('страница ошибки не превращается в пустой список', () => {
    try {
      parseEgovResponse('<html><body>502 Bad Gateway</body></html>');
      expect.unreachable('разбор обязан был отказать');
    } catch (error) {
      expect(error).toBeInstanceOf(EgovParseError);
      expect((error as EgovParseError).problem).toBe('NOT_JSON');
      expect((error as EgovParseError).message).toContain('502');
    }
  });

  it('ответ-ошибка службы доносится текстом', () => {
    try {
      parseEgovResponse('{"error":"Dataset not found"}');
      expect.unreachable('разбор обязан был отказать');
    } catch (error) {
      expect((error as EgovParseError).problem).toBe('ERROR_PAYLOAD');
      expect((error as EgovParseError).message).toContain('Dataset not found');
    }
  });

  it('непонятный объект называет пришедшие поля', () => {
    try {
      parseEgovResponse('{"took":5,"timed_out":false}');
      expect.unreachable('разбор обязан был отказать');
    } catch (error) {
      expect((error as EgovParseError).problem).toBe('NOT_A_RECORD_LIST');
      expect((error as EgovParseError).message).toContain('took');
    }
  });
});

describe('чтение полей записи', () => {
  const record = { BIN_UL: '123456789012', 'sum-debt': '1 234,50', name: '  ТОО Пример  ', empty: '' };

  it('имя поля ищется без учёта регистра и разделителей', () => {
    expect(pickText(record, ['bin'])).toBeUndefined();
    expect(pickText(record, ['binul'])).toBe('123456789012');
    expect(pickText(record, ['bin_ul'])).toBe('123456789012');
  });

  it('первое найденное написание выигрывает', () => {
    expect(pickText(record, ['нетполя', 'name'])).toBe('ТОО Пример');
  });

  it('пустое значение — это не значение', () => {
    expect(pickText(record, ['empty'])).toBeUndefined();
  });

  it('число читается и из строки с пробелами и запятой', () => {
    expect(pickNumber(record, ['sum_debt'])).toBe(1234.5);
    expect(pickNumber(record, ['нетполя'])).toBeUndefined();
  });
});

describe('карта полей набора', () => {
  it('разбирается голый список имён', () => {
    expect(parseEgovMapping('["bin","name_ru"]')).toEqual(['bin', 'name_ru']);
  });

  it('разбирается список описаний полей', () => {
    expect(parseEgovMapping('[{"name":"bin_ul","type":"string"},{"name":"name_ru"}]')).toEqual([
      'bin_ul',
      'name_ru',
    ]);
  });

  it('разбирается объект с properties', () => {
    expect(parseEgovMapping('{"properties":{"bin":{"type":"keyword"},"name_ru":{}}}')).toEqual([
      'bin',
      'name_ru',
    ]);
  });

  it('страница ошибки не становится пустой картой', () => {
    expect(() => parseEgovMapping('<html>503</html>')).toThrow(EgovParseError);
  });

  it('карта без единого имени — это отказ, а не пустой список', () => {
    try {
      parseEgovMapping('[]');
      expect.unreachable('разбор обязан был отказать');
    } catch (error) {
      expect((error as EgovParseError).problem).toBe('NOT_A_RECORD_LIST');
      expect((error as EgovParseError).message).toContain('записи нет');
    }
  });
});

describe('выбор имени поля', () => {
  it('возвращается написание из набора, а не ожидаемое', () => {
    expect(resolveFieldName(['BIN_UL', 'NAME_RU'], ['bin', 'bin_ul'])).toBe('BIN_UL');
  });

  it('порядок ожидаемых написаний решает', () => {
    expect(resolveFieldName(['bin', 'bin_ul'], ['bin_ul', 'bin'])).toBe('bin_ul');
  });

  it('ничего не подошло — null, а не первое попавшееся', () => {
    expect(resolveFieldName(['name_ru', 'address'], ['bin', 'bin_ul'])).toBeNull();
  });
});

describe('запрос по БИН', () => {
  it('имя поля берётся снаружи и не угадывается', () => {
    expect(binQuery('gbd_ul', 'v1', 'bin_ul', '123456789012', 5)).toEqual({
      dataset: 'gbd_ul',
      version: 'v1',
      match: { bin_ul: '123456789012' },
      size: 5,
    });
  });

  it('не-БИН в запрос не уходит', () => {
    expect(() => binQuery('gbd_ul', 'v1', 'bin', '12345')).toThrow(EgovQueryError);
  });
});
