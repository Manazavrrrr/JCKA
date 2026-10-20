/**
 * Связанные аккаунты и телефоны.
 *
 * Экран отвечает на вопрос, который нельзя задать карточке одного
 * объявления: кто продаёт. Один телефон в объявлениях по четырём ЖК на
 * трёх площадках — это свойство продавца, а не объекта, и увидеть его,
 * открывая карточки по очереди, невозможно: связь существует между
 * карточками.
 *
 * Поэтому и устройство экрана обратное обычному списку: единица показа —
 * группа, а не объявление. Группы, затрагивающие несколько объектов,
 * стоят первыми (порядок задан в findConnections), потому что именно с
 * них начинается разбор.
 *
 * Чего здесь нет и не будет: кнопки «начислить балл». Связь — направление
 * проверки, а не нарушение. Риелтор, законно работающий с четырьмя
 * застройщиками, в этом разделе выглядит ровно так же, как недобросовестный
 * посредник, и различить их может только человек. Об этом сказано прямо
 * в конце страницы: раздел, который выглядит как доказательство, рано или
 * поздно используют как доказательство.
 *
 * Телефоны показаны в нормализованном виде (+7XXXXXXXXXX), а не так, как
 * их написали на площадке. Нормализованная форма — это и есть признак,
 * по которому группа собралась; показывать исходное написание значило бы
 * предлагать аналитику проверить связь по данным, которых система не
 * сравнивала.
 */

import Link from 'next/link';

import { PLATFORM_LABELS, type Platform } from '../../core/domain/enums';
import { translator } from '../../i18n/dict';
import { getLocale } from '../../i18n/server';
import { prisma } from '../../lib/db';
import { listConnections } from '../../server/queries';
import { FilterForm } from '../../components/Filters';
import { Empty, Notice, PageHeader, Stat, When, ZoneTag } from '../../components/ui';

export const dynamic = 'force-dynamic';

