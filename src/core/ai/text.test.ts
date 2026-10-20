/**
 * Тесты текстовых примитивов.
 *
 * Основное, что здесь проверяется, — сохранение позиций. Если нормализация
 * сдвинет хотя бы один символ, подсветка цитаты в интерфейсе уедет, а ссылка
 * на источник в сигнальной карточке будет указывать не туда. Поэтому
 * инвариант «длина не меняется, офсет совпадает с оригиналом» проверяется
 * отдельно и на каждом извлекающем помощнике.
 */

import { describe, expect, it } from 'vitest';

import {
  clampConfidence,
  expandToSentence,
  extractAmounts,
  extractPercents,
  extractPhones,
  extractYears,
  findNameInText,
  findCapture,
  findPattern,
  fold,
  levenshtein,
  nameSimilarity,
  nearestAmount,
  normalizeName,
  similarity,
  tokenize,
} from './text';

describe('fold — посимвольная нормализация', () => {
  it('не меняет длину строки', () => {
    for (const text of [
      'ЖК «Көктем Парк»',
      'Ертіс Сарайы, құрылыс салушы',
      'Бронь 150 000 ₸',
      'ЁЛКА и ёлка',
    ]) {
      expect(fold(text)).toHaveLength(text.length);
    }
  });

  it('сводит казахские буквы к русским', () => {
    expect(fold('Көктем')).toBe('коктем');
    expect(fold('Ертіс Сарайы')).toBe('ертис сарайы');
    expect(fold('құрылыс')).toBe('курылыс');
  });

  it('сводит латинские омоглифы к кириллице', () => {
    expect(fold('Caмaл')).toBe('самал');
  });

  it('позиция найденного фрагмента совпадает с оригиналом', () => {
    const text = 'ЖК «Көктем Парк» — готовность 78%.';
    const index = fold(text).indexOf('коктем');
    expect(text.slice(index, index + 6)).toBe('Көктем');
  });
});

describe('normalizeName и tokenize', () => {
  it('убирает служебное «ЖК» и кавычки', () => {
    expect(normalizeName('ЖК «Алтай Арман»')).toBe('алтай арман');
  });

  it('приводит дефис к пробелу', () => {
    expect(normalizeName('Алтай-Арман')).toBe('алтай арман');
  });

  it('отбрасывает односимвольные токены', () => {
    expect(tokenize('ЖК «Самал Тауэрс-2»')).toEqual(['самал', 'тауэрс']);
  });
});

describe('похожесть строк', () => {
  it('levenshtein считает расстояние', () => {
    expect(levenshtein('арман', 'арман')).toBe(0);
    expect(levenshtein('арман', 'аркан')).toBe(1);
  });

  it('similarity нормирована на отрезок [0, 1]', () => {
    expect(similarity('арман', 'арман')).toBe(1);
    expect(similarity('арман', 'xyzzy')).toBeLessThan(0.3);
  });

  /**
   * Ключевой случай: в объявлении название написано с «ЖК» и дефисом,
   * в реестре — двумя словами. Это должно считаться совпадением.
   */
  it('nameSimilarity устойчива к «ЖК», дефису и регистру', () => {
    expect(nameSimilarity('ЖК Алтай-Арман', 'Алтай Арман')).toBeGreaterThan(0.95);
  });

  it('nameSimilarity не притягивает разные названия', () => {
    expect(nameSimilarity('ЖК Алтын Орда', 'Алтай Арман')).toBeLessThan(0.62);
  });

  it('nameSimilarity устойчива к перестановке слов', () => {
    expect(nameSimilarity('Арман Алтай', 'Алтай Арман')).toBeGreaterThan(0.95);
  });
});

describe('findNameInText', () => {
  it('находит название с опечаткой и возвращает позицию', () => {
    const text = 'Продаю квартиру в новом ЖК Алтай-Арман на Протозанова.';
    const found = findNameInText(text, 'Алтай Арман');
    expect(found).not.toBeNull();
    expect(found?.score).toBeGreaterThan(0.9);
    expect(text.slice(found?.charStart ?? 0, found?.charEnd ?? 0)).toContain('Алтай');
  });

  it('находит казахское название, набранное русскими буквами', () => {
    const found = findNameInText('Новая очередь ЖК Коктем Парк в продаже.', 'Көктем Парк');
    expect(found?.score ?? 0).toBeGreaterThan(0.9);
  });

  it('для чужого названия даёт низкую похожесть', () => {
    const found = findNameInText('ЖК «Самал Тауэрс» — старт продаж.', 'Алтай Арман');
    expect(found?.score ?? 1).toBeLessThan(0.62);
  });
});

