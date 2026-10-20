/**
 * Экран настройки слов-ловушек.
 *
 * Страница существует ради одного утверждения: состав фильтра — это
 * данные надзорного органа, а не исходный код подрядчика. Поэтому здесь
 * нет ничего, кроме списка слов, и всё, что со списком можно сделать,
 * делается отсюда.
 *
 * Слова сгруппированы по категориям, и группы идут в том же порядке, в
 * каком объявлены в ядре, — сначала положительные, стоп-слова последними.
 * Порядок не косметический: правило отбора читается сверху вниз («предмет
 * и ещё одна группа — берём; стоп-слово — отменяем»), и список, идущий в
 * том же порядке, объясняет правило сам.
 *
 * У каждого слова стоит счётчик пойманного. Это единственная обратная
 * связь, по которой видно, работает список или только выглядит рабочим:
 * слово с нулём либо описывает формулировку, вышедшую из обихода, либо
 * написано с опечаткой. Что именно — машина знать не может, поэтому ноль
 * помечен как наблюдение, а не как ошибка, и решение остаётся за человеком.
 *
 * Правило отбора показано числом из того же DEFAULT_COLLECT_RULE, по
 * которому идёт прогон. Текст правила, расходящийся с поведением, хуже
 * отсутствующего текста: он создаёт ложную уверенность.
 */

import {
  DEFAULT_COLLECT_RULE,
  POSITIVE_CATEGORIES,
  WATCH_TERM_CATEGORIES,
  WATCH_TERM_CATEGORY_HINTS,
  WATCH_TERM_CATEGORY_LABELS,
  WATCH_TERM_LANGUAGES,
  WATCH_TERM_LANGUAGE_LABELS,
  type WatchTermLanguage,
} from '../../core/collect';
import { translator } from '../../i18n/dict';
import { getLocale } from '../../i18n/server';
import { prisma } from '../../lib/db';
import { listWatchTerms } from '../../server/collect';
import {
  AddWatchTerm,
  RestoreDefaultTerms,
  WatchTermControls,
} from '../../components/actions/WatchTermEditor';
import { Empty, Notice, PageHeader } from '../../components/ui';

export const dynamic = 'force-dynamic';

export default async function TermsPage() {
  const locale = await getLocale();
  const t = translator(locale);

  const terms = await listWatchTerms(prisma);

  const categories = WATCH_TERM_CATEGORIES.map((category) => ({
    value: category,
    label: WATCH_TERM_CATEGORY_LABELS[category][locale],
    hint: WATCH_TERM_CATEGORY_HINTS[category][locale],
  }));

  const languages = WATCH_TERM_LANGUAGES.map((language) => ({
    value: language,
    label: WATCH_TERM_LANGUAGE_LABELS[language][locale],
  }));

  return (
    <>
      <PageHeader title={t('termsTitle')} lead={t('termsLead')} />

      {/* --- Правило отбора ------------------------------------------- */}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('termsRule')}</h2>
        <p className="lead" style={{ marginBottom: 0 }}>
          {t('termsRuleText')}
        </p>
        <p className="faint" style={{ marginBottom: 0 }}>
          {t('collectThreshold')}: {DEFAULT_COLLECT_RULE.minCategories} из{' '}
          {POSITIVE_CATEGORIES.length}
        </p>
      </div>

      <AddWatchTerm locale={locale} categories={categories} languages={languages} />

      {/* --- Список по группам ---------------------------------------- */}

      {WATCH_TERM_CATEGORIES.map((category) => {
        const group = terms.filter((term) => term.category === category);
        const stop = category === 'EXCLUDE';

        return (
          <div key={category} className="card">
            <div className="row-between">
              <h2 style={{ marginTop: 0, marginBottom: 0 }}>
                {WATCH_TERM_CATEGORY_LABELS[category][locale]}
              </h2>
              <span className="faint">
                {t('total')}: {group.length}
              </span>
            </div>

            <p className="faint" style={{ marginTop: 4 }}>
              {WATCH_TERM_CATEGORY_HINTS[category][locale]}
            </p>

            {/*
             * Предупреждение стоит у группы, а не в общем тексте правила:
             * стоп-слово ведёт себя противоположно остальным, и прочитать
             * об этом нужно там, где его добавляют.
             */}
            {stop ? <Notice kind="warn">{t('termsStopHint')}</Notice> : null}

            {group.length === 0 ? (
              <Empty text={t('empty')} />
            ) : (
              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>{t('termsText')}</th>
                    <th>{t('termsLanguage')}</th>
                    <th className="num">{t('termsCaught')}</th>
                    <th>{t('termsState')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {group.map((term) => {
                    const dead = term.caught === 0;

                    return (
                      <tr key={term.id}>
                        <td>
                          <strong className="mono">{term.text}</strong>
                          {term.note ? (
                            <div className="faint">{term.note[locale]}</div>
                          ) : null}
                        </td>
                        <td className="faint">
                          {WATCH_TERM_LANGUAGE_LABELS[term.language as WatchTermLanguage][locale]}
                        </td>
                        <td className="num">
                          {term.caught}
                          {/*
                           * Пометка показывается только у включённого слова.
                           * У выключенного ноль ничего не сообщает: оно и не
                           * могло ничего поймать, пока было выключено.
                           */}
                          {dead && term.active ? (
                            <div className="tag" title={t('termsDeadHint')}>
                              {t('termsDead')}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span className={term.active ? 'tag tag-ok' : 'tag'}>
                            {term.active ? t('termsActive') : t('termsOff')}
                          </span>
                        </td>
                        <td>
                          <WatchTermControls
                            termId={term.id}
                            active={term.active}
                            locale={locale}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {/*
       * Возврат набора — под всеми группами, а не у формы добавления.
       * Кнопку ищут, просмотрев список и увидев, что в нём не хватает, —
       * значит, взгляд в этот момент внизу страницы. У формы добавления она
       * к тому же читалась бы как «добавить», хотя ничего не вводят.
       */}
      <div className="card no-print">
        <h2 style={{ marginTop: 0 }}>{t('termsRestoreTitle')}</h2>
        <RestoreDefaultTerms locale={locale} />
      </div>
    </>
  );
}
