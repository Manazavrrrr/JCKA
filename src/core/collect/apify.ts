/**
 * Разбор ответа Apify Instagram Scraper.
 *
 * Зачем вообще посредник. Instagram не отдаёт публикации чужого аккаунта
 * никому: Graph API работает только с аккаунтом, который сам выдал токен,
 * Business Discovery — только с бизнес-аккаунтами, подключёнными к вашей
 * странице, а Ad Library по Казахстану коммерческую рекламу не показывает
 * (см. источник meta-ads в каталоге). Надзорный орган ни одним из этих
 * условий не располагает: застройщик, которого проверяют, согласия не даст.
 * Остаётся сторонний сборщик, который читает публичный профиль так же, как
 * его читает прохожий в браузере.
 *
 * Чем за это платят. Двумя вещами, и обе названы в интерфейсе, а не спрятаны
 * в коде.
 *
 * Первое — условия площадки. Автоматическое чтение Instagram противоречит
 * пользовательскому соглашению Meta. Собираются только публичные публикации
 * коммерческих аккаунтов застройщиков, персональные данные граждан не
 * затрагиваются, но формально это серая зона, и решение подключать источник
 * принимает орган, а не программа. Поэтому источник выключен, пока не задан
 * ключ, и несёт при себе оговорку.
 *
 * Второе — деньги. Сбор платный: 2,70 доллара за 1000 результатов на
 * бесплатном тарифе (дешевле на платных). Поэтому число публикаций за прогон
 * ограничено сверху жёстко, а ожидаемая стоимость считается заранее и
 * показывается до запуска, а не приходит счётом в конце месяца.
 *
 * Сам модуль ничего не скачивает и ничего не платит. На вход ему дают уже
 * разобранный JSON, на выход он отдаёт RawItem[] — то же разделение, что у
 * telegram.ts, и по той же причине: сеть в тестах недоступна, а ответ
 * сборщика — обычная структура, поэтому разбор проверяется на сохранённом
 * образце и ведёт себя одинаково всегда.
 *
 * Модуль чистый: ни сети, ни Prisma, ни текущего времени.
 */

import type { Label } from '../domain/enums';
import type { RawItem } from './run';

// ---------------------------------------------------------------------------
// Актор и адреса
// ---------------------------------------------------------------------------

/** Идентификатор актора в API: в адресе косая черта заменяется на тильду. */
export const APIFY_ACTOR = 'apify~instagram-scraper';

/** Страница актора — чтобы проверяющий мог сверить цену и поля сам. */
export const APIFY_ACTOR_PAGE = 'https://apify.com/apify/instagram-scraper';

/** Где завести ключ. Этот адрес показывается аналитику в интерфейсе. */
export const APIFY_TOKEN_PAGE = 'https://console.apify.com/settings/integrations';

/** Идентификатор источника в каталоге. */
export const INSTAGRAM_SOURCE_ID = 'instagram-apify';

/**
 * Синхронный запуск: актор отрабатывает и сразу отдаёт собранные записи.
 *
 * Токена в адресе нет намеренно. Apify допускает параметр ?token=…, но адрес
 * целиком попадает в журналы сервера, в историю запросов и в текст ошибки —
 * то есть ключ утёк бы в три места сразу. Ключ передаётся заголовком
 * Authorization: Bearer, который никуда не записывается.
 */
export function apifyRunUrl(): string {
  return `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items`;
}

// ---------------------------------------------------------------------------
// Цена
// ---------------------------------------------------------------------------

/** Доллары за 1000 результатов на бесплатном тарифе. Сверено 16.10.2026. */
export const APIFY_PRICE_PER_1000_USD = 2.7;

/** Дата сверки цены. Показывается рядом с ценой: цены меняются. */
export const APIFY_PRICE_CHECKED_ON = '2026-10-16';

export const APIFY_PRICE_NOTE: Label = {
  ru: 'Сбор платный: 2,70 $ за 1000 результатов на бесплатном тарифе Apify (2,30 $ на Starter, 1,90 $ на Scale, 1,50 $ на Business). Цена сверена 16.10.2026 на странице актора — проверьте её перед запуском, тарифы меняются.',
  kk: 'Жинау ақылы: Apify тегін тарифінде 1000 нәтиже үшін 2,70 $ (Starter-де 2,30 $, Scale-де 1,90 $, Business-те 1,50 $). Баға 16.10.2026 акторлар бетінде тексерілді — іске қоспас бұрын тексеріңіз, тарифтер өзгереді.',
};

export const APIFY_TERMS_CAVEAT: Label = {
  ru: 'Автоматическое чтение Instagram противоречит пользовательскому соглашению Meta. Собираются только публичные публикации коммерческих аккаунтов застройщиков; личные страницы граждан и закрытые профили не читаются. Решение подключать источник принимает орган: без ключа источник выключен.',
  kk: 'Instagram-ды автоматты оқу Meta пайдаланушы келісіміне қайшы келеді. Тек құрылыс салушылардың коммерциялық аккаунттарының ашық жарияланымдары жиналады; азаматтардың жеке беттері мен жабық профильдер оқылмайды. Дереккөзді қосу туралы шешімді орган қабылдайды: кілтсіз дереккөз өшірулі.',
};

