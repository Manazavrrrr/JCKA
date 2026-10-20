/**
 * Экран государственных реестров.
 *
 * Порядок частей на странице повторяет порядок рассуждения, а не удобство
 * вёрстки.
 *
 * Сначала — ограничение, и это главное решение этого экрана. Разрешений
 * МИО на привлечение денег дольщиков в открытых данных Казахстана нет ни
 * в одном наборе; значит, ни один машинный ответ не может подтвердить
 * фактор R1, а может только снять его. Если бы эта мысль стояла внизу
 * страницы, аналитик прочитал бы её после того, как уже посмотрел на
 * список реестров и решил, что система проверяет законность стройки
 * автоматически. Он её не проверяет и проверять не может.
 *
 * Затем каталог — весь, включая четыре источника без машинного доступа и
 * один проверенный и отклонённый. Разложен он по назначению, а не по
 * доступности: аналитику важнее, отвечает ли реестр на вопрос о правовом
 * основании или о застройщике как о юридическом лице, чем то, каким
 * способом из него достают сведения. И выходит наглядно: в группе
 * «правовое основание» — четыре источника и ни одного с API.
 *
 * Потом форма проверки, потом история. История показывает и неудачные
 * проверки тоже: без записи о том, что служба не ответила, «записи нет»
 * и «ответа нет» выглядели бы на экране одинаково, а это противоположные
 * вещи.
 *
 * Вердикты сверки в истории не читаются из базы — их пересчитывает ядро
 * при каждом показе (см. listRegistryChecks). Страница только отображает.
 */

import Link from 'next/link';

import {
  FIELD_VERDICT_LABELS,
  type FieldVerdict,
  R1_BEARING_HINTS,
  R1_BEARING_LABELS,
  type R1Bearing,
  REGISTRY_ACCESS_MODE_HINTS,
  REGISTRY_ACCESS_MODE_LABELS,
  REGISTRY_ANSWER_LABELS,
  REGISTRY_BEARINGS,
  REGISTRY_BEARING_HINTS,
  REGISTRY_BEARING_LABELS,
  type RegistryAnswer,
  egovDatasetPageUrl,
  fieldsFor,
  rejectedRegistrySources,
  sourcesByBearing,
} from '../../core/registry';
import { translator } from '../../i18n/dict';
import { getLocale } from '../../i18n/server';
import { prisma } from '../../lib/db';
import { listDevelopersForRegistry, listRegistryChecks } from '../../server/registry';
import { RegistryCheckForm } from '../../components/actions/RegistryCheckForm';
import { Empty, Notice, PageHeader, When } from '../../components/ui';

export const dynamic = 'force-dynamic';

/** Цвет ответа реестра. «Записи нет» — не успех и не провал, а факт. */
const ANSWER_CLASS: Record<RegistryAnswer, string> = {
  FOUND: 'tag tag-ok',
  NOT_FOUND: 'tag',
  UNAVAILABLE: 'tag tag-warn',
};

/**
 * Цвет вердикта по полю. В красное красится только прямое несовпадение:
 * «только в карточке» и «только в реестре» чаще означают неполноту набора,
 * и если красить их так же, аналитик перестанет замечать красное.
 */
const VERDICT_CLASS: Record<FieldVerdict, string> = {
  MATCH: 'tag tag-ok',
  MISMATCH: 'tag tag-danger',
  ONLY_IN_CARD: 'tag tag-warn',
  ONLY_IN_REGISTRY: 'tag tag-warn',
  ABSENT_BOTH: 'tag',
};

