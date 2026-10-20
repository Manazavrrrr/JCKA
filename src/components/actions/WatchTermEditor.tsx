'use client';

/**
 * Правка списка слов-ловушек прямо на экране.
 *
 * Смысл этого файла — в том, чего в нём нет: обращения к разработчику.
 * Состав признаков рекламы меняется быстрее, чем выходят сборки. Сегодня
 * застройщики пишут «бронь», завтра «закрепление цены», послезавтра
 * появляется имя нового ЖК. Если править список может только тот, кто
 * выкладывает новую версию, фильтр неизбежно отстаёт от рынка на срок
 * согласования задачи.
 *
 * Выключение и удаление — разные кнопки, и обе нужны. Выключенное слово
 * остаётся в списке со своим счётчиком: видно, что оно когда-то ловило,
 * и его можно вернуть одним нажатием. Удаление применяют к опечаткам.
 * Поэтому удаление спрашивает подтверждение, а выключение — нет:
 * выключение обратимо, удаление нет.
 *
 * Ни то, ни другое не переписывает прошлое. Объяснение к каждому уже
 * собранному элементу сохранено готовой строкой и остаётся правдой о том,
 * почему элемент взяли тогда, — иначе правка одного слова задним числом
 * сделала бы необъяснимыми десятки карточек. Это сказано в подтверждении
 * удаления, а не только в коде: аналитик должен понимать последствие
 * до нажатия.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export interface TermCategoryOption {
  value: string;
  label: string;
  hint: string;
}

export interface TermLanguageOption {
  value: string;
  label: string;
}

/** Форма добавления слова. */
export function AddWatchTerm({
  locale,
  categories,
  languages,
}: {
  locale: Locale;
  categories: readonly TermCategoryOption[];
  languages: readonly TermLanguageOption[];
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [text, setText] = useState('');
  const [category, setCategory] = useState(categories[0]?.value ?? '');
  const [language, setLanguage] = useState(languages[0]?.value ?? '');

  const hint = categories.find((item) => item.value === category)?.hint ?? '';

  function add() {
    return action.run(
      () =>
        api.post('/api/collect/terms', {
          text: text.trim(),
          category,
          language,
          active: true,
        }),
      () => {
        setText('');
        router.refresh();
      },
      'Слово добавлено. Оно сработает на следующем прогоне.',
    );
  }

  const blocked = text.trim().length < 2;

  return (
    <div className="card no-print">
      <h2 style={{ marginTop: 0 }}>{t('termsAdd')}</h2>

      <div className="grid grid-3">
        <div className="field">
          <label htmlFor="term-text">{t('termsText')}</label>
          <input
            id="term-text"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="брон*"
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="term-category">{t('termsGroup')}</label>
          <select
            id="term-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {categories.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="term-language">{t('termsLanguage')}</label>
          <select
            id="term-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {languages.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="faint" style={{ marginTop: 4 }}>
        {t('termsTextHint')}
      </p>
      {hint ? (
        <p className="faint" style={{ marginTop: 0 }}>
          {hint}
        </p>
      ) : null}

      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn-primary" disabled={action.busy || blocked} onClick={add}>
          {t('termsAdd')}
        </button>
      </div>

      <Feedback failure={action.failure} done={action.done} />
    </div>
  );
}

/**
 * Возврат набора слов-ловушек по умолчанию.
 *
 * Та же кнопка, что у слов поиска, и по той же причине: набор живёт в базе, и
 * удалившему всё иначе остаётся только пересоздать базу — то есть потерять
 * всю работу. Разница в последствии удаления. Слова-ловушки бесплатны, и
 * опустошить список кажется безобидным; но прогон без включённых ловушек
 * отбрасывает всё прочитанное, и на экране это выглядит как «реклама
 * кончилась», а не как «фильтр пуст».
 *
 * Итог называется числом добавленных, а не словом «готово»: набор — семь
 * десятков слов, и человек, нажавший кнопку после правки списка, спрашивает
 * именно «сколько вернулось».
 */
export function RestoreDefaultTerms({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [summary, setSummary] = useState<string | null>(null);

  function restore() {
    setSummary(null);
    return action.run(
      () =>
        api.post<{ added: string[]; kept: number; activeCount: number }>(
          '/api/collect/terms/defaults',
          {},
        ),
      (result) => {
        setSummary(
          result.added.length === 0
            ? 'Весь набор уже в списке — ничего не добавлено.'
            : `Добавлено слов: ${result.added.length}. Уже были в списке: ${result.kept}. ` +
                `Включённых слов теперь ${result.activeCount}.`,
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
        {t('termsRestoreHint')}
      </p>
      <Feedback failure={action.failure} done={action.failure ? null : summary} />
    </div>
  );
}

/** Переключатель и удаление для одной строки списка. */
export function WatchTermControls({
  termId,
  active,
  locale,
}: {
  termId: string;
  active: boolean;
  locale: Locale;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  function toggle() {
    return action.run(
      () => api.patch(`/api/collect/terms/${termId}`, { active: !active }),
      () => router.refresh(),
    );
  }

  function remove() {
    // Подтверждение стоит здесь, а не на сервере: сервер не вправе
    // отказать в удалении, а человек вправе передумать.
    if (!window.confirm(t('termsDeleteConfirm'))) return;
    return action.run(
      () => api.del(`/api/collect/terms/${termId}`),
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
