/**
 * Сверка: что записано в карточке ЖК против того, что ответил реестр.
 *
 * Смысл слоя. Аналитик вносит в карточку застройщика, разрешение, сроки —
 * со слов объявления, сайта продаж или заявки. Реестр отвечает своё.
 * Расхождение между этими двумя записями — само по себе не нарушение,
 * но это ровно то место, куда проверяющий смотрит в первую очередь,
 * и показать его надо явно, с датой запроса и адресом, по которому ответ
 * можно получить повторно.
 *
 * Главное ограничение, закреплённое здесь кодом, а не обещанием.
 * Фактор R1 звучит как «установлено отсутствие применимого правового
 * основания», и к нему в модели приписана оговорка: отсутствие доступа
 * к реестру или ответ «нет данных» основанием для начисления не являются.
 * Разведка показала, что разрешения МИО на привлечение денег дольщиков
 * в открытых данных не публикуются вовсе. Значит, ни один машинный ответ
 * не может подтвердить R1 — он может только его снять, если разрешение
 * нашлось. Поэтому у типа R1Bearing нет значения «подтверждает»: его
 * нельзя получить, и притворяться, что можно, в инструменте надзорного
 * органа нельзя тем более. Начисление R1 остаётся действием человека
 * с документом на руках и идёт через обычный механизм факторов.
 *
 * Второе ограничение: сверка не трогает баллы. Налоговая задолженность,
 * сведения ГБД ЮЛ и аттестаты — это сведения о застройщике, а не факторы
 * риска. Шкала на сто баллов откалибрована под шесть факторов, и дописать
 * в неё седьмой «за долги» значит молча обесценить остальные. В типе итога
 * поле affectsScore имеет буквальный тип false: его невозможно выставить
 * в true, не переписав этот файл.
 *
 * Модуль чистый: ни сети, ни Prisma, ни текущего времени.
 */

import { z } from 'zod';

import type { Label } from '../domain/enums';

import { findRegistrySource } from './sources';

// ---------------------------------------------------------------------------
// Ответ реестра
// ---------------------------------------------------------------------------

export const REGISTRY_ANSWERS = ['FOUND', 'NOT_FOUND', 'UNAVAILABLE'] as const;
export const registryAnswerSchema = z.enum(REGISTRY_ANSWERS);
export type RegistryAnswer = z.infer<typeof registryAnswerSchema>;

export const REGISTRY_ANSWER_LABELS: Record<RegistryAnswer, Label> = {
  FOUND: { ru: 'Запись найдена', kk: 'Жазба табылды' },
  NOT_FOUND: { ru: 'Записи нет', kk: 'Жазба жоқ' },
  UNAVAILABLE: { ru: 'Ответ не получен', kk: 'Жауап алынбады' },
};

export const REGISTRY_ANSWER_HINTS: Record<RegistryAnswer, Label> = {
  FOUND: {
    ru: 'Реестр ответил, и запрошенная запись в нём есть.',
    kk: 'Тізілім жауап берді және сұралған жазба онда бар.',
  },
  NOT_FOUND: {
    ru: 'Реестр ответил, но запрошенной записи в нём нет. Это не то же самое, что «нарушений нет»: запись могла не попасть в набор, а поле поиска — называться иначе.',
    kk: 'Тізілім жауап берді, бірақ сұралған жазба онда жоқ. Бұл «бұзушылық жоқ» дегенді білдірмейді: жазба жиынтыққа енбеген, ал іздеу өрісі басқаша аталуы мүмкін.',
  },
  UNAVAILABLE: {
    ru: 'Ответ от реестра не получен: служба недоступна, ответ не разобран либо источник проверяется только вручную.',
    kk: 'Тізілімнен жауап алынбады: қызмет қолжетімсіз, жауап талданбады немесе дереккөз тек қолмен тексеріледі.',
  },
};

// ---------------------------------------------------------------------------
// Отношение ответа к фактору R1
// ---------------------------------------------------------------------------

/**
 * Значения ровно два, и третьего не предусмотрено намеренно — см. заголовок.
 * «Снимает» означает: реестр показал применимое основание, и фактор
 * «отсутствие правового основания» в карточке держать больше не на чем.
 */
