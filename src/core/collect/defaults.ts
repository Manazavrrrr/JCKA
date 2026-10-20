/**
 * Набор слов-ловушек по умолчанию.
 *
 * Это стартовая настройка, а не часть логики: аналитик правит её в
 * интерфейсе, и именно правленый набор лежит в базе. Набор живёт здесь,
 * а не в prisma/seed-data.ts, по одной причине — чтобы кнопка «вернуть
 * набор по умолчанию» и тесты ядра брали его из того же места, что и
 * первичное заполнение базы, и три списка не разъехались.
 *
 * Состав подобран под Восточно-Казахстанскую область и под то, что реально
 * пишут в объявлениях: русские и казахские формулировки вперемешку, нередко
 * в одном тексте. Разделение по языкам сделано для отчётности — поиск идёт
 * по обоим наборам всегда, потому что свёртка символов уже приводит
 * «пәтер» и «патер» к одному виду.
 *
 * Про стоп-слова. Их здесь немного и они узкие. Широкое стоп-слово тихо
 * выкидывает из выборки честные объявления, и обнаружится это только тогда,
 * когда объект уже попал в новости. Поэтому в списке «посуточно» и «натяжные
 * потолки», но нет, например, «мебель»: новостройку сдают и с мебелью.
 */

import type { WatchTerm } from './terms';

/** Короткая запись термина: id собирается из категории и порядка. */
interface Seed {
  text: string;
  language: WatchTerm['language'];
  note?: { ru: string; kk: string };
}

function build(category: WatchTerm['category'], seeds: readonly Seed[]): WatchTerm[] {
  return seeds.map((seed, index) => ({
    id: `${category.toLowerCase()}-${index + 1}`,
    category,
    language: seed.language,
    text: seed.text,
    active: true,
    note: seed.note ?? null,
  }));
}

const SUBJECT: Seed[] = [
  { text: 'квартир*', language: 'RU' },
  { text: 'жиль*', language: 'RU' },
  { text: 'жилой комплекс', language: 'RU' },
  {
    text: 'ЖК',
    language: 'RU',
    note: {
      ru: 'Двухбуквенный термин работает только по границам слова: «ЖК Алтай» поймает, «жкх» — нет.',
      kk: 'Екі әріпті термин тек сөз шекарасы бойынша жұмыс істейді: «ЖК Алтай» ұстайды, «жкх» — жоқ.',
    },
  },
  { text: 'новостройк*', language: 'RU' },
  { text: 'апартамент*', language: 'RU' },
  { text: 'пәтер*', language: 'KK' },
  { text: 'тұрғын үй', language: 'KK' },
  { text: 'тұрғын үй кешені', language: 'KK' },
];

const ACTOR: Seed[] = [
  { text: 'застройщик*', language: 'RU' },
  { text: 'девелопер*', language: 'RU' },
  { text: 'отдел продаж', language: 'RU' },
  { text: 'строительн* компани*', language: 'RU' },
  { text: 'құрылыс салушы', language: 'KK' },
  { text: 'сату бөлімі', language: 'KK' },
];

const OFFER: Seed[] = [
  {
    text: 'брон*',
    language: 'RU',
    note: {
      ru: 'Ловит «бронь», «бронирование», «забронировать». Ключевое слово фактора R2 — прямое предложение внести деньги.',
      kk: '«Бронь», «бронирование», «забронировать» сөздерін ұстайды. R2 факторының негізгі сөзі — ақша салуға тікелей ұсыныс.',
    },
  },
  { text: 'рассрочк*', language: 'RU' },
  { text: 'первоначальный взнос', language: 'RU' },
  { text: 'задаток', language: 'RU' },
  { text: 'предоплат*', language: 'RU' },
  { text: 'старт продаж', language: 'RU' },
  { text: 'брондау', language: 'KK' },
  { text: 'бөліп төлеу', language: 'KK' },
  { text: 'бастапқы жарна', language: 'KK' },
];

const CONSTRUCTION: Seed[] = [
  { text: 'строящ*', language: 'RU' },
  { text: 'строительств*', language: 'RU' },
  { text: 'котлован*', language: 'RU' },
  { text: 'срок сдачи', language: 'RU' },
  {
    text: 'сдача в 20*',
    language: 'RU',
    note: {
      ru: 'Год в будущем времени — самый надёжный письменный признак того, что дом ещё не построен.',
      kk: 'Келер шақтағы жыл — үйдің әлі салынбағанының ең сенімді жазбаша белгісі.',
    },
  },
  { text: 'готовност*', language: 'RU' },
  { text: 'салынып жатыр', language: 'KK' },
  { text: 'пайдалануға беру', language: 'KK' },
  { text: 'құрылыс барысы', language: 'KK' },
];

const EXCLUDE: Seed[] = [
  { text: 'посуточн*', language: 'RU' },
  {
    text: 'аренд*',
    language: 'RU',
    note: {
      ru: 'Аренда к долевому строительству отношения не имеет и составляет заметную часть потока.',
      kk: 'Жалға беру үлестік құрылысқа қатысы жоқ және ағынның едәуір бөлігін құрайды.',
    },
  },
  { text: 'вторичн*', language: 'RU' },
  { text: 'ремонт квартир', language: 'RU' },
  { text: 'натяжн* потолк*', language: 'RU' },
  { text: 'жалға бер*', language: 'KK' },
  { text: 'тәулікке', language: 'KK' },
];

export const DEFAULT_WATCH_TERMS: readonly WatchTerm[] = [
  ...build('SUBJECT', SUBJECT),
  ...build('ACTOR', ACTOR),
  ...build('OFFER', OFFER),
  ...build('CONSTRUCTION', CONSTRUCTION),
  ...build('EXCLUDE', EXCLUDE),
];
