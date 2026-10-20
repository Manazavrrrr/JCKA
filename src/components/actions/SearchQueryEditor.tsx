'use client';

/**
 * Правка слов, по которым идёт поиск без перечня аккаунтов.
 *
 * Отличие от правки слов-ловушек выглядит как мелочь, а определяет весь вид
 * этих двух компонентов: слово-ловушка применяется к уже прочитанному тексту
 * и денег не стоит, а слово поиска решает, какую страницу открыть, — и
 * оплачивается на каждом обходе. Поэтому здесь, в отличие от ловушек:
 *
 * — после добавления показывается, к какому виду слово приведено. «жк усть
 *   каменогорск» ищется склеенным, и если аналитик узнает об этом не сразу,
 *   а по пустому результату, он решит, что реклама кончилась, тогда как
 *   кончилась она только по его написанию;
 *
 * — отказ «таких слов уже достаточно» приходит с сервера и показывается
 *   целиком. Потолок включённых слов — это потолок расхода на один обход, и
 *   объяснять его числом без причины значило бы выдать защиту за капризы;
 *
 * — выключение и удаление разведены по разным кнопкам. Выключенное слово
 *   перестаёт тратить деньги, но остаётся в списке со своей историей: когда
 *   по нему ходили и сколько оно принесло. По этой истории и решают, вернуть
 *   его или удалить, — а удаление такую историю стирает, поэтому спрашивает
 *   подтверждение.
 *
 * Найденное по слову ни выключение, ни удаление не трогают: элементы сбора
 * привязаны к прогону, а не к слову. Иначе удаление слова стирало бы из
 * истории объявления, по которым аналитик уже принял решение.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

interface CreatedQuery {
  query: { tag: string; geoAnchored: boolean; exploreUrl: string };
  /** Приведено ли введённое к виду тега. */
  changed: boolean;
}

