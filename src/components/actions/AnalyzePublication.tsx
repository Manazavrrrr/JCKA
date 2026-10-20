'use client';

/**
 * Запуск разбора сохранённого объявления.
 *
 * Кнопка делает ровно одно: создаёт гипотезы. Не подтверждает факторы, не
 * меняет балл, не привязывает объявление к объекту. Поэтому в ответе
 * показывается только число сохранённых гипотез и чем они получены —
 * провайдер, модель, время. Это те сведения, по которым потом можно
 * объяснить, откуда в очереди появилось предложение.
 *
 * Повторный разбор заменяет нерассмотренные гипотезы и не трогает решения
 * человека. Об этом сказано рядом с кнопкой, а не только в документации
 * API: аналитик, нажимающий «разобрать» второй раз, вправе знать, что
 * его отклонения не исчезнут.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

interface AnalyzeResponse {
  provider: string;
  model: string | null;
  durationMs: number;
  saved: number;
  warnings: { ru: string; kk: string }[];
}

export function AnalyzePublication({
  publicationId,
  locale,
  /** Был ли разбор раньше — от этого зависит предупреждение о замене. */
  hasSuggestions,
}: {
  publicationId: string;
  locale: Locale;
  hasSuggestions: boolean;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function run() {
    const response = await action.run<AnalyzeResponse>(
      () => api.post(`/api/publications/${publicationId}/analyze`, {}),
      (data) => {
        setResult(data);
        router.refresh();
      },
    );
    if (!response) setResult(null);
  }

  return (
    <div className="no-print">
      <div className="row">
        <button type="button" className="btn-primary" disabled={action.busy} onClick={run}>
          {action.busy ? t('loading') : t('publicationsAnalyze')}
        </button>
      </div>

      <p className="faint">
        Разбор создаёт гипотезы и не меняет балл объекта.
        {hasSuggestions
          ? ' Повторный разбор заменит нерассмотренные гипотезы; принятые и отклонённые останутся.'
          : ''}
      </p>

      {result ? (
        <div className="notice notice-info">
          <strong>Разбор выполнен.</strong> Сохранено гипотез: {result.saved}.{' '}
          {t('analyzeProvider')}: <span className="mono">{result.provider}</span>
          {result.model ? <span className="mono"> / {result.model}</span> : null}, {result.durationMs}{' '}
          мс.
          {result.warnings.length > 0 ? (
            <ul>
              {result.warnings.map((item, index) => (
                <li key={index}>{item[locale]}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Feedback failure={action.failure} done={action.done} />
    </div>
  );
}
