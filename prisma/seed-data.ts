/**
 * ДЕМОНСТРАЦИОННЫЙ НАБОР ДАННЫХ.
 *
 * Все застройщики, БИН, телефоны, номера документов и тексты объявлений
 * вымышлены и созданы для хакатона. Совпадения с реальными компаниями,
 * объектами и людьми не предполагаются. Персональных данных в наборе нет.
 * Каждая запись помечена флагом isDemo = true.
 *
 * Состав набора (требование раздела 4 ТЗ):
 *   - 8 объектов (ЖК) с полностью заполненными карточками;
 *   - 12 рекламных публикаций, две из них намеренно не связаны с объектом
 *     и служат входом для демонстрации автосопоставления ИИ;
 *   - три контрольных сценария A, B и C из раздела 5 ТЗ;
 *   - граничный случай зоны: 75 баллов без подтверждённого R2 → жёлтая.
 *
 * Поля expectedScore / expectedZone — это ожидание из ТЗ, записанное руками.
 * Движок скоринга (src/core/scoring) считает балл независимо, а скрипт
 * проверки сверяет расчёт с этим ожиданием. Расхождение означает ошибку
 * либо в данных, либо в формуле.
 */

import type {
  AppealStatus,
  EvidenceKind,
  FactorCode,
  FactorOrigin,
  FactorStatus,
  LegalBasisStatus,
  LegalBasisType,
  LinkStatus,
  Platform,
  ProjectStage,
  RiskZone,
} from '../src/core/domain/enums';

/** Демонстрационная учётная запись аналитика. Реальных данных не содержит. */
export const DEMO_ANALYST = 'analyst@demo.local';

/** Демонстрационная учётная запись руководителя подразделения. */
export const DEMO_SUPERVISOR = 'supervisor@demo.local';

// ---------------------------------------------------------------------------
// Типы набора
// ---------------------------------------------------------------------------

export interface SeedEvidence {
  kind: EvidenceKind;
  /**
   * Ключ публикации для kind = TEXT_FRAGMENT. Офсеты символов вычисляются
   * при загрузке через indexOf, поэтому их нельзя рассинхронизировать с текстом:
   * если фрагмент не найден дословно, сид падает с ошибкой.
   */
  publicationKey?: string;
  fragment?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  capturedAt: string;
  note?: string;
}

export interface SeedFactor {
  code: FactorCode;
  status: FactorStatus;
  origin: FactorOrigin;
  /** Почему аналитик принял именно такое решение по фактору. */
  rationale: string;
  confirmedBy?: string;
  confirmedAt?: string;
  evidence?: SeedEvidence[];
}

export interface SeedAppeal {
  registeredAt: string;
  signatories: number;
  status: AppealStatus;
  reference: string;
  summary: string;
}

export interface SeedProject {
  key: string;
  slug: string;
  name: string;
  nameKk: string;
  address: string;
  addressKk: string;
  lat: number;
  lng: number;
  developerKey: string;
  stage: ProjectStage;
  plannedCompletionAt?: string;
  actualDelayDays?: number;

  declaredReadinessPct?: number;
  declaredReadinessSource?: string;
  declaredReadinessAt?: string;
  verifiedReadinessPct?: number;
  verifiedReadinessSource?: string;
  verifiedReadinessAt?: string;

  legalBasisStatus: LegalBasisStatus;
  legalBasisType: LegalBasisType;
  legalBasisSource?: string;
  legalBasisCheckedAt?: string;
  legalBasisCheckedBy?: string;
  legalBasisNote?: string;

  factors: SeedFactor[];
  appeals?: SeedAppeal[];

  /** Контрольный сценарий из раздела 5 ТЗ, если объект его иллюстрирует. */
  scenario?: 'A' | 'B' | 'C';
  /** Ожидаемый балл по ТЗ. Сверяется автотестом и скриптом проверки. */
  expectedScore: number;
  /** Ожидаемая зона по ТЗ. */
  expectedZone: RiskZone;
  /** Что именно демонстрирует объект — выводится в консоль при сиде. */
  demoNote: string;
}

export interface SeedPublication {
  key: string;
  /** null — публикация намеренно оставлена без привязки для демонстрации ИИ. */
  projectKey: string | null;
  platform: Platform;
  accountName: string;
  accountUrl?: string;
  contactPhone?: string;
  url?: string;
  publishedAt: string;
  capturedAt: string;
  rawText: string;
  linkStatus: LinkStatus;
  linkConfidence?: number;
  linkedBy?: string;
  linkedAt?: string;
}

export interface SeedDeveloper {
  key: string;
  name: string;
  nameKk: string;
  bin: string;
  phone: string;
}

// ---------------------------------------------------------------------------
// Застройщики (вымышленные)
// ---------------------------------------------------------------------------

export const developers: SeedDeveloper[] = [
  {
    key: 'altai',
    name: 'ТОО «Алтай Құрылыс Демо»',
    nameKk: '«Алтай Құрылыс Демо» ЖШС',
    bin: '000000000101',
    phone: '+7 701 000 00 11',
  },
  {
    key: 'ertis',
    name: 'ТОО «Ертіс Девелопмент Демо»',
    nameKk: '«Ертіс Девелопмент Демо» ЖШС',
    bin: '000000000102',
    phone: '+7 701 000 00 22',
  },
  {
    key: 'koktem',
    name: 'ТОО «Көктем Строй Демо»',
    nameKk: '«Көктем Строй Демо» ЖШС',
    bin: '000000000103',
    phone: '+7 701 000 00 33',
  },
  {
    key: 'ulba',
    name: 'ТОО «Ульба Инвест Демо»',
    nameKk: '«Ульба Инвест Демо» ЖШС',
    bin: '000000000104',
    phone: '+7 701 000 00 44',
  },
  {
    key: 'samal',
    name: 'ТОО «Самал Групп Демо»',
    nameKk: '«Самал Групп Демо» ЖШС',
    bin: '000000000105',
    phone: '+7 701 000 00 77',
  },
];

// ---------------------------------------------------------------------------
// Публикации
// ---------------------------------------------------------------------------

