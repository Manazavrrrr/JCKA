/**
 * Тесты коннектора Instagram через Apify.
 *
 * Проверяется три вещи, и ни одна из них не про сеть.
 *
 * Первое — чистка имени аккаунта. Аналитик копирует адрес из браузера, и в
 * нём бывает всё: протокол, www, параметры языка, косая черта в конце.
 * Ошибиться здесь значит запустить платный прогон по несуществующему имени.
 *
 * Второе — арифметика цены и потолок. Прогон стоит денег, поэтому «сколько
 * спишется» считается до запуска, а опечатка в числе публикаций не может
 * превратиться в счёт на сотни долларов.
 *
 * Третье — разбор. Главное требование к нему: пустой результат наружу не
 * выходит. «Нет публикаций» и «аккаунт закрыт» — разные вещи, и обе должны
 * быть ошибкой с текстом, а не тихим пустым списком, который на
 * демонстрации читается как «у застройщика рекламы нет».
 */

import { describe, expect, it } from 'vitest';

import {
  APIFY_ACTOR,
  APIFY_PRICE_PER_1000_USD,
  ApifyParseError,
  DEFAULT_POSTS_LIMIT,
  INSTAGRAM_SOURCE_ID,
  MAX_POSTS_LIMIT,
  apifyRunUrl,
  clampPostsLimit,
  estimateRunCostUsd,
  instagramProfileUrl,
  instagramScraperInput,
  normalizeInstagramAccount,
  parseApifyPosts,
} from './apify';
import {
  APIFY_FIXTURE_ACCOUNT,
  APIFY_FIXTURE_EMPTY_PROFILE,
  APIFY_FIXTURE_POSTS,
} from './apify.fixture';

describe('имя аккаунта', () => {
  it('принимает имя в любом виде, в каком его копируют', () => {
    const expected = 'monterosa.kz';

    for (const input of [
      'monterosa.kz',
      '@monterosa.kz',
      ' monterosa.kz ',
      'instagram.com/monterosa.kz',
      'www.instagram.com/monterosa.kz/',
      'https://www.instagram.com/monterosa.kz/',
      'https://instagram.com/monterosa.kz/?hl=ru',
      'https://www.instagram.com/monterosa.kz/#reels',
    ]) {
      expect(normalizeInstagramAccount(input), input).toBe(expected);
    }
  });

  it('отказывается от того, что именем аккаунта не является', () => {
    for (const input of [
      '',
      '   ',
      'https://www.instagram.com/',
      'https://www.instagram.com/p/Cabc123/',
      'https://www.instagram.com/reel/Cabc123/',
      'https://www.instagram.com/explore/tags/kvartira/',
      'имя_кириллицей',
      'слишком_длинное_имя_которого_в_инстаграме_не_бывает',
      'имя с пробелом',
    ]) {
      expect(normalizeInstagramAccount(input), input).toBeNull();
    }
  });

  it('адрес профиля собирается из чистого имени', () => {
    expect(instagramProfileUrl('monterosa.kz')).toBe('https://www.instagram.com/monterosa.kz/');
  });
});

describe('цена прогона', () => {
  it('тысяча результатов стоит объявленную цену', () => {
    expect(estimateRunCostUsd(1000)).toBe(APIFY_PRICE_PER_1000_USD);
  });

  it('двадцать публикаций стоят копейки, и это видно до запуска', () => {
    // 20 / 1000 * 2.70 = 0.054 → округление вверх до цента.
    expect(estimateRunCostUsd(20)).toBe(0.06);
  });

  it('нулевой прогон бесплатен', () => {
    expect(estimateRunCostUsd(0)).toBe(0);
  });

  it('округление всегда вверх: обещать меньше, чем спишется, нельзя', () => {
    expect(estimateRunCostUsd(1)).toBeGreaterThan(0);
    expect(estimateRunCostUsd(37)).toBeGreaterThanOrEqual((37 / 1000) * APIFY_PRICE_PER_1000_USD);
  });

  it('самый дорогой допустимый прогон стоит меньше доллара', () => {
    expect(estimateRunCostUsd(MAX_POSTS_LIMIT)).toBeLessThan(1);
  });
});

describe('потолок на прогон', () => {
  it('опечатка в числе публикаций упирается в потолок', () => {
    expect(clampPostsLimit(100000)).toBe(MAX_POSTS_LIMIT);
  });

  it('ноль и отрицательное превращаются в единицу, а не в пустой прогон', () => {
    expect(clampPostsLimit(0)).toBe(1);
    expect(clampPostsLimit(-5)).toBe(1);
  });

  it('нечисло возвращает значение по умолчанию', () => {
    expect(clampPostsLimit(Number.NaN)).toBe(DEFAULT_POSTS_LIMIT);
  });

  it('дробное число округляется вниз', () => {
    expect(clampPostsLimit(12.9)).toBe(12);
  });
});

describe('вход актора', () => {
  it('закреплённые публикации пропускаются', () => {
    expect(instagramScraperInput(APIFY_FIXTURE_ACCOUNT).skipPinnedPosts).toBe(true);
  });

  it('собирает адрес профиля и тип результата', () => {
    const input = instagramScraperInput('monterosa.kz', { limit: 30 });

    expect(input.directUrls).toEqual(['https://www.instagram.com/monterosa.kz/']);
    expect(input.resultsType).toBe('posts');
    expect(input.resultsLimit).toBe(30);
  });

  it('потолок применяется и здесь, а не только в интерфейсе', () => {
    expect(instagramScraperInput('demo', { limit: 100000 }).resultsLimit).toBe(MAX_POSTS_LIMIT);
  });

  it('отсечка по давности ставится, только когда задана', () => {
    expect(instagramScraperInput('demo').onlyPostsNewerThan).toBeUndefined();
    expect(instagramScraperInput('demo', { newerThan: '7 days' }).onlyPostsNewerThan).toBe('7 days');
    expect(instagramScraperInput('demo', { newerThan: '  ' }).onlyPostsNewerThan).toBeUndefined();
  });
});

