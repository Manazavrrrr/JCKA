/**
 * Проверка словаря.
 *
 * Двуязычный интерфейс ломается тихо: строку копируют с русского
 * в казахскую «пока так» и забывают. Снаружи это выглядит как
 * работающий переключатель языка, который ничего не переключает.
 *
 * Поэтому здесь проверяется не наличие ключей — за этим следит
 * типизация, — а содержание: обе строки непустые и не совпадают
 * дословно, кроме случаев, где совпадение правильное (имя системы,
 * сокращения языков).
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  LOCALES,
  UI,
  isLocale,
  pick,
  translator,
  type UiKey,
} from './dict';

/**
 * Ключи, где совпадение русской и казахской строки осмысленно: имя
 * системы, сокращения самих языков и слова, одинаковые в обоих
 * («балл», «телефон», «формула»).
 */
const INTENTIONALLY_EQUAL = new Set<UiKey>([
  'appName',
  'langRu',
  'langKk',
  'score',
  'phone',
  'account',
  'platform',
  'scoringFormula',
]);

const keys = Object.keys(UI) as UiKey[];

describe('словарь интерфейса', () => {
  it('содержит обе локали для каждого ключа', () => {
    for (const key of keys) {
      for (const locale of LOCALES) {
        expect(UI[key][locale], `${key}.${locale}`).toBeTruthy();
        expect(UI[key][locale].trim(), `${key}.${locale}`).toBe(UI[key][locale]);
      }
    }
  });

  /**
   * Главный тест файла: непереведённая строка обнаруживается здесь,
   * а не на защите проекта.
   */
  it('казахская строка не скопирована с русской', () => {
    const copied = keys.filter(
      (key) => !INTENTIONALLY_EQUAL.has(key) && UI[key].ru === UI[key].kk,
    );
    expect(copied).toEqual([]);
  });

  it('в словаре нет латиницы там, где ожидается кириллица', () => {
    // Площадки и имя системы — исключения; остальное должно читаться
    // на двух государственных языках без вставок.
    const suspicious = keys.filter((key) => {
      if (INTENTIONALLY_EQUAL.has(key)) return false;
      return /^[A-Za-z\s.,]+$/.test(UI[key].ru);
    });
    expect(suspicious).toEqual([]);
  });

  it('длинные подсказки действительно объясняют, а не повторяют заголовок', () => {
    // Пояснения к ключевым решениям системы должны быть содержательными:
    // именно они объясняют аналитику, почему интерфейс ведёт себя так.
    const explanations: UiKey[] = [
      'scoringLegalBasisHint',
      'analyzeNoScore',
      'suggestionsLead',
      'signalsNotReady',
      'connectionsLead',
    ];

    for (const key of explanations) {
      expect(UI[key].ru.length, key).toBeGreaterThan(60);
      expect(UI[key].kk.length, key).toBeGreaterThan(40);
    }
  });
});

describe('переводчик', () => {
  it('выдаёт строку выбранного языка', () => {
    expect(translator('ru')('navProjects')).toBe('Реестр ЖК');
    expect(translator('kk')('navProjects')).toBe('ТК тізілімі');
  });

  it('по умолчанию работает на русском', () => {
    expect(DEFAULT_LOCALE).toBe('ru');
  });

  it('распознаёт только поддерживаемые языки', () => {
    expect(isLocale('ru')).toBe(true);
    expect(isLocale('kk')).toBe(true);
    expect(isLocale('en')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('выбор языка из двуязычного значения сервера', () => {
  it('берёт нужную сторону', () => {
    const label = { ru: 'Красная зона', kk: 'Қызыл аймақ' };
    expect(pick(label, 'ru')).toBe('Красная зона');
    expect(pick(label, 'kk')).toBe('Қызыл аймақ');
  });

  it('пустое значение не ломает разметку', () => {
    expect(pick(null, 'ru')).toBe('');
    expect(pick(undefined, 'kk')).toBe('');
  });
});