export const publications: SeedPublication[] = [
  {
    key: 'pub-01',
    projectKey: 'altai-arman',
    platform: 'KRISHA_DEMO',
    accountName: 'Отдел продаж «Алтай Арман» (демо)',
    contactPhone: '+7 701 000 00 11',
    url: 'https://example-board.demo/ads/altai-arman-1001',
    publishedAt: '2026-09-02T09:15:00.000Z',
    capturedAt: '2026-09-03T06:40:00.000Z',
    rawText:
      'ЖК «Алтай Арман» — старт продаж. Однокомнатные, двухкомнатные и трёхкомнатные квартиры от 420 000 ₸ за квадратный метр. Плановый ввод дома — IV квартал 2027 года. Бронь квартиры 150 000 ₸, сумма входит в стоимость и фиксирует цену на 30 дней. Отдел продаж работает на объекте: улица Протозанова, 85. Запись на показ по телефону +7 701 000 00 11.',
    linkStatus: 'CONFIRMED',
    linkedBy: DEMO_ANALYST,
    linkedAt: '2026-09-03T07:10:00.000Z',
  },
  {
    key: 'pub-02',
    projectKey: 'altai-arman',
    platform: 'INSTAGRAM_DEMO',
    accountName: '@altai_arman_demo',
    contactPhone: '+7 701 000 00 11',
    url: 'https://example-social.demo/p/altai-arman-0914',
    publishedAt: '2026-09-14T11:30:00.000Z',
    capturedAt: '2026-09-15T05:20:00.000Z',
    rawText:
      'Строительство ЖК «Алтай Арман» идёт по графику. Смонтирован каркас восьмого этажа. Видовые квартиры с окнами на Ульбу ещё в продаже. Подробности и актуальный прайс — в сообщениях.',
    linkStatus: 'CONFIRMED',
    linkedBy: DEMO_ANALYST,
    linkedAt: '2026-09-15T05:45:00.000Z',
  },
  {
    key: 'pub-03',
    projectKey: 'ertis-sarayy',
    platform: 'TELEGRAM_DEMO',
    accountName: 'Канал «Ертіс Сарайы | продажи» (демо)',
    contactPhone: '+7 701 000 00 22',
    url: 'https://example-messenger.demo/ertis_sarayy_demo/318',
    publishedAt: '2026-08-21T04:05:00.000Z',
    capturedAt: '2026-08-22T03:30:00.000Z',
    rawText:
      'ЖК «Ертіс Сарайы» — котлован, самые низкие цены на старте продаж. Для закрепления выбранной квартиры вносится депозит 10% от стоимости при подписании предварительного договора. Остаток — рассрочка от застройщика на 36 месяцев, без банка и без переплат. Количество квартир по стартовой цене ограничено.',
    linkStatus: 'CONFIRMED',
    linkedBy: DEMO_ANALYST,
    linkedAt: '2026-08-22T04:00:00.000Z',
  },
  {
    key: 'pub-04',
    projectKey: 'ertis-sarayy',
    platform: 'DEVELOPER_SITE',
    accountName: 'Сайт ТОО «Ертіс Девелопмент Демо»',
    contactPhone: '+7 701 000 00 22',
    url: 'https://example-developer.demo/ertis-sarayy',
    publishedAt: '2026-08-10T00:00:00.000Z',
    capturedAt: '2026-08-22T03:35:00.000Z',
    rawText:
      'Жилой комплекс «Ертіс Сарайы», улица Казахстан, 70. Начало строительства — март 2026 года, плановый ввод — II квартал 2028 года. В продаже 214 квартир, свободны все этажи. Отдел продаж: ежедневно с 9:00 до 19:00.',
    linkStatus: 'CONFIRMED',
    linkedBy: DEMO_ANALYST,
    linkedAt: '2026-08-22T04:02:00.000Z',
  },
  {
    key: 'pub-05',
    projectKey: 'koktem-park',
    platform: 'KRISHA_DEMO',
    accountName: 'Отдел продаж «Көктем Парк» (демо)',
    contactPhone: '+7 701 000 00 33',
    url: 'https://example-board.demo/ads/koktem-park-2042',
    publishedAt: '2026-09-25T08:00:00.000Z',
    capturedAt: '2026-09-26T04:15:00.000Z',
    rawText:
      'ЖК «Көктем Парк», проспект Назарбаева, 44. Готовность 78%, идут отделочные работы. Продажи ведутся по договорам о долевом участии с гарантией Единого оператора жилищного строительства. Оплата производится через уполномоченный банк на счёт эскроу. Доступна ипотека банков-партнёров.',
    linkStatus: 'CONFIRMED',
    linkedBy: DEMO_ANALYST,
    linkedAt: '2026-09-26T04:50:00.000Z',
  },
  {
    key: 'pub-06',
    projectKey: 'ulba-residence',
    platform: 'INSTAGRAM_DEMO',
    accountName: '@ulba_residence_demo',
    contactPhone: '+7 701 000 00 44',
    url: 'https://example-social.demo/p/ulba-residence-0908',
    publishedAt: '2026-09-08T10:10:00.000Z',
    capturedAt: '2026-09-09T05:00:00.000Z',
    rawText:
      'ЖК «Ульба Резиденс» — завершается остекление фасада. Срок сдачи дома перенесён на I квартал 2028 года. Квартиры в продаже, актуальный прайс по запросу.',
    linkStatus: 'CONFIRMED',
    linkedBy: DEMO_ANALYST,
    linkedAt: '2026-09-09T05:30:00.000Z',
  },
  {
    key: 'pub-07',
    projectKey: 'samal-towers',
    platform: 'TELEGRAM_DEMO',
    accountName: 'Канал «Новостройки ВКО | демо»',
    contactPhone: '+7 701 000 00 77',
    url: 'https://example-messenger.demo/novostroiki_vko_demo/1204',
    publishedAt: '2026-07-18T06:25:00.000Z',
    capturedAt: '2026-07-19T03:10:00.000Z',
    rawText:
      'ЖК «Самал Тауэрс», улица Серикбаева, 19. Квартиры от застройщика напрямую, без посредников. Первоначальный взнос 30%, остальное — беспроцентная рассрочка до конца строительства. Договор бронирования подписываем в день обращения, бронь платная — 200 000 ₸. Звоните: +7 701 000 00 77.',
    linkStatus: 'CONFIRMED',
    linkedBy: DEMO_ANALYST,
    linkedAt: '2026-07-19T04:00:00.000Z',
  },
  {
    key: 'pub-08',
    projectKey: 'samal-towers',
    platform: 'KRISHA_DEMO',
    accountName: 'Частное объявление (демо)',
    contactPhone: '+7 701 000 00 55',
    url: 'https://example-board.demo/ads/samal-towers-3310',
    publishedAt: '2026-08-02T12:40:00.000Z',
    capturedAt: '2026-08-03T04:20:00.000Z',
    rawText:
      'Продам двухкомнатную квартиру 64 м² в строящемся ЖК «Самал Тауэрс». Дом на стадии возведения каркаса, двенадцатый этаж. Цена от застройщика, торг уместен.',
    linkStatus: 'CONFIRMED',
    linkedBy: DEMO_ANALYST,
    linkedAt: '2026-08-03T04:55:00.000Z',
  },
  {
    key: 'pub-09',
    projectKey: 'grand-ertis',
    platform: 'FACEBOOK_DEMO',
    accountName: 'Страница «Гранд Ертіс» (демо)',
    contactPhone: '+7 701 000 00 22',
    url: 'https://example-social.demo/grand-ertis-demo/posts/771',
    publishedAt: '2026-09-19T07:45:00.000Z',
    capturedAt: '2026-09-20T04:05:00.000Z',
    rawText:
      'ЖК «Гранд Ертіс» на Самарском шоссе. Ход строительства: возведён каркас девяти этажей из шестнадцати. Планировки и актуальные цены — на сайте застройщика. Консультация в офисе продаж по будням.',
    linkStatus: 'CONFIRMED',
    linkedBy: DEMO_ANALYST,
    linkedAt: '2026-09-20T04:30:00.000Z',
  },
  {
    key: 'pub-10',
    projectKey: 'zhastar-city',
    platform: 'KRISHA_DEMO',
    accountName: 'Отдел продаж «Жастар Сити» (демо)',
    contactPhone: '+7 701 000 00 33',
    url: 'https://example-board.demo/ads/zhastar-city-4120',
    publishedAt: '2026-10-01T05:30:00.000Z',
    capturedAt: '2026-10-02T04:00:00.000Z',
    rawText:
      'ЖК «Жастар Сити», улица Ушанова, 92. Готовность 82%, ведётся внутренняя отделка. Ввод в эксплуатацию — IV квартал 2026 года. Свободны 18 квартир.',
    linkStatus: 'CONFIRMED',
    linkedBy: DEMO_ANALYST,
    linkedAt: '2026-10-02T04:25:00.000Z',
  },

  // --- Две публикации намеренно без привязки.
  // На них демонстрируется работа ИИ: разбор нового текста, извлечение условий
  // оплаты и сопоставление с объектом из реестра. Аналитик принимает решение.
  {
    key: 'pub-11',
    projectKey: null,
    platform: 'OLX_DEMO',
    accountName: 'Частное объявление (демо)',
    contactPhone: '+7 701 000 00 99',
    url: 'https://example-board2.demo/ads/5590',
    publishedAt: '2026-10-09T13:05:00.000Z',
    capturedAt: '2026-10-10T03:50:00.000Z',
    rawText:
      'Продаю квартиру в новом ЖК Алтай-Арман на Протозанова. Дом ещё строится, сдача в 2027 году. Застройщик берёт платную бронь 150 тысяч тенге, я уступаю свою бронь дешевле. Торг возможен.',
    linkStatus: 'UNLINKED',
  },
  {
    key: 'pub-12',
    projectKey: null,
    platform: 'TELEGRAM_DEMO',
    accountName: 'Канал «Новостройки ВКО | демо»',
    contactPhone: '+7 701 000 00 77',
    url: 'https://example-messenger.demo/novostroiki_vko_demo/1388',
    publishedAt: '2026-10-11T08:20:00.000Z',
    capturedAt: '2026-10-12T03:30:00.000Z',
    rawText:
      'Стартовали продажи второй очереди ЖК «Самал Тауэрс-2». Фиксируем стартовую цену при внесении задатка 250 000 ₸. Количество квартир по этой цене ограничено. Телефон: +7 701 000 00 77.',
    linkStatus: 'UNLINKED',
  },
];

// ---------------------------------------------------------------------------
// Объекты
// ---------------------------------------------------------------------------

