'use client';

/**
 * Разбор произвольного текста объявления.
 *
 * Самая важная форма в приложении с точки зрения проверки. Техническое
 * задание требует, чтобы модуль ИИ работал на новом тексте, а не только на
 * подготовленных примерах, и единственный способ это показать — дать
 * проверяющему поле ввода и свои собственные слова.
 *
 * Поэтому форма устроена так, чтобы её нельзя было обойти заготовкой:
 *
 *   - текст любой, включая площадки, которых нет в демо-данных;
 *   - сопоставление с реестром можно отключить и увидеть, что разбор нашёл
 *     в тексте сам, без подсказок от восьми известных объектов;
 *   - ничего не записывается: разбор безопасно повторять, и реестр
 *     не засоряется проверочными текстами.
 *
 * Отдельно в разметке закреплено то, что легко потерять в демонстрации:
 * у ответа нет ни балла, ни зоны. Разбор возвращает гипотезы и список того,
 * что обязан проверить человек. Балл меняется только подтверждением фактора
 * аналитиком — и об этом написано прямо над результатом, а не в сноске.
 *
 * Готовые примеры подставляются в поле, а не разбираются отдельной кнопкой:
 * проверяющий видит тот же путь, что и со своим текстом, и может изменить
 * пример перед разбором.
 */

import { useState } from 'react';

import { type Label } from '../../core/domain/enums';
import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { AdText, HighlightLegend } from '../AdText';
import { type HighlightSpan } from '../../core/text/highlight';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

// --- Форма ответа /api/analyze ---------------------------------------------

interface Span {
  fragment: string;
  charStart: number;
  charEnd: number;
}

interface Hypothesis {
  code: string;
  confidence: number;
  lowConfidence: boolean;
  span: Span | null;
  rationale: Label;
  verification: Label;
  confirmable: false;
}

interface PaymentTerm extends Span {
  category: string;
  riskBearing: boolean;
  label: Label;
  note: Label;
  amount: number | null;
}

interface ProjectMatch {
  projectId: string;
  projectName: string;
  score: number;
  matchedOn: string[];
  rationale: Label;
  requiresConfirmation: true;
}

interface AnalyzeResponse {
  provider: string;
  model: string | null;
  durationMs: number;
  isHousingAd: boolean;
  mentionsUnderConstruction: boolean;
  extracted: {
    projectNames: (Span & { normalized: string })[];
    addresses: Span[];
    phones: (Span & { normalized: string })[];
    paymentTerms: PaymentTerm[];
    readinessMentions: (Span & { value: number })[];
    completionYears: (Span & { year: number })[];
    legalBasisClaims: Span[];
    delayMentions: Span[];
  };
  factorHypotheses: Hypothesis[];
  projectMatches: ProjectMatch[];
  checks: Label[];
  warnings: Label[];
  summary: Label;
  disclaimer: Label;
}

export interface AnalyzeExample {
  title: string;
  text: string;
  hint: string;
}

