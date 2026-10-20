/**
 * Модуль 1. Обзор региона — первый экран аналитика.
 *
 * Экран отвечает на один вопрос: с чего начать работу сегодня. Поэтому
 * в нём три блока и ничего больше.
 *
 * Сверху — распределение объектов по зонам: сколько требует приоритетной
 * проверки, сколько углублённой, сколько планового наблюдения. Рядом —
 * очередь работы: неразобранные объявления, гипотезы ИИ без решения,
 * сигнальные карточки без рассмотрения. Это числа, за каждым из которых
 * стоит чьё-то ожидание.
 *
 * Ниже — схема объектов и список тех, что требуют внимания. «Требуют
 * внимания» означает не высокий балл, а незакрытую неопределённость:
 * непроверенное основание привлечения средств либо фактор в статусе
 * «нужна проверка». Объект с нулевым баллом и неизвестным основанием
 * опаснее объекта с сорока баллами и полностью разобранными фактами:
 * про второй мы знаем, а про первый — нет.
 */

import Link from 'next/link';

import { RISK_ZONES, RISK_ZONE_ACTIONS, RISK_ZONE_LABELS } from '../core/domain/enums';
import { translator } from '../i18n/dict';
import { getLocale } from '../i18n/server';
import { prisma } from '../lib/db';
import { listProjects, zoneSummary } from '../server/queries';
import { RiskMap } from '../components/RiskMap';
import { DateOnly, Empty, PageHeader, ScoreBadge, Stat, ZoneTag } from '../components/ui';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const locale = await getLocale();
  const t = translator(locale);

  const [summary, all, attention] = await Promise.all([
    zoneSummary(prisma),
    listProjects(prisma, { limit: 200, offset: 0 }),
    listProjects(prisma, { needsAttention: true, limit: 10, offset: 0 }),
  ]);

  return (
    <>
      <PageHeader title={t('overviewTitle')} lead={t('overviewLead')} />

      <h2>{t('overviewZones')}</h2>
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        {RISK_ZONES.map((zone) => (
          <div className="card" key={zone} style={{ marginBottom: 0 }}>
            <div className="row-between">
              <ZoneTag zone={zone} locale={locale} />
              <strong style={{ fontSize: 26, color: `var(--zone-${zone.toLowerCase()})` }}>
                {summary.zones[zone] ?? 0}
              </strong>
            </div>
            <p className="faint" style={{ margin: '8px 0 0' }}>
              {RISK_ZONE_ACTIONS[zone][locale]}
            </p>
            <Link className="faint" href={`/projects?zone=${zone}`}>
              {t('open')} →
            </Link>
          </div>
        ))}
      </div>

      <h2>{t('overviewQueue')}</h2>
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Stat
          value={summary.unlinkedPublications}
          label={t('overviewUnlinked')}
          href="/publications?unlinked=true"
        />
        <Stat
          value={summary.pendingSuggestions}
          label={t('overviewPending')}
          href="/suggestions"
        />
        <Stat value={summary.draftSignals} label={t('overviewDrafts')} href="/signals" />
        <Stat value={attention.total} label={t('overviewAttention')} href="/projects?needsAttention=true" />
      </div>

      <div className="split">
        <section className="card">
          <h2>{t('overviewMap')}</h2>
          <p className="faint">{t('overviewMapHint')}</p>
          <RiskMap points={all.items} locale={locale} />
          <div className="legend" style={{ marginTop: 10 }}>
            {RISK_ZONES.map((zone) => (
              <span className="legend-item" key={zone}>
                <span
                  className="legend-swatch"
                  style={{
                    background: `var(--zone-${zone.toLowerCase()})`,
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                  }}
                />
                {RISK_ZONE_LABELS[zone][locale]}
              </span>
            ))}
            <span className="legend-item">
              {t('overviewNoCoords')}:{' '}
              {all.items.filter((item) => item.lat === null || item.lng === null).length}
            </span>
          </div>
        </section>

        <section className="card">
          <h2>{t('overviewAttention')}</h2>
          {attention.items.length === 0 ? (
            <Empty text={t('empty')} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('navProjects')}</th>
                  <th className="num">{t('score')}</th>
                  <th>{t('projectsDeadline')}</th>
                </tr>
              </thead>
              <tbody>
                {attention.items.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={`/projects/${project.slug}`}>
                        {locale === 'kk' ? project.nameKk ?? project.name : project.name}
                      </Link>
                      <div className="faint">
                        {project.needsCheckCount > 0
                          ? `${t('projectsNeedsCheck')}: ${project.needsCheckCount}`
                          : null}
                        {project.legalBasisStatus === 'NOT_CHECKED' ? (
                          <span className="tag tag-warn" style={{ marginLeft: 6 }}>
                            {t('scoringLegalBasis')}: ?
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="num">
                      <ScoreBadge
                        score={project.riskScore}
                        zone={project.riskZone}
                        locale={locale}
                      />
                    </td>
                    <td>
                      <DateOnly value={project.plannedCompletionAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
