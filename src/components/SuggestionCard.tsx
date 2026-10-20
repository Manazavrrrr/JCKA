/**
 * Гипотеза ИИ как отдельная карточка.
 *
 * Компонент один на два экрана — карточку объявления и очередь гипотез, —
 * и это не экономия кода, а требование к смыслу: одна и та же гипотеза,
 * показанная в двух местах по-разному, читалась бы как два разных
 * утверждения.
 *
 * Разбор payloadJson живёт здесь же. Содержимое поля зависит от вида
 * гипотезы, и схема описана в core/ai/schemas.ts, но хранится оно строкой.
 * Поэтому чтение устроено осторожно: испорченная или незнакомая запись
 * показывается как есть, в <pre>, вместо того чтобы обрушить страницу.
 * Гипотеза, которую нельзя прочитать, всё равно должна быть видна — иначе
 * она тихо исчезнет из очереди вместе со своим решением.
 *
 * Уверенность показана числом и, если она ниже порога, словами. Требование
 * ТЗ «неуверенные выводы маркируются» не выполняется процентом: «0.55»
 * ничего не говорит человеку, который не знает, где в этой системе граница.
 */

import Link from 'next/link';

import {
  type Label,
  LOW_CONFIDENCE_THRESHOLD,
  SUGGESTION_KIND_LABELS,
  SUGGESTION_STATUS_LABELS,
  type SuggestionKind,
  type SuggestionStatus,
} from '../core/domain/enums';
import { type Locale, translator } from '../i18n/dict';
import { SuggestionReview } from './actions/SuggestionReview';
import { When } from './ui';

/** То, что нужно показать о гипотезе. Поля повторяют модель AiSuggestion. */
export interface SuggestionView {
  id: string;
  kind: string;
  factorCode: string | null;
  payloadJson: string;
  confidence: number;
  evidenceExcerpt: string | null;
  provider: string;
  model: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | string | null;
  createdAt: Date | string;
  publicationId?: string | null;
}

