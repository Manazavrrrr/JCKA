/**
 * Тесты движка разбора объявлений.
 *
 * Проверяется не «работает ли регулярное выражение», а четыре свойства,
 * которые требует ТЗ и без которых модуль нельзя показывать аналитику:
 *
 *   1. Разбор работает на новом тексте. Тесты специально написаны на
 *      объявлениях, которых нет в демо-наборе: заготовленные ответы
 *      система не использует.
 *   2. ИИ не трогает R1 и R4. Ни одна формулировка, даже прямо заявляющая
 *      об отсутствии разрешения, не даёт гипотезы по этим факторам.
 *   3. Законные схемы расчётов не превращаются в риск.
 *   4. Любая цитата указывает на реальные символы исходного текста.
 */

import { describe, expect, it } from 'vitest';

import { publications, projects } from '../../../prisma/seed-data';
import { LOW_CONFIDENCE_THRESHOLD } from '../domain/enums';
import { analyzeWithRules, rulesProvider } from './rules-provider';
import { LEGAL_BASIS_CHECK } from './provider';
import type { ProjectCandidate } from './provider';
import { analysisResultSchema } from './schemas';

const CANDIDATES: ProjectCandidate[] = projects.map((project) => ({
  id: project.key,
  name: project.name,
  nameKk: project.nameKk,
  address: project.address,
}));

function analyze(text: string, extra: Partial<{ title: string }> = {}) {
  return analyzeWithRules({ text, projects: CANDIDATES, ...extra });
}

function codes(result: ReturnType<typeof analyze>) {
  return result.factorHypotheses.map((item) => item.code);
}

/** Собирает все цитаты результата, чтобы проверить их позиции разом. */
function allSpans(result: ReturnType<typeof analyze>) {
  return [
    ...result.factorHypotheses.map((item) => item.span),
    ...result.projectMatches.map((item) => item.span),
    ...result.extracted.paymentTerms,
    ...result.extracted.phones,
    ...result.extracted.amounts,
    ...result.extracted.addresses,
    ...result.extracted.readinessMentions,
    ...result.extracted.delayMentions,
    ...result.extracted.legalBasisClaims,
  ].filter((span): span is NonNullable<typeof span> => span !== null);
}

// ---------------------------------------------------------------------------
// Текст, которого нет в демо-наборе
// ---------------------------------------------------------------------------

/**
 * Объявление, написанное специально для тестов.
 *
 * Это имитация того, что сделает проверяющий на защите: возьмёт собственный
 * текст и вставит его в систему. Ни одна строка здесь не встречается
 * в демо-данных.
 */
const FRESH_AD = `Новый жилой комплекс «Ақ Бұлақ» в Усть-Каменогорске!
Дом на этапе возведения каркаса, сдача — III квартал 2028 года.
Квартиры от 380 000 тенге за квадрат. Чтобы закрепить цену, вносится
платная бронь 250 тысяч тенге на карту менеджера. Предварительный договор
подписываем сразу. Звоните: 8 (705) 123-45-67.`;

const LAWFUL_AD = `ЖК «Жібек Жолы» — продажи идут по договорам о долевом участии.
Расчёты проходят через уполномоченный банк второго уровня на счёт эскроу.
Доступна ипотека по программе «7-20-25». Готовность объекта 64%.`;

const COMMISSIONED_AD = `Продам трёхкомнатную квартиру в сданном доме на улице Абая, 12.
Дом введён в эксплуатацию, есть акт приёмки. Собственник один, документы готовы.`;

// ---------------------------------------------------------------------------