describe('адрес запуска', () => {
  it('ключа в адресе нет: он уйдёт заголовком', () => {
    const url = apifyRunUrl();

    expect(url).toContain(APIFY_ACTOR);
    expect(url).not.toContain('token');
    expect(url).not.toContain('?');
  });
});

describe('разбор ответа', () => {
  it('читает публикации образца', () => {
    const items = parseApifyPosts(APIFY_FIXTURE_POSTS);

    // Четыре записи, одна из них без подписи — её в потоке быть не должно.
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.sourceId === INSTAGRAM_SOURCE_ID)).toBe(true);
  });

  it('сохраняет текст, ссылку, автора и дату публикации', () => {
    const [first] = parseApifyPosts(APIFY_FIXTURE_POSTS);

    expect(first?.externalId).toBe('DEMOpost001');
    expect(first?.text).toContain('Бронь квартиры');
    expect(first?.text).toContain('IV квартал 2027');
    expect(first?.url).toBe('https://www.instagram.com/p/DEMOpost001/');
    expect(first?.author).toBe(APIFY_FIXTURE_ACCOUNT);
    expect(first?.publishedAt).toBe('2026-10-10T09:15:00.000Z');
  });

  it('публикация без подписи в поток не попадает', () => {
    const items = parseApifyPosts(APIFY_FIXTURE_POSTS);

    expect(items.map((item) => item.externalId)).not.toContain('DEMOpost002');
  });

  it('дописывает хештеги, которых нет в подписи', () => {
    const items = parseApifyPosts(APIFY_FIXTURE_POSTS);
    const reel = items.find((item) => item.externalId === 'DEMOreel003');

    expect(reel?.text).toContain('#пәтер');
    expect(reel?.text).toContain('#жаңа_құрылыс');
  });

  it('не дублирует хештег, уже стоящий в подписи', () => {
    const items = parseApifyPosts([
      {
        shortCode: 'DEMOhash',
        caption: 'Квартиры в рассрочку #новостройки',
        hashtags: ['новостройки'],
        ownerUsername: 'demo',
      },
    ]);

    expect(items[0]?.text.match(/#новостройки/g)).toHaveLength(1);
  });

  it('метку времени числом секунд приводит к ISO', () => {
    const items = parseApifyPosts(APIFY_FIXTURE_POSTS);
    const post = items.find((item) => item.externalId === 'DEMOpost004');

    expect(post?.publishedAt).toBe(new Date(1760000000 * 1000).toISOString());
  });

  it('непонятную дату превращает в null, а не в «сейчас»', () => {
    const items = parseApifyPosts([
      { shortCode: 'DEMObad', caption: 'Текст есть, даты нет', timestamp: 'позавчера' },
    ]);

    expect(items[0]?.publishedAt).toBeNull();
  });

  it('закрытый профиль — это ошибка с объяснением, а не пустой список', () => {
    expect(() => parseApifyPosts(APIFY_FIXTURE_EMPTY_PROFILE)).toThrowError(ApifyParseError);

    try {
      parseApifyPosts(APIFY_FIXTURE_EMPTY_PROFILE);
      expect.unreachable('разбор обязан был отказать');
    } catch (error) {
      expect(error).toBeInstanceOf(ApifyParseError);
      expect((error as ApifyParseError).problem).toBe('PRIVATE_OR_EMPTY');
      expect((error as ApifyParseError).message).toContain('вручную');
    }
  });

  it('ошибку актора пересказывает аналитику', () => {
    try {
      parseApifyPosts([{ error: 'rate_limited', errorDescription: 'Too many requests' }]);
      expect.unreachable('разбор обязан был отказать');
    } catch (error) {
      expect((error as ApifyParseError).problem).toBe('ACTOR_REPORTED_ERROR');
      expect((error as ApifyParseError).message).toContain('Too many requests');
    }
  });

  it('ответ не списком — это ошибка про ключ и тариф', () => {
    try {
      parseApifyPosts({ error: 'Authentication token is not valid' });
      expect.unreachable('разбор обязан был отказать');
    } catch (error) {
      expect((error as ApifyParseError).problem).toBe('NOT_A_LIST');
      expect((error as ApifyParseError).message).toContain('ключ');
    }
  });

  it('лента из одних картинок без подписей — тоже ошибка, а не тихий ноль', () => {
    try {
      parseApifyPosts([
        { shortCode: 'A', caption: '' },
        { shortCode: 'B', caption: '   ' },
      ]);
      expect.unreachable('разбор обязан был отказать');
    } catch (error) {
      expect((error as ApifyParseError).problem).toBe('NO_POSTS');
      expect((error as ApifyParseError).message).toContain('не распознаёт');
    }
  });

  it('идентификатор источника можно задать явно', () => {
    const items = parseApifyPosts(APIFY_FIXTURE_POSTS, { sourceId: 'иной-источник' });

    expect(items.every((item) => item.sourceId === 'иной-источник')).toBe(true);
  });
});
