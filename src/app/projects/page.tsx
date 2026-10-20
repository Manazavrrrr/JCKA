/**
 * Модуль 2. Реестр жилых комплексов.
 *
 * Список объектов с баллом и набором подтверждённых факторов. Сортировка
 * по убыванию балла задана в запросе, а не выбирается пользователем:
 * у списка одна задача — показать, куда смотреть в первую очередь.
 *
 * Коды подтверждённых факторов показаны прямо в строке, а не спрятаны
 * в карточку. Это то, чем 60 баллов из R1+R2 отличаются от 60 баллов из
 * R3+R4+R5+R6: первое — красная зона, второе — жёлтая, и разница видна
 * в списке без открывания объекта.
 */

import Link from 'next/link';

import {
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  RISK_ZONES,
  RISK_ZONE_LABELS,
} from '../../core/domain/enums';
import { translator } from '../../i18n/dict';
import { getLocale } from '../../i18n/server';
import { prisma } from '../../lib/db';
import { listProjects } from '../../server/queries';
import {
  CheckboxFilter,
  FilterForm,
  SelectFilter,
  TextFilter,
  optionsFrom,
} from '../../components/Filters';
import { DateOnly, Empty, PageHeader, ScoreBadge, ZoneTag } from '../../components/ui';

export const dynamic = 'force-dynamic';

type Params = { zone?: string; stage?: string; q?: string; needsAttention?: string };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const locale = await getLocale();
  const t = translator(locale);
  const params = await searchParams;

  const page = await listProjects(prisma, {
    zone: params.zone ? ([params.zone] as never) : undefined,
    stage: params.stage ? [params.stage] : undefined,
    q: params.q || undefined,
    needsAttention: params.needsAttention === 'true',
    limit: 100,
    offset: 0,
  });

  return (
    <>
      <PageHeader title={t('projectsTitle')} lead={t('projectsLead')} />

      <FilterForm locale={locale} action="/projects">
        <TextFilter
          name="q"
          label={t('search')}
          placeholder={t('projectsSearchHint')}
          value={params.q}
        />
        <SelectFilter
          name="zone"
          label={t('projectsFilterZone')}
          options={optionsFrom(RISK_ZONES, RISK_ZONE_LABELS)}
          value={params.zone}
          locale={locale}
          anyLabel={t('all')}
        />
        <SelectFilter
          name="stage"
          label={t('projectsFilterStage')}
          options={optionsFrom(PROJECT_STAGES, PROJECT_STAGE_LABELS)}
          value={params.stage}
          locale={locale}
          anyLabel={t('all')}
        />
        <CheckboxFilter
          name="needsAttention"
          label={t('projectsFilterAttention')}
          checked={params.needsAttention === 'true'}
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
                <th className="num">{t('score')}</th>
                <th>{t('navProjects')}</th>
                <th>{t('developer')}</th>
                <th>{t('stage')}</th>
                <th>{t('projectsConfirmed')}</th>
                <th>{t('projectsDeadline')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((project) => (
                <tr key={project.id}>
                  <td className="num">
                    <ScoreBadge
                      score={project.riskScore}
                      zone={project.riskZone}
                      locale={locale}
                    />
                  </td>
                  <td>
                    <Link href={`/projects/${project.slug}`}>
                      <strong>
                        {locale === 'kk' ? project.nameKk ?? project.name : project.name}
                      </strong>
                    </Link>
                    <div className="faint">
                      {locale === 'kk' ? project.addressKk ?? project.address : project.address}
                    </div>
                    <div style={{ marginTop: 3 }}>
                      <ZoneTag zone={project.riskZone} locale={locale} />
                      {project.needsCheckCount > 0 ? (
                        <span className="tag tag-warn" style={{ marginLeft: 5 }}>
                          {t('projectsNeedsCheck')}: {project.needsCheckCount}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {locale === 'kk'
                      ? project.developer.nameKk ?? project.developer.name
                      : project.developer.name}
                    <div className="faint mono">{project.developer.bin}</div>
                  </td>
                  <td>{PROJECT_STAGE_LABELS[project.stage as never]?.[locale] ?? project.stage}</td>
                  <td>
                    {project.confirmedCodes.length === 0 ? (
                      <span className="faint">—</span>
                    ) : (
                      <span className="row" style={{ gap: 4 }}>
                        {project.confirmedCodes.map((code) => (
                          <span className="tag tag-code tag-danger" key={code}>
                            {code}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    <DateOnly value={project.plannedCompletionAt} />
                    {(project.actualDelayDays ?? 0) > 0 ? (
                      <div className="faint">+{project.actualDelayDays} дн.</div>
                    ) : null}
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