export default async function RegistryPage() {
  const locale = await getLocale();
  const t = translator(locale);

  const [developers, history] = await Promise.all([
    listDevelopersForRegistry(prisma),
    listRegistryChecks(prisma, { limit: 50, offset: 0 }),
  ]);

  const rejected = rejectedRegistrySources();

  /**
   * В форму идут все источники, кроме отклонённого. Отклонённый отвечает
   * бодро и пусто, и дать по нему нажать кнопку значило бы разрешить
   * сохранить пустой ответ как проверку.
   */
  const selectable = REGISTRY_BEARINGS.flatMap((bearing) =>
    sourcesByBearing(bearing).filter((source) => source.accessMode !== 'ARCHIVED'),
  ).map((source) => ({
    id: source.id,
    name: source.name[locale],
    accessMode: source.accessMode,
    reference: source.reference,
  }));

  return (
    <>
      <PageHeader title={t('registryTitle')} lead={t('registryLead')} />

      {/* --- Ограничение слоя ----------------------------------------- */}

      <Notice kind="warn">
        <strong>{t('registryLimitTitle')}.</strong> {t('registryLimitText')}
      </Notice>

      <Notice kind="info">{t('registryNoScore')}</Notice>

      {/* --- Каталог реестров ------------------------------------------ */}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('registrySources')}</h2>
        <p className="lead">{t('registrySourcesLead')}</p>

        {REGISTRY_BEARINGS.map((bearing) => {
          const group = sourcesByBearing(bearing).filter(
            (source) => source.accessMode !== 'ARCHIVED',
          );
          if (group.length === 0) return null;

          return (
            <section key={bearing} style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 2 }}>{REGISTRY_BEARING_LABELS[bearing][locale]}</h3>
              <p className="faint" style={{ marginTop: 0 }}>
                {REGISTRY_BEARING_HINTS[bearing][locale]}
              </p>

              {group.map((source) => {
                const machine = source.accessMode === 'OPEN_API';
                const compares = fieldsFor(source.id)?.compare ?? [];

                return (
                  <div key={source.id} className="card card-nested" style={{ marginTop: 10 }}>
                    <div className="row-between">
                      <strong>{source.name[locale]}</strong>
                      <span className={machine ? 'tag tag-ok' : 'tag tag-warn'}>
                        {REGISTRY_ACCESS_MODE_LABELS[source.accessMode][locale]}
                      </span>
                    </div>

                    <p className="faint" style={{ margin: '4px 0 0' }}>
                      {REGISTRY_ACCESS_MODE_HINTS[source.accessMode][locale]}
                    </p>

                    <table className="kv" style={{ marginTop: 6 }}>
                      <tbody>
                        <tr>
                          <th>{t('registryAuthority')}</th>
                          <td>{source.authority[locale]}</td>
                        </tr>
                        <tr>
                          <th>{t('registryProvides')}</th>
                          <td>{source.provides[locale]}</td>
                        </tr>

                        {source.limitation ? (
                          <tr>
                            <th>{t('collectLimitation')}</th>
                            <td>{source.limitation[locale]}</td>
                          </tr>
                        ) : null}

                        {compares.length > 0 ? (
                          <tr>
                            <th>{t('registryCompares')}</th>
                            <td>{compares.map((field) => field.label[locale]).join(', ')}</td>
                          </tr>
                        ) : null}

                        {source.refreshed ? (
                          <tr>
                            <th>{t('registryRefreshed')}</th>
                            <td>{source.refreshed[locale]}</td>
                          </tr>
                        ) : null}

                        {source.dataset ? (
                          <tr>
                            <th>{t('registryDataset')}</th>
                            <td>
                              <a
                                className="mono"
                                href={egovDatasetPageUrl(source.dataset)}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {source.dataset}
                              </a>{' '}
                              <span className="faint">{source.datasetVersion}</span>
                            </td>
                          </tr>
                        ) : (
                          <tr>
                            <th>{t('collectReference')}</th>
                            <td>
                              <a
                                className="mono"
                                href={source.reference}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {source.reference}
                              </a>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </section>
          );
        })}

        {/*
         * Отклонённые источники стоят отдельным блоком внизу. Они не
         * выбираются в форме и не участвуют в работе — но и удалять их
         * нельзя: без этой записи следующий разработчик найдёт набор с
         * подходящим названием и подключит его заново.
         */}
        {rejected.length > 0 ? (
          <section style={{ marginTop: 20 }}>
            <h3 style={{ marginBottom: 2 }}>{t('registryRejected')}</h3>
            <p className="faint" style={{ marginTop: 0 }}>
              {t('registryRejectedLead')}
            </p>

            {rejected.map((source) => (
              <div key={source.id} className="card card-nested" style={{ marginTop: 10 }}>
                <div className="row-between">
                  <strong>{source.name[locale]}</strong>
                  <span className="tag tag-danger">
                    {REGISTRY_ACCESS_MODE_LABELS[source.accessMode][locale]}
                  </span>
                </div>
                <p style={{ margin: '6px 0 0' }}>{source.limitation?.[locale]}</p>
                <p className="faint" style={{ margin: '6px 0 0' }}>
                  <a
                    className="mono"
                    href={source.reference}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {source.reference}
                  </a>
                </p>
              </div>
            ))}
          </section>
        ) : null}
      </div>

      {/* --- Проверка -------------------------------------------------- */}

      {developers.length > 0 && selectable.length > 0 ? (
        <RegistryCheckForm locale={locale} sources={selectable} developers={developers} />
      ) : null}

      {/* --- История проверок ------------------------------------------ */}

      <div className="card">
        <div className="row-between">
          <h2 style={{ marginTop: 0 }}>{t('registryChecks')}</h2>
          <span className="faint">
            {t('total')}: {history.total}
          </span>
        </div>

        {history.checks.length === 0 ? (
          <Empty text={t('registryChecksEmpty')} />
        ) : (
          history.checks.map((check) => {
            const answer = check.answer as RegistryAnswer;
            const bearing = check.bearingOnR1 as R1Bearing;

            return (
              <article key={check.id} className="card card-nested" style={{ marginTop: 12 }}>
                <div className="row-between">
                  <div>
                    <strong>{check.sourceName?.[locale] ?? check.sourceId}</strong>
                    <div className="faint">
                      {check.developer?.name ?? '—'}
                      {check.project ? (
                        <>
                          {' · '}
                          <Link href={`/projects/${check.project.slug}`}>{check.project.name}</Link>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className={ANSWER_CLASS[answer]}>
                      {REGISTRY_ANSWER_LABELS[answer][locale]}
                    </span>
                    <span className="tag">
                      {check.manual ? t('registryManualMark') : t('registryAutoMark')}
                    </span>
                  </div>
                </div>

                <table className="kv" style={{ marginTop: 6 }}>
                  <tbody>
                    <tr>
                      <th>{t('registryCheckedAt')}</th>
                      <td>
                        <When value={check.checkedAt} />{' '}
                        <span className="faint">· {check.checkedBy}</span>
                      </td>
                    </tr>

                    {check.bin ? (
                      <tr>
                        <th>БИН</th>
                        <td className="mono">
                          {check.bin}
                          {check.binLooksValid === false ? (
                            <span className="tag tag-warn" style={{ marginLeft: 6 }}>
                              {t('registryBinWarning')}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}

                    {check.requestUrl ? (
                      <tr>
                        <th>{t('registryRequestUrl')}</th>
                        <td>
                          <a
                            className="mono faint"
                            href={check.requestUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {check.requestUrl}
                          </a>
                        </td>
                      </tr>
                    ) : null}

                    {check.note ? (
                      <tr>
                        <th>{t('registryNote')}</th>
                        <td>{check.note}</td>
                      </tr>
                    ) : null}

                    {check.attachment ? (
                      <tr>
                        <th>{t('registryAttachment')}</th>
                        <td>{check.attachment}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>

                {/*
                 * Ошибка показана текстом целиком, а не значком. «Служба
                 * не ответила» и «в наборе нет поля с БИН» требуют разных
                 * действий: первое — повторить позже, второе — починить
                 * описание набора.
                 */}
                {check.error ? (
                  <Notice kind="error">{check.error}</Notice>
                ) : null}

                {check.fields.length > 0 ? (
                  <>
                    <p className="faint" style={{ margin: '10px 0 4px' }}>
                      {t('registryComparison')} · {t('registryDisagreements')}:{' '}
                      <strong>{check.disagreements}</strong>
                    </p>
                    <table>
                      <thead>
                        <tr>
                          <th>{t('registryCompares')}</th>
                          <th>{t('registryDeclared')}</th>
                          <th>{t('registryInRegistry')}</th>
                          <th>{t('registryVerdict')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {check.fields.map((field) => (
                          <tr key={field.key}>
                            <td>{field.label[locale]}</td>
                            <td className="mono">{field.declared ?? '—'}</td>
                            <td className="mono">{field.registry ?? '—'}</td>
                            <td>
                              <span className={VERDICT_CLASS[field.verdict]}>
                                {FIELD_VERDICT_LABELS[field.verdict][locale]}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : null}

                {/*
                 * Следствие для карточки пишется всегда, в том числе когда
                 * следствия нет. Пустое место здесь читалось бы как «балл
                 * уже пересчитан», а балл эта проверка не трогает вовсе.
                 */}
                <Notice kind={bearing === 'WITHDRAWS_R1' ? 'warn' : 'info'}>
                  <strong>{t('registryWhatNext')}:</strong>{' '}
                  {R1_BEARING_LABELS[bearing][locale]}. {R1_BEARING_HINTS[bearing][locale]}
                </Notice>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}