type Params = { crossProjectOnly?: string; projectId?: string };

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const locale = await getLocale();
  const t = translator(locale);
  const params = await searchParams;

  const crossProjectOnly = params.crossProjectOnly === 'true';

  const { total, items } = await listConnections(prisma, {
    projectId: params.projectId || undefined,
    crossProjectOnly,
  });

  /**
   * Сводка считается по тем же группам, что показаны, а не отдельным
   * запросом: иначе при включённом фильтре числа в плитках противоречили
   * бы списку под ними.
   */
  const summary = {
    clusters: total,
    crossProject: items.filter((item) => item.crossProject).length,
    unlinked: items.reduce((sum, item) => sum + item.unlinkedCount, 0),
    byPhone: items.filter((item) => item.basis.includes('PHONE')).length,
  };

  /**
   * Публикации догружаются одним запросом на все группы, а не запросом
   * на группу: групп немного, но запрос в цикле по ним — ровно тот код,
   * который на демонстрации начинает отвечать по секунде.
   */
  const ids = items.flatMap((item) => item.publicationIds);
  const publications =
    ids.length > 0
      ? await prisma.publication.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            platform: true,
            accountName: true,
            contactPhone: true,
            publishedAt: true,
            /**
             * У объявления нет заголовка — в модели только rawText. Для
             * строки таблицы берётся начало текста: оно почти всегда и есть
             * заголовок объявления, а выдумывать отдельное поле ради
             * красивой ссылки значило бы хранить два текста, которые
             * разойдутся.
             */
            rawText: true,
            projectId: true,
            project: { select: { slug: true, name: true, nameKk: true, riskZone: true } },
          },
        })
      : [];

  const byId = new Map(publications.map((item) => [item.id, item]));

  return (
    <>
      <PageHeader title={t('connectionsTitle')} lead={t('connectionsLead')} />

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Stat value={summary.clusters} label="Групп найдено" />
        <Stat value={summary.crossProject} label="Затрагивают несколько ЖК" />
        <Stat value={summary.byPhone} label="Собраны по телефону" />
        <Stat value={summary.unlinked} label="Размещений без привязки" />
      </div>

      <FilterForm locale={locale} action="/connections">
        <div className="field">
          <label htmlFor="crossProjectOnly">Показывать</label>
          <select id="crossProjectOnly" name="crossProjectOnly" defaultValue={params.crossProjectOnly ?? ''}>
            <option value="">Все группы</option>
            <option value="true">Только межобъектные</option>
          </select>
        </div>
      </FilterForm>

      {items.length === 0 ? (
        <div className="card">
          <Empty
            text={
              crossProjectOnly
                ? 'Межобъектных групп нет: ни один продавец не ведёт размещения по нескольким ЖК.'
                : 'Связанных размещений не найдено.'
            }
          />
        </div>
      ) : (
        items.map((cluster) => {
          const members = cluster.publicationIds
            .map((id) => byId.get(id))
            .filter((item): item is (typeof publications)[number] => item !== undefined);

          return (
            <div className="card" key={cluster.id}>
              <div className="row-between">
                <div>
                  <h2 style={{ margin: 0 }}>
                    {cluster.publicationIds.length} размещения
                    {cluster.projects.length > 0
                      ? `, объектов: ${cluster.projects.length}`
                      : ', без привязки к объектам'}
                  </h2>
                  <p className="faint" style={{ margin: '4px 0 0' }}>
                    Основание: {cluster.basis.map((item) => basisLabel(item)).join(', ') || '—'}
                    {' · '}
                    площадок: {cluster.platforms.length}
                  </p>
                </div>
                {cluster.crossProject ? (
                  <span className="tag tag-warn nowrap">несколько ЖК</span>
                ) : null}
              </div>

              <table className="kv" style={{ marginTop: 10 }}>
                <tbody>
                  <tr>
                    <th>Телефоны группы</th>
                    <td>
                      {cluster.phones.length > 0 ? (
                        <span className="mono">{cluster.phones.join(', ')}</span>
                      ) : (
                        <span className="faint">не указаны или не распознаны</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Аккаунты</th>
                    <td>
                      {cluster.accounts.length > 0 ? (
                        cluster.accounts.map((account, index) => (
                          <span key={`${account.platform}|${account.accountName}`}>
                            {index > 0 ? ', ' : ''}
                            {account.accountName}{' '}
                            <span className="faint">
                              ({platformLabel(account.platform, locale)})
                            </span>
                          </span>
                        ))
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Объекты реестра</th>
                    <td>
                      {cluster.projects.length > 0 ? (
                        cluster.projects.map((project, index) => (
                          <span key={project.id}>
                            {index > 0 ? ', ' : ''}
                            {project.name ?? project.id}
                          </span>
                        ))
                      ) : (
                        <span className="faint">нет ни одной привязки</span>
                      )}
                      {cluster.unlinkedCount > 0 ? (
                        <div className="faint">
                          не привязано размещений: {cluster.unlinkedCount}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                </tbody>
              </table>

              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Объявление</th>
                    <th>{t('platform')}</th>
                    <th>Аккаунт и телефон</th>
                    <th>{t('navProjects')}</th>
                    <th>{t('published')}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((item) => (
                    <tr key={item.id}>
                      <td style={{ maxWidth: 380 }}>
                        <Link href={`/publications/${item.id}`}>{excerpt(item.rawText)}</Link>
                      </td>
                      <td>{platformLabel(item.platform, locale)}</td>
                      <td>
                        {item.accountName ?? <span className="faint">—</span>}
                        {item.contactPhone ? (
                          <div className="faint mono">{item.contactPhone}</div>
                        ) : null}
                      </td>
                      <td>
                        {item.project ? (
                          <>
                            <Link href={`/projects/${item.project.slug}`}>
                              {locale === 'kk' && item.project.nameKk
                                ? item.project.nameKk
                                : item.project.name}
                            </Link>{' '}
                            <ZoneTag zone={item.project.riskZone} locale={locale} />
                          </>
                        ) : (
                          <span className="tag">не привязано</span>
                        )}
                      </td>
                      <td>
                        <When value={item.publishedAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/*
                Расхождение между размером группы и числом догруженных
                размещений означает, что публикацию удалили между
                построением групп и догрузкой. Молча показать меньше
                строк, чем обещано в заголовке, нельзя: это читается как
                ошибка расчёта.
              */}
              {members.length !== cluster.publicationIds.length ? (
                <p className="faint">
                  Часть размещений группы недоступна ({cluster.publicationIds.length - members.length}):
                  вероятно, они удалены после построения групп.
                </p>
              ) : null}
            </div>
          );
        })
      )}

      <Notice kind="info">
        <strong>Связь — это направление проверки, а не нарушение.</strong> Общий
        телефон или общий аккаунт означает только то, что размещения ведёт
        один продавец. Агентство вправе работать с несколькими застройщиками,
        и в этом разделе оно выглядит так же, как недобросовестный посредник.
        Баллы начисляются не здесь, а на карточке объекта — после подтверждения
        фактора с обоснованием и документами.
      </Notice>
    </>
  );
}

/**
 * Подпись основания.
 *
 * Телефон и аккаунт — признаки разной силы, и подписи это отражают:
 * номер принадлежит человеку, имя аккаунта может совпасть случайно.
 * Поэтому «совпадение имени» названо совпадением, а не связью.
 */
function basisLabel(basis: string): string {
  if (basis === 'PHONE') return 'общий телефон';
  if (basis === 'ACCOUNT') return 'совпадение имени аккаунта на площадке';
  return basis;
}

function platformLabel(platform: string, locale: 'ru' | 'kk'): string {
  const label = PLATFORM_LABELS[platform as Platform];
  return label ? label[locale] : platform;
}

/** Начало текста объявления вместо отсутствующего заголовка. */
function excerpt(raw: string): string {
  const firstLine = raw.split('\n').find((line) => line.trim().length > 0) ?? raw;
  const trimmed = firstLine.trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 90)}…` : trimmed;
}
