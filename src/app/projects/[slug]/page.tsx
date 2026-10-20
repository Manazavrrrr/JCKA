/**
 * Модуль 4. Панель скоринга объекта.
 *
 * Главный экран системы и то место, где проверяется её честность. Раздел 6
 * технического задания требует, чтобы по каждому объекту было видно, «из чего
 * именно сложился балл и почему присвоена зона». Здесь это требование
 * выполняется буквально, и устройство экрана подчинено одной мысли: число
 * без разбора ничего не значит.
 *
 * Поэтому балл показан не сам по себе, а четырьмя слоями сразу:
 *
 *   формула       R1(+35) + R2(+25) = 60 — арифметика на виду;
 *   причина зоны  почему именно эта зона при этом балле;
 *   граница зоны  что конкретно её изменит;
 *   шесть строк   все факторы, включая нулевые.
 *
 * Последнее важнее, чем выглядит. Панель показывает все шесть факторов
 * всегда, даже те, что не начислены: иначе непроверенный фактор визуально
 * не отличается от проверенного и отклонённого. «R4 не начислен» и «R4 никто
 * не смотрел» — разные состояния объекта, и первое спокойно, а второе нет.
 *
 * Ни одно значение на этой странице не вычисляется в разметке. Балл, зона,
 * формула, вклад каждого фактора и вердикты предусловий приходят готовыми
 * из core/scoring. Если бы зона определялась здесь по баллу, в системе
 * появился бы второй экземпляр правила из раздела 5 ТЗ — и он неизбежно
 * разошёлся бы с первым.
 */

import Link from 'next/link';

