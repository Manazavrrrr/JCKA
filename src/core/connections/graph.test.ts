/**
 * Тесты поиска связанных аккаунтов и телефонов.
 *
 * Модуль отвечает на вопрос, который нельзя задать одной карточке: один и тот
 * же продавец ведёт размещения по нескольким объектам? Цена ошибки здесь
 * несимметрична. Пропущенная связь оставляет аналитика с тем, что у него и
 * было, — списком отдельных объявлений. Выдуманная связь отправляет его
 * проверять совпадение, которого не существует, и подрывает доверие к разделу
 * целиком. Поэтому большая часть тестов проверяет не находки, а отказы:
 * одинаковый ник на разных площадках, подпись-заглушка, короткое имя.
 *
 * Отдельно проверяется воспроизводимость: выдача не зависит от порядка, в
 * котором пришли публикации. От этого зависит, можно ли приложить скриншот
 * раздела к сигналу.
 */

import { describe, expect, it } from 'vitest';

import { publications as seedPublications } from '../../../prisma/seed-data';
import {
  type ConnectionInput,
  connectionsOf,
  findConnections,
  normalizeAccount,
  normalizePhone,
} from './graph';

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

let counter = 0;

/** Публикация с заполненными по умолчанию полями — в тесте виден только смысл. */
function pub(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  counter += 1;
  return {
    id: `p${String(counter).padStart(2, '0')}`,
    projectId: null,
    platform: 'KRISHA_DEMO',
    ...overrides,
  };
}

/** Публикации из реальных демонстрационных данных. */
function fromSeed(): ConnectionInput[] {
  return seedPublications.map((item) => ({
    id: item.key,
    projectId: item.projectKey,
    projectName: item.projectKey,
    platform: item.platform,
    accountName: item.accountName,
    contactPhone: item.contactPhone ?? null,
    publishedAt: item.publishedAt,
  }));
}

function clusterWith(clusters: ReturnType<typeof findConnections>, id: string) {
  return clusters.find((cluster) => cluster.publicationIds.includes(id));
}

// ---------------------------------------------------------------------------

