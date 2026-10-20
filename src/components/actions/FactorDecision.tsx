'use client';

/**
 * Решение аналитика по фактору риска.
 *
 * Это центральное действие всей системы: здесь и только здесь меняется балл
 * объекта. Поэтому форма устроена строже остальных.
 *
 * Обоснование — обязательное поле, а не примечание. Сервер отклонит решение
 * без него, и форма повторяет это требование до отправки: ограничение
 * осмысленное, и узнавать о нём из красной плашки после нажатия кнопки —
 * плохой способ.
 *
 * Доказательство прикрепляется тем же действием, а не отдельным шагом «сначала
 * загрузите файл, потом подтвердите». Причина в порядке проверки на сервере:
 * предусловия R2 и R3 требуют наличия доказательства определённого вида,
 * поэтому доказательство должно появиться в той же транзакции — раньше
 * проверки, а не после неё.
 *
 * Кнопка «Подтвердить» выключена, когда предусловие не выполнено, и рядом
 * стоит перечень недостающего. Это не замена серверной проверки — та
 * выполняется всегда, — а избавление от бессмысленного нажатия.
 *
 * «Не подтверждать» доступно всегда. Решение «проверено, не подтвердилось»
 * — тоже результат работы, и он должен фиксироваться с автором и датой,
 * иначе разница между «проверили и не нашли» и «ещё не смотрели» теряется.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  EVIDENCE_KINDS,
  EVIDENCE_KIND_LABELS,
  type EvidenceKind,
  type FactorCode,
  type Label,
} from '../../core/domain/enums';
import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export interface FactorDecisionProps {
  projectSlug: string;
  code: FactorCode;
  locale: Locale;
  /** Вердикт предусловия с сервера: можно ли подтверждать и чего не хватает. */
  allowed: boolean;
  applicable: boolean;
  missing: readonly Label[];
  /** Публикации объекта — источник для доказательства-цитаты. */
  publications: readonly { id: string; label: string }[];
}

const MIN_RATIONALE = 10;

export function FactorDecision({
  projectSlug,
  code,
  locale,
  allowed,
  applicable,
  missing,
  publications,
}: FactorDecisionProps) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [rationale, setRationale] = useState('');
  const [withEvidence, setWithEvidence] = useState(false);
  const [kind, setKind] = useState<EvidenceKind>('DOCUMENT');
  const [publicationId, setPublicationId] = useState(publications[0]?.id ?? '');
  const [excerpt, setExcerpt] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');

  const short = rationale.trim().length < MIN_RATIONALE;

  async function submit(status: 'CONFIRMED' | 'REJECTED' | 'NEEDS_CHECK') {
    await action.run(
      () =>
        api.post(`/api/projects/${projectSlug}/factors`, {
          code,
          status,
          rationale: rationale.trim(),
          ...(withEvidence && {
            evidence: [
              {
                kind,
                ...(excerpt.trim() && { excerpt: excerpt.trim() }),
                ...(kind === 'TEXT_FRAGMENT' && publicationId && { publicationId }),
                ...(sourceLabel.trim() && { sourceLabel: sourceLabel.trim() }),
                ...(sourceUrl.trim() && { sourceUrl: sourceUrl.trim() }),
              },
            ],
          }),
        }),
      () => {
        setRationale('');
        setExcerpt('');
        setWithEvidence(false);
        router.refresh();
      },
    );
  }

  return (
    <details className="no-print" style={{ marginTop: 8 }}>
      <summary>
        {t('scoringRationale')} и решение по {code}
      </summary>

      <div style={{ marginTop: 10 }}>
        {!applicable ? (
          <div className="notice notice-info">
            Фактор неприменим к этому объекту. Корректное решение —
            «неприменимо», а не «требует проверки».
          </div>
        ) : null}

        <div className="field">
          <label htmlFor={`rationale-${code}`}>{t('scoringRationale')}</label>
          <textarea
            id={`rationale-${code}`}
            rows={3}
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder={t('scoringRationaleHint')}
          />
          <small className="faint">
            {t('scoringRationaleHint')}
            {short ? ` Минимум ${MIN_RATIONALE} символов.` : null}
          </small>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={withEvidence}
            onChange={(event) => setWithEvidence(event.target.checked)}
          />
          Приложить доказательство
        </label>

        {withEvidence ? (
          <div className="grid grid-2" style={{ marginTop: 10 }}>
            <div className="field">
              <label htmlFor={`kind-${code}`}>Вид доказательства</label>
              <select
                id={`kind-${code}`}
                value={kind}
                onChange={(event) => setKind(event.target.value as EvidenceKind)}
              >
                {EVIDENCE_KINDS.map((item) => (
                  <option key={item} value={item}>
                    {EVIDENCE_KIND_LABELS[item][locale]}
                  </option>
                ))}
              </select>
            </div>

            {kind === 'TEXT_FRAGMENT' ? (
              <div className="field">
                <label htmlFor={`pub-${code}`}>Публикация-источник</label>
                <select
                  id={`pub-${code}`}
                  value={publicationId}
                  onChange={(event) => setPublicationId(event.target.value)}
                >
                  {publications.length === 0 ? <option value="">Публикаций нет</option> : null}
                  {publications.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="field">
                <label htmlFor={`src-${code}`}>Название источника</label>
                <input
                  id={`src-${code}`}
                  value={sourceLabel}
                  onChange={(event) => setSourceLabel(event.target.value)}
                  placeholder="Акт проверки, запись реестра, письмо"
                />
              </div>
            )}

            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor={`excerpt-${code}`}>
                {kind === 'TEXT_FRAGMENT' ? 'Цитата дословно' : 'Описание'}
              </label>
              <textarea
                id={`excerpt-${code}`}
                rows={2}
                value={excerpt}
                onChange={(event) => setExcerpt(event.target.value)}
              />
              {kind === 'TEXT_FRAGMENT' ? (
                <small className="faint">
                  Позиция цитаты в тексте вычисляется на сервере. Если фрагмент
                  не найден дословно, доказательство не будет создано — подсветка
                  обязана указывать на настоящее место в объявлении.
                </small>
              ) : null}
            </div>

            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor={`url-${code}`}>Ссылка на источник</label>
              <input
                id={`url-${code}`}
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://"
              />
            </div>
          </div>
        ) : null}

        {!allowed && missing.length > 0 ? (
          <div className="notice notice-warn">
            <strong>{t('scoringBlocked')}.</strong> {t('scoringMissing')}:
            <ul>
              {missing.map((item, index) => (
                <li key={index}>{item[locale]}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn-danger"
            disabled={action.busy || short || !allowed}
            onClick={() => submit('CONFIRMED')}
            title={allowed ? undefined : t('scoringBlocked')}
          >
            {t('scoringConfirm')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={action.busy || short}
            onClick={() => submit('REJECTED')}
          >
            {t('scoringReject')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={action.busy || short}
            onClick={() => submit('NEEDS_CHECK')}
          >
            {t('scoringNeedsCheck')}
          </button>
        </div>

        <Feedback failure={action.failure} done={action.done} />
      </div>
    </details>
  );
}
