/**
 * Модуль 5. Список сигнальных карточек.
 *
 * Карточка — единственное, что выходит из системы наружу: её печатают
 * и прикладывают к служебной записке. Поэтому список устроен как реестр
 * исходящих документов, а не как лента работы.
 *
 * Два столбца с баллом стоят рядом намеренно: снимок на дату формирования
 * и текущее состояние объекта. Расхождение между ними — не ошибка, а
 * нормальная жизнь объекта: после формирования карточки фактор могли
 * подтвердить или снять. Но человек, у которого на руках распечатка,
 * должен видеть, что в системе цифра уже другая, — иначе он будет
 * защищать документ, ссылаясь на несуществующие данные.
 *
 * Карточку здесь нельзя ни сформировать, ни рассмотреть. Формирование
 * живёт на карточке объекта, потому что требует проверки предусловий по
 * конкретному объекту; рассмотрение — на карточке сигнала, потому что
 * решение принимается после прочтения всего документа, а не из списка.
 */

import Link from 'next/link';

import { SIGNAL_STATUSES, SIGNAL_STATUS_LABELS, type SignalStatus } from '../../core/domain/enums';
import { translator } from '../../i18n/dict';
import { getLocale } from '../../i18n/server';
import { prisma } from '../../lib/db';
import { listSignals } from '../../server/queries';
import { FilterForm, SelectFilter, optionsFrom } from '../../components/Filters';
import { Empty, PageHeader, ScoreBadge, Stat, When, ZoneTag } from '../../components/ui';

export const dynamic = 'force-dynamic';

type Params = { status?: string };

export default async function SignalsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const locale = await getLocale();
  const t = translator(locale);
  const params = await searchParams;

  const [page, draftCount, confirmedCount, returnedCount] = await Promise.all([
    listSignals(prisma, {
      status: params.status ? ([params.status] as never) : undefined,
      limit: 100,
      offset: 0,
    }),
    prisma.signal.count({ where: { status: 'DRAFT' } }),
    prisma.signal.count({ where: { status: 'CONFIRMED' } }),
    prisma.signal.count({ where: { status: 'RETURNED' } }),
  ]);

  return (
    <>
      <PageHeader title={t('signalsTitle')} lead={t('signalsLead')} />

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <Stat
          value={draftCount}
          label={SIGNAL_STATUS_LABELS.DRAFT[locale]}
          href="/signals?status=DRAFT"
        />
        <Stat
          value={confirmedCount}
          label={SIGNAL_STATUS_LABELS.CONFIRMED[locale]}
          href="/signals?status=CONFIRMED"
        />
        <Stat
          value={returnedCount}
          label={SIGNAL_STATUS_LABELS.RETURNED[locale]}
          href="/signals?status=RETURNED"
        />
      </div>

      <FilterForm locale={locale} action="/signals">
        <SelectFilter
          name="status"
          label="Состояние карточки"
          options={optionsFrom(SIGNAL_STATUSES, SIGNAL_STATUS_LABELS)}
          value={params.status}
          locale={locale}
          anyLabel={t('all')}
        />
      </FilterForm>

      <div className="card">
        <p className="faint" style={{ marginTop: 0 }}>
          {t('total')}: {page.total}
        </p>

        {page.items.length === 0 ? (
          <Empty text="Сигнальных карточек нет. Карточка формируется на карточке объекта." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('navProjects')}</th>
                <th className="num">{t('signalsSnapshot')}</th>
                <th className="num">{t('signalsCurrent')}</th>
                <th>Состояние</th>
                <th>{t('dateTime')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => {
                const diverged =
                  item.score !== item.project.riskScore || item.zone !== item.project.riskZone;
                const statusLabel = SIGNAL_STATUS_LABELS[item.status as SignalStatus];

                return (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/signals/${item.id}`}>
                        <strong>
                          {locale === 'kk' && item.project.nameKk
                            ? item.project.nameKk
                            : item.project.name}
                        </strong>
                      </Link>
                      <div className="faint">
                        <Link href={`/projects/${item.project.slug}`}>карточка объекта</Link>
                      </div>
                    </td>
                    <td className="num">
                      <ScoreBadge score={item.score} zone={item.zone} locale={locale} />
                    </td>
                    <td className="num">
                      <ScoreBadge
                        score={item.project.riskScore}
                        zone={item.project.riskZone}
                        locale={locale}
                      />
                      {diverged ? (
                        <div className="faint">данные изменились после формирования</div>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={
                          item.status === 'CONFIRMED'
                            ? 'tag tag-ok'
                            : item.status === 'RETURNED'
                              ? 'tag tag-warn'
                              : 'tag'
                        }
                      >
                        {statusLabel ? statusLabel[locale] : item.status}
                      </span>
                      <div className="faint">
                        {t('signalsCreatedBy')}: {item.createdBy}
                      </div>
                      {item.reviewedBy ? (
                        <div className="faint">
                          {t('signalsReviewedBy')}: {item.reviewedBy}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <When value={item.createdAt} />
                      {item.reviewedAt ? (
                        <div className="faint">
                          рассмотрено <When value={item.reviewedAt} />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <ZoneTag zone="RED" locale={locale} />{' '}
        <span className="faint">
          Зона в карточке — снимок на дату формирования. Текущая зона объекта показана рядом
          и может отличаться: карточка остаётся верной на свою дату, и именно поэтому её можно
          приложить к документу.
        </span>
      </div>
    </>
  );
}
