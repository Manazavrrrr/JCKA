/**
 * Поиск связанных аккаунтов и телефонов.
 *
 * Зачем это нужно. Одно объявление с платной бронью — повод для проверки
 * одного объекта. Тот же телефон в объявлениях по четырём разным ЖК на трёх
 * площадках — это уже не свойство объекта, а свойство продавца, и проверять
 * надо его. Такую связь невозможно увидеть, открывая карточки по очереди:
 * она существует только между карточками.
 *
 * Как это работает. Публикации объединяются в группы по двум признакам:
 *
 *   - совпадение телефона — признак сильный и межплатформенный: номер
 *     принадлежит человеку, а не площадке;
 *   - совпадение имени аккаунта в пределах одной площадки — признак слабее
 *     и намеренно ограничен площадкой. «Алия» в Instagram и «Алия» в OLX
 *     это, скорее всего, разные люди, и склеивать их по совпадению ника
 *     значило бы выдумать связь.
 *
 * Группы строятся системой непересекающихся множеств: связь транзитивна.
 * Если объявление A и B имеют общий телефон, а B и C — общий аккаунт на
 * одной площадке, то A, B и C попадают в одну группу. Это соответствует
 * действительности: один и тот же продавец сменил номер в части размещений.
 *
 * Чего модуль не делает. Он не начисляет баллы и не создаёт факторов.
 * Связь между объявлениями — это направление проверки, а не нарушение:
 * риелтор, законно работающий с несколькими объектами, выглядит точно так
 * же, как недобросовестный посредник. Решение остаётся за аналитиком,
 * поэтому на выходе — только найденные совпадения и их основания.
 *
 * Модуль чистый: на вход обычные записи, на выход обычные объекты.
 * Ни Prisma, ни сети, ни текущего времени.
 */

// ---------------------------------------------------------------------------
// Вход и выход
// ---------------------------------------------------------------------------

/** Публикация в том виде, в котором она нужна для поиска связей. */
export interface ConnectionInput {
  id: string;
  /** Привязанный объект реестра или null, если привязки ещё нет. */
  projectId: string | null;
  /** Название объекта — для показа в группе без дополнительного запроса. */
  projectName?: string | null;
  platform: string;
  accountName?: string | null;
  contactPhone?: string | null;
  publishedAt?: string | null;
}

/** Признак, по которому публикации оказались в одной группе. */
export type ConnectionBasis = 'PHONE' | 'ACCOUNT';

export interface ConnectionCluster {
  /** Устойчивый идентификатор группы: наименьший id публикации в ней. */
  id: string;
  /** Публикации группы в порядке возрастания id. */
  publicationIds: string[];
  /** Нормализованные телефоны группы. */
  phones: string[];
  /** Аккаунты группы с указанием площадки. */
  accounts: { platform: string; accountName: string }[];
  /** Площадки, на которых встречается группа. */
  platforms: string[];
  /** Объекты реестра, затронутые группой. */
  projects: { id: string; name: string | null }[];
  /** Сколько публикаций группы ещё не привязано к объекту. */
  unlinkedCount: number;
  /** Признаки, по которым группа собралась. */
  basis: ConnectionBasis[];
  /**
   * true, если группа затрагивает больше одного объекта реестра.
   *
   * Это главный повод для внимания: один продавец ведёт размещения по
   * нескольким ЖК. Сам по себе признак нарушением не является.
   */
  crossProject: boolean;
}

// ---------------------------------------------------------------------------
// Нормализация
// ---------------------------------------------------------------------------