export function SuggestionCard({
  suggestion,
  locale,
  /** Ссылка на объявление нужна в очереди и не нужна на самой карточке. */
  showPublicationLink = false,
}: {
  suggestion: SuggestionView;
  locale: Locale;
  showPublicationLink?: boolean;
}) {
  const t = translator(locale);
  const payload = readPayload(suggestion.payloadJson);
  const low = suggestion.confidence < LOW_CONFIDENCE_THRESHOLD;

  const kindLabel = SUGGESTION_KIND_LABELS[suggestion.kind as SuggestionKind];
  const statusLabel = SUGGESTION_STATUS_LABELS[suggestion.status as SuggestionStatus];

  return (
    <div className="card card-nested">
      <div className="row-between">
        <div>
          <strong>{kindLabel ? kindLabel[locale] : suggestion.kind}</strong>
          {suggestion.factorCode ? (
            <span className="tag tag-ai" style={{ marginLeft: 6 }}>
              {suggestion.factorCode}
            </span>
          ) : null}
        </div>
        <div>
          <span className={low ? 'tag tag-warn' : 'tag'}>
            {t('analyzeConfidence')}: {Math.round(suggestion.confidence * 100)}%
          </span>{' '}
          <span className="tag">{statusLabel ? statusLabel[locale] : suggestion.status}</span>
        </div>
      </div>

      {low ? <p className="faint">{t('analyzeLowConfidence')} — решение требует проверки текста.</p> : null}

      <Body payload={payload} locale={locale} />

      {suggestion.evidenceExcerpt ? (
        <blockquote className="quote">
          <span className="faint">{t('suggestionsQuote')}: </span>
          {suggestion.evidenceExcerpt}
        </blockquote>
      ) : (
        <p className="faint">{t('suggestionsNoQuote')}</p>
      )}

      <p className="faint">
        {t('analyzeProvider')}: <span className="mono">{suggestion.provider}</span>
        {suggestion.model ? <span className="mono"> / {suggestion.model}</span> : null} ·{' '}
        <When value={suggestion.createdAt} />
        {suggestion.reviewedBy ? (
          <>
            {' · '}
            {statusLabel ? statusLabel[locale] : suggestion.status}: {suggestion.reviewedBy},{' '}
            <When value={suggestion.reviewedAt} />
          </>
        ) : null}
        {showPublicationLink && suggestion.publicationId ? (
          <>
            {' · '}
            <Link href={`/publications/${suggestion.publicationId}`}>объявление</Link>
          </>
        ) : null}
      </p>

      <SuggestionReview
        suggestionId={suggestion.id}
        locale={locale}
        status={suggestion.status}
        reviewedBy={suggestion.reviewedBy}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Содержимое гипотезы в зависимости от вида.
 *
 * Для гипотезы о факторе показывается не только обоснование, но и способ
 * проверки: аналитик должен увидеть, что именно ему предстоит сделать,
 * прежде чем согласится. Для сопоставления — на чём именно совпало:
 * совпадение по телефону и совпадение по названию стоят разного.
 */
function Body({ payload, locale }: { payload: unknown; locale: Locale }) {
  const t = translator(locale);

  if (!isRecord(payload)) {
    return <p className="faint">Содержимое гипотезы прочитать не удалось.</p>;
  }

  // Гипотеза о факторе.
  if (isLabel(payload.rationale) && isLabel(payload.verification)) {
    return (
      <>
        <p>{payload.rationale[locale]}</p>
        <p className="faint">
          {t('analyzeVerification')}: {payload.verification[locale]}
        </p>
      </>
    );
  }

  // Сопоставление с объектом реестра.
  if (typeof payload.projectName === 'string' && isLabel(payload.rationale)) {
    const matchedOn = Array.isArray(payload.matchedOn)
      ? payload.matchedOn.filter((item): item is string => typeof item === 'string')
      : [];
    return (
      <>
        <p>
          <strong>{payload.projectName}</strong>
          {matchedOn.length > 0 ? (
            <span className="faint"> — совпало: {matchedOn.map(matchedLabel).join(', ')}</span>
          ) : null}
        </p>
        <p className="faint">{payload.rationale[locale]}</p>
      </>
    );
  }

  // Условия расчётов — одной записью на объявление.
  if (Array.isArray(payload.terms)) {
    const terms = payload.terms.filter(isRecord);
    if (terms.length === 0) return null;
    return (
      <table>
        <thead>
          <tr>
            <th>{t('analyzePaymentTerms')}</th>
            <th>{t('analyzeRiskBearing')}</th>
            <th>Пояснение</th>
          </tr>
        </thead>
        <tbody>
          {terms.map((term, index) => (
            <tr key={index}>
              <td>{isLabel(term.label) ? term.label[locale] : String(term.category ?? '—')}</td>
              <td>
                {term.riskBearing === true ? (
                  <span className="tag tag-danger">{t('analyzeRiskBearing')}</span>
                ) : (
                  <span className="tag tag-ok">{t('analyzeLawful')}</span>
                )}
              </td>
              <td className="faint">{isLabel(term.note) ? term.note[locale] : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  /**
   * Незнакомый вид гипотезы. Показывается как есть: лучше нечитаемый JSON,
   * чем пустая карточка, по которой нельзя понять, что вообще предложено.
   */
  return <pre className="raw">{JSON.stringify(payload, null, 2)}</pre>;
}

/** Основания сопоставления: по-русски, иначе NAME и PHONE ничего не значат. */
function matchedLabel(value: string): string {
  switch (value) {
    case 'NAME':
      return 'название';
    case 'ADDRESS':
      return 'адрес';
    case 'PHONE':
      return 'телефон';
    case 'DEVELOPER':
      return 'застройщик';
    default:
      return value;
  }
}

function readPayload(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLabel(value: unknown): value is Label {
  return isRecord(value) && typeof value.ru === 'string' && typeof value.kk === 'string';
}
