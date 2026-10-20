/**
 * Текстовые примитивы для разбора объявлений.
 *
 * Главное требование к этому модулю — сохранение позиций. Любой найденный
 * фрагмент должен указывать на точные символы исходного текста, потому что
 * именно по этим позициям интерфейс подсвечивает цитату, а сигнальная
 * карточка ссылается на источник. Поэтому нормализация здесь строго
 * посимвольная: каждый символ заменяется ровно одним символом, длина строки
 * не меняется, и офсеты в нормализованном тексте совпадают с офсетами
 * в оригинале. Ни одной операции, которая сдвигает позиции.
 *
 * Модуль не зависит от БД, сети и времени: один и тот же текст всегда
 * разбирается одинаково.
 */

// ---------------------------------------------------------------------------
// Посимвольная нормализация
// ---------------------------------------------------------------------------

/**
 * Казахские буквы складываются в ближайшие русские.
 *
 * Это нужно, чтобы «Ертіс Сарайы» в объявлении совпало с «Ертіс Сарайы»
 * в реестре, набранным через «и», а «Көктем» — с «Коктем». Замена один
 * символ в один символ: позиции не сдвигаются.
 */
const CHAR_FOLD: Record<string, string> = {
  ә: 'а',
  ғ: 'г',
  қ: 'к',
  ң: 'н',
  ө: 'о',
  ұ: 'у',
  ү: 'у',
  һ: 'х',
  і: 'и',
  ё: 'е',
  // Латиница, которой иногда подменяют кириллицу в объявлениях.
  a: 'а',
  c: 'с',
  e: 'е',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
  k: 'к',
  m: 'м',
  t: 'т',
  h: 'н',
  b: 'в',
};

/**
 * Приводит текст к виду для поиска, не меняя длину.
 *
 * После вызова `fold(text).indexOf(...)` можно безопасно использовать
 * полученный индекс как позицию в исходном тексте.
 */
export function fold(text: string): string {
  let result = '';
  for (const char of text.toLowerCase()) {
    result += CHAR_FOLD[char] ?? char;
  }
  return result;
}

/**
 * Нормализация для сравнения названий: сворачивает символы, убирает
 * служебные слова и знаки, сжимает пробелы. Позиции здесь уже не нужны,
 * поэтому длина меняться может.
 */