export const R1_BEARINGS = ['WITHDRAWS_R1', 'NO_BEARING'] as const;
export const r1BearingSchema = z.enum(R1_BEARINGS);
export type R1Bearing = z.infer<typeof r1BearingSchema>;

export const R1_BEARING_LABELS: Record<R1Bearing, Label> = {
  WITHDRAWS_R1: { ru: 'Снимает основание для R1', kk: 'R1 үшін негізді алып тастайды' },
  NO_BEARING: { ru: 'На R1 не влияет', kk: 'R1-ге әсер етпейді' },
};

export const R1_BEARING_HINTS: Record<R1Bearing, Label> = {
  WITHDRAWS_R1: {
    ru: 'Реестр показал применимое правовое основание. Фактор «установлено отсутствие правового основания» следует снять, а снятие — обосновать в карточке.',
    kk: 'Тізілім қолданылатын құқықтық негізді көрсетті. «Құқықтық негіздің жоқтығы анықталды» факторын алып тастау керек, ал алып тастауды картада негіздеу қажет.',
  },
  NO_BEARING: {
    ru: 'Ответ реестра не меняет фактор R1. Начислить R1 по ответу «нет данных» или по недоступности службы нельзя — это прямо запрещено оговоркой к фактору.',
    kk: 'Тізілімнің жауабы R1 факторын өзгертпейді. «Дерек жоқ» жауабы немесе қызметтің қолжетімсіздігі бойынша R1 есептеуге болмайды: бұл факторға берілген ескертпеде тікелей тыйым салынған.',
  },
};

/**
 * Как ответ реестра соотносится с фактором R1.
 *
 * Источники с назначением DEVELOPER_PROFILE не влияют на R1 ни при каком
 * ответе: это сведения о застройщике, а не о правовом основании стройки.
 * Проверка стоит здесь, а не в вызывающем коде, чтобы её нельзя было
 * забыть при добавлении следующего источника.
 *
 * Неизвестный идентификатор источника — это ошибка вызова, а не повод
 * что-то начислить, поэтому ответ NO_BEARING.
 */
export function bearingOnR1(sourceId: string, answer: RegistryAnswer): R1Bearing {
  const source = findRegistrySource(sourceId);
  if (source === null) return 'NO_BEARING';
  if (source.bearing !== 'LEGAL_BASIS') return 'NO_BEARING';
  return answer === 'FOUND' ? 'WITHDRAWS_R1' : 'NO_BEARING';
}

// ---------------------------------------------------------------------------
// Сравнение значений
// ---------------------------------------------------------------------------

export const FIELD_VERDICTS = [
  'MATCH',
  'MISMATCH',
  'ONLY_IN_CARD',
  'ONLY_IN_REGISTRY',
  'ABSENT_BOTH',
] as const;
export const fieldVerdictSchema = z.enum(FIELD_VERDICTS);
export type FieldVerdict = z.infer<typeof fieldVerdictSchema>;

export const FIELD_VERDICT_LABELS: Record<FieldVerdict, Label> = {
  MATCH: { ru: 'Совпадает', kk: 'Сәйкес келеді' },
  MISMATCH: { ru: 'Расходится', kk: 'Сәйкес келмейді' },
  ONLY_IN_CARD: { ru: 'Только в карточке', kk: 'Тек картада' },
  ONLY_IN_REGISTRY: { ru: 'Только в реестре', kk: 'Тек тізілімде' },
  ABSENT_BOTH: { ru: 'Нет ни там, ни там', kk: 'Екі жерде де жоқ' },
};

/**
 * Сокращения организационно-правовых форм.
 *
 * «ТОО „Монтероса"» и «Товарищество с ограниченной ответственностью
 * „Монтероса"» — одна организация, записанная двумя способами, и подсветить
 * это как расхождение значит отправить аналитика проверять пустое место.
 * А вот ТОО против АО — расхождение настоящее, и оно остаётся: формы
 * приводятся к сокращению, но не отбрасываются.
 */
const LEGAL_FORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/товарищество\s+с\s+ограниченной\s+ответственностью/g, 'тоо'],
  [/жауапкершілігі\s+шектеулі\s+серіктестік/g, 'тоо'],
  [/акционерное\s+общество/g, 'ао'],
  [/акционерлік\s+қоғам/g, 'ао'],
  [/индивидуальный\s+предприниматель/g, 'ип'],
  [/жеке\s+кәсіпкер/g, 'ип'],
  [/производственный\s+кооператив/g, 'пк'],
  [/государственное\s+предприятие/g, 'гп'],
];

