/**
 * Разрезание текста объявления на куски для подсветки.
 *
 * Задача выглядит простой — «покрасить найденные фрагменты» — и становится
 * непростой из-за одного обстоятельства: фрагменты пересекаются. Гипотеза
 * ИИ цитирует «бронирование 150 000 тенге», аналитик приложил
 * доказательством «бронирование», и обе подсветки претендуют на одни и те
 * же символы.
 *
 * Разметка не терпит пересечений: вложить <mark> в <mark> с разными
 * смыслами нельзя. Поэтому текст разрезается по всем границам сразу, и
 * каждый кусок получает набор ролей, которые на него попали. Кусок с
 * двумя ролями подсвечивается третьим способом — «и предложено, и
 * подтверждено», — а не произвольно выбранным из двух.
 *
 * Отдельно важна устойчивость к мусорным границам. Смещения приходят из
 * разбора текста и из записей доказательств, сделанных раньше: текст
 * объявления мог быть отредактирован, смещение — выйти за его пределы или
 * оказаться перевёрнутым. Такой фрагмент молча отбрасывается, а не рушит
 * страницу: лучше показать объявление без одной подсветки, чем не
 * показать объявление.
 *
 * Модуль не зависит ни от React, ни от Prisma — и поэтому проверяется
 * тестами целиком.
 */

/**
 * Три вида подсветки, и различать их обязательно.
 *
 * TERM — сработавшее слово-ловушка. Это самое слабое из трёх утверждений:
 * «в тексте встретилось слово из списка», и ничего больше. Слово поймало
 * объявление в выборку, но о риске не говорит — «бронь» бывает и законной.
 *
 * AI — цитата, на которую ссылается гипотеза разбора: вопрос аналитику.
 *
 * EVIDENCE — фрагмент, приложенный аналитиком к фактору: утверждение,
 * за которым стоит человек с именем и датой.
 *
 * Одинаковое оформление сложило бы находку текстового фильтра и решение
 * человека в одно, и читатель дела увидел бы доказательство там, где
 * сработал поиск подстроки.
 */
export type HighlightRole = 'TERM' | 'AI' | 'EVIDENCE';

export interface HighlightSpan {
  charStart: number;
  charEnd: number;
  role: HighlightRole;
  /** Что показать во всплывающей подсказке. */
  title?: string;
  /** Для перехода к источнику подсветки. */
  refId?: string;
}

export interface TextSegment {
  text: string;
  charStart: number;
  charEnd: number;
  /** Роли, попавшие на этот кусок. Пустой набор — обычный текст. */
  roles: HighlightRole[];
  /** Подсказки всех фрагментов, накрывших кусок, без повторов. */
  titles: string[];
  refIds: string[];
}

/**
 * Класс подсветки для куска — один на все случаи, чтобы не плодить
 * условия в разметке.
 *
 * Когда на кусок попало несколько ролей, показывается сильнейшая:
 * решение человека важнее вопроса алгоритма, вопрос алгоритма важнее
 * совпадения со списком слов. Слабая роль при этом не пропадает — она
 * остаётся в подсказке куска.
 */
export function segmentClass(segment: TextSegment): string | null {
  const ai = segment.roles.includes('AI');
  const evidence = segment.roles.includes('EVIDENCE');
  if (ai && evidence) return 'hl-both';
  if (evidence) return 'hl-evidence';
  if (ai) return 'hl-ai';
  if (segment.roles.includes('TERM')) return 'hl-term';
  return null;
}

/**
 * Отбрасывает фрагменты, которые нельзя применить к данному тексту.
 *
 * Проверка идёт по длине текста, а не по совпадению цитаты: цитату
 * сверяет разбор при создании, здесь задача скромнее — не дать смещению
 * вывести за границы строки.
 */
export function usableSpans(text: string, spans: readonly HighlightSpan[]): HighlightSpan[] {
  return spans.filter(
    (span) =>
      Number.isInteger(span.charStart) &&
      Number.isInteger(span.charEnd) &&
      span.charStart >= 0 &&
      span.charEnd > span.charStart &&
      span.charEnd <= text.length,
  );
}

/**
 * Разрезает текст на куски по границам всех фрагментов.
 *
 * Возвращается полное покрытие текста: сумма кусков равна исходной
 * строке. Это свойство проверяется тестом и нужно затем, чтобы разметка
 * собиралась простым перебором без склейки остатков.
 */
export function toSegments(text: string, spans: readonly HighlightSpan[]): TextSegment[] {
  if (text.length === 0) return [];

  const usable = usableSpans(text, spans);
  if (usable.length === 0) {
    return [{ text, charStart: 0, charEnd: text.length, roles: [], titles: [], refIds: [] }];
  }

  // Границы: начало, конец и края каждого фрагмента. Повторы убираются.
  const edges = new Set<number>([0, text.length]);
  for (const span of usable) {
    edges.add(span.charStart);
    edges.add(span.charEnd);
  }

  const points = [...edges].sort((a, b) => a - b);
  const segments: TextSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (end <= start) continue;

    // Фрагмент накрывает кусок, если пересекается с ним целиком:
    // куски строятся по границам, поэтому частичного попадания не бывает.
    const covering = usable.filter((span) => span.charStart <= start && span.charEnd >= end);

    segments.push({
      text: text.slice(start, end),
      charStart: start,
      charEnd: end,
      roles: uniqueRoles(covering.map((span) => span.role)),
      titles: unique(covering.map((span) => span.title).filter(isText)),
      refIds: unique(covering.map((span) => span.refId).filter(isText)),
    });
  }

  return segments;
}

/**
 * Укороченный текст с сохранением подсветок.
 *
 * Нужен в списках: там показывается начало объявления, но подсветка
 * должна остаться на месте, иначе список и карточка расходятся. Куски,
 * целиком ушедшие за предел, отбрасываются; кусок на границе
 * подрезается вместе со своим смещением.
 */
export function clipSegments(segments: readonly TextSegment[], limit: number): TextSegment[] {
  const result: TextSegment[] = [];

  for (const segment of segments) {
    if (segment.charStart >= limit) break;
    if (segment.charEnd <= limit) {
      result.push(segment);
      continue;
    }
    result.push({
      ...segment,
      text: segment.text.slice(0, limit - segment.charStart),
      charEnd: limit,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------

function isText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Порядок ролей фиксирован, чтобы сравнение наборов в тестах было устойчивым. */
function uniqueRoles(values: readonly HighlightRole[]): HighlightRole[] {
  const set = new Set(values);
  const ordered: HighlightRole[] = [];
  if (set.has('TERM')) ordered.push('TERM');
  if (set.has('AI')) ordered.push('AI');
  if (set.has('EVIDENCE')) ordered.push('EVIDENCE');
  return ordered;
}