/** Та же цена в целых центах за 1000. Нужна для счёта без долей. */
export const APIFY_PRICE_PER_1000_CENTS = Math.round(APIFY_PRICE_PER_1000_USD * 100);

/**
 * Сколько будет стоить прогон на столько публикаций.
 *
 * Считается до запуска и показывается аналитику. Округление вверх до цента:
 * ошибиться лучше в сторону «дороже», чем пообещать меньше, чем спишется.
 *
 * Счёт ведётся в целых центах, и это не стилистика. Наивное
 * `Math.ceil(results / 1000 * 2.7 * 100)` даёт на 900 публикациях 243.00000000000003
 * вместо ровно 243 и округляет вверх до 244 — лишний цент из ниоткуда, причём
 * не на всяком числе, а на отдельных. Поймано свойством в budget.test.ts:
 * «то, что названо вместимым, умещается в остаток». Вылезало бы это на
 * прогоне по остатку дня — самом частом в автоматическом обходе.
 */
export function estimateRunCostUsd(limit: number): number {
  const results = Math.max(0, Math.trunc(limit));
  return Math.ceil((results * APIFY_PRICE_PER_1000_CENTS) / 1000) / 100;
}

// ---------------------------------------------------------------------------
// Сколько брать за прогон
// ---------------------------------------------------------------------------

export const DEFAULT_POSTS_LIMIT = 20;

/**
 * Жёсткий потолок на прогон.
 *
 * Не из осторожности, а из арифметики: опечатка в поле «сколько публикаций»
 * — это опечатка в счёте. Сто публикаций стоят 27 центов, сто тысяч — 270
 * долларов, и разница между ними в интерфейсе ровно три нажатия. Потолок
 * ставит предел худшему случаю: больше, чем на 27 центов, один прогон
 * ошибиться не может.
 */
export const MAX_POSTS_LIMIT = 100;

/** Приводит запрошенное число к допустимому. Отрицательное и ноль — к единице. */
export function clampPostsLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_POSTS_LIMIT;
  return Math.min(MAX_POSTS_LIMIT, Math.max(1, Math.trunc(limit)));
}

// ---------------------------------------------------------------------------
// Имя аккаунта
// ---------------------------------------------------------------------------

/** Имена в Instagram: латиница, цифры, точка и подчёркивание, до 30 знаков. */
const ACCOUNT_PATTERN = /^[A-Za-z0-9._]{1,30}$/;

/**
 * Приводит введённое аналитиком к чистому имени аккаунта.
 *
 * Аналитик копирует из браузера что угодно: «@monterosa.kz»,
 * «instagram.com/monterosa.kz», «https://www.instagram.com/monterosa.kz/?hl=ru».
 * Всё это — один аккаунт. Возвращает null, если после чистки имя не похоже
 * на имя аккаунта: пустая строка, служебный путь (p, reel, explore) или
 * знаки, которых в именах не бывает.
 */
const RESERVED_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'explore',
  'accounts',
  'direct',
]);

