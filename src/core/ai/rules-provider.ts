/**
 * Движок разбора на правилах — основной провайдер системы.
 *
 * Это не заглушка в ожидании языковой модели, а рабочий инструмент, который
 * сознательно выбран основным. Причины прямые:
 *
 *   - Детерминированность. Один и тот же текст всегда даёт один и тот же
 *     разбор. ТЗ требует воспроизводимости результата, а ответ языковой модели
 *     воспроизводим только при нулевой температуре и неизменной версии модели.
 *
 *   - Проверяемость. Каждая гипотеза привязана к конкретному шаблону и цитате
 *     из текста. Аналитик видит, какая фраза дала срабатывание, и может
 *     оспорить именно её. Объяснение «так решила модель» в надзорной работе
 *     непригодно.
 *
 *   - Работа без сети. На защите проекта нет гарантии доступа к внешнему API.
 *
 * Языковая модель подключается рядом (llm-provider) и решает ту задачу,
 * где правила слабы: формулировки, которых нет в словаре. При её сбое
 * система возвращается сюда.
 *
 * Границы модуля заданы в dictionary.ts: предлагать можно только R2, R3, R5, R6.
 * R1 и R4 не выводятся из текста ни при каких условиях.
 */

import { LOW_CONFIDENCE_THRESHOLD, type Label } from '../domain/enums';
import {
  ALWAYS_LOW_CONFIDENCE_FACTORS,
  DELAY_PATTERNS,
  LEGAL_BASIS_CLAIM_PATTERNS,
  PAYMENT_TERMS,
  READINESS_PATTERNS,
  SALE_PATTERNS,
  UNDER_CONSTRUCTION_PATTERNS,
} from './dictionary';
import {
  APPEALS_CHECK,
  LEGAL_BASIS_CHECK,
  type AiProvider,
  type AnalyzeInput,
  type ProjectCandidate,
} from './provider';
import {
  analysisResultSchema,
  type AnalysisResult,
  type FactorHypothesis,
  type PaymentTerm,
  type ProjectMatch,
  type Span,
} from './schemas';
import {
  clampConfidence,
  expandToSentence,
  extractAmounts,
  extractPercents,
  extractPhones,
  extractYears,
  findCapture,
  findNameInText,
  findPattern,
  fold,
  nearestAmount,
  normalizeName,
  type PatternHit,
} from './text';

// ---------------------------------------------------------------------------
// Константы движка
// ---------------------------------------------------------------------------

/**
 * Порог, с которого название считается возможным совпадением.
 *
 * Значение подобрано так, чтобы «ЖК Алтай-Арман» в объявлении находило
 * объект «Алтай Арман» в реестре (опечатка и дефис), но «Алтын Орда»
 * не притягивалось к «Алтай Арман». Ниже этого порога предложение
 * не формируется — ложная привязка объявления к чужому ЖК опаснее
 * пропущенной: она создаёт риск на невиновном застройщике.
 */
const MATCH_THRESHOLD = 0.62;

/** Максимум предложений по сопоставлению: аналитику нужен выбор, а не список. */
const MAX_MATCHES = 3;

/**
 * Порог совпадения адреса — выше, чем у названия, и это не придирка.
 *
 * Все адреса реестра одного региона устроены одинаково: «г. Усть-Каменогорск,
 * ул. ..., номер». Общая часть составляет большую половину строки, поэтому
 * сравнение адресов «как есть» даёт заметную похожесть вообще на всём,
 * и объявление притягивается к случайным объектам. Отсюда два решения:
 * из адреса вырезается общая часть (город и тип улицы), а от остатка
 * требуется высокое совпадение.
 */
const ADDRESS_THRESHOLD = 0.82;

/**
 * Общая часть адресов, по которой сопоставлять нельзя.
 *
 * Город и тип улицы совпадают у всех объектов региона и потому не несут
 * различающей информации. Названия города перечислены в обоих написаниях.
 */
