/**
 * Модуль 5. Печатная сигнальная карточка — единственный документ системы.
 *
 * Всё содержание документа берётся из снимка (factorsJson), а не из
 * текущего состояния объекта. Это главное свойство карточки: распечатку
 * можно защитить через месяц, когда данные объекта уже изменились, потому
 * что в ней написано, что было известно на дату формирования. Если бы
 * страница перерисовывала карточку по актуальным данным, распечатка и
 * экран расходились бы, и документ перестал бы что-либо подтверждать.
 *
 * Текущее состояние объекта тоже показано — но отдельным блоком, помеченным
 * как справка, и только когда оно расходится со снимком. Аналитик должен
 * узнать о расхождении здесь, а не от руководителя на совещании.
 *
 * Снимок разворачивается из JSON, то есть приходит как unknown. Поэтому
 * страница не доверяет его форме: каждое поле проверяется, а при
 * непригодном снимке печатается честное «снимок нечитаем» вместо падения.
 * Карточка — документ; документ, который не открывается, хуже документа,
 * который сообщает о своей порче.
 */

import Link from 'next/link';

import {
  FACTOR_STATUS_LABELS,
  RISK_ZONE_LABELS,
  SIGNAL_STATUS_LABELS,
  type FactorStatus,
  type Label,
  type RiskZone,
  type SignalStatus,
} from '../../../core/domain/enums';
import { translator } from '../../../i18n/dict';
import { getLocale } from '../../../i18n/server';
import { prisma } from '../../../lib/db';
import { orNotFound } from '../../../server/page';
import { signalDetail } from '../../../server/queries';
import { PrintButton } from '../../../components/actions/PrintButton';
import { SignalReview } from '../../../components/actions/SignalReview';
import {
  FactorStatusTag,
  Notice,
  PageHeader,
  ScoreBadge,
  When,
  ZoneTag,
} from '../../../components/ui';

export const dynamic = 'force-dynamic';