import {
  EVIDENCE_KIND_LABELS,
  LEGAL_BASIS_STATUS_LABELS,
  LEGAL_BASIS_TYPE_LABELS,
  LINK_STATUS_LABELS,
  PLATFORM_LABELS,
  PROJECT_STAGE_LABELS,
  SIGNAL_STATUS_LABELS,
  type EvidenceKind,
  type FactorCode,
  type LegalBasisStatus,
  type LegalBasisType,
  type Platform,
} from '../../../core/domain/enums';
import {
  getProjectAudit,
  getProjectScoring,
  getScoreHistory,
} from '../../../core/scoring/service';
import { DELAY_THRESHOLD_DAYS, READINESS_GAP_THRESHOLD_PP, readinessGapPp } from '../../../core/scoring/model';
import { translator } from '../../../i18n/dict';
import { getLocale } from '../../../i18n/server';
import { prisma } from '../../../lib/db';
import { orNotFound } from '../../../server/page';
import { projectDetail, resolveProjectId } from '../../../server/queries';
import { listRegistryChecks } from '../../../server/registry';
import { RegistryBrief } from '../../../components/RegistryBrief';
import { CreateSignal } from '../../../components/actions/CreateSignal';
import { FactorDecision } from '../../../components/actions/FactorDecision';
import { LegalBasisForm } from '../../../components/actions/LegalBasisForm';
import { RecalculateButton } from '../../../components/actions/RecalculateButton';
import { ScoreHistory } from '../../../components/ScoreHistory';
import {
  DateOnly,
  Empty,
  FactorStatusTag,
  PageHeader,
  ScoreBadge,
  When,
  ZoneTag,
} from '../../../components/ui';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const locale = await getLocale();
  const t = translator(locale);
  const { slug } = await params;

  // Неизвестный slug — это 404, а не упавшая страница: судья или аналитик
  // может прийти по устаревшей ссылке, и ему нужно понять, что объекта нет.
  const projectId = await orNotFound(resolveProjectId(prisma, slug));

  // Пять независимых чтений — одним ожиданием, а не последовательно:
  // панель открывается целиком или не открывается вовсе.
  const [detail, scoring, history, audit, registry] = await Promise.all([
    projectDetail(prisma, projectId),
    getProjectScoring(prisma, projectId),
    getScoreHistory(prisma, projectId),
    getProjectAudit(prisma, projectId, 60),
    listRegistryChecks(prisma, { projectId, limit: 10, offset: 0 }),
  ]);

  const { explanation, eligibility, summary, stale } = scoring;
  const name = locale === 'kk' ? detail.nameKk ?? detail.name : detail.name;
  const address = locale === 'kk' ? detail.addressKk ?? detail.address : detail.address;

  const publicationOptions = detail.publications.map((item) => ({
    id: item.id,
    label:
      `${PLATFORM_LABELS[item.platform as Platform]?.[locale] ?? item.platform}` +
      (item.accountName ? ` — ${item.accountName}` : ''),
  }));

  const evidenceByCode = new Map(
    detail.factors.map((factor) => [factor.code, factor.evidence] as const),
  );

  const gap = readinessGapPp(detail.declaredReadinessPct, detail.verifiedReadinessPct);

  const verifiedAppeals = detail.appeals.filter((appeal) => appeal.status === 'VERIFIED').length;

  return (
    <>
      <PageHeader
        title={name}
        lead={address}
        right={
          <>
            <RecalculateButton projectSlug={detail.slug} locale={locale} emphasize={stale} />
            <Link className="btn" href={`/publications?projectId=${detail.id}`}>
              {t('navPublications')} ({detail.publications.length})
            </Link>
            <Link className="btn" href={`/connections?projectId=${detail.id}`}>
              {t('navConnections')}
            </Link>
          </>
        }
      />

      {stale ? (
        <div className="notice notice-warn">
          <strong>{t('scoringStale')}</strong> В объекте сохранено{' '}
          {detail.riskScore} / {detail.riskZone}, расчёт по факторам даёт{' '}
          {explanation.score} / {explanation.zone}.
        </div>
      ) : null}

      {/* --- Балл, формула, зона ------------------------------------- */}

      <div className="card">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{t('scoringTitle')}</h2>
            <p className="lead" style={{ marginBottom: 0 }}>
              {locale === 'kk' ? summary.kk : summary.ru}
            </p>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <ScoreBadge score={explanation.score} zone={explanation.zone} locale={locale} />
            <ZoneTag zone={explanation.zone} locale={locale} />
          </div>
        </div>

        <div className="grid grid-2" style={{ marginTop: 14 }}>
          <div>
            <h3>{t('scoringFormula')}</h3>
            <p className="mono">{explanation.formula}</p>
            {explanation.capped ? (
              <p className="faint">
                Сумма весов {explanation.rawSum} урезана ограничением в 100 баллов.
              </p>
            ) : null}
            <p className="faint">
              {explanation.zoneAction[locale]}
            </p>
          </div>
          <div>
            <h3>{t('scoringZoneReason')}</h3>
            <p>{explanation.zoneReason[locale]}</p>
            {explanation.zoneBoundary ? (
              <>
                <h3>{t('scoringBoundary')}</h3>
                <p className="faint">{explanation.zoneBoundary[locale]}</p>
              </>
            ) : null}
          </div>
        </div>

        {explanation.integrityWarnings.length > 0 ? (
          <div className="notice notice-error">
            <strong>{t('scoringIntegrity')}.</strong> Пока они не устранены,
            сигнальную карточку сформировать нельзя: документ не должен ссылаться
            на решение без автора или без обоснования.
            <ul>
              {explanation.integrityWarnings.map((item, index) => (
                <li key={index}>{item[locale]}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {explanation.openQuestions.length > 0 ? (
          <div className="notice notice-info">
            <strong>{t('scoringOpenQuestions')}.</strong> Балл отражает только
            проверенное. Пока эти факторы не рассмотрены, он может как вырасти,
            так и остаться прежним — но не уменьшиться.
            <ul>
              {explanation.openQuestions.map((item, index) => (
                <li key={index}>{item[locale]}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* --- Шесть факторов ------------------------------------------ */}

      <div className="card">
        <h2>{t('scoringFactors')}</h2>
        {explanation.contributions.map((item) => {
          const verdict = eligibility[item.code as FactorCode];
          const evidence = evidenceByCode.get(item.code) ?? [];
          return (
            <div className="factor-row" key={item.code}>
              <div className="factor-head">
                <div>
                  <span className="tag tag-code">{item.code}</span>{' '}
                  <strong>{item.title[locale]}</strong>{' '}
                  <FactorStatusTag status={item.status} locale={locale} />
                </div>
                <div className="nowrap">
                  <span className="faint">
                    {t('scoringWeight')} {item.weight}
                  </span>{' '}
                  <strong style={{ color: item.applied ? 'var(--zone-red)' : 'var(--text-faint)' }}>
                    {t('scoringApplied')} {item.applied}
                  </strong>
                </div>
              </div>

              {/*
                Полоса показывает вес фактора относительно максимума в 100
                баллов, а заливка — начислено или нет. Так видно и «сколько
                этот фактор может стоить», и «стоит ли сейчас».
              */}
              <div className={item.applied ? 'factor-bar' : 'factor-bar inactive'}>
                <div style={{ width: `${item.weight}%` }} />
              </div>

              <p className="faint" style={{ margin: '0 0 6px' }}>
                {item.criteria[locale]}
              </p>

              {item.rationale ? (
                <p style={{ margin: '0 0 4px' }}>
                  <span className="faint">{t('scoringRationale')}: </span>
                  {item.rationale}
                </p>
              ) : null}

              <p className="faint" style={{ margin: 0 }}>
                {item.confirmedBy ? (
                  <>
                    {t('actor')}: {item.confirmedBy}, <When value={item.confirmedAt} />
                  </>
                ) : (
                  <>Решение не зафиксировано</>
                )}
                {item.origin ? <> · источник: {item.origin}</> : null}
                {' · '}
                {t('scoringEvidence')}: {item.evidenceCount}
              </p>

              {evidence.length > 0 ? (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {evidence.map((piece) => (
                    <li key={piece.id} className="faint">
                      {EVIDENCE_KIND_LABELS[piece.kind as EvidenceKind]?.[locale] ?? piece.kind}
                      {piece.excerpt ? <> — «{piece.excerpt}»</> : null}
                      {piece.publicationId ? (
                        <>
                          {' '}
                          <Link href={`/publications/${piece.publicationId}`}>
                            открыть объявление
                          </Link>
                        </>
                      ) : null}
                      {piece.sourceLabel ? <> · {piece.sourceLabel}</> : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {verdict ? (
                <>
                  {!verdict.allowed ? (
                    <p className="faint" style={{ marginTop: 6 }}>
                      {verdict.reason[locale]}
                    </p>
                  ) : null}
                  <FactorDecision
                    projectSlug={detail.slug}
                    code={item.code as FactorCode}
                    locale={locale}
                    allowed={verdict.allowed}
                    applicable={verdict.applicable}
                    missing={verdict.missing}
                    publications={publicationOptions}
                  />
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* --- Правовое основание -------------------------------------- */}

      <div className="card">
        <h2>{t('scoringLegalBasis')}</h2>
        <table>
          <tbody>
            <tr>
              <th>Результат проверки</th>
              <td>
                {LEGAL_BASIS_STATUS_LABELS[detail.legalBasisStatus as LegalBasisStatus]?.[locale] ??
                  detail.legalBasisStatus}
              </td>
            </tr>
            <tr>
              <th>Способ организации</th>
              <td>
                {LEGAL_BASIS_TYPE_LABELS[detail.legalBasisType as LegalBasisType]?.[locale] ??
                  detail.legalBasisType}
              </td>
            </tr>
            <tr>
              <th>{t('scoringLegalBasisSource')}</th>
              <td>{detail.legalBasisSource ?? <span className="faint">—</span>}</td>
            </tr>
            <tr>
              <th>Кто и когда проверил</th>
              <td>
                {detail.legalBasisCheckedBy ? (
                  <>
                    {detail.legalBasisCheckedBy}, <When value={detail.legalBasisCheckedAt} />
                  </>
                ) : (
                  <span className="faint">Проверка не выполнялась</span>
                )}
              </td>
            </tr>
            {detail.legalBasisNote ? (
              <tr>
                <th>{t('comment')}</th>
                <td>{detail.legalBasisNote}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <LegalBasisForm
          projectSlug={detail.slug}
          locale={locale}
          status={detail.legalBasisStatus}
          type={detail.legalBasisType}
          source={detail.legalBasisSource}
          note={detail.legalBasisNote}
        />
      </div>

      {/*
       * Проверки в реестрах стоят сразу после правового основания, а не
       * в конце страницы. Это ответ государства на тот же вопрос, который
       * задан в карточке выше: то, что внесено со слов объявления, и то,
       * что числится в реестре, должны читаться рядом — иначе расхождение
       * между ними никто не заметит.
       */}
      <RegistryBrief locale={locale} checks={registry.checks} />

      <div className="split">
        {/* --- Данные объекта ---------------------------------------- */}

        <section className="card">
          <h2>Данные объекта</h2>
          <table>
            <tbody>
              <tr>
                <th>{t('developer')}</th>
                <td>
                  {locale === 'kk'
                    ? detail.developer.nameKk ?? detail.developer.name
                    : detail.developer.name}
                  <div className="faint mono">БИН {detail.developer.bin}</div>
                </td>
              </tr>
              <tr>
                <th>{t('stage')}</th>
                <td>{PROJECT_STAGE_LABELS[detail.stage as never]?.[locale] ?? detail.stage}</td>
              </tr>
              <tr>
                <th>{t('projectsDeadline')}</th>
                <td>
                  <DateOnly value={detail.plannedCompletionAt} />
                  {detail.actualDelayDays && detail.actualDelayDays > 0 ? (
                    <div
                      className={
                        detail.actualDelayDays >= DELAY_THRESHOLD_DAYS ? 'tag tag-danger' : 'tag tag-warn'
                      }
                    >
                      просрочка {detail.actualDelayDays} дн.
                      {detail.actualDelayDays >= DELAY_THRESHOLD_DAYS
                        ? ` — порог R3 (${DELAY_THRESHOLD_DAYS} дн.) превышен`
                        : ` — ниже порога R3 (${DELAY_THRESHOLD_DAYS} дн.)`}
                    </div>
                  ) : null}
                </td>
              </tr>
              <tr>
                <th>Готовность заявленная</th>
                <td>
                  {detail.declaredReadinessPct === null ? (
                    <span className="faint">нет сведений</span>
                  ) : (
                    <>
                      {detail.declaredReadinessPct}%
                      <div className="faint">
                        {detail.declaredReadinessSource ?? 'источник не указан'},{' '}
                        <DateOnly value={detail.declaredReadinessAt} />
                      </div>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <th>Готовность подтверждённая</th>
                <td>
                  {detail.verifiedReadinessPct === null ? (
                    <span className="faint">нет сведений</span>
                  ) : (
                    <>
                      {detail.verifiedReadinessPct}%
                      <div className="faint">
                        {detail.verifiedReadinessSource ?? 'источник не указан'},{' '}
                        <DateOnly value={detail.verifiedReadinessAt} />
                      </div>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <th>Расхождение готовности</th>
                <td>
                  {gap === null ? (
                    <span className="faint">
                      не вычисляется: нужны оба значения с источниками
                    </span>
                  ) : (
                    <>
                      {gap} п.п.{' '}
                      <span className="faint">
                        {gap >= READINESS_GAP_THRESHOLD_PP
                          ? `порог R5 (${READINESS_GAP_THRESHOLD_PP} п.п.) превышен`
                          : `ниже порога R5 (${READINESS_GAP_THRESHOLD_PP} п.п.)`}
                      </span>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <th>Координаты</th>
                <td className="mono faint">
                  {detail.lat !== null && detail.lng !== null
                    ? `${detail.lat.toFixed(5)}, ${detail.lng.toFixed(5)}`
                    : 'нет'}
                </td>
              </tr>
              <tr>
                <th>Балл обновлён</th>
                <td>
                  <When value={detail.scoredAt} />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* --- Обращения дольщиков ----------------------------------- */}

        <section className="card">
          <h2>{t('scoringAppeals')}</h2>
          <p className="faint">
            Фактор R4 допускает только подтверждённые обращения: их сейчас{' '}
            {verifiedAppeals} из {detail.appeals.length}. Неподтверждённое
            обращение — повод проверить, а не основание для балла.
          </p>
          {detail.appeals.length === 0 ? (
            <Empty text={t('empty')} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th className="num">Подписей</th>
                  <th>Статус</th>
                  <th>Суть</th>
                </tr>
              </thead>
              <tbody>
                {detail.appeals.map((appeal) => (
                  <tr key={appeal.id}>
                    <td>
                      <DateOnly value={appeal.registeredAt} />
                      {appeal.reference ? (
                        <div className="faint mono">{appeal.reference}</div>
                      ) : null}
                    </td>
                    <td className="num">{appeal.signatories}</td>
                    <td>
                      <span
                        className={
                          appeal.status === 'VERIFIED' ? 'tag tag-danger' : 'tag tag-warn'
                        }
                      >
                        {appeal.status === 'VERIFIED' ? 'Подтверждено' : 'Не подтверждено'}
                      </span>
                    </td>
                    <td className="faint">{appeal.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* --- Объявления объекта -------------------------------------- */}

      <div className="card">
        <h2>{t('navPublications')}</h2>
        {detail.publications.length === 0 ? (
          <Empty text={t('empty')} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('platform')}</th>
                <th>{t('account')}</th>
                <th>{t('phone')}</th>
                <th>{t('published')}</th>
                <th>Привязка</th>
              </tr>
            </thead>
            <tbody>
              {detail.publications.map((publication) => (
                <tr key={publication.id}>
                  <td>
                    <Link href={`/publications/${publication.id}`}>
                      {PLATFORM_LABELS[publication.platform as Platform]?.[locale] ??
                        publication.platform}
                    </Link>
                  </td>
                  <td>{publication.accountName ?? <span className="faint">—</span>}</td>
                  <td className="mono">
                    {publication.contactPhone ?? <span className="faint">—</span>}
                  </td>
                  <td>
                    <DateOnly value={publication.publishedAt} />
                  </td>
                  <td>
                    {LINK_STATUS_LABELS[publication.linkStatus as never]?.[locale] ??
                      publication.linkStatus}
                    {publication.linkConfidence !== null ? (
                      <div className="faint">
                        {Math.round(publication.linkConfidence * 100)}%
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* --- Динамика риска ------------------------------------------ */}

      <div className="card">
        <h2>{t('scoringHistory')}</h2>
        <ScoreHistory points={history} locale={locale} />
      </div>

      {/* --- Сигнальные карточки ------------------------------------- */}

      <div className="card">
        <h2>{t('navSignals')}</h2>
        {detail.signals.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th className="num">{t('score')}</th>
                <th>Статус</th>
                <th>{t('signalsCreatedBy')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.signals.map((signal) => (
                <tr key={signal.id}>
                  <td>
                    <Link href={`/signals/${signal.id}`}>
                      <When value={signal.createdAt} />
                    </Link>
                  </td>
                  <td className="num">
                    <ScoreBadge score={signal.score} zone={signal.zone} locale={locale} />
                  </td>
                  <td>
                    {SIGNAL_STATUS_LABELS[signal.status as never]?.[locale] ?? signal.status}
                  </td>
                  <td className="faint">{signal.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <CreateSignal
          projectSlug={detail.slug}
          locale={locale}
          ready={
            explanation.confirmedCodes.length > 0 && explanation.integrityWarnings.length === 0
          }
          hasConfirmed={explanation.confirmedCodes.length > 0}
          integrityWarnings={explanation.integrityWarnings}
        />
      </div>

      {/* --- Журнал решений ------------------------------------------ */}

      <div className="card">
        <h2>{t('scoringAudit')}</h2>
        <p className="faint">
          Каждое изменение балла и статуса фактора фиксируется с автором и
          временем. Это требование раздела «контроль решений»: решение,
          о котором нельзя спросить «кто и на каком основании», в системе
          государственного контроля недопустимо.
        </p>
        {audit.length === 0 ? (
          <Empty text={t('empty')} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('dateTime')}</th>
                <th>Действие</th>
                <th>Фактор</th>
                <th>{t('actor')}</th>
                <th>{t('comment')}</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <When value={entry.at} />
                  </td>
                  <td className="mono">{entry.action}</td>
                  <td>
                    {entry.subject ? (
                      <span className="tag tag-code">{entry.subject}</span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td className="faint">{entry.actor}</td>
                  <td className="faint">{entry.comment ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