export function AnalyzeForm({
  locale,
  examples,
}: {
  locale: Locale;
  examples: readonly AnalyzeExample[];
}) {
  const t = translator(locale);
  const action = useAction();

  const [text, setText] = useState('');
  const [useRegistry, setUseRegistry] = useState(true);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  /** Текст, по которому построен показанный результат: офсеты относятся к нему. */
  const [analyzed, setAnalyzed] = useState('');

  async function submit() {
    const sent = text;
    const response = await action.run<AnalyzeResponse>(
      () => api.post('/api/analyze', { text: sent, locale, useRegistry }),
      (data) => {
        setResult(data);
        setAnalyzed(sent);
      },
    );
    if (!response) setResult(null);
  }

  return (
    <>
      <div className="card no-print">
        <div className="field">
          <label htmlFor="analyze-text">{t('analyzeInput')}</label>
          <textarea
            id="analyze-text"
            rows={8}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Вставьте текст объявления о продаже жилья — любой, в том числе свой собственный."
          />
          <small className="faint">
            Символов: {text.length}. Текст не сохраняется: разбор произвольного
            текста ничего не пишет в реестр.
          </small>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={useRegistry}
            onChange={(event) => setUseRegistry(event.target.checked)}
          />
          Сопоставлять с реестром ЖК
        </label>
        <small className="faint" style={{ display: 'block', marginBottom: 10 }}>
          Снимите галочку, чтобы увидеть, что разбор находит в самом тексте,
          без подсказок от известных объектов.
        </small>

        <div className="row">
          <button
            type="button"
            className="btn-primary"
            disabled={action.busy || text.trim().length === 0}
            onClick={submit}
          >
            {action.busy ? t('loading') : t('analyzeRun')}
          </button>
          {result ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setResult(null);
                setText('');
                action.reset();
              }}
            >
              {t('analyzeAgain')}
            </button>
          ) : null}
        </div>

        <Feedback failure={action.failure} done={action.done} />

        <details style={{ marginTop: 12 }}>
          <summary>Готовые примеры ({examples.length})</summary>
          <p className="faint" style={{ marginTop: 8 }}>
            Пример подставляется в поле ввода — его можно изменить перед
            разбором. Это тот же путь, что и со своим текстом.
          </p>
          {examples.map((example) => (
            <div key={example.title} style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setText(example.text);
                  setResult(null);
                  action.reset();
                }}
              >
                {example.title}
              </button>{' '}
              <span className="faint">{example.hint}</span>
            </div>
          ))}
        </details>
      </div>

      {result ? <Result locale={locale} result={result} text={analyzed} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function Result({
  locale,
  result,
  text,
}: {
  locale: Locale;
  result: AnalyzeResponse;
  text: string;
}) {
  const t = translator(locale);

  // Подсветка собирается из цитат гипотез и найденных условий оплаты.
  // Роль у всех — AI: в произвольном тексте доказательств аналитика быть
  // не может, здесь ещё ничего не подтверждено.
  const spans: HighlightSpan[] = [
    ...result.factorHypotheses.flatMap((item) =>
      item.span
        ? [
            {
              charStart: item.span.charStart,
              charEnd: item.span.charEnd,
              role: 'AI' as const,
              title: `${item.code} — ${item.rationale[locale]}`,
            },
          ]
        : [],
    ),
    ...result.extracted.paymentTerms.map((item) => ({
      charStart: item.charStart,
      charEnd: item.charEnd,
      role: 'AI' as const,
      title: `${item.label[locale]} — ${item.riskBearing ? t('analyzeRiskBearing') : t('analyzeLawful')}`,
    })),
  ];

  return (
    <>
      <div className="notice notice-info">
        <strong>{result.disclaimer[locale]}</strong>
      </div>

      <div className="card">
        <div className="row-between">
          <h2 style={{ marginBottom: 0 }}>{t('analyzeExtracted')}</h2>
          <span className="faint">
            {t('analyzeProvider')}: <span className="mono">{result.provider}</span>
            {result.model ? <> · {result.model}</> : null} · {Math.round(result.durationMs)} мс
          </span>
        </div>

        <p className="lead">{result.summary[locale]}</p>

        <div className="row" style={{ marginBottom: 10 }}>
          <span className={result.isHousingAd ? 'tag tag-ok' : 'tag'}>
            {t('analyzeIsHousing')}: {result.isHousingAd ? 'да' : 'нет'}
          </span>
          <span className={result.mentionsUnderConstruction ? 'tag tag-warn' : 'tag'}>
            {t('analyzeUnderConstruction')}: {result.mentionsUnderConstruction ? 'да' : 'нет'}
          </span>
        </div>

        <h3>{t('publicationsText')}</h3>
        <HighlightLegend locale={locale} />
        <AdText text={text} spans={spans} />
      </div>

      <div className="split">
        <section className="card">
          <h2>{t('analyzeHypotheses')}</h2>
          {result.factorHypotheses.length === 0 ? (
            <p className="muted">{t('analyzeNoRisk')}</p>
          ) : (
            result.factorHypotheses.map((item, index) => (
              <div className="factor-row" key={`${item.code}-${index}`}>
                <div className="factor-head">
                  <div>
                    <span className="tag tag-code tag-ai">{item.code}</span>{' '}
                    <strong>{item.rationale[locale]}</strong>
                  </div>
                  <span className={item.lowConfidence ? 'tag tag-warn' : 'tag'}>
                    {t('analyzeConfidence')} {Math.round(item.confidence * 100)}%
                  </span>
                </div>
                {item.span ? (
                  <p className="faint" style={{ margin: '4px 0' }}>
                    «{item.span.fragment}» — символы {item.span.charStart}…{item.span.charEnd}
                  </p>
                ) : (
                  <p className="faint" style={{ margin: '4px 0' }}>
                    Цитаты нет: основание нужно искать за пределами текста.
                  </p>
                )}
                <p style={{ margin: 0 }}>
                  <span className="faint">{t('analyzeVerification')}: </span>
                  {item.verification[locale]}
                </p>
                {item.lowConfidence ? (
                  <p className="faint" style={{ margin: '4px 0 0' }}>
                    {t('analyzeLowConfidence')} — вывод требует особенно
                    внимательной проверки.
                  </p>
                ) : null}
              </div>
            ))
          )}
          <p className="faint" style={{ marginTop: 10 }}>
            {t('analyzeNoScore')}
          </p>
        </section>

        <section className="card">
          <h2>{t('analyzePaymentTerms')}</h2>
          {result.extracted.paymentTerms.length === 0 ? (
            <p className="muted">Условий оплаты в тексте не найдено.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Формулировка</th>
                  <th>Оценка</th>
                </tr>
              </thead>
              <tbody>
                {result.extracted.paymentTerms.map((item, index) => (
                  <tr key={`${item.category}-${index}`}>
                    <td>
                      <strong>{item.label[locale]}</strong>
                      <div className="faint">«{item.fragment}»</div>
                      {item.amount !== null ? (
                        <div className="faint">
                          сумма: {item.amount.toLocaleString('ru-RU')}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={item.riskBearing ? 'tag tag-danger' : 'tag tag-ok'}>
                        {item.riskBearing ? t('analyzeRiskBearing') : t('analyzeLawful')}
                      </span>
                      <div className="faint">{item.note[locale]}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>Прочее найденное</h3>
          <Facts locale={locale} extracted={result.extracted} />
        </section>
      </div>

      <div className="split">
        <section className="card">
          <h2>{t('analyzeMatches')}</h2>
          {result.projectMatches.length === 0 ? (
            <p className="muted">
              Совпадений с реестром нет. Это не значит, что объекта не существует:
              название в объявлении может быть написано иначе.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Объект</th>
                  <th className="num">Схожесть</th>
                  <th>Основание</th>
                </tr>
              </thead>
              <tbody>
                {result.projectMatches.map((match) => (
                  <tr key={match.projectId}>
                    <td>{match.projectName}</td>
                    <td className="num">{Math.round(match.score * 100)}%</td>
                    <td className="faint">
                      {match.matchedOn.join(', ')}
                      <div>{match.rationale[locale]}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="faint">
            Привязку подтверждает человек: ошибочная связь объявления с ЖК — это
            ложный риск на конкретном застройщике.
          </p>
        </section>

        <section className="card">
          <h2>{t('analyzeChecks')}</h2>
          <ul>
            {result.checks.map((item, index) => (
              <li key={index}>{item[locale]}</li>
            ))}
          </ul>
          {result.warnings.length > 0 ? (
            <>
              <h3>{t('analyzeWarnings')}</h3>
              <ul>
                {result.warnings.map((item, index) => (
                  <li key={index} className="faint">
                    {item[locale]}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}

function Facts({
  locale,
  extracted,
}: {
  locale: Locale;
  extracted: AnalyzeResponse['extracted'];
}) {
  const t = translator(locale);
  const rows: { label: string; values: string[] }[] = [
    { label: 'Названия ЖК', values: extracted.projectNames.map((item) => item.fragment) },
    { label: t('address'), values: extracted.addresses.map((item) => item.fragment) },
    { label: t('phone'), values: extracted.phones.map((item) => item.normalized) },
    {
      label: 'Готовность',
      values: extracted.readinessMentions.map((item) => `${item.value}%`),
    },
    { label: 'Срок сдачи', values: extracted.completionYears.map((item) => String(item.year)) },
    {
      label: 'Заявленное основание',
      values: extracted.legalBasisClaims.map((item) => item.fragment),
    },
    { label: 'Упоминания просрочки', values: extracted.delayMentions.map((item) => item.fragment) },
  ].filter((row) => row.values.length > 0);

  if (rows.length === 0) return <p className="muted">Ничего больше не найдено.</p>;

  return (
    <table>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th>{row.label}</th>
            <td>{row.values.join(' · ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
