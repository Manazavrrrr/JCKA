/**
 * Тесты каталога источников.
 *
 * Проверяется не поведение, а честность описания. Источник, который нельзя
 * читать автоматически, обязан нести при себе объяснение: иначе через месяц
 * в каталоге появится строка «только ручной ввод» без причины, и отличить
 * продуманное ограничение от недоделанного коннектора станет невозможно —
 * ни проверяющему, ни следующему разработчику.
 */

import { describe, expect, it } from 'vitest';

import { INSTAGRAM_SOURCE_ID } from './apify';
import {
  COLLECT_SOURCES,
  autoSources,
  findSource,
  keyRequiredSources,
  manualSources,
} from './sources';

describe('каталог источников', () => {
  it('идентификаторы уникальны', () => {
    const ids = COLLECT_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('названия заполнены на обоих языках', () => {
    for (const source of COLLECT_SOURCES) {
      expect(source.name.ru.length).toBeGreaterThan(0);
      expect(source.name.kk.length).toBeGreaterThan(0);
      expect(source.method.ru.length).toBeGreaterThan(0);
      expect(source.method.kk.length).toBeGreaterThan(0);
    }
  });

  it('у каждого ручного источника есть причина на обоих языках', () => {
    for (const source of manualSources()) {
      expect(source.limitation, `источник ${source.id} без объяснения`).not.toBeNull();
      expect(source.limitation?.ru.length ?? 0).toBeGreaterThan(40);
      expect(source.limitation?.kk.length ?? 0).toBeGreaterThan(40);
    }
  });

  it('у автоматических источников причины ограничения нет', () => {
    for (const source of autoSources()) {
      expect(source.limitation).toBeNull();
    }
  });

  it('есть хотя бы один источник каждого режима', () => {
    expect(autoSources().length).toBeGreaterThan(0);
    expect(keyRequiredSources().length).toBeGreaterThan(0);
    expect(manualSources().length).toBeGreaterThan(0);
  });

  it('платный источник называет цену и оговорку, а бесплатный молчит', () => {
    for (const source of keyRequiredSources()) {
      expect(source.cost, `источник ${source.id} без цены`).not.toBeNull();
      expect(source.cost?.ru.length ?? 0).toBeGreaterThan(40);
      expect(source.cost?.kk.length ?? 0).toBeGreaterThan(40);
      expect(source.caveat, `источник ${source.id} без оговорки`).not.toBeNull();
      expect(source.caveat?.ru.length ?? 0).toBeGreaterThan(40);
      expect(source.caveat?.kk.length ?? 0).toBeGreaterThan(40);
      // Проверить сказанное должно быть где: цена сверяется на странице посредника.
      expect(source.reference).toBeTruthy();
    }

    for (const source of [...autoSources(), ...manualSources()]) {
      expect(source.cost, `бесплатный источник ${source.id} с ценой`).toBeNull();
    }
  });

  it('Instagram подключён как платный источник, а не как автоматический', () => {
    const instagram = findSource(INSTAGRAM_SOURCE_ID);

    expect(instagram?.accessMode).toBe('KEY_REQUIRED');
    expect(instagram?.cost?.ru).toContain('2,70');
    expect(instagram?.caveat?.ru).toContain('Meta');
    // Ограничения в смысле «автоматически нельзя вовсе» у него нет:
    // технически можно, решает орган — за это отвечает caveat.
    expect(instagram?.limitation).toBeNull();
  });

  it('реклама в соцсетях помечена как ручной ввод', () => {
    const meta = findSource('meta-ads');

    expect(meta?.accessMode).toBe('MANUAL_ONLY');
    expect(meta?.limitation?.ru).toContain('Ad Library');
    expect(meta?.reference).toBeTruthy();
  });

  it('публичный Telegram-канал читается автоматически', () => {
    expect(findSource('telegram-public')?.accessMode).toBe('AUTO');
  });

  it('несуществующий источник возвращает null', () => {
    expect(findSource('нет такого')).toBeNull();
  });

  it('у источников с изображениями отмечено слепое пятно', () => {
    expect(findSource('telegram-public')?.blindSpot?.ru).toContain('изображ');
    expect(findSource('meta-ads')?.blindSpot?.ru).toContain('изображ');
  });
});