describe('findPattern и expandToSentence', () => {
  it('возвращает фрагмент оригинала, а не нормализованный', () => {
    const text = 'Готовность объекта — 78%.';
    const [hit] = findPattern(text, /готовност\w*/);
    expect(hit?.fragment).toBe('Готовность');
  });

  it('расширяет фрагмент до предложения', () => {
    const text = 'Дом строится. Бронь 150 000 ₸ фиксирует цену. Звоните.';
    const sentence = expandToSentence(text, 14, 19);
    expect(sentence.fragment).toBe('Бронь 150 000 ₸ фиксирует цену.');
    expect(text.slice(sentence.charStart, sentence.charEnd)).toBe(sentence.fragment);
  });

  it('позиции расширенного фрагмента указывают на исходный текст', () => {
    const text = 'Первое предложение. Второе про депозит 10%. Третье.';
    const [hit] = findPattern(text, /депозит/);
    const sentence = expandToSentence(text, hit?.charStart ?? 0, hit?.charEnd ?? 0);
    expect(text.slice(sentence.charStart, sentence.charEnd)).toBe(sentence.fragment);
  });
});

/**
 * findCapture нужна там, где шаблон описывает контекст, а взять надо лишь
 * его часть: указатель «ЖК» и кавычки — признак названия, но названием
 * является только то, что внутри.
 */
describe('findCapture', () => {
  it('возвращает группу захвата, а не всё совпадение', () => {
    const text = 'Продаются квартиры в ЖК «Алтай-Арман» на Протозанова.';
    const [hit] = findCapture(text, /жк\s*«([^»]+)»/);
    expect(hit?.fragment).toBe('Алтай-Арман');
    expect(text.slice(hit?.charStart ?? 0, hit?.charEnd ?? 0)).toBe('Алтай-Арман');
  });

  it('работает с казахской орфографией в шаблоне', () => {
    const text = 'Өскемен қаласында тұрғын үй кешені «Ақ Бұлақ» салынып жатыр.';
    const [hit] = findCapture(text, /тұрғын\s+үй\s+кешені\s*«([^»]+)»/);
    expect(hit?.fragment).toBe('Ақ Бұлақ');
  });

  it('берёт первую заполненную группу из нескольких ветвей', () => {
    const pattern = /жк\s*«([^»]+)»|жк\s+(\w+)/;
    expect(findCapture('ЖК «Самал Тауэрс» строится', pattern)[0]?.fragment).toBe('Самал Тауэрс');
    expect(findCapture('ЖК Жастар строится', pattern)[0]?.fragment).toBe('Жастар');
  });

  it('возвращает всё совпадение, если групп нет', () => {
    const [hit] = findCapture('Бронь 150 000 ₸', /бронь/);
    expect(hit?.fragment).toBe('Бронь');
  });

  it('находит все вхождения', () => {
    const text = 'ЖК «Алтай» и ЖК «Ертіс» — два разных объекта.';
    expect(findCapture(text, /жк\s*«([^»]+)»/).map((item) => item.fragment)).toEqual([
      'Алтай',
      'Ертіс',
    ]);
  });
});

describe('извлечение сущностей', () => {
  it('телефоны нормализуются к виду +7XXXXXXXXXX', () => {
    const phones = extractPhones('Звоните: +7 701 000 00 11 или 8 (701) 000-00-22.');
    expect(phones.map((phone) => phone.normalized)).toEqual(['+77010000011', '+77010000022']);
  });

  it('позиция телефона указывает на исходный текст', () => {
    const text = 'Запись по телефону +7 701 000 00 11.';
    const [phone] = extractPhones(text);
    expect(text.slice(phone?.charStart ?? 0, phone?.charEnd ?? 0)).toBe('+7 701 000 00 11');
  });

  it('суммы распознаются в разных записях', () => {
    expect(extractAmounts('Бронь 150 000 ₸').map((item) => item.amount)).toEqual([150000]);
    expect(extractAmounts('от 1,5 млн тенге').map((item) => item.amount)).toEqual([1500000]);
    expect(extractAmounts('бронь 150 тысяч тенге').map((item) => item.amount)).toEqual([150000]);
    expect(extractAmounts('залог 250 000 тг.').map((item) => item.amount)).toEqual([250000]);
  });

  it('проценты вне отрезка [0, 100] отбрасываются', () => {
    expect(extractPercents('скидка 15%, рост 450%')).toHaveLength(1);
  });

  it('годы распознаются и фильтруются по диапазону', () => {
    expect(extractYears('сдача в 2027 году, начало 2026 г.').map((item) => item.year)).toEqual([
      2027, 2026,
    ]);
  });

  it('nearestAmount связывает сумму с ближайшей формулировкой', () => {
    const text = 'Бронь 150 000 ₸ фиксирует цену. Отдельно депозит 300 000 ₸.';
    const amounts = extractAmounts(text);
    expect(nearestAmount(amounts, text.indexOf('Бронь'))?.amount).toBe(150000);
    expect(nearestAmount(amounts, text.indexOf('депозит'))?.amount).toBe(300000);
  });

  it('nearestAmount не связывает сумму за пределами радиуса', () => {
    const text = `Бронь${' '.repeat(200)}300 000 ₸`;
    expect(nearestAmount(extractAmounts(text), 0)).toBeNull();
  });
});

describe('clampConfidence', () => {
  it('держит значение в границах и округляет', () => {
    expect(clampConfidence(1.4)).toBe(0.95);
    expect(clampConfidence(-1)).toBe(0.05);
    expect(clampConfidence(0.5555)).toBe(0.56);
  });
});
