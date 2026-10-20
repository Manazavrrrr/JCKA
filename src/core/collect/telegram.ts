/**
 * Разбор открытой веб-версии публичного Telegram-канала.
 *
 * Почему именно веб-версия, а не Bot API. Бот видит сообщения канала только
 * после того, как его туда добавили администратором: для чужого канала это
 * означает согласие владельца, которого у надзорного органа нет и не будет.
 * А страница https://t.me/s/<канал> — это то же самое, что видит любой
 * прохожий без Telegram: публичная витрина канала, открытая по прямой ссылке,
 * без входа и без токена. Поэтому сбор идёт по ней: читается ровно то, что
 * застройщик сам опубликовал для неограниченного круга лиц.
 *
 * Сам модуль ничего не скачивает. На вход ему дают уже полученный HTML,
 * на выход он отдаёт RawItem[]. Разделение не формальное: сеть в тестах
 * недоступна и недетерминирована, а разметка — обычная строка, поэтому
 * разбор проверяется на сохранённом образце и ведёт себя одинаково всегда.
 *
 * Разметку чужой страницы никто не обязан сохранять неизменной, и это главный
 * риск коннектора. Поэтому разбор устроен так, чтобы ломаться заметно:
 * пустой результат на непустой странице — это ошибка с внятным текстом
 * (см. parseTelegramPage), а не тихий ноль, который на демонстрации выглядит
 * как «в канале ничего нет».
 *
 * Модуль чистый: ни сети, ни Prisma, ни текущего времени.
 */

import type { RawItem } from './run';

// ---------------------------------------------------------------------------
// Имя канала
// ---------------------------------------------------------------------------

/**
 * Имена каналов в Telegram: латиница, цифры и подчёркивание, 5–32 знака.
 * Проверка нужна не ради красоты, а чтобы в адрес не подставили чужой путь.
 */
const CHANNEL_PATTERN = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/**
 * Приводит введённое аналитиком к чистому имени канала.
 *
 * Аналитик копирует из браузера что угодно: «@ukg_novostroyki»,
 * «https://t.me/ukg_novostroyki», «t.me/s/ukg_novostroyki?before=42».
 * Всё это — один канал, и требовать от человека ручной чистки незачем.
 * Возвращает null, если после чистки имя не похоже на имя канала.
 */
