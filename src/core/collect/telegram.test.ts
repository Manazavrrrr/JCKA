/**
 * Тесты разбора витрины публичного Telegram-канала.
 *
 * Проверяется две вещи. Первая — что из разметки вынимается ровно то, на чём
 * потом держится доказательство: номер поста, его прямая ссылка, дата
 * публикации из страницы (а не из часов сервера) и текст с сохранёнными
 * переводами строк. Вторая — что непригодная страница вызывает ошибку
 * с объяснением, а не пустой список: молчаливый ноль на защите неотличим
 * от «в канале ничего нет».
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_WATCH_TERMS } from './defaults';
import { runCollection } from './run';
import {
  TELEGRAM_FIXTURE_CHANNEL,
  TELEGRAM_FIXTURE_HTML,
  TELEGRAM_FIXTURE_PRIVATE,
} from './telegram.fixture';
import {
  TelegramParseError,
  channelUrl,
  htmlToText,
  normalizeChannel,
  parseTelegramPage,
} from './telegram';

describe('normalizeChannel — чистка введённого имени', () => {
  it('принимает имя как есть', () => {
    expect(normalizeChannel('ukg_novostroyki')).toBe('ukg_novostroyki');
  });

  it('снимает собачку, пробелы и адрес целиком', () => {
    expect(normalizeChannel('  @ukg_novostroyki ')).toBe('ukg_novostroyki');
    expect(normalizeChannel('https://t.me/ukg_novostroyki')).toBe('ukg_novostroyki');
    expect(normalizeChannel('t.me/s/ukg_novostroyki')).toBe('ukg_novostroyki');
    expect(normalizeChannel('https://t.me/s/ukg_novostroyki/1041?before=5')).toBe('ukg_novostroyki');
  });

  it('отказывает в том, что не похоже на имя канала', () => {
    expect(normalizeChannel('')).toBeNull();
    expect(normalizeChannel('кириллица')).toBeNull();
    expect(normalizeChannel('ab')).toBeNull();
    expect(normalizeChannel('1channel')).toBeNull();
    // Попытка увести запрос на чужой адрес не должна пройти проверку.
    expect(normalizeChannel('https://example.com/s/evil')).toBeNull();
    expect(normalizeChannel('../../etc/passwd')).toBeNull();
  });

  it('адрес витрины собирается из чистого имени', () => {
    expect(channelUrl('ukg_novostroyki')).toBe('https://t.me/s/ukg_novostroyki');
  });
});

describe('htmlToText — подпись в текст', () => {
  it('сохраняет переводы строк', () => {
    expect(htmlToText('Цена<br/>Срок<br/>Телефон')).toBe('Цена\nСрок\nТелефон');
  });

  it('снимает теги, но оставляет их содержимое', () => {
    expect(htmlToText('<b>ЖК</b> <a href="#">ссылка</a>')).toBe('ЖК ссылка');
  });

  it('разворачивает сущности, включая числовые', () => {
    expect(htmlToText('&laquo;Алтай&raquo; &mdash; 150&nbsp;000 &#8376;')).toBe(
      '«Алтай» — 150 000 ₸',
    );
  });

  it('схлопывает лишние пустые строки', () => {
    expect(htmlToText('Раз<br/><br/><br/><br/>Два')).toBe('Раз\n\nДва');
  });
});

describe('parseTelegramPage — разбор витрины', () => {
  const items = parseTelegramPage(TELEGRAM_FIXTURE_HTML, TELEGRAM_FIXTURE_CHANNEL);

  it('берёт только посты с подписью', () => {
    // В образце три поста, у среднего — одна картинка без текста.
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.externalId)).toEqual(['1041', '1043']);
  });

  it('номер поста превращается в прямую ссылку', () => {
    expect(items[0]?.url).toBe(`https://t.me/${TELEGRAM_FIXTURE_CHANNEL}/1041`);
  });

  it('дата берётся из страницы, а не из часов сервера', () => {
    expect(items[0]?.publishedAt).toBe('2026-10-10T09:15:00+00:00');
    expect(items[1]?.publishedAt).toBe('2026-10-11T07:05:00+00:00');
  });

  it('подпись канала сохраняется как автор', () => {
    expect(items[0]?.author).toBe('Новостройки ВКО ДЕМО');
  });

  it('текст собран построчно и без разметки', () => {
    const text = items[0]?.text ?? '';
    expect(text.split('\n')).toEqual([
      'ЖК «Алтай Арман ДЕМО»',
      'Старт продаж от застройщика.',
      'Бронь квартиры — 150 000 ₸',
      'Ввод в эксплуатацию: IV кв. 2027',
      'Записаться на просмотр',
    ]);
  });

  it('вложенный блок цитаты не обрывает текст', () => {
    const text = items[1]?.text ?? '';
    expect(text).toContain('посуточно');
    expect(text).toContain('Звоните после 18:00.');
  });

  it('источник проставляется из каталога', () => {
    expect(items[0]?.sourceId).toBe('telegram-public');
    const custom = parseTelegramPage(TELEGRAM_FIXTURE_HTML, TELEGRAM_FIXTURE_CHANNEL, {
      sourceId: 'другой',
    });
    expect(custom[0]?.sourceId).toBe('другой');
  });
});

describe('parseTelegramPage — непригодная страница', () => {
  it('закрытый канал: ошибка с объяснением, а не пустой список', () => {
    expect(() => parseTelegramPage(TELEGRAM_FIXTURE_PRIVATE, 'zakrytyy_demo')).toThrowError(
      TelegramParseError,
    );

    try {
      parseTelegramPage(TELEGRAM_FIXTURE_PRIVATE, 'zakrytyy_demo');
    } catch (error) {
      const parse = error as TelegramParseError;
      expect(parse.problem).toBe('NOT_A_CHANNEL_PAGE');
      expect(parse.message).toContain('zakrytyy_demo');
      expect(parse.message).toContain('согласия');
    }
  });

  it('канал из одних картинок: ошибка называет и вторую причину — смену вёрстки', () => {
    const onlyPhotos = TELEGRAM_FIXTURE_HTML.replace(
      /<div class="tgme_widget_message_text[\s\S]*?<\/div>\s*<div class="tgme_widget_message_footer/g,
      '<div class="tgme_widget_message_footer',
    );

    try {
      parseTelegramPage(onlyPhotos, TELEGRAM_FIXTURE_CHANNEL);
      expect.unreachable('разбор обязан был отказать');
    } catch (error) {
      const parse = error as TelegramParseError;
      expect(parse.problem).toBe('NO_MESSAGES');
      expect(parse.message).toContain('вёрстку');
      expect(parse.message).toContain('src/core/collect/telegram.ts');
    }
  });
});

describe('разбор и отбор работают в связке', () => {
  it('из витрины канала отбор берёт объявление застройщика и отбрасывает аренду', () => {
    const items = parseTelegramPage(TELEGRAM_FIXTURE_HTML, TELEGRAM_FIXTURE_CHANNEL);
    const { items: decided, stats } = runCollection(items, DEFAULT_WATCH_TERMS);

    expect(stats.total).toBe(2);
    expect(stats.kept).toBe(1);

    const kept = decided.find((item) => item.decision.verdict === 'KEPT');
    expect(kept?.externalId).toBe('1041');
    expect(kept?.decision.explanation.ru).toContain('«брон*»');

    const skipped = decided.find((item) => item.decision.verdict === 'SKIPPED');
    expect(skipped?.decision.reason).toBe('EXCLUDED');
    expect(skipped?.decision.explanation.ru).toContain('«посуточн*»');
  });
});