describe('нормализация телефона', () => {
  it('разные записи одного номера сходятся к одному виду', () => {
    const expected = '+77015554433';
    expect(normalizePhone('+7 701 555 44 33')).toBe(expected);
    expect(normalizePhone('8 701 555 44 33')).toBe(expected);
    expect(normalizePhone('87015554433')).toBe(expected);
    expect(normalizePhone('77015554433')).toBe(expected);
    expect(normalizePhone('7015554433')).toBe(expected);
    expect(normalizePhone('+7 (701) 555-44-33')).toBe(expected);
    expect(normalizePhone('тел.: 8-701-555-44-33')).toBe(expected);
  });

  /**
   * Это главное, зачем нужна нормализация: связь между площадками. На Krisha
   * номер оформлен скобками, в Instagram записан через восьмёрку — без
   * приведения к одному виду связь не нашлась бы именно там, где важнее всего.
   */
  it('находит один номер в разном оформлении на разных площадках', () => {
    const krisha = normalizePhone('+7 (701) 000-00-22');
    const instagram = normalizePhone('87010000022');
    expect(krisha).toBe(instagram);
    expect(krisha).not.toBeNull();
  });

  it('обрывки и мусор номером не считаются', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('555-44-33')).toBeNull();
    expect(normalizePhone('позвоните нам')).toBeNull();
    expect(normalizePhone('+7 701 555 44 33 44 33')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('нормализация имени аккаунта', () => {
  it('оформление ника не мешает узнать продавца', () => {
    const expected = 'алия недвижимость';
    expect(normalizeAccount('@Алия_Недвижимость')).toBe(expected);
    expect(normalizeAccount('Алия Недвижимость')).toBe(expected);
    expect(normalizeAccount('алия  недвижимость')).toBe(expected);
    expect(normalizeAccount('«Алия-Недвижимость»')).toBe(expected);
  });

  it('слишком короткое имя не различает людей', () => {
    expect(normalizeAccount('аб')).toBeNull();
    expect(normalizeAccount('@a')).toBeNull();
    expect(normalizeAccount('   ')).toBeNull();
    expect(normalizeAccount(null)).toBeNull();
  });

  /**
   * Подпись-заглушка площадки — не имя. Два разных частных продавца получают
   * одинаковую надпись, и связать их по ней значило бы выдумать связь.
   */
  it('подпись-заглушка площадки именем не считается', () => {
    expect(normalizeAccount('Частное объявление')).toBeNull();
    expect(normalizeAccount('Частное объявление (демо)')).toBeNull();
    expect(normalizeAccount('частное лицо')).toBeNull();
    expect(normalizeAccount('Жеке хабарландыру')).toBeNull();
    expect(normalizeAccount('Без имени')).toBeNull();
    expect(normalizeAccount('Риелтор')).toBeNull();
  });

  /** Хотя бы одно содержательное слово делает подпись именем. */
  it('настоящее имя рядом со служебным словом сохраняется', () => {
    expect(normalizeAccount('Отдел продаж «Алтай Арман» (демо)')).toBe(
      'отдел продаж алтай арман демо',
    );
    expect(normalizeAccount('Частное объявление Алия')).toBe('частное объявление алия');
  });

  /**
   * Осознанное ограничение. «Дом Плюс» и «Dom Plus» — вероятно один продавец,
   * но доказать это нормализацией нельзя: обратная транслитерация
   * неоднозначна и породит связи между посторонними. Такие случаи
   * вылавливаются по телефону, который у площадок записан цифрами.
   */
  it('транслитерация именем не склеивается', () => {
    expect(normalizeAccount('Дом Плюс')).not.toBe(normalizeAccount('Dom Plus'));
  });
});

// ---------------------------------------------------------------------------

describe('построение групп', () => {
  it('общий телефон связывает публикации на разных площадках', () => {
    const clusters = findConnections([
      pub({ id: 'a', platform: 'KRISHA_DEMO', contactPhone: '+7 701 111 11 11' }),
      pub({ id: 'b', platform: 'INSTAGRAM_DEMO', contactPhone: '8 701 111 11 11' }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.publicationIds).toEqual(['a', 'b']);
    expect(clusters[0]?.basis).toEqual(['PHONE']);
    expect(clusters[0]?.phones).toEqual(['+77011111111']);
    expect(clusters[0]?.platforms).toEqual(['INSTAGRAM_DEMO', 'KRISHA_DEMO']);
  });

  it('общий аккаунт в пределах площадки связывает публикации', () => {
    const clusters = findConnections([
      pub({ id: 'a', platform: 'OLX_DEMO', accountName: '@alia_realty' }),
      pub({ id: 'b', platform: 'OLX_DEMO', accountName: 'Alia Realty' }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.basis).toEqual(['ACCOUNT']);
    expect(clusters[0]?.accounts).toHaveLength(1);
  });

  /**
   * Намеренное ограничение. «Алия» в Instagram и «Алия» в OLX — это, скорее
   * всего, разные люди. Совпадение ника без общего телефона не является
   * межплатформенным признаком, и склеивать по нему значило бы выдумать связь.
   */
  it('одинаковое имя на разных площадках связью не считается', () => {
    const clusters = findConnections([
      pub({ id: 'a', platform: 'INSTAGRAM_DEMO', accountName: 'Алия Недвижимость' }),
      pub({ id: 'b', platform: 'OLX_DEMO', accountName: 'Алия Недвижимость' }),
    ]);

    expect(clusters).toHaveLength(0);
  });

  it('общий телефон связывает даже при разных именах на разных площадках', () => {
    const clusters = findConnections([
      pub({
        id: 'a',
        platform: 'INSTAGRAM_DEMO',
        accountName: 'Алия Недвижимость',
        contactPhone: '+7 701 222 22 22',
      }),
      pub({
        id: 'b',
        platform: 'OLX_DEMO',
        accountName: 'Дом Плюс',
        contactPhone: '8 701 222 22 22',
      }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.accounts).toHaveLength(2);
  });

  /**
   * Связь транзитивна: продавец сменил номер в части размещений, но аккаунт
   * на площадке остался тем же. Группа обязана собраться целиком — иначе
   * аналитик увидит два фрагмента вместо одной картины.
   */
  it('связь транзитивна: телефон плюс аккаунт собирают одну группу', () => {
    const clusters = findConnections([
      pub({ id: 'a', platform: 'KRISHA_DEMO', contactPhone: '+7 701 333 33 33' }),
      pub({
        id: 'b',
        platform: 'OLX_DEMO',
        accountName: 'Дом Плюс Недвижимость',
        contactPhone: '+7 701 333 33 33',
      }),
      pub({ id: 'c', platform: 'OLX_DEMO', accountName: '@Дом_Плюс_Недвижимость' }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.publicationIds).toEqual(['a', 'b', 'c']);
    expect(clusters[0]?.basis).toEqual(['ACCOUNT', 'PHONE']);
  });

  it('одиночная публикация в выдачу не попадает', () => {
    const clusters = findConnections([
      pub({ id: 'a', contactPhone: '+7 701 444 44 44' }),
      pub({ id: 'b', contactPhone: '+7 701 555 55 55' }),
      pub({ id: 'c' }),
    ]);

    expect(clusters).toHaveLength(0);
  });

  it('пустой вход не ломает модуль', () => {
    expect(findConnections([])).toEqual([]);
  });

  it('публикации без контактов не склеиваются между собой', () => {
    const clusters = findConnections([pub(), pub(), pub()]);
    expect(clusters).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('содержание группы', () => {
  it('отмечает группу, затрагивающую несколько объектов', () => {
    const clusters = findConnections([
      pub({
        id: 'a',
        projectId: 'altai-arman',
        projectName: 'Алтай Арман',
        contactPhone: '+7 701 666 66 66',
      }),
      pub({
        id: 'b',
        projectId: 'ertis-sarayy',
        projectName: 'Ертіс Сарайы',
        contactPhone: '+7 701 666 66 66',
      }),
    ]);

    expect(clusters[0]?.crossProject).toBe(true);
    expect(clusters[0]?.projects).toEqual([
      { id: 'altai-arman', name: 'Алтай Арман' },
      { id: 'ertis-sarayy', name: 'Ертіс Сарайы' },
    ]);
  });

  it('группа внутри одного объекта поводом для внимания не отмечается', () => {
    const clusters = findConnections([
      pub({ id: 'a', projectId: 'altai-arman', contactPhone: '+7 701 777 77 77' }),
      pub({ id: 'b', projectId: 'altai-arman', contactPhone: '+7 701 777 77 77' }),
    ]);

    expect(clusters[0]?.crossProject).toBe(false);
    expect(clusters[0]?.projects).toHaveLength(1);
  });

  /**
   * Непривязанные публикации в группе — рабочая подсказка: объект для них
   * скорее всего тот же, что у остальных участников группы.
   */
  it('считает непривязанные публикации группы', () => {
    const clusters = findConnections([
      pub({ id: 'a', projectId: 'altai-arman', contactPhone: '+7 701 888 88 88' }),
      pub({ id: 'b', projectId: null, contactPhone: '+7 701 888 88 88' }),
      pub({ id: 'c', projectId: null, contactPhone: '+7 701 888 88 88' }),
    ]);

    expect(clusters[0]?.unlinkedCount).toBe(2);
    expect(clusters[0]?.projects).toHaveLength(1);
    expect(clusters[0]?.crossProject).toBe(false);
  });

  it('идентификатор группы устойчив и не зависит от порядка входа', () => {
    const items = [
      pub({ id: 'z', contactPhone: '+7 701 999 99 99' }),
      pub({ id: 'm', contactPhone: '+7 701 999 99 99' }),
      pub({ id: 'a', contactPhone: '+7 701 999 99 99' }),
    ];

    const direct = findConnections(items);
    const reversed = findConnections([...items].reverse());

    expect(direct[0]?.id).toBe('a');
    expect(reversed[0]?.id).toBe('a');
    expect(direct).toEqual(reversed);
  });
});

// ---------------------------------------------------------------------------

describe('порядок выдачи', () => {
  /**
   * Сверху должно оказаться самое содержательное — группы, затрагивающие
   * несколько объектов. Иначе аналитик сортирует список вручную, а при
   * нескольких десятках групп просто не доходит до важного.
   */
  it('группы по нескольким объектам идут первыми, затем более крупные', () => {
    const clusters = findConnections([
      // Крупная группа, но внутри одного объекта.
      pub({ id: 'b1', projectId: 'one', contactPhone: '+7 700 000 00 01' }),
      pub({ id: 'b2', projectId: 'one', contactPhone: '+7 700 000 00 01' }),
      pub({ id: 'b3', projectId: 'one', contactPhone: '+7 700 000 00 01' }),
      pub({ id: 'b4', projectId: 'one', contactPhone: '+7 700 000 00 01' }),
      // Небольшая группа, но по двум объектам.
      pub({ id: 'a1', projectId: 'one', contactPhone: '+7 700 000 00 02' }),
      pub({ id: 'a2', projectId: 'two', contactPhone: '+7 700 000 00 02' }),
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.publicationIds).toEqual(['a1', 'a2']);
    expect(clusters[0]?.crossProject).toBe(true);
    expect(clusters[1]?.publicationIds).toHaveLength(4);
  });

  it('при равных признаках порядок детерминирован', () => {
    const items = [
      pub({ id: 'y1', contactPhone: '+7 700 000 00 11' }),
      pub({ id: 'y2', contactPhone: '+7 700 000 00 11' }),
      pub({ id: 'x1', contactPhone: '+7 700 000 00 22' }),
      pub({ id: 'x2', contactPhone: '+7 700 000 00 22' }),
    ];

    expect(findConnections(items).map((cluster) => cluster.id)).toEqual(['x1', 'y1']);
    expect(findConnections([...items].reverse()).map((cluster) => cluster.id)).toEqual([
      'x1',
      'y1',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('группы для одной публикации', () => {
  it('возвращает группы, в которые входит публикация', () => {
    const items = [
      pub({ id: 'a', contactPhone: '+7 702 000 00 01' }),
      pub({ id: 'b', contactPhone: '+7 702 000 00 01' }),
      pub({ id: 'c', contactPhone: '+7 702 000 00 02' }),
      pub({ id: 'd', contactPhone: '+7 702 000 00 02' }),
    ];

    const found = connectionsOf(items, 'a');
    expect(found).toHaveLength(1);
    expect(found[0]?.publicationIds).toEqual(['a', 'b']);
  });

  it('для публикации без связей возвращает пустой список', () => {
    const items = [
      pub({ id: 'a', contactPhone: '+7 702 000 00 03' }),
      pub({ id: 'b', contactPhone: '+7 702 000 00 03' }),
      pub({ id: 'lonely', contactPhone: '+7 702 000 00 04' }),
    ];

    expect(connectionsOf(items, 'lonely')).toEqual([]);
    expect(connectionsOf(items, 'нет-такой')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('демонстрационные данные', () => {
  /**
   * Связи заложены в данные намеренно: один номер обслуживает размещения по
   * «Ертіс Сарайы» и «Гранд Ертіс», другой — по «Көктем Парк» и «Жастар
   * Сити». Если бы модуль их не находил, на защите нечего было бы показать.
   */
  it('находит заложенные связи между объектами', () => {
    const clusters = findConnections(fromSeed());

    const crossProject = clusters.filter((cluster) => cluster.crossProject);
    expect(crossProject.length).toBeGreaterThanOrEqual(2);

    const ertis = clusterWith(clusters, 'pub-09');
    expect(ertis?.publicationIds).toEqual(['pub-03', 'pub-04', 'pub-09']);
    expect(ertis?.crossProject).toBe(true);
    expect(ertis?.projects.map((item) => item.id)).toEqual(['ertis-sarayy', 'grand-ertis']);

    const koktem = clusterWith(clusters, 'pub-05');
    expect(koktem?.publicationIds).toEqual(['pub-05', 'pub-10']);
    expect(koktem?.projects.map((item) => item.id)).toEqual(['koktem-park', 'zhastar-city']);
  });

  /**
   * Телеграм-канал «Новостройки ВКО» размещает объявления и по известному
   * объекту, и без привязки. Группа подсказывает аналитику, с чего начать
   * разбор непривязанной публикации.
   */
  it('связывает непривязанную публикацию с известным объектом', () => {
    const clusters = findConnections(fromSeed());
    const channel = clusterWith(clusters, 'pub-12');

    expect(channel?.publicationIds).toEqual(['pub-07', 'pub-12']);
    expect(channel?.basis).toEqual(['ACCOUNT', 'PHONE']);
    expect(channel?.unlinkedCount).toBe(1);
    expect(channel?.projects.map((item) => item.id)).toEqual(['samal-towers']);
  });

  /**
   * Два частных объявления подписаны одинаково — «Частное объявление (демо)»,
   * но на разных площадках и с разными номерами. Общего у них нет ничего,
   * и в выдаче их быть не должно.
   */
  it('не связывает разных частных продавцов по подписи-заглушке', () => {
    const clusters = findConnections(fromSeed());
    const eight = clusterWith(clusters, 'pub-08');
    const eleven = clusterWith(clusters, 'pub-11');

    expect(eight).toBeUndefined();
    expect(eleven).toBeUndefined();
  });

  it('выдача по демонстрационным данным воспроизводима', () => {
    const items = fromSeed();
    const direct = findConnections(items);
    const reversed = findConnections([...items].reverse());
    const shuffled = findConnections([...items].sort((a, b) => a.platform.localeCompare(b.platform)));

    expect(reversed).toEqual(direct);
    expect(shuffled).toEqual(direct);
  });

  it('все телефоны групп приведены к одному формату', () => {
    for (const cluster of findConnections(fromSeed())) {
      for (const phone of cluster.phones) {
        expect(phone).toMatch(/^\+7\d{10}$/);
      }
    }
  });
});