const ADDRESS_NOISE =
  /(?<![\p{L}\p{N}])(?:г|город|ул|улица|пр|проспект|мкр|микрорайон|шоссе|пер|переулок|дом|усть|каменогорск|оскемен|семей|алматы|астана|шымкент)(?![\p{L}\p{N}])/gu;

/** Оставляет в адресе только различающую часть: название улицы и номер. */
export function addressKey(address: string): string {
  return normalizeName(address).replace(ADDRESS_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Адрес: «ул. Протозанова, 85», «пр. Абая 12/1», «Абай даңғылы, 12/1».
 *
 * Две ветви нужны потому, что в русском языке указатель типа улицы стоит
 * перед названием, а в казахском — после него («Протозанов к-сі, 85»).
 *
 * Указатель обязателен. Соблазнительно было бы принимать за адрес любое
 * «слово + номер», но тогда «Продаём 2-комнатные квартиры» попадает в
 * извлечённые адреса, а аналитик видит в карточке мусор и перестаёт
 * доверять остальным полям. Безымянный адрес лучше не найти вовсе:
 * сопоставление с реестром всё равно опирается ещё на название,
 * телефон и застройщика.
 *
 * Сокращения отделены опережающей проверкой «(?=[^\p{L}\p{N}]|$)»: без неё
 * «пр» срабатывает внутри слова «Протозанова» и «Продаём».
 */
const ADDRESS_PATTERN = new RegExp(
  '(?:ул|улица|мкр|микрорайон|пр|пр-?кт|проспект|шоссе|пер|переулок)' +
    '(?=[^\\p{L}\\p{N}]|$)\\.?\\s*[^,.;\\n]{2,40}?,?\\s*\\d+[а-я]?(?:\\s*/\\s*\\d+)?' +
    '|[\\p{L}][^,.;\\n]{1,39}?\\s*' +
    '(?:көшес\\w*|к-сі|даңғыл\\w*|ықшам\\s*аудан\\w*|тұйығ\\w*)' +
    ',?\\s*\\d+[а-я]?(?:\\s*/\\s*\\d+)?',
  'gu',
);

/** Квартиры, студии, жилой комплекс — признак того, что текст вообще про жильё. */
const HOUSING_NOUN_PATTERN =
  /\b(?:кварти\w*|студи\w*|апартамент\w*|жилой\s+комплекс|жк\b|новостро\w*|пәтер\w*|тұрғын\s+үй)/g;

/**
 * Слова, которые после «ЖК» означают не название, а продолжение фразы:
 * «ЖК в центре города», «ЖК по адресу …». Без этой проверки такие
 * конструкции попадают в извлечённые названия.
 */
const NAME_STOP_WORDS = new Set([
  'в',
  'во',
  'на',
  'по',
  'от',
  'до',
  'с',
  'со',
  'и',
  'или',
  'для',
  'у',
  'за',
  'под',
  'при',
  'через',
  'это',
  'эконом',
  'комфорт',
  'бизнес',
  'класса',
  'сдан',
  'сдана',
  'сдача',
  'строится',
  'продажа',
  'продаются',
  'продаем',
  'квартиры',
  'квартира',
  'дом',
  'дома',
  'город',
  'адрес',
  'адресу',
]);

/**
 * Название объекта в тексте: «ЖК «Алтай-Арман»», «ЖК Коктем Парк»,
 * «тұрғын үй кешені «Нұрлы Жол»».
 *
 * Названия извлекаются из текста самостоятельно, а не берутся из цитат
 * совпадений с реестром. Разница существенная: совпадение может быть
 * найдено по адресу или телефону, и тогда его цитата — это адрес, а не
 * название. Показать аналитику адрес в графе «названия» значит соврать
 * ему о том, что увидела система.
 *
 * Указатель «ЖК» обязателен: без него любое словосочетание с заглавной
 * буквы стало бы «названием», а регистр в свёрнутом тексте недоступен.
 */
const PROJECT_NAME_PATTERN = new RegExp(
  '(?:жк|жилой\\s+комплекс|тұрғын\\s+үй\\s+кешені)\\s*[«"„]([^»"“\\n]{2,40})[»"“]' +
    '|(?:жк|жилой\\s+комплекс|тұрғын\\s+үй\\s+кешені)\\s+' +
    '([\\p{L}][\\p{L}\\p{N}-]{1,20}(?:\\s+[\\p{L}][\\p{L}\\p{N}-]{1,20})?)',
  'gu',
);

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

function anyPatternHits(text: string, patterns: readonly RegExp[]) {
  return patterns.flatMap((pattern) => findPattern(text, pattern));
}

/**
 * Отрезает служебные слова с краёв найденного названия.
 *
 * Шаблон берёт после «ЖК» до двух слов, и второе может оказаться предлогом:
 * «ЖК Алтай-Арман на Протозанова» даёт «Алтай-Арман на». Лишнее слово не
 * только выглядит небрежно — оно искажает нормализованное написание и мешает
 * сопоставлению с реестром.
 */
function trimStopWords(hit: PatternHit): PatternHit {
  let { fragment, charStart, charEnd } = hit;

  for (;;) {
    const leading = /^[\s«»"'„“-]+/.exec(fragment)?.[0]?.length ?? 0;
    if (leading > 0) {
      fragment = fragment.slice(leading);
      charStart += leading;
      continue;
    }

    const trailing = /[\s«»"'„“-]+$/.exec(fragment)?.[0]?.length ?? 0;
    if (trailing > 0) {
      fragment = fragment.slice(0, -trailing);
      charEnd -= trailing;
      continue;
    }

    const lastWord = /(\s+)(\S+)$/.exec(fragment);
    if (lastWord && NAME_STOP_WORDS.has(fold(lastWord[2] ?? ''))) {
      const cut = (lastWord[1]?.length ?? 0) + (lastWord[2]?.length ?? 0);
      fragment = fragment.slice(0, -cut);
      charEnd -= cut;
      continue;
    }

    return { fragment, charStart, charEnd };
  }
}

/**
 * Извлекает названия объектов, упомянутые в тексте.
 *
 * Отсекаются конструкции, где после «ЖК» идёт не название, а продолжение
 * фразы, и названия короче трёх символов: «ЖК в» названием не является.
 */
function extractProjectNames(text: string) {
  return dedupeSpans(
    findCapture(text, PROJECT_NAME_PATTERN)
      .map(trimStopWords)
      .filter((hit) => {
        const normalized = normalizeName(hit.fragment);
        if (normalized.length < 3) return false;
        const first = normalized.split(' ')[0] ?? '';
        return !NAME_STOP_WORDS.has(first);
      }),
  ).map((hit) => ({
    fragment: hit.fragment,
    charStart: hit.charStart,
    charEnd: hit.charEnd,
    normalized: normalizeName(hit.fragment),
  }));
}

function toSpan(text: string, charStart: number, charEnd: number): Span {
  const sentence = expandToSentence(text, charStart, charEnd);
  return {
    fragment: sentence.fragment,
    charStart: sentence.charStart,
    charEnd: sentence.charEnd,
  };
}

function dedupeSpans<T extends { charStart: number; charEnd: number }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of [...items].sort((a, b) => a.charStart - b.charStart)) {
    const key = `${item.charStart}:${item.charEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** Маркирует гипотезу как неуверенную и приводит уверенность к допустимой. */
function finalizeHypothesis(
  code: FactorHypothesis['code'],
  rawConfidence: number,
  span: Span | null,
  rationale: Label,
  verification: Label,
): FactorHypothesis {
  const alwaysLow = (ALWAYS_LOW_CONFIDENCE_FACTORS as readonly string[]).includes(code);
  // Для R5 и R6 уверенность принудительно держится ниже порога маркировки:
  // числа из рекламы — это заявление застройщика, а не результат проверки.
  const ceiling = alwaysLow ? LOW_CONFIDENCE_THRESHOLD - 0.05 : 0.95;
  const confidence = clampConfidence(Math.min(rawConfidence, ceiling), 0.1, 0.95);

  return {
    code,
    confidence,
    lowConfidence: confidence < LOW_CONFIDENCE_THRESHOLD,
    span,
    rationale,
    verification,
    confirmable: false,
  };
}

// ---------------------------------------------------------------------------
// Извлечение условий оплаты
// ---------------------------------------------------------------------------

function extractPaymentTerms(text: string): PaymentTerm[] {
  const amounts = extractAmounts(text);
  const terms: PaymentTerm[] = [];

  for (const entry of PAYMENT_TERMS) {
    for (const pattern of entry.patterns) {
      for (const hit of findPattern(text, pattern)) {
        const sentence = expandToSentence(text, hit.charStart, hit.charEnd);
        const amount = nearestAmount(amounts, hit.charStart);
        terms.push({
          category: entry.category,
          riskBearing: entry.riskBearing,
          label: entry.label,
          note: entry.note,
          fragment: sentence.fragment,
          charStart: sentence.charStart,
          charEnd: sentence.charEnd,
          amount: amount?.amount ?? null,
        });
      }
    }
  }

  // Одна фраза может сработать по нескольким шаблонам одной категории.
  const seen = new Set<string>();
  return terms
    .sort((a, b) => a.charStart - b.charStart)
    .filter((term) => {
      const key = `${term.category}:${term.charStart}:${term.charEnd}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ---------------------------------------------------------------------------
// Гипотеза R2: привлечение средств вне законной схемы
// ---------------------------------------------------------------------------

/**
 * R2 — самая содержательная часть разбора и единственное место, где движок
 * обязан не ошибиться в обе стороны.
 *
 * Срабатывание строится только на риск-несущих формулировках. Законные схемы
 * расчётов (эскроу, уполномоченный банк, ипотека, Единый оператор) снижают
 * уверенность: текст «оплата через уполномоченный банк на счёт эскроу»
 * описывает предусмотренный законом порядок, и выдать по нему гипотезу
 * нарушения — значит обвинить добросовестного застройщика.
 *
 * Если риск-несущих формулировок нет вообще, гипотеза не создаётся.
 * Если законная схема названа, а риск-несущая формулировка одна и без суммы,
 * гипотеза тоже не создаётся: одного слова «рассрочка» рядом с ипотечной
 * программой недостаточно для утверждения о нарушении.
 */
function hypothesizeR2(terms: readonly PaymentTerm[]): FactorHypothesis | null {
  const risky = terms.filter((term) => term.riskBearing);
  const lawful = terms.filter((term) => !term.riskBearing);

  if (risky.length === 0) return null;

  const riskyCategories = new Set(risky.map((term) => term.category));
  const withAmount = risky.filter((term) => term.amount !== null);

  // Законная схема названа, а риск-несущий признак слабый — отказ от гипотезы.
  if (lawful.length > 0 && riskyCategories.size === 1 && withAmount.length === 0) {
    return null;
  }

  let confidence = 0.55;
  if (withAmount.length > 0) confidence += 0.2;
  if (riskyCategories.size > 1) confidence += 0.1;
  if (riskyCategories.has('DIRECT_TRANSFER')) confidence += 0.1;
  if (lawful.length > 0) confidence -= 0.25;

  const anchor = withAmount[0] ?? risky[0];
  if (!anchor) return null;

  const categories = risky.map((term) => term.label.ru).join(', ');
  const categoriesKk = risky.map((term) => term.label.kk).join(', ');
  const lawfulNote =
    lawful.length > 0
      ? ` В тексте также названа законная схема расчётов (${lawful.map((t) => t.label.ru).join(', ')}), уверенность снижена.`
      : '';
  const lawfulNoteKk =
    lawful.length > 0
      ? ` Мәтінде заңды есеп айырысу схемасы да аталған (${lawful.map((t) => t.label.kk).join(', ')}), сенімділік төмендетілді.`
      : '';

  return finalizeHypothesis(
    'R2',
    confidence,
    { fragment: anchor.fragment, charStart: anchor.charStart, charEnd: anchor.charEnd },
    {
      ru: `В тексте найдены формулировки о приёме денег до оформления законной схемы: ${categories}.${lawfulNote}`,
      kk: `Мәтінде заңды схема ресімделгенге дейін қаражат алу туралы тұжырымдар табылды: ${categoriesKk}.${lawfulNoteKk}`,
    },
    {
      ru: 'Подтвердить фрагментом публикации или снимком экрана и сверить фактический порядок расчётов с правовым основанием объекта.',
      kk: 'Жарияланым үзіндісімен немесе экран суретімен растап, есеп айырысудың нақты тәртібін нысанның заңды негіздемесімен салыстыру.',
    },
  );
}

// ---------------------------------------------------------------------------
// Гипотеза R3: реклама продажи строящегося жилья
// ---------------------------------------------------------------------------

function hypothesizeR3(
  text: string,
  hasSale: boolean,
  hasHousing: boolean,
  underConstruction: readonly { fragment: string; charStart: number; charEnd: number }[],
): FactorHypothesis | null {
  if (!hasHousing) return null;
  if (!hasSale && underConstruction.length === 0) return null;

  let confidence = 0.5;
  if (hasSale && hasHousing) confidence += 0.2;
  if (underConstruction.length > 0) confidence += 0.15;
  if (underConstruction.length > 1) confidence += 0.05;

  const anchor = underConstruction[0];
  const span = anchor ? toSpan(text, anchor.charStart, anchor.charEnd) : null;

  return finalizeHypothesis(
    'R3',
    confidence,
    span,
    {
      ru: anchor
        ? 'Текст предлагает жильё и одновременно указывает на незавершённое строительство.'
        : 'Текст предлагает жильё; признак незавершённого строительства прямо не назван, стадию нужно взять из реестра.',
      kk: anchor
        ? 'Мәтін тұрғын үй ұсынады және сонымен бірге құрылыстың бітпегенін көрсетеді.'
        : 'Мәтін тұрғын үй ұсынады; құрылыстың бітпеуі тікелей аталмаған, сатыны тізілімнен алу қажет.',
    },
    {
      ru: 'Сверить стадию объекта в реестре: для введённого в эксплуатацию дома фактор неприменим.',
      kk: 'Нысанның сатысын тізілімде салыстыру: пайдалануға берілген үй үшін фактор қолданылмайды.',
    },
  );
}

// ---------------------------------------------------------------------------
// Гипотезы R5 и R6: числа, требующие независимого источника
// ---------------------------------------------------------------------------

function hypothesizeR5(
  text: string,
  readinessMentions: readonly { value: number; charStart: number; charEnd: number }[],
): FactorHypothesis | null {
  const anchor = readinessMentions[0];
  if (!anchor) return null;

  return finalizeHypothesis(
    'R5',
    0.5,
    toSpan(text, anchor.charStart, anchor.charEnd),
    {
      ru: `В объявлении заявлена готовность ${anchor.value}%. Это заявление застройщика, а не результат проверки: расхождение устанавливается сравнением с проверенным значением.`,
      kk: `Хабарландыруда ${anchor.value}% дайындық мәлімделген. Бұл құрылыс салушының мәлімдемесі, тексеру нәтижесі емес.`,
    },
    {
      ru: 'Получить проверенное значение готовности (акт, выездная проверка) и сравнить с заявленным; фактор начисляется при расхождении от 20 процентных пунктов с указанием источника по обоим значениям.',
      kk: 'Дайындықтың тексерілген мәнін алып (акт, шығып тексеру), мәлімделгенмен салыстыру; фактор 20 пайыздық тармақтан асатын алшақтықта есептеледі.',
    },
  );
}

function hypothesizeR6(
  text: string,
  delayMentions: readonly { charStart: number; charEnd: number }[],
): FactorHypothesis | null {
  const anchor = delayMentions[0];
  if (!anchor) return null;

  return finalizeHypothesis(
    'R6',
    0.45,
    toSpan(text, anchor.charStart, anchor.charEnd),
    {
      ru: 'Текст упоминает перенос срока или остановку работ. Сам факт упоминания не задаёт длительность просрочки.',
      kk: 'Мәтінде мерзімнің ауысуы немесе жұмыстың тоқтауы аталған. Аталуының өзі кешігу ұзақтығын белгілемейді.',
    },
    {
      ru: 'Сверить проектный и фактический срок ввода по документам: фактор начисляется при просрочке от 90 дней, подтверждённой документом или выездной проверкой.',
      kk: 'Жобалық және нақты мерзімді құжаттар бойынша салыстыру: фактор 90 күннен асатын кешігуде есептеледі.',
    },
  );
}

// ---------------------------------------------------------------------------
// Сопоставление с реестром
// ---------------------------------------------------------------------------

/**
 * Нечёткое сопоставление публикации с объектом.
 *
 * Сравнение идёт по нескольким независимым признакам, и каждый из них
 * фиксируется в matchedOn, чтобы аналитик видел основание связи.
 * Совпадение телефона — самый сильный признак: номер в объявлении
 * совпадает с номером из уже подтверждённой публикации объекта.
 */
function matchProjects(
  text: string,
  title: string | null | undefined,
  projects: readonly ProjectCandidate[],
  phones: readonly string[],
): ProjectMatch[] {
  const haystack = title ? `${title}\n${text}` : text;
  const offset = title ? title.length + 1 : 0;
  const matches: ProjectMatch[] = [];

  /**
   * Переводит позицию из склейки «заголовок + текст» в позицию исходного
   * текста. Совпадение, попавшее в заголовок, цитатой не становится:
   * позиции в заголовке к тексту объявления не относятся, а неточная
   * подсветка хуже её отсутствия.
   */
  const spanInText = (hit: { charStart: number; charEnd: number }): Span | null => {
    if (hit.charStart < offset) return null;
    const start = hit.charStart - offset;
    const end = hit.charEnd - offset;
    if (end <= start || end > text.length) return null;
    return { fragment: text.slice(start, end), charStart: start, charEnd: end };
  };

  for (const project of projects) {
    const matchedOn: ProjectMatch['matchedOn'] = [];
    let score = 0;
    let span: Span | null = null;

    // --- Название ----------------------------------------------------------
    let nameScore = 0;
    let nameSpan: Span | null = null;
    for (const name of [project.name, project.nameKk].filter((item): item is string => !!item)) {
      const found = findNameInText(haystack, name);
      if (found && found.score > nameScore) {
        nameScore = found.score;
        nameSpan = spanInText(found);
      }
    }
    if (nameScore >= MATCH_THRESHOLD) {
      matchedOn.push('NAME');
      score = nameScore;
      span = nameSpan;
    }

    // --- Адрес -------------------------------------------------------------
    const key = project.address ? addressKey(project.address) : '';
    if (key.length > 0) {
      const found = findNameInText(haystack, key);
      if (found && found.score >= ADDRESS_THRESHOLD) {
        matchedOn.push('ADDRESS');
        score = Math.max(score, found.score * 0.9);
        span = span ?? spanInText(found);
      }
    }

    // --- Застройщик --------------------------------------------------------
    if (project.developerName) {
      const found = findNameInText(haystack, project.developerName);
      if (found && found.score >= 0.85) {
        matchedOn.push('DEVELOPER');
        score = Math.max(score, 0.7);
        span = span ?? spanInText(found);
      }
    }

    const phoneOverlap = (project.knownPhones ?? []).filter((phone) => phones.includes(phone));
    if (phoneOverlap.length > 0) {
      matchedOn.push('PHONE');
      score = Math.max(score, 0.85);
    }

    if (matchedOn.length === 0) continue;

    const reasons: string[] = [];
    const reasonsKk: string[] = [];
    if (matchedOn.includes('NAME')) {
      reasons.push('совпадение названия');
      reasonsKk.push('атау сәйкестігі');
    }
    if (matchedOn.includes('ADDRESS')) {
      reasons.push('совпадение адреса');
      reasonsKk.push('мекенжай сәйкестігі');
    }
    if (matchedOn.includes('DEVELOPER')) {
      reasons.push('упоминание застройщика');
      reasonsKk.push('құрылыс салушының аталуы');
    }
    if (matchedOn.includes('PHONE')) {
      reasons.push(`совпадение телефона (${phoneOverlap.join(', ')})`);
      reasonsKk.push(`телефон сәйкестігі (${phoneOverlap.join(', ')})`);
    }

    matches.push({
      projectId: project.id,
      projectName: project.name,
      score: clampConfidence(score, 0.1, 0.99),
      matchedOn,
      span,
      rationale: {
        ru: `Предложено по признакам: ${reasons.join(', ')}. Связь должен подтвердить аналитик.`,
        kk: `Белгілер бойынша ұсынылды: ${reasonsKk.join(', ')}. Байланысты талдаушы растауы қажет.`,
      },
      requiresConfirmation: true,
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, MAX_MATCHES);
}

// ---------------------------------------------------------------------------
// Провайдер
// ---------------------------------------------------------------------------

export function analyzeWithRules(input: AnalyzeInput): AnalysisResult {
  const startedAt = Date.now();
  const text = input.text ?? '';
  const locale = input.locale ?? 'ru';

  const housingHits = findPattern(text, HOUSING_NOUN_PATTERN);
  const saleHits = anyPatternHits(text, SALE_PATTERNS);
  const underConstruction = dedupeSpans(anyPatternHits(text, UNDER_CONSTRUCTION_PATTERNS));
  const readinessHits = dedupeSpans(anyPatternHits(text, READINESS_PATTERNS));
  const delayHits = dedupeSpans(anyPatternHits(text, DELAY_PATTERNS));
  const legalBasisClaims = dedupeSpans(anyPatternHits(text, LEGAL_BASIS_CLAIM_PATTERNS));
  const addresses = dedupeSpans(findPattern(text, ADDRESS_PATTERN));
  const projectNames = extractProjectNames(text);

  const phones = dedupeSpans(extractPhones(text));
  const amounts = dedupeSpans(extractAmounts(text));
  const percents = dedupeSpans(extractPercents(text));
  const years = dedupeSpans(extractYears(text));
  const paymentTerms = extractPaymentTerms(text);

  // Готовность — это процент, стоящий рядом с формулировкой о готовности,
  // а не любое число с процентом: «скидка 10%» готовностью не является.
  const readinessMentions = percents.filter((percent) =>
    readinessHits.some(
      (hit) => percent.charStart >= hit.charStart - 2 && percent.charEnd <= hit.charEnd + 2,
    ),
  );

  const isHousingAd = housingHits.length > 0 || saleHits.length > 0;

  const hypotheses = [
    hypothesizeR2(paymentTerms),
    hypothesizeR3(text, saleHits.length > 0, housingHits.length > 0, underConstruction),
    hypothesizeR5(text, readinessMentions),
    hypothesizeR6(text, delayHits),
  ].filter((item): item is FactorHypothesis => item !== null);

  const projectMatches = matchProjects(
    text,
    input.title,
    input.projects ?? [],
    phones.map((phone) => phone.normalized),
  );

  // --- Пункты обязательной проверки ----------------------------------------
  const checks: Label[] = [LEGAL_BASIS_CHECK, APPEALS_CHECK];
  if (legalBasisClaims.length > 0) {
    checks.push({
      ru: 'В объявлении заявлено правовое основание — сверить заявление с реестром: ссылка на разрешение в рекламе сама по себе ничего не подтверждает.',
      kk: 'Хабарландыруда заңды негіздеме мәлімделген — мәлімдемені тізіліммен салыстыру қажет.',
    });
  }
  if (projectMatches.length > 0) {
    checks.push({
      ru: 'Подтвердить или отклонить предложенную связь публикации с объектом до внесения факторов.',
      kk: 'Факторларды енгізгенге дейін жарияланымның нысанмен ұсынылған байланысын растау немесе қабылдамау.',
    });
  }

  // --- Замечания к разбору --------------------------------------------------
  const warnings: Label[] = [];
  if (!isHousingAd) {
    warnings.push({
      ru: 'Признаков рекламы жилья в тексте не найдено. Разбор может быть неполным.',
      kk: 'Мәтінде тұрғын үй жарнамасының белгілері табылмады. Талдау толық болмауы мүмкін.',
    });
  }
  if (text.trim().length < 60) {
    warnings.push({
      ru: 'Текст короткий: формулировок для надёжного разбора может не хватать.',
      kk: 'Мәтін қысқа: сенімді талдау үшін тұжырымдар жеткіліксіз болуы мүмкін.',
    });
  }
  if (projectMatches.length === 0 && (input.projects?.length ?? 0) > 0) {
    warnings.push({
      ru: 'Объект реестра по тексту не определён. Привязку нужно выбрать вручную.',
      kk: 'Мәтін бойынша тізілім нысаны анықталмады. Байланысты қолмен таңдау қажет.',
    });
  }

  // --- Сводка ---------------------------------------------------------------
  const codes = hypotheses.map((item) => item.code).join(', ');
  const summary: Label = {
    ru: hypotheses.length > 0
      ? `Найдены основания для проверки факторов: ${codes}. Это гипотезы: баллы начисляются только после подтверждения аналитиком. Правовое основание (R1) по тексту не устанавливается.`
      : 'Формулировок, дающих основание для гипотез по факторам риска, в тексте не найдено. Правовое основание всё равно требует проверки в реестре.',
    kk: hypotheses.length > 0
      ? `Факторларды тексеруге негіздер табылды: ${codes}. Бұл болжамдар: балл талдаушы растағаннан кейін ғана есептеледі. Заңды негіздеме (R1) мәтін бойынша анықталмайды.`
      : 'Мәтінде тәуекел факторлары бойынша болжам жасауға негіз беретін тұжырымдар табылмады. Заңды негіздеме тізілімде тексерілуі қажет.',
  };
  void locale;

  return analysisResultSchema.parse({
    provider: 'rules',
    model: null,
    durationMs: Date.now() - startedAt,
    isHousingAd,
    mentionsUnderConstruction: underConstruction.length > 0,
    extracted: {
      projectNames,
      addresses,
      phones,
      amounts,
      paymentTerms,
      readinessMentions,
      completionYears: years,
      legalBasisClaims,
      delayMentions: delayHits,
    },
    factorHypotheses: hypotheses,
    projectMatches,
    checks,
    warnings,
    summary,
  });
}

export const rulesProvider: AiProvider = {
  id: 'rules',
  description: {
    ru: 'Детерминированный разбор по словарю формулировок: каждая гипотеза привязана к шаблону и цитате из текста, один и тот же текст всегда даёт один и тот же результат.',
    kk: 'Тұжырымдар сөздігі бойынша детерминделген талдау: әрбір болжам шаблонға және мәтіннен алынған үзіндіге байланысты.',
  },
  isAvailable: () => true,
  analyze: async (input) => analyzeWithRules(input),
};