describe('работа на новом тексте', () => {
  it('разбирает объявление, которого нет в демо-наборе', () => {
    const result = analyze(FRESH_AD);
    expect(result.isHousingAd).toBe(true);
    expect(result.mentionsUnderConstruction).toBe(true);
    expect(codes(result)).toContain('R2');
    expect(codes(result)).toContain('R3');
  });

  it('извлекает сущности из нового текста', () => {
    const result = analyze(FRESH_AD);
    expect(result.extracted.phones.map((item) => item.normalized)).toEqual(['+77051234567']);
    expect(result.extracted.amounts.map((item) => item.amount)).toContain(250000);
    expect(result.extracted.paymentTerms.map((item) => item.category)).toContain('BOOKING_FEE');
    expect(result.extracted.paymentTerms.map((item) => item.category)).toContain('DIRECT_TRANSFER');
  });

  it('не находит объект в реестре для незнакомого ЖК и говорит об этом', () => {
    const result = analyze(FRESH_AD);
    expect(result.projectMatches).toHaveLength(0);
    expect(result.warnings.some((item) => item.ru.includes('не определён'))).toBe(true);
  });

  it('результат проходит собственную схему', () => {
    expect(() => analysisResultSchema.parse(analyze(FRESH_AD))).not.toThrow();
  });

  it('не падает на пустом и мусорном тексте', () => {
    expect(() => analyze('')).not.toThrow();
    expect(() => analyze('   \n\n   ')).not.toThrow();
    expect(() => analyze('qwerty 12345 ??? !!!')).not.toThrow();
    expect(analyze('qwerty 12345').isHousingAd).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('границы ответственности ИИ', () => {
  /**
   * Самая важная проверка модуля. Текст прямо заявляет об отсутствии
   * разрешения — именно та формулировка, на которую «логично» выдать R1.
   * Гипотезы быть не должно: отсутствие основания устанавливается реестром,
   * а не рекламой. Иначе +35 баллов начислялись бы по чужому утверждению.
   */
  it('никогда не предлагает R1, даже если текст заявляет об отсутствии разрешения', () => {
    const texts = [
      'Продаём квартиры в строящемся доме без разрешения акимата, зато дешевле на 20%.',
      'Разрешение на привлечение средств пока не получено, но бронь уже можно внести.',
      'Работаем без договора долевого участия, деньги принимаем на карту.',
      FRESH_AD,
      LAWFUL_AD,
    ];
    for (const text of texts) {
      expect(codes(analyze(text))).not.toContain('R1');
    }
  });

  it('никогда не предлагает R4 по тексту публикации', () => {
    const text =
      'Дольщики ЖК «Самал Тауэрс» massовo жалуются, уже собрали коллективное обращение в акимат.';
    expect(codes(analyze(text))).not.toContain('R4');
  });

  it('вместо гипотезы по R1 выдаёт поручение проверить реестр', () => {
    const result = analyze('Продаём квартиры в строящемся доме без разрешения акимата.');
    expect(result.checks).toContainEqual(LEGAL_BASIS_CHECK);
    expect(result.checks[0]?.ru).toContain('реестре');
  });

  it('поручение проверить правовое основание есть в любом результате', () => {
    for (const text of ['', FRESH_AD, LAWFUL_AD, COMMISSIONED_AD]) {
      expect(analyze(text).checks).toContainEqual(LEGAL_BASIS_CHECK);
    }
  });

  it('ни одна гипотеза не является подтверждаемой сама по себе', () => {
    for (const text of [FRESH_AD, LAWFUL_AD, ...publications.map((item) => item.rawText)]) {
      for (const hypothesis of analyze(text).factorHypotheses) {
        expect(hypothesis.confirmable).toBe(false);
        expect(hypothesis.verification.ru.length).toBeGreaterThan(20);
      }
    }
  });

  it('у каждой гипотезы есть обоснование на двух языках', () => {
    for (const hypothesis of analyze(FRESH_AD).factorHypotheses) {
      expect(hypothesis.rationale.ru.length).toBeGreaterThan(10);
      expect(hypothesis.rationale.kk.length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------

describe('законные схемы расчётов не формируют риск', () => {
  /**
   * Контрольный случай из демо-набора: публикация pub-05 описывает расчёт
   * через уполномоченный банк на счёт эскроу с гарантией Единого оператора.
   * Это предусмотренный законом порядок. Гипотеза R2 здесь была бы
   * обвинением добросовестного застройщика.
   */
  it('эскроу, уполномоченный банк и Единый оператор не дают гипотезы R2', () => {
    const pub05 = publications.find((item) => item.key === 'pub-05');
    expect(pub05).toBeDefined();
    const result = analyze(pub05?.rawText ?? '');

    expect(codes(result)).not.toContain('R2');
    expect(result.extracted.paymentTerms.length).toBeGreaterThan(0);
    expect(result.extracted.paymentTerms.every((term) => term.riskBearing === false)).toBe(true);
  });

  it('то же на тексте, которого нет в демо-наборе', () => {
    const result = analyze(LAWFUL_AD);
    expect(codes(result)).not.toContain('R2');
    expect(result.extracted.paymentTerms.map((item) => item.category)).toContain('ESCROW');
    expect(result.extracted.paymentTerms.map((item) => item.category)).toContain('MORTGAGE');
  });

  /**
   * Одного слабого признака рядом с законной схемой недостаточно:
   * «рассрочка» в объявлении с ипотекой и эскроу — это условие продажи,
   * а не доказательство нарушения.
   */
  it('единственный слабый риск-признак рядом с законной схемой не даёт гипотезы', () => {
    const text =
      'ЖК «Коктем-2»: расчёты через эскроу-счёт уполномоченного банка, доступна ипотека. Есть рассрочка от застройщика до конца строительства.';
    expect(codes(analyze(text))).not.toContain('R2');
  });

  it('законная схема рядом с суммой и платной бронью гипотезу не отменяет, но снижает уверенность', () => {
    const risky = 'Платная бронь 300 000 тенге, предварительный договор, перевод на карту.';
    const mixed = `${risky} Также доступна ипотека банков-партнёров и эскроу-счёт.`;

    const riskyResult = analyze(risky).factorHypotheses.find((item) => item.code === 'R2');
    const mixedResult = analyze(mixed).factorHypotheses.find((item) => item.code === 'R2');

    expect(riskyResult).toBeDefined();
    expect(mixedResult).toBeDefined();
    expect(mixedResult?.confidence ?? 1).toBeLessThan(riskyResult?.confidence ?? 0);
    expect(mixedResult?.rationale.ru).toContain('уверенность снижена');
  });

  it('объявление о сданном доме не даёт гипотезы о привлечении средств', () => {
    expect(codes(analyze(COMMISSIONED_AD))).not.toContain('R2');
  });
});

// ---------------------------------------------------------------------------

describe('маркировка неуверенных выводов', () => {
  it('R5 и R6 всегда помечены как неуверенные', () => {
    const text =
      'ЖК «Алтын Дала»: готовность 70%, но срок сдачи перенесён на 2029 год. Квартиры в продаже.';
    const result = analyze(text);
    const low = result.factorHypotheses.filter((item) => ['R5', 'R6'].includes(item.code));

    expect(low.length).toBe(2);
    for (const hypothesis of low) {
      expect(hypothesis.lowConfidence).toBe(true);
      expect(hypothesis.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    }
  });

  it('гипотеза R5 называет порог и требование к источнику', () => {
    const result = analyze('ЖК «Алтын Дала»: готовность 70%. Квартиры в продаже.');
    const r5 = result.factorHypotheses.find((item) => item.code === 'R5');
    expect(r5?.verification.ru).toContain('20 процентных пунктов');
  });

  it('гипотеза R6 называет порог в 90 дней', () => {
    const result = analyze('Срок сдачи дома перенесён на следующий год, работы приостановлены.');
    const r6 = result.factorHypotheses.find((item) => item.code === 'R6');
    expect(r6?.verification.ru).toContain('90 дней');
  });

  it('процент не рядом с готовностью не считается готовностью', () => {
    const result = analyze('Скидка 15% на все квартиры в строящемся доме! Успейте купить.');
    expect(result.extracted.readinessMentions).toHaveLength(0);
    expect(codes(result)).not.toContain('R5');
  });

  it('уверенность всех гипотез лежит в отрезке [0, 1]', () => {
    for (const text of [FRESH_AD, LAWFUL_AD, ...publications.map((item) => item.rawText)]) {
      for (const hypothesis of analyze(text).factorHypotheses) {
        expect(hypothesis.confidence).toBeGreaterThan(0);
        expect(hypothesis.confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('сопоставление с реестром', () => {
  /**
   * Второй контрольный случай демо-набора: частное объявление pub-11
   * называет ЖК через дефис и без кавычек («ЖК Алтай-Арман»), тогда как
   * в реестре объект записан как «Алтай Арман». Без нечёткого сопоставления
   * такая публикация осталась бы непривязанной.
   */
  it('находит объект при другом написании названия', () => {
    const pub11 = publications.find((item) => item.key === 'pub-11');
    const result = analyze(pub11?.rawText ?? '');

    expect(result.projectMatches[0]?.projectId).toBe('altai-arman');
    expect(result.projectMatches[0]?.score ?? 0).toBeGreaterThan(0.8);
    expect(result.projectMatches[0]?.matchedOn).toContain('NAME');
  });

  it('верно определяет объект для всех связанных публикаций демо-набора', () => {
    for (const publication of publications) {
      if (!publication.projectKey) continue;
      const result = analyze(publication.rawText);
      expect(result.projectMatches[0]?.projectId, `публикация ${publication.key}`).toBe(
        publication.projectKey,
      );
    }
  });

  it('находит казахское название, набранное русскими буквами', () => {
    const result = analyze('Новая очередь ЖК Коктем Парк, проспект Назарбаева. Квартиры в продаже.');
    expect(result.projectMatches[0]?.projectId).toBe('koktem-park');
  });

  it('любая предложенная связь требует подтверждения аналитиком', () => {
    for (const publication of publications) {
      for (const match of analyze(publication.rawText).projectMatches) {
        expect(match.requiresConfirmation).toBe(true);
        expect(match.rationale.ru).toContain('подтвердить');
      }
    }
  });

  it('предлагает не больше трёх вариантов', () => {
    for (const publication of publications) {
      expect(analyze(publication.rawText).projectMatches.length).toBeLessThanOrEqual(3);
    }
  });

  it('совпадение телефона усиливает связь', () => {
    const withPhone = analyzeWithRules({
      text: 'Квартиры в строящемся доме. Звоните +7 701 000 00 11.',
      projects: [
        { id: 'altai-arman', name: 'Алтай Арман', knownPhones: ['+77010000011'] },
      ],
    });
    expect(withPhone.projectMatches[0]?.matchedOn).toContain('PHONE');
    expect(withPhone.projectMatches[0]?.score ?? 0).toBeGreaterThanOrEqual(0.85);
  });

  it('не связывает объявление с объектом по одному лишь похожему слову', () => {
    const result = analyze('Продам квартиру в районе Самарского шоссе, дом сдан.');
    expect(result.projectMatches.map((item) => item.projectId)).not.toContain('grand-ertis');
  });
});

// ---------------------------------------------------------------------------

/**
 * Названия извлекаются из текста самостоятельно, а не берутся из цитат
 * совпадений с реестром: совпадение может быть найдено по адресу или
 * телефону, и тогда его цитата — это адрес, а не название.
 */
describe('извлечение названия объекта', () => {
  function names(text: string): string[] {
    return analyze(text).extracted.projectNames.map((item) => item.fragment);
  }

  it('находит название в кавычках после указателя', () => {
    expect(names('Жилой комплекс «Нұрлы Жол» — сдача в 2027 году.')).toEqual(['Нұрлы Жол']);
    expect(names('тұрғын үй кешені «Ақ Бұлақ», пәтерлер сатылады.')).toEqual(['Ақ Бұлақ']);
  });

  it('находит название без кавычек', () => {
    expect(names('ЖК Коктем Парк, проспект Назарбаева.')).toEqual(['Коктем Парк']);
    expect(names('ЖК Алтай-Арман. Продаём квартиры.')).toEqual(['Алтай-Арман']);
  });

  it('не берёт за название продолжение фразы после «ЖК»', () => {
    expect(names('ЖК в центре города, квартиры в продаже.')).toEqual([]);
    expect(names('ЖК по адресу ул. Протозанова, 85.')).toEqual([]);
    expect(names('ЖК эконом класса, рассрочка от застройщика.')).toEqual([]);
  });

  it('отрезает предлог, попавший в название', () => {
    expect(names('ЖК Алтай-Арман на Протозанова, квартиры в продаже.')).toEqual(['Алтай-Арман']);
  });

  it('не выдумывает название, когда его в тексте нет', () => {
    expect(names('Квартиры в новостройке, звоните по телефону.')).toEqual([]);
  });

  /**
   * Главное требование к извлечению: название должно быть именно названием,
   * а не адресом, случайно совпавшим с объектом реестра. Здесь адрес
   * принадлежит одному объекту, а название в тексте — другому.
   */
  it('не подменяет название адресом при совпадении по адресу', () => {
    const text = 'ЖК «Жібек Жолы», г. Усть-Каменогорск, ул. Протозанова, 85. Квартиры в продаже.';
    const result = analyze(text);

    expect(result.extracted.projectNames.map((item) => item.fragment)).toEqual(['Жібек Жолы']);
    expect(result.projectMatches[0]?.matchedOn).toContain('ADDRESS');
  });

  it('все извлечённые названия указывают на исходный текст', () => {
    for (const publication of publications) {
      const result = analyze(publication.rawText);
      expect(result.extracted.projectNames.length).toBeGreaterThan(0);
      for (const name of result.extracted.projectNames) {
        expect(publication.rawText.slice(name.charStart, name.charEnd)).toBe(name.fragment);
      }
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Извлечённые сущности выводятся аналитику в карточке публикации.
 * Мусор в этом списке стоит дороже пропуска: один раз увидев «адрес»
 * «Продаём 2», аналитик перестаёт доверять и остальным полям.
 */
describe('извлечение адреса', () => {
  function addresses(text: string): string[] {
    return analyze(text).extracted.addresses.map((item) => item.fragment);
  }

  it('находит русскую запись адреса с указателем перед названием', () => {
    expect(addresses('Квартиры по адресу г. Усть-Каменогорск, ул. Протозанова, 85.')).toEqual([
      'ул. Протозанова, 85',
    ]);
    expect(addresses('Дом строится по пр. Абая 12/1, сдача в 2028 году.')).toEqual([
      'пр. Абая 12/1',
    ]);
    expect(addresses('Новый дом в мкр. Солнечный, 4.')).toEqual(['мкр. Солнечный, 4']);
  });

  /** В казахской записи указатель стоит после названия улицы. */
  it('находит казахскую запись адреса с указателем после названия', () => {
    expect(addresses('Пәтерлер: Өскемен қ., Абай даңғылы, 12/1.')).toEqual(['Абай даңғылы, 12/1']);
    expect(addresses('Өскемен қ., Протозанов к-сі, 85.')).toEqual(['Протозанов к-сі, 85']);
  });

  it('не принимает за адрес «слово + число» без указателя улицы', () => {
    expect(addresses('Продаём 2-комнатные квартиры от застройщика напрямую, сдача 2028.')).toEqual(
      [],
    );
    expect(addresses('Бронь 200 000 тенге, вносится на карту менеджера.')).toEqual([]);
    expect(addresses('Свободно 15 квартир, скидка 10% до 1 декабря.')).toEqual([]);
  });

  /** Самая коварная пара: «пр» внутри «Продаём» и «Протозанова». */
  it('не срабатывает на сокращении внутри слова', () => {
    const found = addresses('ЖК Алтай-Арман. Продаём квартиры, дом на стадии возведения каркаса.');
    expect(found).toEqual([]);
  });

  it('все извлечённые адреса указывают на исходный текст', () => {
    for (const publication of publications) {
      const result = analyze(publication.rawText);
      for (const address of result.extracted.addresses) {
        expect(publication.rawText.slice(address.charStart, address.charEnd)).toBe(
          address.fragment,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('точность цитат', () => {
  it('каждая цитата указывает на реальные символы исходного текста', () => {
    const texts = [FRESH_AD, LAWFUL_AD, COMMISSIONED_AD, ...publications.map((i) => i.rawText)];
    for (const text of texts) {
      for (const span of allSpans(analyze(text))) {
        expect(text.slice(span.charStart, span.charEnd), `текст: ${text.slice(0, 40)}`).toBe(
          span.fragment,
        );
      }
    }
  });

  it('цитата условия оплаты — это предложение, а не одно слово', () => {
    const result = analyze(FRESH_AD);
    const booking = result.extracted.paymentTerms.find((item) => item.category === 'BOOKING_FEE');
    expect(booking?.fragment.length ?? 0).toBeGreaterThan(20);
    expect(booking?.fragment).toContain('бронь');
  });

  it('сумма привязывается к ближайшему условию оплаты', () => {
    const result = analyze('Бронь квартиры 150 000 ₸. Отдельно депозит 400 000 ₸.');
    const booking = result.extracted.paymentTerms.find((item) => item.category === 'BOOKING_FEE');
    const deposit = result.extracted.paymentTerms.find((item) => item.category === 'DEPOSIT');
    expect(booking?.amount).toBe(150000);
    expect(deposit?.amount).toBe(400000);
  });
});

// ---------------------------------------------------------------------------

describe('воспроизводимость', () => {
  /** Без этого свойства объяснение балла теряет смысл: оно должно повторяться. */
  it('одинаковый текст даёт одинаковый разбор', () => {
    const texts = [FRESH_AD, LAWFUL_AD, ...publications.map((item) => item.rawText)];
    for (const text of texts) {
      const first = { ...analyze(text), durationMs: 0 };
      const second = { ...analyze(text), durationMs: 0 };
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    }
  });

  it('порядок объектов в реестре не влияет на результат', () => {
    const forward = analyzeWithRules({ text: FRESH_AD, projects: CANDIDATES });
    const backward = analyzeWithRules({ text: FRESH_AD, projects: [...CANDIDATES].reverse() });
    expect(JSON.stringify({ ...forward, durationMs: 0 })).toBe(
      JSON.stringify({ ...backward, durationMs: 0 }),
    );
  });

  it('гипотезы отсортированы по коду фактора', () => {
    const list = codes(analyze(FRESH_AD));
    expect(list).toEqual([...list].sort());
  });
});

// ---------------------------------------------------------------------------

describe('провайдер', () => {
  it('доступен без ключей и без сети', () => {
    expect(rulesProvider.id).toBe('rules');
    expect(rulesProvider.isAvailable()).toBe(true);
  });

  it('асинхронный вызов возвращает тот же результат, что и прямой', async () => {
    const direct = analyzeWithRules({ text: FRESH_AD, projects: CANDIDATES });
    const viaProvider = await rulesProvider.analyze({ text: FRESH_AD, projects: CANDIDATES });
    expect({ ...viaProvider, durationMs: 0 }).toEqual({ ...direct, durationMs: 0 });
  });

  it('помечает результат своим именем', () => {
    const result = analyze(FRESH_AD);
    expect(result.provider).toBe('rules');
    expect(result.model).toBeNull();
  });

  it('сводка предупреждает, что баллы начисляются только после проверки', () => {
    expect(analyze(FRESH_AD).summary.ru).toContain('после подтверждения аналитиком');
    expect(analyze(FRESH_AD).summary.ru).toContain('R1');
  });

  it('заголовок учитывается при сопоставлении, но цитаты берутся из текста', () => {
    const result = analyzeWithRules({
      title: 'ЖК Алтай-Арман, старт продаж',
      text: 'Дом строится, сдача в 2027 году. Бронь 150 000 ₸.',
      projects: CANDIDATES,
    });
    expect(result.projectMatches[0]?.projectId).toBe('altai-arman');
    for (const span of allSpans(result)) {
      expect(result.extracted.paymentTerms.length).toBeGreaterThan(0);
      expect(
        'Дом строится, сдача в 2027 году. Бронь 150 000 ₸.'.slice(span.charStart, span.charEnd),
      ).toBe(span.fragment);
    }
  });
});