/** Форма добавления слова поиска. */
export function AddSearchQuery({
  locale,
  activeCount,
  maxActive,
}: {
  locale: Locale;
  activeCount: number;
  /** Потолок включённых слов. Приходит из ядра, а не прописан числом. */
  maxActive: number;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState<string | null>(null);

  function add() {
    setSummary(null);
    return action.run(
      () =>
        api.post<CreatedQuery>('/api/collect/queries', {
          tag: tag.trim(),
          active: true,
          ...(note.trim() ? { noteRu: note.trim() } : {}),
        }),
      (result) => {
        /*
         * Приведённый вид называется всегда, а не только когда он отличается
         * от введённого: «слово добавлено как „жкукг“» читается однозначно, а
         * «слово изменено» заставляет гадать, во что именно.
         */
        setSummary(
          `Слово добавлено как «${result.query.tag}».` +
            (result.changed ? ' Введённое приведено к виду тега.' : '') +
            (result.query.geoAnchored
              ? ''
              : ' Привязки к месту в слове нет: обход будет собирать рекламу и по другим регионам.'),
        );
        setTag('');
        setNote('');
        router.refresh();
      },
    );
  }

  const blocked = tag.trim().length < 2;
  const full = activeCount >= maxActive;

  return (
    <div className="card no-print">
      <div className="row-between">
        <h2 style={{ marginTop: 0 }}>{t('queriesAdd')}</h2>
        {/*
         * Счётчик стоит у заголовка, а не у кнопки: решение «выключить
         * ненужное слово» принимают до того, как придумают новое, иначе
         * придуманное упрётся в отказ и потеряется.
         */}
        <span className={full ? 'tag tag-warn' : 'tag'}>
          {t('queriesActiveCount')}: {activeCount} / {maxActive}
        </span>
      </div>

      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="query-tag">{t('queriesTag')}</label>
          <input
            id="query-tag"
            type="text"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="#новостройкиукг"
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="query-note">{t('termsNote')}</label>
          <input
            id="query-note"
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="зачем это слово в обходе"
          />
        </div>
      </div>

      <p className="faint" style={{ marginTop: 4 }}>
        {t('queriesTagHint')}
      </p>
      <p className="faint" style={{ marginTop: 0 }}>
        {t('queriesGeoHint')}
      </p>

      <div className="row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn-primary"
          disabled={action.busy || blocked}
          onClick={add}
        >
          {action.busy ? t('loading') : t('queriesAdd')}
        </button>
      </div>

      <Feedback failure={action.failure} done={action.failure ? null : summary} />
    </div>
  );
}

/**
 * Возврат набора слов по умолчанию.
 *
 * Кнопка нужна по одной причине: список слов живёт в базе, а не в коде, и
 * аналитик, удаливший всё, иначе остался бы с пустым экраном и без способа
 * начать заново, кроме пересоздания базы — то есть потери всей работы. То же
 * состояние возникает после обновления схемы на прежней базе.
 *
 * Итог называется разбором, а не словом «готово». «Добавлено 3, уже были 4»
 * отвечает на вопрос, который возникает сразу после нажатия: что изменилось
 * в списке, за который платят деньги. Отдельно названы слова, пришедшие
 * выключенными: это не отказ и не сбой, а соблюдённый потолок, и аналитик
 * должен знать, что они не будут собираться, пока он не освободит место.
 */
export function RestoreDefaultQueries({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [summary, setSummary] = useState<string | null>(null);

  function restore() {
    setSummary(null);
    return action.run(
      () =>
        api.post<{
          added: string[];
          addedDisabled: string[];
          kept: string[];
          activeCount: number;
        }>('/api/collect/queries/defaults', {}),
      (result) => {
        setSummary(
          result.added.length === 0
            ? 'Все слова набора уже в списке — ничего не добавлено.'
            : `Добавлено слов: ${result.added.length} (${result.added.join(', ')}).` +
                (result.kept.length > 0 ? ` Уже были в списке: ${result.kept.length}.` : '') +
                (result.addedDisabled.length > 0
                  ? ` Выключенными добавлены ${result.addedDisabled.join(', ')}: включённых слов уже достаточно.`
                  : ''),
        );
        router.refresh();
      },
    );
  }

  return (
    <div className="no-print" style={{ marginTop: 10 }}>
      <button type="button" className="btn btn-small" disabled={action.busy} onClick={restore}>
        {action.busy ? t('loading') : t('queriesRestore')}
      </button>
      <p className="faint" style={{ marginTop: 6 }}>
        {t('queriesRestoreHint')}
      </p>
      <Feedback failure={action.failure} done={action.failure ? null : summary} />
    </div>
  );
}

/** Включение, выключение и удаление для одной строки списка. */
export function SearchQueryControls({
  queryId,
  active,
  locale,
}: {
  queryId: string;
  active: boolean;
  locale: Locale;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  function toggle() {
    return action.run(
      () => api.patch(`/api/collect/queries/${queryId}`, { active: !active }),
      () => router.refresh(),
    );
  }

  function remove() {
    // Подтверждение здесь, а не на сервере: сервер не вправе отказать в
    // удалении, а человек вправе передумать, прочитав последствие.
    if (!window.confirm(t('queriesDeleteConfirm'))) return;
    return action.run(
      () => api.del(`/api/collect/queries/${queryId}`),
      () => router.refresh(),
    );
  }

  return (
    <div className="row no-print" style={{ gap: 6, justifyContent: 'flex-end' }}>
      <button type="button" className="btn btn-small" disabled={action.busy} onClick={toggle}>
        {active ? t('termsDisable') : t('termsEnable')}
      </button>
      <button type="button" className="btn btn-small" disabled={action.busy} onClick={remove}>
        {t('termsDelete')}
      </button>
      {action.failure ? (
        <span className="tag tag-danger" title={action.failure.message}>
          {t('errorTitle')}
        </span>
      ) : null}
    </div>
  );
}
