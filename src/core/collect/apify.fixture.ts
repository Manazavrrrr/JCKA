/**
 * Образец ответа Apify Instagram Scraper.
 *
 * Это сокращённая копия набора данных, который актор отдаёт по запросу
 * run-sync-get-dataset-items: оставлены поля, которые читает разбор
 * (id, shortCode, caption, url, timestamp, ownerUsername, hashtags, type),
 * убраны размеры изображений, списки комментариев и служебная статистика.
 * Аккаунты и тексты объявлений вымышленные, как и все демонстрационные
 * данные проекта.
 *
 * У образца две задачи, и вторая важнее первой.
 *
 * Первая — обычная: проверить разбор на постоянных данных. Настоящая лента
 * живёт своей жизнью, тест, зависящий от её содержимого, падал бы без
 * всякой связи с кодом.
 *
 * Вторая — показать источник в работе, не потратив ни цента и не нарушив
 * ничьих условий. Сбор через Apify платный и требует ключа, которого у
 * проверяющего нет. Без образца источник на демонстрации выглядел бы как
 * мёртвая строка в каталоге; с образцом видно, что именно он принесёт,
 * как объявления пройдут через слова-ловушки и что аналитик увидит на
 * экране. Прогон на образце помечается в журнале отдельно и не выдаётся
 * за живой сбор.
 *
 * В образец намеренно включены неудобные случаи: публикация без подписи
 * (одна картинка), хештеги отдельным полем, видео-reel, казахский текст
 * и запись с меткой времени в виде числа.
 */

export const APIFY_FIXTURE_ACCOUNT = 'altay_arman_demo';

/**
 * Записи ровно в том виде, в каком их отдаёт актор, — то есть unknown[].
 * Тип намеренно не сужается: разбор обязан уметь работать с чужой
 * структурой, а не с заранее подогнанной.
 */
export const APIFY_FIXTURE_POSTS: unknown[] = [
  {
    inputUrl: `https://www.instagram.com/${APIFY_FIXTURE_ACCOUNT}/`,
    id: '3512000000000000001',
    type: 'Image',
    shortCode: 'DEMOpost001',
    caption:
      'ЖК «Алтай Арман ДЕМО» — старт продаж!\n' +
      'Бронь квартиры — 150 000 ₸, сумма входит в стоимость.\n' +
      'Ввод в эксплуатацию: IV квартал 2027 года.\n' +
      'Остались последние квартиры, успейте забронировать.',
    url: 'https://www.instagram.com/p/DEMOpost001/',
    timestamp: '2026-10-10T09:15:00.000Z',
    ownerUsername: APIFY_FIXTURE_ACCOUNT,
    hashtags: ['новостройки', 'усть_каменогорск', 'рассрочка'],
    likesCount: 184,
  },
  {
    inputUrl: `https://www.instagram.com/${APIFY_FIXTURE_ACCOUNT}/`,
    id: '3512000000000000002',
    type: 'Image',
    shortCode: 'DEMOpost002',
    caption: '',
    url: 'https://www.instagram.com/p/DEMOpost002/',
    timestamp: '2026-10-09T12:00:00.000Z',
    ownerUsername: APIFY_FIXTURE_ACCOUNT,
    hashtags: [],
    likesCount: 42,
  },
  {
    inputUrl: `https://www.instagram.com/${APIFY_FIXTURE_ACCOUNT}/`,
    id: '3512000000000000003',
    type: 'Video',
    shortCode: 'DEMOreel003',
    caption:
      'Көрсетілім аптасы! «Алтай Арман ДЕМО» тұрғын кешенінде пәтерлер сатылымда.\n' +
      'Бастапқы жарна 10%, қалғаны — мерзімдік төлеммен.',
    url: 'https://www.instagram.com/reel/DEMOreel003/',
    timestamp: '2026-10-08T15:30:00.000Z',
    ownerUsername: APIFY_FIXTURE_ACCOUNT,
    hashtags: ['пәтер', 'жаңа_құрылыс'],
    likesCount: 97,
  },
  {
    inputUrl: `https://www.instagram.com/${APIFY_FIXTURE_ACCOUNT}/`,
    id: '3512000000000000004',
    type: 'Sidecar',
    shortCode: 'DEMOpost004',
    caption:
      'Инвестируйте в строящийся дом на этапе котлована — цена вырастет к сдаче.\n' +
      'Договор бронирования подписываем в офисе продаж, оплата любым способом.',
    url: 'https://www.instagram.com/p/DEMOpost004/',
    // Актор иногда отдаёт метку времени числом секунд: разбор обязан это пережить.
    timestamp: 1760000000,
    ownerUsername: APIFY_FIXTURE_ACCOUNT,
    hashtags: ['инвестиции', 'котлован'],
    likesCount: 311,
  },
];

/** Ответ актора на закрытый или пустой профиль. */
export const APIFY_FIXTURE_EMPTY_PROFILE: unknown[] = [
  {
    error: 'no_items',
    errorDescription:
      'We detected that this page is empty or private. Please check the URL and try again.',
    url: 'https://www.instagram.com/zakrytyi_demo/',
  },
];