/**
 * Приводит телефон к цифрам в формате +7XXXXXXXXXX.
 *
 * Без нормализации «+7 701 555 44 33», «8 701 555 44 33» и «77015554433»
 * считались бы тремя разными номерами, и связь не нашлась бы именно там,
 * где её важнее всего найти: в объявлениях, размещённых на разных
 * площадках с разным оформлением номера.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;

  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10) return `+7${digits}`;
  return null;
}

/**
 * Слова, которые не называют продавца.
 *
 * Площадки подставляют такую подпись вместо имени, когда продавец его не
 * указал. Два разных частных продавца на одной площадке получают одинаковую
 * надпись «Частное объявление» — и связались бы по ней, хотя общего у них
 * нет ничего. Ложная связь хуже пропущенной: аналитик потратит время на
 * проверку совпадения, которого не существует, и перестанет доверять разделу.
 *
 * Проверяется не имя целиком, а каждое слово. Так «Частное объявление»,
 * «Частное объявление (демо)» и «частный продавец» отсеиваются одним
 * правилом, а «Частное объявление Алия» сохраняется: слово «Алия» в перечень
 * не входит, значит имя всё-таки названо.
 */
const EMPTY_NAME_WORDS = new Set([
  'частное',
  'частный',
  'частная',
  'объявление',
  'объявления',
  'лицо',
  'продавец',
  'продажа',
  'продажи',
  'собственник',
  'хозяин',
  'агентство',
  'агент',
  'риелтор',
  'риэлтор',
  'без',
  'имени',
  'название',
  'нет',
  'жеке',
  'хабарландыру',
  'тулга',
  'адам',
  'аты',
  'жок',
  'сатушы',
  'демо',
  'demo',
  'test',
  'тест',
]);

/**
 * Приводит имя аккаунта к сравнимому виду.
 *
 * Снимаются регистр, украшения и служебные символы: «@Алия_Недвижимость»,
 * «Алия Недвижимость» и «алия  недвижимость» — один и тот же продавец.
 *
 * Возвращается null, если имя ничего не различает: слишком короткое или
 * является подписью-заглушкой площадки.
 */
export function normalizeAccount(value: string | null | undefined): string | null {
  if (!value) return null;

  const normalized = value
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[_.\-–—]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Слишком короткое имя не различает людей: «аб» свяжет посторонних.
  if (normalized.length < 3) return null;

  // Имя, целиком составленное из служебных слов, продавца не называет.
  const words = normalized.split(' ');
  if (words.every((word) => EMPTY_NAME_WORDS.has(word))) return null;

  return normalized;
}

// ---------------------------------------------------------------------------
// Система непересекающихся множеств
// ---------------------------------------------------------------------------

class DisjointSet {
  private readonly parent = new Map<string, string>();

  find(item: string): string {
    const parent = this.parent.get(item);
    if (parent === undefined) {
      this.parent.set(item, item);
      return item;
    }
    if (parent === item) return item;

    const root = this.find(parent);
    this.parent.set(item, root);
    return root;
  }

  union(left: string, right: string): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a === b) return;
    // Корнем становится меньший идентификатор: результат не зависит
    // от порядка, в котором пришли публикации.
    if (a < b) this.parent.set(b, a);
    else this.parent.set(a, b);
  }
}

// ---------------------------------------------------------------------------
// Построение групп
// ---------------------------------------------------------------------------

/**
 * Собирает группы связанных публикаций.
 *
 * Возвращаются только группы, в которых больше одной публикации: одиночное
 * объявление связью не является, и показывать его в этом разделе значило бы
 * засорять выдачу.
 *
 * Порядок результата детерминирован — группы и их содержимое отсортированы.
 * Это важно не для красоты: от воспроизводимости выдачи зависит то, можно ли
 * доверять скриншоту, приложенному к сигналу.
 */
