/**
 * Короткая сводка проверок в реестрах — для карточки объекта.
 *
 * На экране «Реестры» проверки показаны целиком, с ответом портала и
 * адресом запроса. Здесь нужно другое: аналитик смотрит карточку ЖК и
 * должен за секунду понять, спрашивали ли про этот объект государство и
 * чем это кончилось. Поэтому строка на проверку, а не карточка.
 *
 * Два правила этого блока.
 *
 * Первое. Блок показывается даже когда проверок нет, и тогда говорит об
 * этом прямо. Пустое место читалось бы как «проверено, всё чисто», а это
 * ровно противоположное положение дел.
 *
 * Второе. Расхождение в сверке и снятие основания для R1 — разные вещи, и
 * показаны они по-разному. Расхождение значит «карточка и реестр говорят
 * не одно и то же, посмотрите»; снятие R1 значит «реестр показал
 * основание, фактор держать больше не на чем». Ни то, ни другое блок сам
 * не применяет: баллы меняет человек в разделе факторов выше.
 *
 * Компонент серверный, без состояния и без обращения к базе: данные
 * приходят готовыми из listRegistryChecks.
 */

import Link from 'next/link';

import {
  R1_BEARING_LABELS,
  type R1Bearing,
  REGISTRY_ANSWER_LABELS,
  type RegistryAnswer,
} from '../core/registry';
import type { Label } from '../core/domain/enums';
import { type Locale, translator } from '../i18n/dict';
import { Empty, When } from './ui';

export interface RegistryBriefCheck {
  id: string;
  sourceId: string;
  sourceName: Label | null;
  answer: string;
  disagreements: number;
  bearingOnR1: string;
  manual: boolean;
  error: string | null;
  checkedAt: Date | string;
}

export function RegistryBrief({
  locale,
  checks,
}: {
  locale: Locale;
  checks: RegistryBriefCheck[];
}) {
  const t = translator(locale);

  return (
    <div className="card">
      <div className="row-between">
        <h2 style={{ marginTop: 0 }}>{t('registryTitle')}</h2>
        <Link className="faint no-print" href="/registry">
          {t('open')}
        </Link>
      </div>

      {checks.length === 0 ? (
        <Empty text="Проверок в реестрах по этому объекту не было. Отсутствие проверки — это не «нарушений нет»." />
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('registrySource')}</th>
              <th>{t('registryAnswer')}</th>
              <th className="num">{t('registryDisagreements')}</th>
              <th>{t('registryWhatNext')}</th>
              <th>{t('registryCheckedAt')}</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => {
              const answer = check.answer as RegistryAnswer;
              const bearing = check.bearingOnR1 as R1Bearing;

              return (
                <tr key={check.id}>
                  <td>
                    {check.sourceName?.[locale] ?? check.sourceId}
                    <div className="faint">
                      {check.manual ? t('registryManualMark') : t('registryAutoMark')}
                    </div>
                  </td>
                  <td>
                    <span
                      className={
                        answer === 'FOUND'
                          ? 'tag tag-ok'
                          : answer === 'UNAVAILABLE'
                            ? 'tag tag-warn'
                            : 'tag'
                      }
                    >
                      {REGISTRY_ANSWER_LABELS[answer][locale]}
                    </span>
                    {check.error ? <div className="faint">{check.error}</div> : null}
                  </td>
                  <td className="num">
                    {check.disagreements > 0 ? (
                      <strong>{check.disagreements}</strong>
                    ) : (
                      <span className="faint">0</span>
                    )}
                  </td>
                  <td>
                    {bearing === 'WITHDRAWS_R1' ? (
                      <span className="tag tag-warn">{R1_BEARING_LABELS[bearing][locale]}</span>
                    ) : (
                      <span className="faint">{R1_BEARING_LABELS[bearing][locale]}</span>
                    )}
                  </td>
                  <td>
                    <When value={check.checkedAt} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="faint" style={{ marginTop: 8, marginBottom: 0 }}>
        {t('registryNoScore')}
      </p>
    </div>
  );
}