export default async function SignalPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const t = translator(locale);
  const { id } = await params;

  const signal = await orNotFound(signalDetail(prisma, id));

  const snapshot = readSnapshot(signal.factorsJson);
  const project = signal.project;

  /**
   * Расхождение считается по снимку карточки, а не по снимку внутри JSON:
   * столбцы score/zone таблицы Signal — то, что было записано как решение,
   * и именно их сравнивают с текущим состоянием объекта.
   */
  const diverged = signal.score !== project.riskScore || signal.zone !== project.riskZone;

  const statusLabel = SIGNAL_STATUS_LABELS[signal.status as SignalStatus];
  const projectName = locale === 'kk' && project.nameKk ? project.nameKk : project.name;
  const projectAddress = locale === 'kk' && project.addressKk ? project.addressKk : project.address;

  return (
    <>
      <PageHeader
        title={t('signalsTitle')}
        right={
          <>
            <PrintButton label={t('signalsPrint')} />
            <Link className="btn" href="/signals">
              ко списку
            </Link>
          </>
        }
      />

      {/*
        Шапка документа. В печати это первое, что видит получатель, поэтому
        здесь нет ни ссылок, ни элементов управления — только кто, что и когда.
      */}
      <div className="card">
        <div className="row-between">
          <div>
            <h2 style={{ marginTop: 0 }}>{projectName}</h2>
            <p className="faint" style={{ margin: 0 }}>
              {projectAddress}, {project.city}
            </p>
            <p className="faint" style={{ margin: '4px 0 0' }}>
              Застройщик: {locale === 'kk' && project.developer.nameKk
                ? project.developer.nameKk
                : project.developer.name}
              , БИН {project.developer.bin}
            </p>
          </div>
          <div className="nowrap">
            <ScoreBadge score={signal.score} zone={signal.zone} locale={locale} />
          </div>
        </div>

        <table className="kv" style={{ marginTop: 12 }}>
          <tbody>
            <tr>
              <th>{t('signalsSnapshot')}</th>
              <td>
                <When value={snapshot?.capturedAt ?? signal.createdAt} />
              </td>
            </tr>
            <tr>
              <th>Зона на дату формирования</th>
              <td>
                <ZoneTag zone={signal.zone} locale={locale} />
              </td>
            </tr>
            <tr>
              <th>{t('signalsCreatedBy')}</th>
              <td>
                {signal.createdBy}, <When value={signal.createdAt} />
              </td>
            </tr>
            <tr>
              <th>Состояние карточки</th>
              <td>
                <span
                  className={
                    signal.status === 'CONFIRMED'
                      ? 'tag tag-ok'
                      : signal.status === 'RETURNED'
                        ? 'tag tag-warn'
                        : 'tag'
                  }
                >
                  {statusLabel ? statusLabel[locale] : signal.status}
                </span>
              </td>
            </tr>
            {signal.reviewedBy ? (
              <tr>
                <th>{t('signalsReviewedBy')}</th>
                <td>
                  {signal.reviewedBy}, <When value={signal.reviewedAt} />
                </td>
              </tr>
            ) : null}
            <tr>
              <th>Объект в реестре</th>
              <td>
                {/* В печати адрес ссылки допечатывается правилом a[href^='http'],
                    поэтому внутренняя ссылка остаётся читаемой и на бумаге. */}
                <Link href={`/projects/${project.slug}`}>{project.slug}</Link>
              </td>
            </tr>
          </tbody>
        </table>

        {signal.summary ? (
          <p style={{ marginBottom: 0 }}>
            <span className="faint">Существо сигнала: </span>
            {signal.summary}
          </p>
        ) : null}
      </div>

      {/* --- Расхождение со текущим состоянием ------------------------- */}

      {diverged ? (
        <Notice kind="warn">
          <strong>{t('signalsDiverged')}</strong> В карточке — {signal.score}{' '}
          балла, зона{' '}
          {RISK_ZONE_LABELS[signal.zone as RiskZone]?.[locale] ?? signal.zone}; у объекта
          сейчас — {project.riskScore}, зона{' '}
          {RISK_ZONE_LABELS[project.riskZone as RiskZone]?.[locale] ?? project.riskZone}.
          Карточка остаётся верной на свою дату: расхождение означает, что после
          формирования фактор подтвердили или сняли подтверждение. Для текущего
          состояния формируется новая карточка.
        </Notice>
      ) : null}

      {/* --- Расчёт ---------------------------------------------------- */}

      {snapshot ? (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{t('scoringFormula')}</h2>
            <p className="mono">{snapshot.formula || '—'}</p>
            <p style={{ marginBottom: 0 }}>
              <span className="faint">{t('scoringZoneReason')}: </span>
              {snapshot.zoneReason ? snapshot.zoneReason[locale] : '—'}
            </p>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>{t('scoringFactors')}</h2>
            <p className="faint" style={{ marginTop: 0 }}>
              Перечислены все шесть факторов, включая ненайденные. Документ,
              в котором видно только найденное, не позволяет отличить
              «проверили и не нашли» от «не проверяли».
            </p>

            <table>
              <thead>
                <tr>
                  <th>Фактор</th>
                  <th>Состояние</th>
                  <th className="num">{t('scoringWeight')}</th>
                  <th className="num">{t('scoringApplied')}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.contributions.map((item) => (
                  <tr key={item.code}>
                    <td>
                      <span className="tag tag-code">{item.code}</span>{' '}
                      <strong>{item.title ? item.title[locale] : item.code}</strong>
                      {item.criteria ? (
                        <div className="faint">{item.criteria[locale]}</div>
                      ) : null}
                      {item.rationale ? (
                        <div>
                          <span className="faint">{t('scoringRationale')}: </span>
                          {item.rationale}
                        </div>
                      ) : null}
                      {item.confirmedBy ? (
                        <div className="faint">
                          {t('actor')}: {item.confirmedBy}, <When value={item.confirmedAt} />
                          {item.origin ? <> · источник: {item.origin}</> : null}
                          {typeof item.evidenceCount === 'number' ? (
                            <> · доказательств: {item.evidenceCount}</>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {item.statusLabel ? (
                        <span
                          className={
                            item.status === 'CONFIRMED'
                              ? 'tag tag-danger'
                              : item.status === 'NEEDS_CHECK'
                                ? 'tag tag-warn'
                                : 'tag'
                          }
                        >
                          {item.statusLabel[locale]}
                        </span>
                      ) : (
                        <FactorStatusTag status={item.status} locale={locale} />
                      )}
                    </td>
                    <td className="num mono">{item.weight}</td>
                    <td className="num mono">
                      {item.applied > 0 ? <strong>+{item.applied}</strong> : '0'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>Итого</th>
                  <th className="num mono">{signal.score}</th>
                </tr>
              </tfoot>
            </table>
          </div>

          {/*
            Открытые вопросы печатаются в документе намеренно. Получатель
            должен видеть границу проверенного: сигнал с двумя открытыми
            вопросами и сигнал без них требуют разной реакции, хотя балл
            у них может совпадать.
          */}
          {snapshot.openQuestions.length > 0 ? (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('scoringOpenQuestions')}</h2>
              <p className="faint" style={{ marginTop: 0 }}>
                На дату формирования эти факторы не были рассмотрены. Балл
                отражает только проверенное и после их рассмотрения может
                вырасти, но не уменьшиться.
              </p>
              <ul style={{ marginBottom: 0 }}>
                {snapshot.openQuestions.map((item, index) => (
                  <li key={index}>{item[locale]}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <Notice kind="error">
          <strong>Снимок факторов нечитаем.</strong> Балл и зона в карточке
          сохранены ({signal.score}, {signal.zone}), но разбор по факторам
          восстановить не удалось. Такую карточку нельзя использовать как
          документ: сформируйте новую на карточке объекта.
        </Notice>
      )}

      {/* --- Рассмотрение --------------------------------------------- */}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Рассмотрение</h2>
        <SignalReview
          signalId={signal.id}
          locale={locale}
          status={signal.status}
          reviewedBy={signal.reviewedBy}
          reviewComment={signal.reviewComment}
        />
      </div>

      {/*
        Подпись печатной формы. Блок виден только в печати: на экране
        строки для подписи бессмысленны, а в распечатке без них документ
        не примут.
      */}
      <div className="print-only">
        <p>
          Сформировано информационной системой мониторинга рисков долевого
          строительства. Данные демонстрационные.
        </p>
        <p>Аналитик: {signal.createdBy} _______________</p>
        <p>
          Руководитель: {signal.reviewedBy ?? '_______________'} _______________
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Чтение снимка
// ---------------------------------------------------------------------------

interface SnapshotContribution {
  code: string;
  status: string;
  statusLabel: Label | null;
  title: Label | null;
  criteria: Label | null;
  weight: number;
  applied: number;
  origin: string | null;
  rationale: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  evidenceCount: number | null;
}

interface SnapshotView {
  formula: string;
  zoneReason: Label | null;
  contributions: SnapshotContribution[];
  openQuestions: Label[];
  capturedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function label(value: unknown): Label | null {
  if (!isRecord(value)) return null;
  return typeof value.ru === 'string' && typeof value.kk === 'string'
    ? { ru: value.ru, kk: value.kk }
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Разбор factorsJson.
 *
 * Снимок считается пригодным, только если в нём есть разбор по факторам:
 * без contributions документ не объясняет балл, а объяснение — его
 * единственное назначение. Поля внутри фактора восстанавливаются по
 * отдельности, потому что снимок могли записать более старой версией
 * формата, и потеря подписи к статусу не повод скрывать весь расчёт.
 */
function readSnapshot(raw: string): SnapshotView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.contributions)) return null;

  const contributions = parsed.contributions.filter(isRecord).map((item) => ({
    code: text(item.code) ?? '—',
    status: text(item.status) ?? 'ABSENT',
    statusLabel:
      label(item.statusLabel) ??
      FACTOR_STATUS_LABELS[text(item.status) as FactorStatus] ??
      null,
    title: label(item.title),
    criteria: label(item.criteria),
    weight: num(item.weight),
    applied: num(item.applied),
    origin: text(item.origin),
    rationale: text(item.rationale),
    confirmedAt: text(item.confirmedAt),
    confirmedBy: text(item.confirmedBy),
    evidenceCount: typeof item.evidenceCount === 'number' ? item.evidenceCount : null,
  }));

  if (contributions.length === 0) return null;

  const openQuestions = Array.isArray(parsed.openQuestions)
    ? parsed.openQuestions.map(label).filter((item): item is Label => item !== null)
    : [];

  return {
    formula: text(parsed.formula) ?? '',
    zoneReason: label(parsed.zoneReason),
    contributions,
    openQuestions,
    capturedAt: text(parsed.capturedAt),
  };
}