export function findConnections(publications: readonly ConnectionInput[]): ConnectionCluster[] {
  const sets = new DisjointSet();
  const byId = new Map<string, ConnectionInput>();

  // Признак → публикации, в которых он встретился.
  const byPhone = new Map<string, string[]>();
  const byAccount = new Map<string, string[]>();

  for (const publication of publications) {
    byId.set(publication.id, publication);
    sets.find(publication.id);

    const phone = normalizePhone(publication.contactPhone);
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), publication.id]);

    const account = normalizeAccount(publication.accountName);
    if (account) {
      const key = `${publication.platform}|${account}`;
      byAccount.set(key, [...(byAccount.get(key) ?? []), publication.id]);
    }
  }

  /** Публикация → признаки, по которым она связана с другими. */
  const basisById = new Map<string, Set<ConnectionBasis>>();

  function link(ids: readonly string[], basis: ConnectionBasis): void {
    if (ids.length < 2) return;
    const [first, ...rest] = ids;
    if (first === undefined) return;

    for (const id of ids) {
      basisById.set(id, (basisById.get(id) ?? new Set()).add(basis));
    }
    for (const id of rest) sets.union(first, id);
  }

  for (const ids of byPhone.values()) link(ids, 'PHONE');
  for (const ids of byAccount.values()) link(ids, 'ACCOUNT');

  // --- Сборка групп ---------------------------------------------------------

  const grouped = new Map<string, string[]>();
  for (const id of byId.keys()) {
    const root = sets.find(id);
    grouped.set(root, [...(grouped.get(root) ?? []), id]);
  }

  const clusters: ConnectionCluster[] = [];

  for (const ids of grouped.values()) {
    if (ids.length < 2) continue;

    const members = [...ids].sort().map((id) => byId.get(id)).filter(isPresent);

    const phones = unique(
      members.map((item) => normalizePhone(item.contactPhone)).filter(isPresent),
    ).sort();

    const accounts = uniqueBy(
      members
        .map((item) => {
          const account = normalizeAccount(item.accountName);
          return account && item.accountName
            ? { platform: item.platform, accountName: item.accountName }
            : null;
        })
        .filter(isPresent),
      (item) => `${item.platform}|${normalizeAccount(item.accountName)}`,
    ).sort((a, b) =>
      a.platform === b.platform
        ? a.accountName.localeCompare(b.accountName)
        : a.platform.localeCompare(b.platform),
    );

    const projects = uniqueBy(
      members
        .filter((item) => item.projectId !== null)
        .map((item) => ({ id: item.projectId as string, name: item.projectName ?? null })),
      (item) => item.id,
    ).sort((a, b) => a.id.localeCompare(b.id));

    const basis = unique(
      members.flatMap((item) => [...(basisById.get(item.id) ?? [])]),
    ).sort() as ConnectionBasis[];

    clusters.push({
      id: members[0]?.id ?? '',
      publicationIds: members.map((item) => item.id),
      phones,
      accounts,
      platforms: unique(members.map((item) => item.platform)).sort(),
      projects,
      unlinkedCount: members.filter((item) => item.projectId === null).length,
      basis,
      crossProject: projects.length > 1,
    });
  }

  /**
   * Порядок выдачи: сначала группы, затрагивающие несколько объектов, затем
   * более крупные. Так самое содержательное оказывается сверху без того,
   * чтобы аналитик сортировал список вручную.
   */
  return clusters.sort((a, b) => {
    if (a.crossProject !== b.crossProject) return a.crossProject ? -1 : 1;
    if (a.projects.length !== b.projects.length) return b.projects.length - a.projects.length;
    if (a.publicationIds.length !== b.publicationIds.length) {
      return b.publicationIds.length - a.publicationIds.length;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Группы, в которые попадает заданная публикация.
 *
 * Нужна для карточки объявления: аналитик, открыв одно объявление, должен
 * сразу видеть, что тот же телефон встречается ещё в трёх размещениях.
 */
export function connectionsOf(
  publications: readonly ConnectionInput[],
  publicationId: string,
): ConnectionCluster[] {
  return findConnections(publications).filter((cluster) =>
    cluster.publicationIds.includes(publicationId),
  );
}

// ---------------------------------------------------------------------------
// Мелкие помощники
// ---------------------------------------------------------------------------

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
}