export const projects: SeedProject[] = [
  // =========================================================================
  // СЦЕНАРИЙ A: основание не проверено, есть платная бронь.
  // Ожидание ТЗ: R2 25 + R3 10 = 35, жёлтая.
  // Проверяет, что «нет данных» НЕ превращается в R1.
  // =========================================================================
  {
    key: 'altai-arman',
    slug: 'altai-arman',
    name: 'ЖК «Алтай Арман»',
    nameKk: '«Алтай Арман» ТК',
    address: 'г. Усть-Каменогорск, ул. Протозанова, 85',
    addressKk: 'Өскемен қ., Протозанов к-сі, 85',
    lat: 49.9553,
    lng: 82.6089,
    developerKey: 'altai',
    stage: 'FRAME',
    plannedCompletionAt: '2027-12-31T00:00:00.000Z',
    declaredReadinessPct: 55,
    declaredReadinessSource: 'Проектная декларация застройщика (демо), ред. от 01.09.2026',
    declaredReadinessAt: '2026-09-01T00:00:00.000Z',
    verifiedReadinessPct: 50,
    verifiedReadinessSource: 'Акт визуального осмотра МИО (демо) №ОСМ-2026-212',
    verifiedReadinessAt: '2026-09-12T00:00:00.000Z',
    legalBasisStatus: 'NOT_CHECKED',
    legalBasisType: 'UNKNOWN',
    legalBasisSource: 'Запрос в реестр разрешений МИО (демо) №ЗАП-2026-0871 от 05.09.2026',
    legalBasisCheckedAt: undefined,
    legalBasisCheckedBy: undefined,
    legalBasisNote:
      'Ответ на запрос не получен. Сведений о гарантии Единого оператора и об участии банка второго уровня также нет. Статус остаётся «не проверено»: отсутствие данных не равно отсутствию основания.',
    scenario: 'A',
    expectedScore: 35,
    expectedZone: 'YELLOW',
    demoNote:
      'Сценарий A. Основание не проверено — R1 не начисляется, несмотря на платную бронь в рекламе.',
    factors: [
      {
        code: 'R1',
        status: 'NEEDS_CHECK',
        origin: 'MANUAL',
        rationale:
          'Запрос в реестр разрешений направлен 05.09.2026, ответ не получен. Проверить наличие гарантии Единого оператора и договора с банком второго уровня. До получения ответа фактор не начисляется.',
        evidence: [
          {
            kind: 'REGISTRY_RECORD',
            sourceLabel: 'Запрос в реестр разрешений МИО (демо) №ЗАП-2026-0871',
            capturedAt: '2026-09-05T00:00:00.000Z',
            note: 'Статус запроса: на рассмотрении. Сведения об основании отсутствуют.',
          },
        ],
      },
      {
        code: 'R2',
        status: 'CONFIRMED',
        origin: 'AI_ACCEPTED',
        rationale:
          'В публикации прямо предложено внести 150 000 ₸ за бронирование квартиры с фиксацией цены. Гипотеза ИИ проверена аналитиком по тексту первоисточника и принята.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-03T08:05:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-01',
            fragment:
              'Бронь квартиры 150 000 ₸, сумма входит в стоимость и фиксирует цену на 30 дней',
            sourceLabel: 'Доска объявлений (демо), публикация от 02.09.2026',
            sourceUrl: 'https://example-board.demo/ads/altai-arman-1001',
            capturedAt: '2026-09-03T06:40:00.000Z',
          },
        ],
      },
      {
        code: 'R3',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'Объект на стадии возведения каркаса, зафиксированы две действующие публикации о продаже квартир до ввода в эксплуатацию.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-03T08:07:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-01',
            fragment: 'ЖК «Алтай Арман» — старт продаж',
            sourceLabel: 'Доска объявлений (демо), публикация от 02.09.2026',
            capturedAt: '2026-09-03T06:40:00.000Z',
          },
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-02',
            fragment: 'Видовые квартиры с окнами на Ульбу ещё в продаже',
            sourceLabel: 'Соцсеть (демо), публикация от 14.09.2026',
            capturedAt: '2026-09-15T05:20:00.000Z',
          },
        ],
      },
      {
        code: 'R4',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale:
          'Реестр обращений (демо) проверен 10.09.2026: коллективных обращений по объекту не зарегистрировано.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-10T00:00:00.000Z',
      },
      {
        code: 'R5',
        status: 'REJECTED',
        origin: 'RULE',
        rationale:
          'Заявленная готовность 55%, подтверждённая 50%. Расхождение 5 процентных пунктов при пороге 20 — фактор не начисляется.',
      },
      {
        code: 'R6',
        status: 'NEEDS_CHECK',
        origin: 'MANUAL',
        rationale:
          'Плановый срок ввода (IV квартал 2027) не наступил. Сведения о темпах работ и простое не запрашивались.',
      },
    ],
  },

  // =========================================================================
  // СЦЕНАРИЙ B: установлено отсутствие основания + депозит.
  // Ожидание ТЗ: R1 35 + R2 25 + R3 10 = 70, красная.
  // =========================================================================
  {
    key: 'ertis-sarayy',
    slug: 'ertis-sarayy',
    name: 'ЖК «Ертіс Сарайы»',
    nameKk: '«Ертіс Сарайы» ТК',
    address: 'г. Усть-Каменогорск, ул. Казахстан, 70',
    addressKk: 'Өскемен қ., Қазақстан к-сі, 70',
    lat: 49.9733,
    lng: 82.6141,
    developerKey: 'ertis',
    stage: 'FOUNDATION',
    plannedCompletionAt: '2028-06-30T00:00:00.000Z',
    declaredReadinessPct: 30,
    declaredReadinessSource: 'Проектная декларация застройщика (демо), ред. от 15.08.2026',
    declaredReadinessAt: '2026-08-15T00:00:00.000Z',
    verifiedReadinessPct: 25,
    verifiedReadinessSource: 'Акт визуального осмотра МИО (демо) №ОСМ-2026-198',
    verifiedReadinessAt: '2026-08-28T00:00:00.000Z',
    legalBasisStatus: 'CONFIRMED_ABSENT',
    legalBasisType: 'NONE',
    legalBasisSource:
      'Ответ реестра разрешений МИО (демо) №ОТВ-2026-0455 и ответ Единого оператора (демо) №ЕО-2026-0441',
    legalBasisCheckedAt: '2026-08-26T00:00:00.000Z',
    legalBasisCheckedBy: DEMO_ANALYST,
    legalBasisNote:
      'Получены письменные ответы по всем трём способам: разрешение МИО не выдавалось, договор гарантии с Единым оператором не заключался, банк второго уровня не привлекался. Отсутствие основания установлено проверенными данными, а не выведено из отсутствия записи.',
    scenario: 'B',
    expectedScore: 70,
    expectedZone: 'RED',
    demoNote:
      'Сценарий B. Отсутствие основания подтверждено документально + депозит в рекламе → красная зона, карточка ждёт решения человека.',
    factors: [
      {
        code: 'R1',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'По трём возможным способам привлечения средств получены отрицательные письменные ответы. Применимое правовое основание отсутствует.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-08-26T09:00:00.000Z',
        evidence: [
          {
            kind: 'REGISTRY_RECORD',
            sourceLabel: 'Ответ реестра разрешений МИО (демо) №ОТВ-2026-0455 от 24.08.2026',
            capturedAt: '2026-08-26T00:00:00.000Z',
            note: 'Разрешение на привлечение денег дольщиков по объекту не выдавалось.',
          },
          {
            kind: 'DOCUMENT',
            sourceLabel: 'Ответ Единого оператора жилищного строительства (демо) №ЕО-2026-0441',
            capturedAt: '2026-08-26T00:00:00.000Z',
            note:
              'Договор гарантии по объекту не заключался. Сведений об участии банка второго уровня также не представлено.',
          },
        ],
      },
      {
        code: 'R2',
        status: 'CONFIRMED',
        origin: 'AI_ACCEPTED',
        rationale:
          'Публикация содержит условие о внесении депозита 10% от стоимости при подписании предварительного договора. Гипотеза ИИ проверена и принята аналитиком.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-08-22T05:00:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-03',
            fragment:
              'вносится депозит 10% от стоимости при подписании предварительного договора',
            sourceLabel: 'Мессенджер, канал (демо), публикация от 21.08.2026',
            sourceUrl: 'https://example-messenger.demo/ertis_sarayy_demo/318',
            capturedAt: '2026-08-22T03:30:00.000Z',
          },
        ],
      },
      {
        code: 'R3',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'Объект на стадии котлована, при этом на сайте застройщика и в канале ведётся активная продажа квартир.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-08-22T05:02:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-04',
            fragment: 'В продаже 214 квартир, свободны все этажи',
            sourceLabel: 'Сайт застройщика (демо)',
            capturedAt: '2026-08-22T03:35:00.000Z',
          },
        ],
      },
      {
        code: 'R4',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Коллективных обращений по объекту в реестре (демо) не зарегистрировано.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-08-26T09:10:00.000Z',
      },
      {
        code: 'R5',
        status: 'REJECTED',
        origin: 'RULE',
        rationale:
          'Заявленная готовность 30%, подтверждённая 25%. Расхождение 5 процентных пунктов — порог 20 не достигнут.',
      },
      {
        code: 'R6',
        status: 'NEEDS_CHECK',
        origin: 'MANUAL',
        rationale:
          'Строительство начато в марте 2026, плановый срок не наступил. Документов об отклонении от графика нет.',
      },
    ],
  },

  // =========================================================================
  // СЦЕНАРИЙ C: действующая гарантия + обычная реклама.
  // Ожидание ТЗ: R3 10 = 10, зелёная.
  // Проверяет, что отсутствие разрешения МИО само по себе не даёт R1.
  // =========================================================================
  {
    key: 'koktem-park',
    slug: 'koktem-park',
    name: 'ЖК «Көктем Парк»',
    nameKk: '«Көктем Парк» ТК',
    address: 'г. Усть-Каменогорск, пр. Назарбаева, 44',
    addressKk: 'Өскемен қ., Назарбаев д-лы, 44',
    lat: 49.9481,
    lng: 82.6202,
    developerKey: 'koktem',
    stage: 'FINISHING',
    plannedCompletionAt: '2027-03-31T00:00:00.000Z',
    declaredReadinessPct: 80,
    declaredReadinessSource: 'Проектная декларация застройщика (демо), ред. от 20.09.2026',
    declaredReadinessAt: '2026-09-20T00:00:00.000Z',
    verifiedReadinessPct: 78,
    verifiedReadinessSource: 'Акт выездной проверки МИО (демо) №ВП-2026-061',
    verifiedReadinessAt: '2026-09-24T00:00:00.000Z',
    legalBasisStatus: 'CONFIRMED_PRESENT',
    legalBasisType: 'GUARANTEE_OPERATOR',
    legalBasisSource:
      'Договор гарантии Единого оператора жилищного строительства (демо) №ГАР-2026-114, действует',
    legalBasisCheckedAt: '2026-09-26T00:00:00.000Z',
    legalBasisCheckedBy: DEMO_ANALYST,
    legalBasisNote:
      'Отдельное разрешение МИО по объекту не выдавалось и при схеме с гарантией Единого оператора не требуется. Это НЕ основание для начисления R1.',
    scenario: 'C',
    expectedScore: 10,
    expectedZone: 'GREEN',
    demoNote:
      'Сценарий C. Нет разрешения МИО, но есть действующая гарантия Единого оператора → R1 не начисляется, зелёная зона.',
    factors: [
      {
        code: 'R1',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale:
          'Подтверждён действующий договор гарантии Единого оператора — это самостоятельное законное основание привлечения средств. Отсутствие отдельного разрешения МИО при такой схеме не образует фактор R1.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-26T05:30:00.000Z',
        evidence: [
          {
            kind: 'DOCUMENT',
            sourceLabel: 'Договор гарантии Единого оператора (демо) №ГАР-2026-114',
            capturedAt: '2026-09-26T00:00:00.000Z',
            note: 'Срок действия договора не истёк, сведения подтверждены оператором.',
          },
        ],
      },
      {
        code: 'R2',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale:
          'В публикации указана оплата через уполномоченный банк на счёт эскроу. Это законный порядок расчётов, а не прямое предложение внести деньги застройщику. Предложений платной брони, депозита или первоначального взноса не выявлено.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-26T05:35:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-05',
            fragment: 'Оплата производится через уполномоченный банк на счёт эскроу',
            sourceLabel: 'Доска объявлений (демо), публикация от 25.09.2026',
            capturedAt: '2026-09-26T04:15:00.000Z',
            note: 'Фрагмент приложен как обоснование отклонения фактора, а не его подтверждения.',
          },
        ],
      },
      {
        code: 'R3',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'Объект не введён в эксплуатацию, зафиксирована действующая публикация о продаже квартир.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-26T05:36:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-05',
            fragment: 'ЖК «Көктем Парк», проспект Назарбаева, 44',
            sourceLabel: 'Доска объявлений (демо), публикация от 25.09.2026',
            capturedAt: '2026-09-26T04:15:00.000Z',
          },
        ],
      },
      {
        code: 'R4',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Обращений по объекту не зарегистрировано.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-26T05:38:00.000Z',
      },
      {
        code: 'R5',
        status: 'REJECTED',
        origin: 'RULE',
        rationale:
          'Заявленная готовность 80%, подтверждённая 78%. Расхождение 2 процентных пункта.',
      },
      {
        code: 'R6',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale:
          'Отклонений от графика не зафиксировано, работы на объекте ведутся (акт выездной проверки от 24.09.2026).',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-26T05:40:00.000Z',
      },
    ],
  },

  // =========================================================================
  // Объект с коллективным обращением и расхождением готовности.
  // R3 10 + R4 15 + R5 10 = 35, жёлтая.
  // =========================================================================
  {
    key: 'ulba-residence',
    slug: 'ulba-residence',
    name: 'ЖК «Ульба Резиденс»',
    nameKk: '«Ульба Резиденс» ТК',
    address: 'г. Усть-Каменогорск, ул. Виноградова, 12',
    addressKk: 'Өскемен қ., Виноградов к-сі, 12',
    lat: 49.9617,
    lng: 82.6433,
    developerKey: 'ulba',
    stage: 'FACADE',
    plannedCompletionAt: '2028-03-31T00:00:00.000Z',
    declaredReadinessPct: 70,
    declaredReadinessSource: 'Проектная декларация застройщика (демо), ред. от 05.09.2026',
    declaredReadinessAt: '2026-09-05T00:00:00.000Z',
    verifiedReadinessPct: 45,
    verifiedReadinessSource: 'Акт выездной проверки МИО (демо) №ВП-2026-058',
    verifiedReadinessAt: '2026-09-18T00:00:00.000Z',
    legalBasisStatus: 'CONFIRMED_PRESENT',
    legalBasisType: 'MIO_PERMIT',
    legalBasisSource: 'Разрешение МИО (демо) №РАЗ-2026-0096 от 12.02.2026, действует',
    legalBasisCheckedAt: '2026-09-18T00:00:00.000Z',
    legalBasisCheckedBy: DEMO_ANALYST,
    legalBasisNote: 'Разрешение действует. Нарушений условий его выдачи не установлено.',
    expectedScore: 35,
    expectedZone: 'YELLOW',
    demoNote:
      'Законное основание есть, но подтверждённое обращение и расхождение готовности 25 п.п. выводят объект в жёлтую зону.',
    appeals: [
      {
        registeredAt: '2026-09-15T00:00:00.000Z',
        signatories: 34,
        status: 'VERIFIED',
        reference: 'ОБР-2026-0312 (демо)',
        summary:
          'Коллективное обращение дольщиков о расхождении заявленных и фактических темпов строительства и о переносе срока сдачи. Проверено, сведения подтвердились.',
      },
    ],
    factors: [
      {
        code: 'R1',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Разрешение МИО №РАЗ-2026-0096 действует, основание подтверждено.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-18T07:00:00.000Z',
        evidence: [
          {
            kind: 'REGISTRY_RECORD',
            sourceLabel: 'Реестр разрешений МИО (демо), запись №РАЗ-2026-0096',
            capturedAt: '2026-09-18T00:00:00.000Z',
          },
        ],
      },
      {
        code: 'R2',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale:
          'Связанные публикации проверены построчно: предложений платной брони, депозита или первоначального взноса не содержат.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-18T07:05:00.000Z',
      },
      {
        code: 'R3',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale: 'Объект на стадии фасадных работ, квартиры активно рекламируются.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-09T06:00:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-06',
            fragment: 'Квартиры в продаже, актуальный прайс по запросу',
            sourceLabel: 'Соцсеть (демо), публикация от 08.09.2026',
            capturedAt: '2026-09-09T05:00:00.000Z',
          },
        ],
      },
      {
        code: 'R4',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'Зарегистрировано и проверено коллективное обращение 34 дольщиков (ОБР-2026-0312). Сведения подтвердились.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-18T07:10:00.000Z',
        evidence: [
          {
            kind: 'APPEAL',
            sourceLabel: 'Коллективное обращение (демо) №ОБР-2026-0312 от 15.09.2026',
            capturedAt: '2026-09-18T00:00:00.000Z',
            note: '34 подписанта, статус проверки: подтверждено.',
          },
        ],
      },
      {
        code: 'R5',
        status: 'CONFIRMED',
        origin: 'RULE',
        rationale:
          'Заявленная готовность 70% (проектная декларация от 05.09.2026), подтверждённая 45% (акт выездной проверки от 18.09.2026). Расхождение 25 процентных пунктов превышает порог 20.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-18T07:15:00.000Z',
        evidence: [
          {
            kind: 'FIELD_CHECK',
            sourceLabel: 'Акт выездной проверки МИО (демо) №ВП-2026-058 от 18.09.2026',
            capturedAt: '2026-09-18T00:00:00.000Z',
            note: 'Фактическая готовность 45% против заявленных 70%.',
          },
        ],
      },
      /**
       * R6 у этого объекта сознательно отсутствует.
       *
       * Публикация pub-06 упоминает перенос срока на I квартал 2028 — именно
       * из неё ИИ-модуль строит гипотезу о R6. Если завести фактор заранее,
       * принятие гипотезы окажется действием без видимого результата, и
       * главное утверждение шага 6 тестового сценария — «согласие с
       * прочтением текста создаёт задачу на проверку, а не балл» —
       * показать на демонстрации будет нечем. Пустое место здесь и есть то,
       * что заполняет аналитик: фактор появится со статусом «требует
       * проверки», происхождением AI_ACCEPTED и вкладом 0 баллов.
       */
    ],
  },

  // =========================================================================
  // Тяжёлый случай: R1 + R2 + R3 + R6 = 75, красная.
  // =========================================================================
  {
    key: 'samal-towers',
    slug: 'samal-towers',
    name: 'ЖК «Самал Тауэрс»',
    nameKk: '«Самал Тауэрс» ТК',
    address: 'г. Усть-Каменогорск, ул. Серикбаева, 19',
    addressKk: 'Өскемен қ., Серікбаев к-сі, 19',
    lat: 49.9402,
    lng: 82.6031,
    developerKey: 'samal',
    stage: 'FRAME',
    plannedCompletionAt: '2026-06-30T00:00:00.000Z',
    actualDelayDays: 136,
    declaredReadinessPct: 60,
    declaredReadinessSource: 'Проектная декларация застройщика (демо), ред. от 10.07.2026',
    declaredReadinessAt: '2026-07-10T00:00:00.000Z',
    verifiedReadinessPct: 55,
    verifiedReadinessSource: 'Акт выездной проверки МИО (демо) №ВП-2026-049',
    verifiedReadinessAt: '2026-09-30T00:00:00.000Z',
    legalBasisStatus: 'CONFIRMED_ABSENT',
    legalBasisType: 'NONE',
    legalBasisSource: 'Ответ реестра разрешений МИО (демо) №ОТВ-2026-0502 от 29.09.2026',
    legalBasisCheckedAt: '2026-09-30T00:00:00.000Z',
    legalBasisCheckedBy: DEMO_ANALYST,
    legalBasisNote:
      'Проверены все три способа: разрешение не выдавалось, гарантия не оформлялась, банк второго уровня не привлекался.',
    expectedScore: 75,
    expectedZone: 'RED',
    demoNote:
      'Красная зона: подтверждены одновременно R1 и R2, плюс просрочка срока ввода более четырёх месяцев.',
    factors: [
      {
        code: 'R1',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'Получен письменный отказ-подтверждение: применимое правовое основание привлечения средств по объекту отсутствует.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-30T06:00:00.000Z',
        evidence: [
          {
            kind: 'REGISTRY_RECORD',
            sourceLabel: 'Ответ реестра разрешений МИО (демо) №ОТВ-2026-0502',
            capturedAt: '2026-09-30T00:00:00.000Z',
            note: 'Разрешение не выдавалось. Договор гарантии Единого оператора отсутствует.',
          },
        ],
      },
      {
        code: 'R2',
        status: 'CONFIRMED',
        origin: 'AI_ACCEPTED',
        rationale:
          'В публикации два независимых условия оплаты: первоначальный взнос 30% и платная бронь 200 000 ₸. Обе гипотезы ИИ проверены по тексту и приняты.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-07-19T05:00:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-07',
            fragment:
              'Первоначальный взнос 30%, остальное — беспроцентная рассрочка до конца строительства',
            sourceLabel: 'Мессенджер, канал (демо), публикация от 18.07.2026',
            capturedAt: '2026-07-19T03:10:00.000Z',
          },
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-07',
            fragment: 'бронь платная — 200 000 ₸',
            sourceLabel: 'Мессенджер, канал (демо), публикация от 18.07.2026',
            capturedAt: '2026-07-19T03:10:00.000Z',
          },
        ],
      },
      {
        code: 'R3',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale: 'Квартиры в строящемся доме рекламируются на двух площадках.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-08-03T05:00:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-08',
            fragment: 'Продам двухкомнатную квартиру 64 м² в строящемся ЖК «Самал Тауэрс»',
            sourceLabel: 'Доска объявлений (демо), публикация от 02.08.2026',
            capturedAt: '2026-08-03T04:20:00.000Z',
          },
        ],
      },
      {
        code: 'R4',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Коллективных обращений по объекту не поступало.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-30T06:10:00.000Z',
      },
      {
        code: 'R5',
        status: 'REJECTED',
        origin: 'RULE',
        rationale:
          'Заявленная готовность 60%, подтверждённая 55%. Расхождение 5 процентных пунктов — порог не достигнут.',
      },
      {
        code: 'R6',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'Плановый срок ввода — II квартал 2026, истёк более четырёх месяцев назад. Актом выездной проверки зафиксировано отсутствие работ на объекте.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-30T06:15:00.000Z',
        evidence: [
          {
            kind: 'FIELD_CHECK',
            sourceLabel: 'Акт выездной проверки МИО (демо) №ВП-2026-049 от 30.09.2026',
            capturedAt: '2026-09-30T00:00:00.000Z',
            note: 'Техника и рабочие на площадке отсутствуют, просрочка 136 дней.',
          },
        ],
      },
    ],
  },

  // =========================================================================
  // ГРАНИЧНЫЙ КЕЙС ЗОНЫ.
  // R1 35 + R3 10 + R4 15 + R5 10 + R6 5 = 75 баллов, но R2 отклонён.
  // Комбинации R1+R2 нет → по правилу ТЗ зона ЖЁЛТАЯ, несмотря на 60+.
  // Этот объект ловит самую частую ошибку: определение зоны только по баллу.
  // =========================================================================
  {
    key: 'grand-ertis',
    slug: 'grand-ertis',
    name: 'ЖК «Гранд Ертіс»',
    nameKk: '«Гранд Ертіс» ТК',
    address: 'г. Усть-Каменогорск, Самарское шоссе, 3/1',
    addressKk: 'Өскемен қ., Самара тас жолы, 3/1',
    lat: 49.9852,
    lng: 82.6511,
    developerKey: 'ertis',
    stage: 'FRAME',
    plannedCompletionAt: '2027-09-30T00:00:00.000Z',
    actualDelayDays: 92,
    declaredReadinessPct: 65,
    declaredReadinessSource: 'Проектная декларация застройщика (демо), ред. от 01.08.2026',
    declaredReadinessAt: '2026-08-01T00:00:00.000Z',
    verifiedReadinessPct: 40,
    verifiedReadinessSource: 'Акт выездной проверки МИО (демо) №ВП-2026-063',
    verifiedReadinessAt: '2026-09-22T00:00:00.000Z',
    legalBasisStatus: 'CONFIRMED_ABSENT',
    legalBasisType: 'NONE',
    legalBasisSource: 'Ответ реестра разрешений МИО (демо) №ОТВ-2026-0488 от 20.09.2026',
    legalBasisCheckedAt: '2026-09-22T00:00:00.000Z',
    legalBasisCheckedBy: DEMO_ANALYST,
    legalBasisNote:
      'Основание отсутствует по всем трём способам. При этом предложений внести деньги в публикациях не выявлено.',
    expectedScore: 75,
    expectedZone: 'YELLOW',
    demoNote:
      'Граничный кейс зоны: 75 баллов, но R2 отклонён. Комбинации R1+R2 нет → зона жёлтая, а не красная.',
    appeals: [
      {
        registeredAt: '2026-09-10T00:00:00.000Z',
        signatories: 21,
        status: 'VERIFIED',
        reference: 'ОБР-2026-0298 (демо)',
        summary:
          'Коллективное обращение о приостановке работ на объекте. Факты проверены и подтвердились.',
      },
    ],
    factors: [
      {
        code: 'R1',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'Проверенными данными установлено отсутствие применимого правового основания привлечения средств.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-22T06:00:00.000Z',
        evidence: [
          {
            kind: 'REGISTRY_RECORD',
            sourceLabel: 'Ответ реестра разрешений МИО (демо) №ОТВ-2026-0488',
            capturedAt: '2026-09-22T00:00:00.000Z',
          },
        ],
      },
      {
        code: 'R2',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale:
          'Единственная связанная публикация проверена построчно: предложений платной брони, депозита, первоначального взноса или аналогичной схемы не содержит. Рекламируются планировки и цены без условий оплаты.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-22T06:05:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-09',
            fragment: 'Планировки и актуальные цены — на сайте застройщика',
            sourceLabel: 'Соцсеть, страница (демо), публикация от 19.09.2026',
            capturedAt: '2026-09-20T04:05:00.000Z',
            note:
              'Приложено как обоснование отклонения: условий внесения денег в тексте нет.',
          },
        ],
      },
      {
        code: 'R3',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale: 'Квартиры в строящемся доме продвигаются на странице застройщика.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-20T05:00:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-09',
            fragment: 'ЖК «Гранд Ертіс» на Самарском шоссе',
            sourceLabel: 'Соцсеть, страница (демо), публикация от 19.09.2026',
            capturedAt: '2026-09-20T04:05:00.000Z',
          },
        ],
      },
      {
        code: 'R4',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'Коллективное обращение 21 дольщика о приостановке работ проверено, сведения подтвердились.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-22T06:10:00.000Z',
        evidence: [
          {
            kind: 'APPEAL',
            sourceLabel: 'Коллективное обращение (демо) №ОБР-2026-0298 от 10.09.2026',
            capturedAt: '2026-09-22T00:00:00.000Z',
            note: '21 подписант, статус проверки: подтверждено.',
          },
        ],
      },
      {
        code: 'R5',
        status: 'CONFIRMED',
        origin: 'RULE',
        rationale:
          'Заявленная готовность 65%, подтверждённая 40%. Расхождение 25 процентных пунктов превышает порог 20.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-22T06:12:00.000Z',
        evidence: [
          {
            kind: 'FIELD_CHECK',
            sourceLabel: 'Акт выездной проверки МИО (демо) №ВП-2026-063 от 22.09.2026',
            capturedAt: '2026-09-22T00:00:00.000Z',
          },
        ],
      },
      {
        code: 'R6',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'Зафиксирован простой работ продолжительностью более трёх месяцев, подтверждён актом и обращением дольщиков.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-09-22T06:14:00.000Z',
        evidence: [
          {
            kind: 'FIELD_CHECK',
            sourceLabel: 'Акт выездной проверки МИО (демо) №ВП-2026-063 от 22.09.2026',
            capturedAt: '2026-09-22T00:00:00.000Z',
            note: 'Простой 92 дня.',
          },
        ],
      },
    ],
  },

  // =========================================================================
  // Спокойный объект с небольшой просрочкой: R3 10 + R6 5 = 15, зелёная.
  // =========================================================================
  {
    key: 'zhastar-city',
    slug: 'zhastar-city',
    name: 'ЖК «Жастар Сити»',
    nameKk: '«Жастар Сити» ТК',
    address: 'г. Усть-Каменогорск, ул. Ушанова, 92',
    addressKk: 'Өскемен қ., Ушанов к-сі, 92',
    lat: 49.9705,
    lng: 82.5989,
    developerKey: 'koktem',
    stage: 'FINISHING',
    plannedCompletionAt: '2026-12-31T00:00:00.000Z',
    actualDelayDays: 92,
    declaredReadinessPct: 85,
    declaredReadinessSource: 'Проектная декларация застройщика (демо), ред. от 28.09.2026',
    declaredReadinessAt: '2026-09-28T00:00:00.000Z',
    verifiedReadinessPct: 82,
    verifiedReadinessSource: 'Акт визуального осмотра МИО (демо) №ОСМ-2026-240',
    verifiedReadinessAt: '2026-10-03T00:00:00.000Z',
    legalBasisStatus: 'CONFIRMED_PRESENT',
    legalBasisType: 'BANK_PARTICIPATION',
    legalBasisSource:
      'Договор об участии банка второго уровня (демо) №БВУ-2025-0077, подтверждён банком',
    legalBasisCheckedAt: '2026-10-03T00:00:00.000Z',
    legalBasisCheckedBy: DEMO_ANALYST,
    legalBasisNote:
      'Привлечение средств организовано через банк второго уровня — законный способ по ст. 7 Закона РК.',
    expectedScore: 15,
    expectedZone: 'GREEN',
    demoNote:
      'Основание подтверждено, расхождение готовности в пределах нормы. Перенос срока даёт только R6 → зелёная зона.',
    factors: [
      {
        code: 'R1',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Участие банка второго уровня подтверждено документально.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-10-03T06:00:00.000Z',
        evidence: [
          {
            kind: 'DOCUMENT',
            sourceLabel: 'Договор об участии банка второго уровня (демо) №БВУ-2025-0077',
            capturedAt: '2026-10-03T00:00:00.000Z',
          },
        ],
      },
      {
        code: 'R2',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Условий внесения денег в связанной публикации не выявлено.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-10-03T06:02:00.000Z',
      },
      {
        code: 'R3',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale: 'Объект не введён в эксплуатацию, квартиры рекламируются.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-10-02T05:00:00.000Z',
        evidence: [
          {
            kind: 'TEXT_FRAGMENT',
            publicationKey: 'pub-10',
            fragment: 'Свободны 18 квартир',
            sourceLabel: 'Доска объявлений (демо), публикация от 01.10.2026',
            capturedAt: '2026-10-02T04:00:00.000Z',
          },
        ],
      },
      {
        code: 'R4',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Обращений по объекту не зарегистрировано.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-10-03T06:04:00.000Z',
      },
      {
        code: 'R5',
        status: 'REJECTED',
        origin: 'RULE',
        rationale:
          'Заявленная готовность 85%, подтверждённая 82%. Расхождение 3 процентных пункта.',
      },
      {
        code: 'R6',
        status: 'CONFIRMED',
        origin: 'MANUAL',
        rationale:
          'Срок ввода перенесён со II на IV квартал 2026 изменением проектной декларации. Отклонение документировано.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-10-03T06:06:00.000Z',
        evidence: [
          {
            kind: 'DOCUMENT',
            sourceLabel: 'Изменение проектной декларации (демо) от 28.09.2026',
            capturedAt: '2026-10-03T00:00:00.000Z',
            note: 'Перенос срока ввода на 92 дня.',
          },
        ],
      },
    ],
  },

  // =========================================================================
  // Введённый в эксплуатацию объект: 0 баллов, зелёная.
  // Проверяет, что R3 не начисляется после ввода в эксплуатацию.
  // =========================================================================
  {
    key: 'nurly-zhol',
    slug: 'nurly-zhol',
    name: 'ЖК «Нұрлы Жол»',
    nameKk: '«Нұрлы Жол» ТК',
    address: 'г. Усть-Каменогорск, пр. Абая, 150',
    addressKk: 'Өскемен қ., Абай д-лы, 150',
    lat: 49.9288,
    lng: 82.6358,
    developerKey: 'altai',
    stage: 'COMMISSIONED',
    plannedCompletionAt: '2026-03-31T00:00:00.000Z',
    declaredReadinessPct: 100,
    declaredReadinessSource: 'Акт ввода в эксплуатацию (демо) №ВВ-2026-014',
    declaredReadinessAt: '2026-03-28T00:00:00.000Z',
    verifiedReadinessPct: 100,
    verifiedReadinessSource: 'Акт ввода в эксплуатацию (демо) №ВВ-2026-014',
    verifiedReadinessAt: '2026-03-28T00:00:00.000Z',
    legalBasisStatus: 'CONFIRMED_PRESENT',
    legalBasisType: 'GUARANTEE_OPERATOR',
    legalBasisSource: 'Договор гарантии Единого оператора (демо) №ГАР-2024-061, исполнен',
    legalBasisCheckedAt: '2026-04-02T00:00:00.000Z',
    legalBasisCheckedBy: DEMO_ANALYST,
    legalBasisNote: 'Объект введён в эксплуатацию в срок, обязательства исполнены.',
    expectedScore: 0,
    expectedZone: 'GREEN',
    demoNote:
      'Эталон чистого объекта: 0 баллов. После ввода в эксплуатацию R3 не применяется.',
    factors: [
      {
        code: 'R1',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Гарантия Единого оператора действовала весь период строительства.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-04-02T06:00:00.000Z',
      },
      {
        code: 'R2',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Действующих публикаций с предложениями внести деньги не зафиксировано.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-04-02T06:02:00.000Z',
      },
      {
        code: 'R3',
        status: 'NOT_APPLICABLE',
        origin: 'RULE',
        rationale:
          'Объект введён в эксплуатацию 28.03.2026. Фактор «реклама строящегося жилья» к сданному дому неприменим.',
      },
      {
        code: 'R4',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Обращений по объекту не поступало.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-04-02T06:04:00.000Z',
      },
      {
        code: 'R5',
        status: 'REJECTED',
        origin: 'RULE',
        rationale: 'Заявленная и подтверждённая готовность совпадают: 100%.',
      },
      {
        code: 'R6',
        status: 'REJECTED',
        origin: 'MANUAL',
        rationale: 'Объект введён в эксплуатацию в плановый срок.',
        confirmedBy: DEMO_ANALYST,
        confirmedAt: '2026-04-02T06:06:00.000Z',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Поток сбора
// ---------------------------------------------------------------------------

/**
 * Демонстрационная лента публичного Telegram-канала.
 *
 * Набор подобран так, чтобы на экране сбора встретились все пять исходов:
 * взято, отброшено по стоп-слову, отброшено без единого совпадения,
 * отброшено как слишком узкое и отброшено как повтор. Экран, на котором
 * видны только удачные случаи, ничего не доказывает: смысл этого слоя —
 * показать, что система объясняет и свои отказы тоже.
 *
 * Тексты вымышленные, как и остальные демонстрационные данные, но устроены
 * как настоящие размещения по Усть-Каменогорску: смешанный русско-казахский
 * язык, эмодзи, телефон в подписи.
 */
export interface SeedFeedItem {
  externalId: string;
  publishedAt: string;
  author: string;
  url: string;
  rawText: string;
  /** Чего ждём от прогона. Сид сверяет и падает при расхождении. */
  expect: {
    verdict: 'KEPT' | 'SKIPPED';
    reason: 'MATCHED' | 'NO_MATCH' | 'EXCLUDED' | 'TOO_NARROW' | 'DUPLICATE';
  };
}

export const COLLECT_DEMO_CHANNEL = 'ukg_novostroyki_demo';

export const collectFeed: SeedFeedItem[] = [
  {
    externalId: '1041',
    publishedAt: '2026-10-06T04:10:00.000Z',
    author: 'Новостройки ВКО (демо)',
    url: `https://t.me/${COLLECT_DEMO_CHANNEL}/1041`,
    rawText:
      '🔑 ЖК «Алтай Арман» — старт продаж! Однокомнатные и двухкомнатные квартиры от застройщика. Бронь 150 000 ₸ фиксирует цену на 30 дней. Плановый ввод — IV квартал 2027 года. Телефон отдела продаж: +7 701 000 00 11',
    expect: { verdict: 'KEPT', reason: 'MATCHED' },
  },
  {
    externalId: '1042',
    publishedAt: '2026-10-06T09:25:00.000Z',
    author: 'Новостройки ВКО (демо)',
    url: `https://t.me/${COLLECT_DEMO_CHANNEL}/1042`,
    rawText:
      'Сдам 1-комнатную квартиру посуточно, центр, Wi-Fi, отчётные документы. 12 000 ₸ в сутки.',
    expect: { verdict: 'SKIPPED', reason: 'EXCLUDED' },
  },
  {
    externalId: '1043',
    publishedAt: '2026-10-07T03:40:00.000Z',
    author: 'Новостройки ВКО (демо)',
    url: `https://t.me/${COLLECT_DEMO_CHANNEL}/1043`,
    rawText:
      '🏗 ЖК «Ертіс Сарайы»: работы на котловане завершены. Рассрочка без переплаты до конца строительства, первоначальный взнос 20%. Пишите в личные сообщения.',
    expect: { verdict: 'KEPT', reason: 'MATCHED' },
  },
  {
    externalId: '1044',
    publishedAt: '2026-10-07T11:02:00.000Z',
    author: 'Новостройки ВКО (демо)',
    url: `https://t.me/${COLLECT_DEMO_CHANNEL}/1044`,
    rawText: 'Продам земельный участок 10 соток в пригороде, свет и вода по границе. Торг.',
    expect: { verdict: 'SKIPPED', reason: 'NO_MATCH' },
  },
  {
    externalId: '1045',
    publishedAt: '2026-10-08T05:15:00.000Z',
    author: 'Новостройки ВКО (демо)',
    url: `https://t.me/${COLLECT_DEMO_CHANNEL}/1045`,
    rawText:
      '«Көктем Парк» тұрғын үй кешені салынып жатыр. Пәтерлерді брондау басталды, бастапқы жарна 10%. Хабарласыңыз: +7 701 000 00 33',
    expect: { verdict: 'KEPT', reason: 'MATCHED' },
  },
  {
    externalId: '1046',
    publishedAt: '2026-10-08T12:48:00.000Z',
    author: 'Новостройки ВКО (демо)',
    url: `https://t.me/${COLLECT_DEMO_CHANNEL}/1046`,
    rawText:
      'ПРЕМИУМ ХАУС ДЕМО ✨ Усть-Каменогорск. Премиум класс. Какую квартиру вы ищете? Ответьте в опросе ниже.',
    expect: { verdict: 'SKIPPED', reason: 'TOO_NARROW' },
  },
  {
    externalId: '1047',
    publishedAt: '2026-10-09T04:00:00.000Z',
    author: 'Новостройки ВКО (демо)',
    url: `https://t.me/${COLLECT_DEMO_CHANNEL}/1047`,
    rawText: 'Ремонт квартир под ключ, натяжные потолки за один день. Смета бесплатно.',
    expect: { verdict: 'SKIPPED', reason: 'EXCLUDED' },
  },
  {
    externalId: '1048',
    publishedAt: '2026-10-09T10:30:00.000Z',
    author: 'Новостройки ВКО (демо)',
    url: `https://t.me/${COLLECT_DEMO_CHANNEL}/1048`,
    rawText:
      '🔑 ЖК «АЛТАЙ АРМАН» — СТАРТ ПРОДАЖ!!! Однокомнатные и двухкомнатные квартиры от застройщика. Бронь 150 000 ₸ фиксирует цену на 30 дней. Плановый ввод — IV квартал 2027 года. Телефон отдела продаж: +7 701 000 00 11',
    expect: { verdict: 'SKIPPED', reason: 'DUPLICATE' },
  },
  {
    externalId: '1049',
    publishedAt: '2026-10-10T06:20:00.000Z',
    author: 'Новостройки ВКО (демо)',
    url: `https://t.me/${COLLECT_DEMO_CHANNEL}/1049`,
    rawText:
      '📉 Скидки до 15% на квартиры в строящихся домах второй очереди. Готовность объекта 40%, сдача в 2028 году. Количество квартир по акции ограничено.',
    expect: { verdict: 'KEPT', reason: 'MATCHED' },
  },
  {
    externalId: '1050',
    publishedAt: '2026-10-10T13:05:00.000Z',
    author: 'Новостройки ВКО (демо)',
    url: `https://t.me/${COLLECT_DEMO_CHANNEL}/1050`,
    rawText: 'Ищу напарника в бригаду отделочников. Опыт обязателен, оплата еженедельно.',
    expect: { verdict: 'SKIPPED', reason: 'NO_MATCH' },
  },
];

// ---------------------------------------------------------------------------
// Проверки в реестрах
// ---------------------------------------------------------------------------

/**
 * Демонстрационные проверки в государственных реестрах.
 *
 * Набор подобран не вокруг удачных случаев, а вокруг трёх неудобных,
 * потому что именно они показывают, чем инструмент надзорного органа
 * отличается от витрины:
 *
 *   1. На портале разрешения нет — и это НЕ основание начислить R1.
 *      Самая частая ошибка в таких системах: пустой ответ реестра
 *      показывают как установленное нарушение. Проверка reg-01 устроена
 *      так, чтобы на экране было видно обратное.
 *   2. R1 всё-таки начислен — но не по молчанию реестра, а по исходящему
 *      ответу уполномоченной организации, и в карточке лежит его номер
 *      (reg-02). Разница между «не нашли» и «нам письменно ответили,
 *      что основания нет» — это разница между подозрением и фактом.
 *   3. Набор, который выглядит подходящим, но заморожен с 2021 года
 *      и покрывает только Алматы (reg-07). Если бы мы подключили его
 *      молча, пустой ответ по Усть-Каменогорску выглядел бы как
 *      «нарушений не найдено».
 *
 * Ответы служб в поле responseJson — вымышленные, как и весь набор.
 * Настоящих выписок из государственных баз здесь нет и быть не может:
 * демонстрационная база не должна содержать чужих данных.
 */
export interface SeedRegistryCheck {
  key: string;
  /** Идентификатор источника из src/core/registry/sources.ts. */
  sourceId: string;
  developerKey: string;
  /** Пусто, если проверка запущена из общего списка, а не с карточки ЖК. */
  projectKey?: string;
  answer: 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE';
  /** Проверку проводил человек руками: открыл сайт, скачал выписку. */
  manual: boolean;
  /** Чем подтверждена ручная проверка. */
  attachment?: string;
  requestUrl?: string;
  requestJson?: string;
  responseJson?: string;
  error?: string;
  /** Строки сверки: поле, подпись, значение из карточки, значение из реестра. */
  comparison?: Array<{
    key: string;
    labelRu: string;
    labelKk: string;
    declared: string | null;
    registry: string | null;
  }>;
  note: string;
  checkedAt: string;
  checkedBy: string;
}

export const registryChecks: SeedRegistryCheck[] = [
  // --- 1. Пустой ответ, который нельзя считать нарушением ------------------
  {
    key: 'reg-01',
    sourceId: 'homeportal',
    developerKey: 'altai',
    projectKey: 'altai-arman',
    answer: 'NOT_FOUND',
    manual: true,
    requestUrl: 'https://homeportal.kz/ru/objects',
    note:
      'Поиск по застройщику на портале результатов не дал. Это не означает отсутствия разрешения: портал показывает только объекты, по которым сведения уже выгружены. Фактор R1 по такому ответу не начисляется. Направлен письменный запрос в уполномоченную организацию, карточка остаётся в состоянии «не проверено».',
    checkedAt: '2026-10-05T04:20:00.000Z',
    checkedBy: DEMO_ANALYST,
  },

  // --- 2. R1 держится на ответе органа, а не на молчании реестра -----------
  {
    key: 'reg-02',
    sourceId: 'homeportal',
    developerKey: 'ertis',
    projectKey: 'ertis-sarayy',
    answer: 'NOT_FOUND',
    manual: true,
    attachment: 'Исх. № 04-12/1187 от 02.10.2026 — ответ уполномоченной организации (демо)',
    requestUrl: 'https://homeportal.kz/ru/objects',
    note:
      'Записи на портале нет. Основанием для фактора R1 служит не это, а приложенный письменный ответ уполномоченной организации: разрешение на привлечение денег дольщиков по объекту не выдавалось. Снятие фактора возможно только при предъявлении застройщиком разрешения.',
    checkedAt: '2026-10-02T09:15:00.000Z',
    checkedBy: DEMO_ANALYST,
  },

  // --- 3. Найденное разрешение снимает подозрение --------------------------
  {
    key: 'reg-03',
    sourceId: 'qazreestr',
    developerKey: 'koktem',
    projectKey: 'koktem-park',
    answer: 'FOUND',
    manual: true,
    attachment: 'Выписка из реестра от 28.09.2026, печатная форма (демо)',
    requestUrl: 'https://qazreestr.kz/',
    comparison: [
      {
        key: 'developer',
        labelRu: 'Застройщик',
        labelKk: 'Құрылыс салушы',
        declared: 'ТОО «Көктем Строй Демо»',
        registry: 'Товарищество с ограниченной ответственностью «Көктем Строй Демо»',
      },
      {
        key: 'legalBasis',
        labelRu: 'Способ организации долевого участия',
        labelKk: 'Үлестік қатысуды ұйымдастыру тәсілі',
        declared: 'Гарантия Единого оператора',
        registry: 'Гарантия Единого оператора',
      },
      {
        key: 'address',
        labelRu: 'Адрес объекта',
        labelKk: 'Нысан мекенжайы',
        declared: 'ул. Казахстан, 42',
        registry: 'ул. Казахстан, 42/1',
      },
    ],
    note:
      'Разрешение по объекту подтверждено. Фактор R1 снят. Адрес в реестре записан с литерой «/1» — расхождение не критичное, но внесено в карточку, чтобы при следующей проверке не искать объект заново.',
    checkedAt: '2026-09-28T05:40:00.000Z',
    checkedBy: DEMO_ANALYST,
  },

  // --- 4. Сведения о застройщике: налоговая задолженность ------------------
  {
    key: 'reg-04',
    sourceId: 'egov-tax-debt-legal',
    developerKey: 'ertis',
    answer: 'FOUND',
    manual: false,
    requestUrl:
      'https://data.egov.kz/api/v4/01102016_zhylgy_zhagdaiga_sa1/v91?source=%7B%22size%22%3A10%2C%22from%22%3A0%2C%22query%22%3A%7B%22bool%22%3A%7B%22must%22%3A%5B%7B%22match%22%3A%7B%22bin%22%3A%22000000000102%22%7D%7D%5D%7D%7D%7D',
    requestJson:
      '{"size":10,"from":0,"query":{"bool":{"must":[{"match":{"bin":"000000000102"}}]}}}',
    responseJson:
      '[{"bin":"000000000102","name":"ТОО «Ертіс Девелопмент Демо»","region":"Восточно-Казахстанская область","total_debt":18740000,"debt_months":7}]',
    note:
      'Задолженность свыше 150 МРП не погашена более четырёх месяцев. Это сведение о застройщике, а не фактор риска: на балл объекта оно не влияет и в расчёт не входит. Показывается рядом с карточкой как обстоятельство, которое аналитик учитывает при выборе очерёдности проверок.',
    checkedAt: '2026-10-12T03:05:00.000Z',
    checkedBy: DEMO_ANALYST,
  },

  // --- 5. Сверка названия и адреса с ГБД ЮЛ --------------------------------
  {
    key: 'reg-05',
    sourceId: 'egov-legal-entities',
    developerKey: 'altai',
    projectKey: 'altai-arman',
    answer: 'FOUND',
    manual: false,
    requestUrl:
      'https://data.egov.kz/api/v4/gbd_ul/v1?source=%7B%22size%22%3A10%2C%22from%22%3A0%2C%22query%22%3A%7B%22bool%22%3A%7B%22must%22%3A%5B%7B%22match%22%3A%7B%22bin%22%3A%22000000000101%22%7D%7D%5D%7D%7D%7D',
    requestJson:
      '{"size":10,"from":0,"query":{"bool":{"must":[{"match":{"bin":"000000000101"}}]}}}',
    responseJson:
      '[{"bin":"000000000101","name_ru":"ТОО «Алтай Құрылыс Демо»","registration_date":"2019-03-14","oked":"41201","address":"г. Усть-Каменогорск, ул. Протозанова, 83"}]',
    comparison: [
      {
        key: 'developer',
        labelRu: 'Наименование застройщика',
        labelKk: 'Құрылыс салушының атауы',
        declared: 'ТОО «Алтай Құрылыс Демо»',
        registry: 'ТОО «Алтай Құрылыс Демо»',
      },
      {
        key: 'phone',
        labelRu: 'Телефон из объявления',
        labelKk: 'Жарнамадағы телефон',
        declared: '+7 701 000 00 11',
        registry: null,
      },
      {
        key: 'oked',
        labelRu: 'Основной вид деятельности',
        labelKk: 'Қызметтің негізгі түрі',
        declared: null,
        registry: '41201 — строительство жилых зданий',
      },
    ],
    note:
      'Наименование совпадает дословно. Телефона из объявления в реестре нет — там его и не должно быть, это не расхождение. Вид деятельности соответствует жилищному строительству.',
    checkedAt: '2026-10-12T03:06:00.000Z',
    checkedBy: DEMO_ANALYST,
  },

  // --- 6. Пустой ответ машинного реестра -----------------------------------
  {
    key: 'reg-06',
    sourceId: 'egov-construction-licenses',
    developerKey: 'samal',
    projectKey: 'samal-towers',
    answer: 'NOT_FOUND',
    manual: false,
    requestUrl:
      'https://data.egov.kz/api/v4/reestr_attestovannyh1/v1?source=%7B%22size%22%3A10%2C%22from%22%3A0%2C%22query%22%3A%7B%22bool%22%3A%7B%22must%22%3A%5B%7B%22match%22%3A%7B%22bin%22%3A%22000000000105%22%7D%7D%5D%7D%7D%7D',
    requestJson:
      '{"size":10,"from":0,"query":{"bool":{"must":[{"match":{"bin":"000000000105"}}]}}}',
    responseJson: '[]',
    note:
      'Записей по БИН застройщика в наборе нет. Толковать это как отсутствие аттестованных специалистов нельзя: набор обновляется не ежедневно и может не содержать свежих сведений. На оценку риска ответ не влияет; при необходимости направляется запрос в орган.',
    checkedAt: '2026-10-12T03:07:00.000Z',
    checkedBy: DEMO_ANALYST,
  },

  // --- 7. Набор, который выглядит подходящим, но заморожен -----------------
  {
    key: 'reg-07',
    sourceId: 'egov-smr-notices',
    developerKey: 'ulba',
    projectKey: 'ulba-residence',
    answer: 'UNAVAILABLE',
    manual: false,
    requestUrl: 'https://data.egov.kz/datasets/view?index=uvedomlenieonachalesmr2',
    error:
      'Набор не используется для проверки: публикация прекращена в апреле 2021 года, а записи в нём относятся только к городу Алматы. Запрос по Усть-Каменогорску вернул бы пустоту, и эта пустота выглядела бы как отсутствие нарушений.',
    note:
      'Источник оставлен в каталоге намеренно, со статусом «проверен и отклонён». Молча убрать его было бы хуже: через полгода кто-нибудь нашёл бы его снова по названию и подключил, не проверив даты.',
    checkedAt: '2026-10-12T03:08:00.000Z',
    checkedBy: DEMO_ANALYST,
  },

  // --- 8. Разрешение МИО, подтверждённое вручную ---------------------------
  {
    key: 'reg-08',
    sourceId: 'elicense',
    developerKey: 'ulba',
    projectKey: 'ulba-residence',
    answer: 'FOUND',
    manual: true,
    attachment: 'Разрешение МИО № ВК-2025-0417 от 11.04.2025, копия в деле (демо)',
    requestUrl: 'https://elicense.kz/',
    comparison: [
      {
        key: 'legalBasis',
        labelRu: 'Способ организации долевого участия',
        labelKk: 'Үлестік қатысуды ұйымдастыру тәсілі',
        declared: 'Разрешение местного исполнительного органа',
        registry: 'Разрешение местного исполнительного органа',
      },
      {
        key: 'permitNumber',
        labelRu: 'Номер разрешения',
        labelKk: 'Рұқсат нөмірі',
        declared: 'ВК-2025-0417',
        registry: 'ВК-2025-0417',
      },
    ],
    note:
      'Портал закрыт проверкой на робота, поэтому запрос выполнен человеком и подтверждён копией разрешения. Автоматизировать этот шаг мы не стали сознательно: обходить проверку на робота надзорному органу нельзя.',
    checkedAt: '2026-09-30T10:00:00.000Z',
    checkedBy: DEMO_ANALYST,
  },
];