export function normalizeChannel(input: string): string | null {
  let value = input.trim();
  if (value.length === 0) return null;

  // Адрес целиком: отбрасываем схему, домен и служебный префикс /s/.
  value = value.replace(/^https?:\/\//i, '');
  value = value.replace(/^(?:www\.)?t(?:elegram)?\.me\//i, '');
  value = value.replace(/^s\//i, '');
  value = value.replace(/^@/, '');

  // Хвост адреса: номер поста, параметры запроса, якорь.
  value = value.split(/[/?#]/)[0] ?? '';

  return CHANNEL_PATTERN.test(value) ? value : null;
}

/** Адрес открытой веб-версии канала. Токен и вход не требуются. */
export function channelUrl(channel: string): string {
  return `https://t.me/s/${channel}`;
}

// ---------------------------------------------------------------------------
// Ошибка разбора
// ---------------------------------------------------------------------------

export type TelegramParseProblem = 'NOT_A_CHANNEL_PAGE' | 'NO_MESSAGES';

/**
 * Разбор не удался. Текст написан так, чтобы его можно было показать
 * аналитику: он должен понять, что делать, не заглядывая в журнал сервера.
 */
export class TelegramParseError extends Error {
  readonly problem: TelegramParseProblem;

  constructor(problem: TelegramParseProblem, message: string) {
    super(message);
    this.name = 'TelegramParseError';
    this.problem = problem;
  }
}

// ---------------------------------------------------------------------------
// Разметка
// ---------------------------------------------------------------------------

/**
 * Опорные классы веб-версии. Вынесены в одно место намеренно: если Telegram
 * переименует их, правка будет в одной строке, а тест на образце сразу
 * покажет, что именно перестало находиться.
 */
const MESSAGE_BLOCK = 'tgme_widget_message_wrap';
const TEXT_BLOCK = 'tgme_widget_message_text';
const OWNER_NAME = 'tgme_widget_message_owner_name';
const PAGE_MARKER = 'tgme_channel_info';

/** Делит страницу на куски, каждый из которых начинается с одного сообщения. */
function splitMessages(html: string): string[] {
  const parts = html.split(new RegExp(`<div[^>]*class="[^"]*${MESSAGE_BLOCK}[^"]*"`, 'i'));
  // Первый кусок — всё, что было до первого сообщения: шапка канала.
  return parts.slice(1);
}

/** Значение атрибута у первого тега в куске разметки, где он встречается. */
function attribute(chunk: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(chunk);
  return match ? match[1] ?? null : null;
}

/**
 * Содержимое <div class="…tgme_widget_message_text…"> вместе с вложенными
 * тегами. Границу приходится искать счётчиком вложенности: внутри подписи
 * встречаются <b>, <a>, <tg-spoiler> и ещё одно <div> у цитат, поэтому
 * «до первого </div>» обрезало бы текст на середине.
 */
function extractTextHtml(chunk: string): string | null {
  const open = new RegExp(`<div[^>]*class="[^"]*${TEXT_BLOCK}[^"]*"[^>]*>`, 'i').exec(chunk);
  if (!open) return null;

  const start = open.index + open[0].length;
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = start;

  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(chunk)) !== null) {
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) return chunk.slice(start, match.index);
  }

  // Закрывающего тега нет — значит кусок оборван. Берём всё, что есть:
  // лучше разобрать неполный текст, чем потерять объявление целиком.
  return chunk.slice(start);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

/** Разворачивает HTML-сущности, включая числовые (&#1049; и &#x414;). */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * Превращает разметку подписи в текст.
 *
 * Переводы строк сохраняются: в объявлениях цена, срок сдачи и телефон стоят
 * отдельными строками, и если склеить их в одну, «сдача 2027 бронь 150 000»
 * прочитается как одно предложение — а цитату совпадения мы показываем
 * аналитику предложением.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:div|p|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Разбор страницы
// ---------------------------------------------------------------------------

export interface TelegramParseOptions {
  /** Идентификатор источника из каталога. По умолчанию публичный канал. */
  sourceId?: string;
}

/**
 * Разбирает страницу канала в элементы потока.
 *
 * Посты без подписи (одна картинка, один кружок, пересланное видео) в поток
 * не попадают: фильтровать нечего, а пустая карточка в списке «отброшено»
 * только мешает читать настоящие отказы. Это ровно то слепое пятно, которое
 * записано у источника в каталоге: текст, нарисованный на картинке,
 * система не видит.
 */
export function parseTelegramPage(
  html: string,
  channel: string,
  options: TelegramParseOptions = {},
): RawItem[] {
  const sourceId = options.sourceId ?? 'telegram-public';

  if (!html.includes(PAGE_MARKER) && !html.includes(MESSAGE_BLOCK)) {
    throw new TelegramParseError(
      'NOT_A_CHANNEL_PAGE',
      `Страница https://t.me/s/${channel} не похожа на витрину публичного канала. ` +
        'Так отвечают закрытые каналы, чаты и несуществующие имена: ' +
        'у них открытой веб-версии нет, и читать их без согласия владельца нельзя.',
    );
  }

  const chunks = splitMessages(html);
  const items: RawItem[] = [];

  for (const chunk of chunks) {
    const post = attribute(chunk, 'data-post');
    const textHtml = extractTextHtml(chunk);
    if (textHtml === null) continue;

    const text = htmlToText(textHtml);
    if (text.length === 0) continue;

    // «channel/1041» → «1041». Номер поста в канале неизменен, поэтому
    // он же служит ключом повторного сбора.
    const externalId = post ? (post.split('/').pop() ?? post) : String(items.length + 1);

    const time = /<time[^>]*\sdatetime="([^"]+)"/i.exec(chunk);
    const ownerMatch = new RegExp(
      `<[^>]*class="[^"]*${OWNER_NAME}[^"]*"[^>]*>([\\s\\S]*?)</a>`,
      'i',
    ).exec(chunk);
    const author = ownerMatch ? htmlToText(ownerMatch[1] ?? '') : null;

    items.push({
      sourceId,
      externalId,
      text,
      url: post ? `https://t.me/${post}` : channelUrl(channel),
      author: author && author.length > 0 ? author : null,
      publishedAt: time ? (time[1] ?? null) : null,
    });
  }

  if (items.length === 0) {
    throw new TelegramParseError(
      'NO_MESSAGES',
      `На странице https://t.me/s/${channel} не удалось прочитать ни одного сообщения с текстом. ` +
        'Либо в канале только картинки и видео без подписей, либо Telegram изменил вёрстку витрины — ' +
        'во втором случае нужно поправить разбор в src/core/collect/telegram.ts.',
    );
  }

  return items;
}