export function normalizeInstagramAccount(input: string): string | null {
  let value = input.trim();
  if (value.length === 0) return null;

  value = value.replace(/^https?:\/\//i, '');
  value = value.replace(/^(?:www\.)?instagram\.com\//i, '');
  value = value.replace(/^@/, '');
  value = value.split(/[/?#]/)[0] ?? '';

  if (RESERVED_PATHS.has(value.toLowerCase())) return null;

  return ACCOUNT_PATTERN.test(value) ? value : null;
}

/** Адрес публичного профиля. */
export function instagramProfileUrl(account: string): string {
  return `https://www.instagram.com/${account}/`;
}

// ---------------------------------------------------------------------------
// Вход актора
// ---------------------------------------------------------------------------

export interface InstagramScraperInput {
  directUrls: string[];
  resultsType: 'posts';
  resultsLimit: number;
  skipPinnedPosts: boolean;
  /** Отсечка по давности в том виде, в каком её понимает актор. */
  onlyPostsNewerThan?: string;
}

/**
 * Собирает вход актора.
 *
 * Закреплённые публикации пропускаются: это витрина аккаунта, она висит
 * сверху месяцами и на каждом прогоне приходила бы заново, занимая платные
 * результаты и засоряя список повторами. Отсечка по давности задаётся
 * отдельно — без неё прогон тянет всю ленту, а нужна обычно последняя
 * неделя.
 */
export function instagramScraperInput(
  account: string,
  options: { limit?: number; newerThan?: string | null } = {},
): InstagramScraperInput {
  const input: InstagramScraperInput = {
    directUrls: [instagramProfileUrl(account)],
    resultsType: 'posts',
    resultsLimit: clampPostsLimit(options.limit ?? DEFAULT_POSTS_LIMIT),
    skipPinnedPosts: true,
  };

  const newerThan = options.newerThan?.trim();
  if (newerThan && newerThan.length > 0) input.onlyPostsNewerThan = newerThan;

  return input;
}

// ---------------------------------------------------------------------------
// Ошибка разбора
// ---------------------------------------------------------------------------

export type ApifyParseProblem =
  | 'NOT_A_LIST'
  | 'ACTOR_REPORTED_ERROR'
  | 'PRIVATE_OR_EMPTY'
  | 'NO_POSTS';

/**
 * Разбор не удался. Текст пишется так, чтобы аналитик понял, что делать,
 * не заглядывая в журнал сервера.
 */
export class ApifyParseError extends Error {
  readonly problem: ApifyParseProblem;

  constructor(problem: ApifyParseProblem, message: string) {
    super(message);
    this.name = 'ApifyParseError';
    this.problem = problem;
  }
}

// ---------------------------------------------------------------------------
// Разбор ответа
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Приводит метку времени актора к ISO.
 *
 * Актор отдаёт ISO-строку, но встречается и число секунд — на этот случай
 * проверка есть. Непонятное значение превращается в null, а не в «сейчас»:
 * выдуманная дата публикации хуже отсутствующей, потому что по дате
 * считается фактор давности.
 */
function asMoment(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1e11 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const text = asText(value);
  if (text === null) return null;

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Подпись плюс хештеги: хештег в объявлении часто и есть слово-ловушка. */
function postText(post: Record<string, unknown>): string {
  const caption = asText(post.caption) ?? '';
  const hashtags = Array.isArray(post.hashtags)
    ? post.hashtags
        .map((tag) => asText(tag))
        .filter((tag): tag is string => tag !== null)
        .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    : [];

  // Хештеги дописываются, только если их нет в самой подписи: актор
  // выносит их отдельным полем, но в caption они обычно уже есть.
  const missing = hashtags.filter((tag) => !caption.toLowerCase().includes(tag.toLowerCase()));

  return missing.length === 0 ? caption : `${caption}\n${missing.join(' ')}`.trim();
}

export interface ApifyParseOptions {
  /** Идентификатор источника из каталога. */
  sourceId?: string;
}

/**
 * Превращает ответ актора в элементы потока.
 *
 * Пустой результат наружу не отдаётся: он выглядел бы как «у застройщика
 * нет рекламы», хотя означает «аккаунт закрыт», «имя набрано с опечаткой»
 * или «актор изменил формат ответа». Это разные вещи, и каждая из них —
 * ошибка с внятным текстом, как и в telegram.ts.
 */
export function parseApifyPosts(payload: unknown, options: ApifyParseOptions = {}): RawItem[] {
  const sourceId = options.sourceId ?? INSTAGRAM_SOURCE_ID;

  if (!Array.isArray(payload)) {
    throw new ApifyParseError(
      'NOT_A_LIST',
      'Apify вернул не список записей. Так отвечают при неверном ключе, исчерпанном тарифе ' +
        'или изменившемся адресе актора — проверьте ключ в настройках и страницу актора ' +
        `${APIFY_ACTOR_PAGE}.`,
    );
  }

  // Актор сообщает о неудаче не кодом ответа, а записью в наборе данных.
  // Самый частый случай — закрытый или пустой профиль.
  for (const entry of payload) {
    const record = asRecord(entry);
    if (record === null) continue;

    const error = asText(record.error);
    if (error === null) continue;

    const description = asText(record.errorDescription) ?? error;
    if (error === 'no_items' || error === 'empty_profile') {
      throw new ApifyParseError(
        'PRIVATE_OR_EMPTY',
        `Профиль прочитан, но публикаций в нём нет: ${description}. ` +
          'Так отвечают закрытые аккаунты и аккаунты без постов. Закрытый профиль читать нельзя — ' +
          'объявление из него вносится вручную, как из закрытых мессенджеров.',
      );
    }

    throw new ApifyParseError(
      'ACTOR_REPORTED_ERROR',
      `Сборщик вернул ошибку: ${description}. Прогон оплачен не был; ` +
        `подробности — на странице актора ${APIFY_ACTOR_PAGE}.`,
    );
  }

  const items: RawItem[] = [];

  for (const entry of payload) {
    const post = asRecord(entry);
    if (post === null) continue;

    const text = postText(post);
    if (text.length === 0) continue;

    const shortCode = asText(post.shortCode);
    const externalId = shortCode ?? asText(post.id) ?? String(items.length + 1);
    const author = asText(post.ownerUsername);

    items.push({
      sourceId,
      externalId,
      text,
      url:
        asText(post.url) ??
        (shortCode ? `https://www.instagram.com/p/${shortCode}/` : asText(post.inputUrl)),
      author,
      publishedAt: asMoment(post.timestamp),
    });
  }

  if (items.length === 0) {
    throw new ApifyParseError(
      'NO_POSTS',
      'Ни одной публикации с текстом прочитать не удалось. Либо в ленте только изображения ' +
        'и видео без подписей — такой текст система не видит и в этой версии не распознаёт, — ' +
        'либо актор изменил состав полей, и тогда нужно поправить разбор ' +
        'в src/core/collect/apify.ts.',
    );
  }

  return items;
}