export function normalizeName(text: string): string {
  // Служебные слова убираются с границами по Unicode: \b в JavaScript
  // кириллицу не распознаёт и такие замены молча не срабатывают.
  return fold(text)
    .replace(/[«»"'`]/g, ' ')
    .replace(/[-–—_]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/(?<![\p{L}\p{N}])жк(?![\p{L}\p{N}])/gu, ' ')
    .replace(/(?<![\p{L}\p{N}])жилой\s+комплекс(?![\p{L}\p{N}])/gu, ' ')
    // «тұрғын үй кешені» после свёртки символов выглядит как «тургын уй кешени».
    .replace(/(?<![\p{L}\p{N}])тургын\s+уй\s+кешени(?![\p{L}\p{N}])/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Разбивает нормализованную строку на значимые токены. */
export function tokenize(text: string): string[] {
  return normalizeName(text)
    .split(' ')
    .filter((token) => token.length > 1);
}

// ---------------------------------------------------------------------------
// Расстояние и похожесть
// ---------------------------------------------------------------------------

/** Расстояние Левенштейна. Итеративная версия с одной строкой памяти. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }

  return previous[b.length] ?? 0;
}

/** Похожесть двух строк: 1 — совпадение, 0 — ничего общего. */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Похожесть названий по токенам.
 *
 * Для каждого токена названия-кандидата ищется самый похожий токен запроса,
 * результат усредняется с весом по длине токена. Такой подход устойчив
 * к перестановке слов, лишнему «ЖК» и опечаткам в одном из слов:
 * «ЖК Алтай-Арман» и «Алтай Арман» дают совпадение около единицы.
 */
export function nameSimilarity(query: string, candidate: string): number {
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);

  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  let weighted = 0;
  let weight = 0;

  for (const token of candidateTokens) {
    let best = 0;
    for (const other of queryTokens) {
      const score = similarity(token, other);
      if (score > best) best = score;
    }
    weighted += best * token.length;
    weight += token.length;
  }

  return weight === 0 ? 0 : weighted / weight;
}

/**
 * Содержится ли название-кандидат в тексте.
 * Возвращает похожесть и позицию наиболее похожего участка текста,
 * чтобы предложение ИИ можно было подкрепить цитатой.
 */
export function findNameInText(
  text: string,
  candidate: string,
): { score: number; charStart: number; charEnd: number } | null {
  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) return null;

  const words = [...fold(text).matchAll(/\p{L}[\p{L}\p{N}-]*/gu)];
  if (words.length === 0) return null;

  const windowSize = candidateTokens.length;
  let best: { score: number; charStart: number; charEnd: number } | null = null;

  for (let i = 0; i + windowSize <= words.length; i += 1) {
    const slice = words.slice(i, i + windowSize);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (!first || !last || first.index === undefined || last.index === undefined) continue;

    const charStart = first.index;
    const charEnd = last.index + last[0].length;
    const score = nameSimilarity(text.slice(charStart, charEnd), candidate);

    if (!best || score > best.score) {
      best = { score, charStart, charEnd };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Поиск по шаблонам с сохранением позиций
// ---------------------------------------------------------------------------

export interface PatternHit {
  /** Исходный, не нормализованный фрагмент текста. */
  fragment: string;
  charStart: number;
  charEnd: number;
}

/**
 * Класс символов слова с поддержкой кириллицы.
 *
 * В JavaScript `\w` — это ровно [A-Za-z0-9_], а `\b` построена на `\w`.
 * На русском тексте обе конструкции работают не так, как ожидает автор
 * шаблона: в выражении «\bброн\w+» граница слова перед «б» не находится,
 * потому что для движка и пробел, и «б» одинаково не являются символами
 * слова, а «\w» не захватывает «ь». Это тихая ошибка: шаблон компилируется,
 * совпадение находится частично, и подсветка цитаты в интерфейсе
 * обрезается на середине слова.
 */
const WORD_CLASS = '[\\p{L}\\p{N}_]';

/** Граница слова, работающая в обе стороны и понимающая кириллицу. */
const WORD_BOUNDARY =
  `(?:(?<!${WORD_CLASS})(?=${WORD_CLASS})|(?<=${WORD_CLASS})(?!${WORD_CLASS}))`;

/**
 * Сворачивает буквы внутри шаблона, не трогая синтаксис.
 *
 * Поиск идёт по свёрнутому тексту, поэтому шаблон тоже должен быть свёрнут:
 * выражение «құрылыс» по тексту «ҚҰРЫЛЫС» не сработает, потому что текст к этому
 * моменту уже превращён в «курылыс». Ручная свёртка словаря сделала бы его
 * нечитаемым («болип толеу» вместо «бөліп төлеу») и при этом оставила бы
 * возможность опечатки в каждой строке. Поэтому свёртку выполняет компилятор,
 * а словарь пишется нормальным казахским и русским.
 *
 * Обрабатываются только символы вне ASCII. Это важно: `\d`, `\s`, `\S`
 * и прочие служебные последовательности остаются в исходном виде, и регистр
 * escape-последовательностей не ломается.
 */
function foldPatternSource(source: string): string {
  let result = '';
  for (const char of source) {
    if (char.charCodeAt(0) < 128) {
      result += char;
      continue;
    }
    const lower = char.toLowerCase();
    result += CHAR_FOLD[lower] ?? lower;
  }
  return result;
}

/**
 * Переписывает шаблон под кириллицу и добавляет флаги u и g.
 *
 * Благодаря этому все словари пишутся привычным синтаксисом с `\b` и `\w`
 * и обычной казахской орфографией, а на свёрнутом тексте ведут себя так,
 * как написано.
 */
export function compilePattern(pattern: RegExp): RegExp {
  const source = foldPatternSource(pattern.source)
    .replaceAll('\\b', WORD_BOUNDARY)
    .replaceAll('\\w', WORD_CLASS);

  const flags = new Set([...pattern.flags, 'g', 'u']);
  return new RegExp(source, [...flags].join(''));
}

/**
 * Находит все совпадения регулярного выражения в свёрнутом тексте
 * и возвращает фрагменты из оригинала.
 *
 * Выражение пишется по свёрнутому алфавиту: строчные русские буквы.
 * Благодаря посимвольной нормализации позиции совпадают с исходным текстом.
 */
export function findPattern(text: string, pattern: RegExp): PatternHit[] {
  const folded = fold(text);
  const regex = compilePattern(pattern);
  const hits: PatternHit[] = [];

  let match = regex.exec(folded);
  while (match !== null) {
    hits.push({
      fragment: text.slice(match.index, match.index + match[0].length),
      charStart: match.index,
      charEnd: match.index + match[0].length,
    });
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
    match = regex.exec(folded);
  }

  return hits;
}

/**
 * Находит позиции первой заполненной группы захвата, а не всего совпадения.
 *
 * Нужна там, где шаблон описывает контекст, а взять надо лишь его часть:
 * в «ЖК «Алтай-Арман»» признаком названия служат указатель и кавычки,
 * но названием является только «Алтай-Арман».
 *
 * Позиции берутся у самого движка регулярных выражений (флаг d), поэтому
 * фрагмент по-прежнему вырезается из исходного текста и подсветка остаётся
 * точной. Если ни одна группа не заполнена, возвращается всё совпадение.
 */
export function findCapture(text: string, pattern: RegExp): PatternHit[] {
  const folded = fold(text);
  const compiled = compilePattern(pattern);
  const regex = new RegExp(compiled.source, `${compiled.flags}d`);
  const hits: PatternHit[] = [];

  let match = regex.exec(folded);
  while (match !== null) {
    let start = match.index;
    let end = match.index + match[0].length;

    const indices = match.indices;
    if (indices) {
      for (let group = 1; group < match.length; group += 1) {
        const pair = indices[group];
        if (pair) {
          [start, end] = pair;
          break;
        }
      }
    }

    hits.push({ fragment: text.slice(start, end), charStart: start, charEnd: end });
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
    match = regex.exec(folded);
  }

  return hits;
}

/**
 * Расширяет найденный фрагмент до границ предложения.
 * Цитата из одного слова бесполезна в сигнальной карточке — проверяющему
 * нужна фраза, в которой это слово стоит.
 */
export function expandToSentence(text: string, charStart: number, charEnd: number): PatternHit {
  const before = text.slice(0, charStart);
  const boundary = Math.max(
    before.lastIndexOf('.'),
    before.lastIndexOf('!'),
    before.lastIndexOf('?'),
    before.lastIndexOf('\n'),
  );
  const start = boundary === -1 ? 0 : boundary + 1;

  const after = text.slice(charEnd);
  const endOffsets = [after.indexOf('.'), after.indexOf('!'), after.indexOf('?'), after.indexOf('\n')]
    .filter((index) => index !== -1)
    .sort((a, b) => a - b);
  const end = endOffsets.length > 0 ? charEnd + (endOffsets[0] ?? 0) + 1 : text.length;

  const fragment = text.slice(start, end).trim();
  const offset = text.slice(start, end).indexOf(fragment);

  return {
    fragment,
    charStart: start + Math.max(offset, 0),
    charEnd: start + Math.max(offset, 0) + fragment.length,
  };
}

// ---------------------------------------------------------------------------
// Извлечение сущностей
// ---------------------------------------------------------------------------

/** Телефон в казахстанских форматах записи. */
const PHONE_PATTERN =
  /(?:\+?7|8)[\s\-()]*7\d{2}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g;

export interface PhoneHit extends PatternHit {
  /** Нормализованный вид +7XXXXXXXXXX для сравнения и поиска связей. */
  normalized: string;
}

/**
 * Телефоны из текста.
 *
 * Нормализованный вид нужен для функции поиска связанных размещений:
 * одно и то же число в объявлениях пишут десятком разных способов.
 */
export function extractPhones(text: string): PhoneHit[] {
  return findPattern(text, PHONE_PATTERN).map((hit) => {
    const digits = hit.fragment.replace(/\D/g, '');
    const tail = digits.slice(-10);
    return { ...hit, normalized: `+7${tail}` };
  });
}

export interface AmountHit extends PatternHit {
  /** Сумма в тенге. Null, если распознать не удалось. */
  amount: number | null;
}

/**
 * Суммы с указанием валюты: «300 000 тенге», «1,5 млн ₸», «500000 тг»,
 * «150 тысяч тенге». Множитель записывают и сокращённо, и словом, поэтому
 * после «млн», «млрд» и «тыс» допускается любое окончание.
 */
const AMOUNT_PATTERN =
  /\d[\d\s.,]*\s*(?:млрд|млн|тыс|мың)\w*\.?\s*(?:теңге|тг\.?|₸)|\d[\d\s.,]*\s*(?:теңге|тг\.?|₸)/g;

export function extractAmounts(text: string): AmountHit[] {
  return findPattern(text, AMOUNT_PATTERN).map((hit) => {
    const folded = fold(hit.fragment);
    const numeric = folded.replace(/[^\d.,]/g, '').replace(/,(\d{3})/g, '$1').replace(',', '.');
    let amount = Number.parseFloat(numeric);

    if (Number.isNaN(amount)) {
      return { ...hit, amount: null };
    }
    if (/млрд/.test(folded)) amount *= 1_000_000_000;
    else if (/млн/.test(folded)) amount *= 1_000_000;
    else if (/тыс|мын/.test(folded)) amount *= 1_000;

    return { ...hit, amount: Math.round(amount) };
  });
}

export interface PercentHit extends PatternHit {
  value: number;
}

/** Проценты: «готовность 65%», «65 процентов». */
const PERCENT_PATTERN = /\d{1,3}\s*(?:%|процент\w*|пайыз\w*)/g;

export function extractPercents(text: string): PercentHit[] {
  return findPattern(text, PERCENT_PATTERN)
    .map((hit) => {
      const value = Number.parseInt(hit.fragment.replace(/\D/g, ''), 10);
      return { ...hit, value };
    })
    .filter((hit) => Number.isFinite(hit.value) && hit.value >= 0 && hit.value <= 100);
}

/** Годы сдачи: «сдача в 2027», «ввод — 4 квартал 2026». */
const YEAR_PATTERN = /20\d{2}\s*(?:год\w*|г\.?|ж\.?)?/g;

export function extractYears(text: string): (PatternHit & { year: number })[] {
  return findPattern(text, YEAR_PATTERN)
    .map((hit) => ({ ...hit, year: Number.parseInt(hit.fragment.slice(0, 4), 10) }))
    .filter((hit) => hit.year >= 2000 && hit.year <= 2100);
}

/** Ближайшая к позиции сумма — чтобы связать цену с условием оплаты. */
export function nearestAmount(amounts: readonly AmountHit[], position: number, radius = 120) {
  let best: AmountHit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const amount of amounts) {
    const distance = Math.min(
      Math.abs(amount.charStart - position),
      Math.abs(amount.charEnd - position),
    );
    if (distance < bestDistance && distance <= radius) {
      best = amount;
      bestDistance = distance;
    }
  }

  return best;
}

/** Ограничивает значение отрезком [min, max] и округляет до двух знаков. */
export function clampConfidence(value: number, min = 0.05, max = 0.95): number {
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}