/**
 * Приводит строку к виду, пригодному для сравнения.
 *
 * Что снимается: регистр, кавычки всех видов, лишние пробелы, различие
 * «е» и «ё», длинное тире против дефиса, точки в сокращениях.
 * Что НЕ снимается: цифры, порядок слов, организационно-правовая форма.
 * Всё это — содержательные различия, и прятать их нельзя.
 */
export function normalizeForComparison(value: string): string {
  let text = value.toLowerCase().trim();
  text = text.replace(/ё/g, 'е');
  text = text.replace(/[«»"'“”„‟`’]/g, ' ');
  text = text.replace(/[—–−]/g, '-');
  text = text.replace(/\./g, ' ');
  for (const [pattern, short] of LEGAL_FORMS) {
    text = text.replace(pattern, short);
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/** Пустая строка и строка из пробелов — это «значения нет». */
function present(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function compareValues(
  declared: string | null | undefined,
  registry: string | null | undefined,
): FieldVerdict {
  const left = present(declared);
  const right = present(registry);

  if (left === null && right === null) return 'ABSENT_BOTH';
  if (left === null) return 'ONLY_IN_REGISTRY';
  if (right === null) return 'ONLY_IN_CARD';

  return normalizeForComparison(left) === normalizeForComparison(right) ? 'MATCH' : 'MISMATCH';
}

// ---------------------------------------------------------------------------
// Строка сверки и итог
// ---------------------------------------------------------------------------

export interface ComparedField {
  /** Машинное имя поля — чтобы на экране можно было сослаться на него в протоколе. */
  readonly key: string;
  readonly label: Label;
  /** Что записано в карточке ЖК. */
  readonly declared: string | null;
  /** Что ответил реестр. */
  readonly registry: string | null;
  readonly verdict: FieldVerdict;
}

export interface CompareFieldInput {
  readonly key: string;
  readonly label: Label;
  readonly declared?: string | null;
  readonly registry?: string | null;
}

export function compareFields(rows: readonly CompareFieldInput[]): ComparedField[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    declared: present(row.declared),
    registry: present(row.registry),
    verdict: compareValues(row.declared, row.registry),
  }));
}

/**
 * Расхождение в узком смысле: обе стороны что-то сказали, и сказали разное.
 *
 * «Только в карточке» и «только в реестре» сюда не входят намеренно.
 * Чаще всего это неполнота набора, а не противоречие, и красить её в тот же
 * цвет, что и прямое несовпадение, значит приучить аналитика не смотреть
 * на красное.
 */
export function isDisagreement(verdict: FieldVerdict): boolean {
  return verdict === 'MISMATCH';
}

export function countDisagreements(fields: readonly ComparedField[]): number {
  return fields.filter((field) => isDisagreement(field.verdict)).length;
}

export interface Reconciliation {
  readonly sourceId: string;
  readonly answer: RegistryAnswer;
  readonly fields: readonly ComparedField[];
  readonly disagreements: number;
  readonly bearingOnR1: R1Bearing;
  /**
   * Буквальный false, а не boolean. Слой реестров не начисляет и не снимает
   * баллы: он даёт аналитику проверяемое основание изменить фактор вручную.
   * Тип устроен так, что обойти это правило без правки файла невозможно.
   */
  readonly affectsScore: false;
}

export function reconcile(
  sourceId: string,
  answer: RegistryAnswer,
  rows: readonly CompareFieldInput[],
): Reconciliation {
  // Если ответа нет, сравнивать не с чем: сторона реестра пуста по определению,
  // и подставлять в неё прошлые значения было бы подлогом.
  const effective: readonly CompareFieldInput[] =
    answer === 'FOUND' ? rows : rows.map((row) => ({ ...row, registry: null }));

  const fields = compareFields(effective);

  return {
    sourceId,
    answer,
    fields,
    disagreements: countDisagreements(fields),
    bearingOnR1: bearingOnR1(sourceId, answer),
    affectsScore: false,
  };
}
