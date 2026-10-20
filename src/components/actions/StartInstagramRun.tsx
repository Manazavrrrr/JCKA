'use client';

/**
 * Запуск прогона по профилю застройщика в Instagram.
 *
 * Отличие от прогона по Telegram-каналу одно, и оно определяет весь вид
 * этой формы: здесь кнопка тратит деньги органа. Поэтому:
 *
 * — стоимость показана рядом с полем «сколько публикаций» и пересчитывается
 *   на каждое нажатие, а не называется после прогона. Цифра, которая
 *   появляется в ответе, — это уже списанная цифра;
 *
 * — число публикаций задаётся выбором из готовых значений, а не свободным
 *   полем. Свободное поле допускает лишний нуль, а лишний нуль здесь — это
 *   умножение счёта на десять. Потолок приходит из ядра, и список значений
 *   строится от него, а не прописан числами;
 *
 * — когда ключа на сервере нет, об этом сказано до нажатия, а не после:
 *   прогон всё равно состоится, но на сохранённом образце, и аналитик
 *   должен знать это заранее, иначе примет демонстрацию за живой сбор.
 *
 * Правовая оговорка о условиях Meta в форме не повторяется: она стоит выше,
 * на карточке источника, и дублировать её здесь значило бы приучить
 * пролистывать. Форма отвечает за деньги и за ожидание.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

/** Варианты отсечки по давности в том виде, в каком их понимает актор. */
const AGE_OPTIONS: Array<{ value: string; label: { ru: string; kk: string } }> = [
  { value: '7 days', label: { ru: 'неделя', kk: 'бір апта' } },
  { value: '1 month', label: { ru: 'месяц', kk: 'бір ай' } },
  { value: '3 months', label: { ru: 'три месяца', kk: 'үш ай' } },
];

export function StartInstagramRun({
  locale,
  defaultLimit,
  maxLimit,
  defaultMinCategories,
  maxCategories,
  pricePer1000Usd,
  keyPresent,
}: {
  locale: Locale;
  defaultLimit: number;
  /** Потолок из ядра. Список значений строится от него. */
  maxLimit: number;
  defaultMinCategories: number;
  maxCategories: number;
  /** Цена за 1000 результатов. Приходит из ядра, чтобы не разойтись с ним. */
  pricePer1000Usd: number;
  /** Задан ли ключ на сервере. Сам ключ в браузер не попадает. */
  keyPresent: boolean;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [account, setAccount] = useState('');
  const [limit, setLimit] = useState(defaultLimit);
  const [newerThan, setNewerThan] = useState(AGE_OPTIONS[0]?.value ?? '7 days');
  const [minCategories, setMinCategories] = useState(defaultMinCategories);
  const [summary, setSummary] = useState<string | null>(null);

  const thresholds = Array.from({ length: maxCategories }, (_, index) => index + 1);

  /**
   * Готовые значения до потолка: 10, 20, 50, 100 — и ничего выше.
   * Фильтр по потолку, а не обрезка списка руками: когда потолок в ядре
   * изменится, список изменится вместе с ним.
   */
  const limits = [10, 20, 50, 100].filter((value) => value <= maxLimit);

  /** Та же арифметика, что на сервере: доли цента округляются вверх. */
  const cost = Math.ceil((limit / 1000) * pricePer1000Usd * 100) / 100;

  function start() {
    setSummary(null);
    return action.run(
      () =>
        api.post<{
          run: { note: string | null };
          stats: { total: number; kept: number; skipped: number };
        }>('/api/collect/runs', {
          account: account.trim(),
          limit,
          newerThan,
          minCategories,
        }),
      (result) => {
        setSummary(
          `Прочитано ${result.stats.total}, взято ${result.stats.kept}, ` +
            `отброшено ${result.stats.skipped}.` +
            (result.run.note ? ` ${result.run.note}` : ''),
        );
        router.refresh();
      },
    );
  }

  const blocked = account.trim().length === 0;

  return (
    <div className="card no-print">
      <div className="row-between">
        <h2 style={{ marginTop: 0 }}>{t('collectInstagramRun')}</h2>
        <span className={keyPresent ? 'tag tag-ok' : 'tag tag-warn'}>
          {keyPresent ? t('collectReady') : t('collectNotReady')}
        </span>
      </div>

      <div className="grid grid-3">
        <div className="field">
          <label htmlFor="collect-account">{t('collectAccount')}</label>
          <input
            id="collect-account"
            type="text"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            placeholder="@monterosa.kz"
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="collect-limit">{t('collectPostsLimit')}</label>
          <select
            id="collect-limit"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            {limits.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="collect-age">{t('collectNewerThan')}</label>
          <select
            id="collect-age"
            value={newerThan}
            onChange={(event) => setNewerThan(event.target.value)}
          >
            {AGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label[locale]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="collect-ig-threshold">{t('collectThreshold')}</label>
          <select
            id="collect-ig-threshold"
            value={minCategories}
            onChange={(event) => setMinCategories(Number(event.target.value))}
          >
            {thresholds.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="faint" style={{ marginTop: 4 }}>
        {t('collectInstagramHint')}
      </p>

      {/*
       * Стоимость — отдельной строкой и с подчёркиванием, а не в общем
       * потоке подсказок: это единственное место в системе, где нажатие
       * кнопки стоит денег, и оно должно читаться раньше кнопки.
       */}
      <p style={{ margin: '6px 0 0' }}>
        <strong>
          {t('collectEstimatedCost')}: {cost.toFixed(2)} $
        </strong>
      </p>
      <p className="faint" style={{ marginTop: 2 }}>
        {t('collectCostHint')}
      </p>

      {keyPresent ? null : (
        <p className="faint" style={{ marginTop: 6 }}>
          {t('collectDemoRunHint')} {t('collectTokenHowTo')}
        </p>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn-primary"
          disabled={action.busy || blocked}
          onClick={start}
        >
          {action.busy ? t('loading') : t('collectInstagramStart')}
        </button>
      </div>

      <Feedback failure={action.failure} done={action.failure ? null : summary} />
    </div>
  );
}
