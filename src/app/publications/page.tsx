/**
 * Модуль 3. Мониторинг объявлений.
 *
 * Лента размещений о продаже жилья на стадии строительства. Основная работа
 * с объявлением идёт на его карточке; у списка одна задача — выбрать, с чем
 * работать дальше.
 *
 * Поэтому по умолчанию список открывается в порядке «сначала новые», но
 * главный фильтр — «только непривязанные». Непривязанное объявление не влияет
 * ни на один балл: оно не относится ни к какому объекту реестра, и пока
 * аналитик не установит связь, найденный в нём риск висит в воздухе. Счётчик
 * таких объявлений стоит в навигации красным, и это единственное число
 * в системе, которое должно стремиться к нулю.
 *
 * Текст в списке обрезан. Это не экономия места, а решение: читать объявление
 * нужно целиком и с подсветкой, а подсветка на обрезанном тексте вводит
 * в заблуждение — выделенного фрагмента может не оказаться в показанной части.
 */

import Link from 'next/link';

import {
  LINK_STATUSES,
  LINK_STATUS_LABELS,
  PLATFORMS,
  PLATFORM_LABELS,
  type Platform,
} from '../../core/domain/enums';
import { translator } from '../../i18n/dict';
import { getLocale } from '../../i18n/server';
import { prisma } from '../../lib/db';
import { listPublications } from '../../server/queries';
import {
  CheckboxFilter,
  FilterForm,
  SelectFilter,
  TextFilter,
  optionsFrom,
} from '../../components/Filters';
import { DateOnly, Empty, PageHeader, ZoneTag } from '../../components/ui';

export const dynamic = 'force-dynamic';

type Params = {
  platform?: string;
  linkStatus?: string;
  projectId?: string;
  unlinked?: string;
  q?: string;
};

export default async function PublicationsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const locale = await getLocale();
  const t = translator(locale);
  const params = await searchParams;

  const page = await listPublications(prisma, {
    platform: params.platform ? ([params.platform] as never) : undefined,
    linkStatus: params.linkStatus ? ([params.linkStatus] as never) : undefined,
    projectId: params.projectId || undefined,
    unlinked: params.unlinked === 'true',
    q: params.q || undefined,
    limit: 100,
    offset: 0,
  });

  return (
    <>
      <PageHeader title={t('publicationsTitle')} lead={t('publicationsLead')} />

      <FilterForm locale={locale} action="/publications">
        <TextFilter
          name="q"
          label={t('search')}
          placeholder="Текст, аккаунт, телефон"
          value={params.q}
        />
        <SelectFilter
          name="platform"
          label={t('platform')}
          options={optionsFrom(PLATFORMS, PLATFORM_LABELS)}
          value={params.platform}
          locale={locale}
          anyLabel={t('all')}
        />
        <SelectFilter
          name="linkStatus"
          label="Состояние привязки"
          options={optionsFrom(LINK_STATUSES, LINK_STATUS_LABELS)}
          value={params.linkStatus}
          locale={locale}
          anyLabel={t('all')}
        />
        <CheckboxFilter
          name="unlinked"
          label={t('publicationsUnlinkedOnly')}
          checked={params.unlinked === 'true'}
        />
      </FilterForm>

      <div className="card">
        <p className="faint" style={{ marginTop: 0 }}>
          {t('total')}: {page.total}
        </p>

        {page.items.length === 0 ? (
          <Empty text={t('empty')} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('platform')}</th>
                <th>Объявление</th>
                <th>{t('navProjects')}</th>
                <th>{t('published')}</th>
                <th className="num">Разбор</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link href={`/publications/${item.id}`}>
                      <strong>
                        {PLATFORM_LABELS[item.platform as Platform]?.[locale] ?? item.platform}
                      </strong>
                    </Link>
                    <div className="faint">{item.accountName ?? 'без аккаунта'}</div>
                    <div className="faint mono">{item.contactPhone ?? '—'}</div>
                  </td>
                  <td style={{ maxWidth: 440 }}>
                    <div className="faint">{item.excerpt}</div>
                    <div className="faint" style={{ marginTop: 3 }}>
                      {item.textLength} символов
                    </div>
                  </td>
                  <td>
                    {item.project ? (
                      <>
                        <Link href={`/projects/${item.project.slug}`}>{item.project.name}</Link>
                        <div style={{ marginTop: 3 }}>
                          <ZoneTag zone={item.project.riskZone} locale={locale} />
                        </div>
                      </>
                    ) : (
                      <span className="tag tag-warn">не привязано</span>
                    )}
                    <div className="faint" style={{ marginTop: 3 }}>
                      {LINK_STATUS_LABELS[item.linkStatus as never]?.[locale] ?? item.linkStatus}
                      {item.linkConfidence !== null
                        ? ` · ${Math.round(item.linkConfidence * 100)}%`
                        : null}
                    </div>
                  </td>
                  <td>
                    <DateOnly value={item.publishedAt} />
                    <div className="faint">
                      собрано <DateOnly value={item.capturedAt} />
                    </div>
                  </td>
                  <td className="num">
                    <span className="tag tag-ai">{item._count.aiSuggestions}</span>{' '}
                    <span className="tag tag-evidence">{item._count.evidence}</span>
                    <div className="faint">гипотез / доказательств</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
