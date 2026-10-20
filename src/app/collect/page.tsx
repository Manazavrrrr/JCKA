/**
 * Экран сбора объявлений.
 *
 * Три части, и порядок между ними осмысленный.
 *
 * Сначала источники — включая те, которые система читать не может.
 * Реклама новостроек в Instagram и Facebook существует, и именно она
 * чаще всего попадается жителям; автоматически взять её неоткуда (Ad
 * Library API отдаёт коммерческие объявления только по странам ЕС и
 * Великобритании, а разбор веб-версии нарушает условия площадки).
 * Такой источник стоит в списке с пометкой «только ручной ввод» и
 * объяснением, а не отсутствует: отсутствие читалось бы как недоделка,
 * тогда как это ограничение площадки, которое надзорный орган обязан
 * учитывать в своей работе.
 *
 * Затем прогон и его история. Прогон записывается в обоих исходах, в том
 * числе неудачный: без записи о падении молчащий канал и недоступный
 * канал выглядят одинаково.
 *
 * И только потом лента. В ней показано и взятое, и отброшенное — второе
 * важнее. Отброшенное объявление никуда больше не попадёт и ниоткуда не
 * всплывёт, поэтому ошибка фильтра видна только здесь: по строке
 * «отброшено, сработала только группа „предмет“» аналитик понимает,
 * какого слова не хватает в списке.
 *
 * По каждому элементу хранится готовая фраза, объясняющая решение
 * словами самого объявления. Фраза собрана при сборе и не пересчитывается
 * потом: она описывает, почему элемент взяли тогда, и правка списка слов
 * задним числом не должна делать прошлые решения необъяснимыми.
 */

import Link from 'next/link';

import {
  APIFY_PRICE_PER_1000_USD,
  COLLECT_REASON_LABELS,
  COLLECT_SOURCES,
  COLLECT_VERDICT_LABELS,
  type CollectReason,
  type CollectVerdict,
  DEFAULT_COLLECT_RULE,
  DEFAULT_HASHTAG_LIMIT,
  DEFAULT_POSTS_LIMIT,
  MAX_ACTIVE_QUERIES,
  MAX_POSTS_LIMIT,
  MAX_RESULTS_PER_WALK,
  POSITIVE_CATEGORIES,
  SOURCE_ACCESS_MODE_HINTS,
  SOURCE_ACCESS_MODE_LABELS,
  WATCH_TERM_CATEGORY_LABELS,
  type WatchTermCategory,
  estimateRunCostUsd,
  plannedWalkResults,
} from '../../core/collect';
import { PLATFORM_LABELS, type Platform } from '../../core/domain/enums';
import { translator } from '../../i18n/dict';
import { getLocale } from '../../i18n/server';
import { prisma } from '../../lib/db';
import {
  HASHTAG_WALK_TARGET,
  apifyConfigured,
  listCollectRuns,
  listCollectedItems,
} from '../../server/collect';
import { budgetStatus, dailyBudgetUsd, listSearchQueries } from '../../server/discovery';
import {
  DEFAULT_INTERVAL_MINUTES,
  MAX_TELEGRAM_CHANNELS_PER_CYCLE,
  schedulerState,
} from '../../server/scheduler';
import { AdText, TermLegend, spansFromHits } from '../../components/AdText';
import { CheckboxFilter, FilterForm, SelectFilter } from '../../components/Filters';
import { CollectedItemDecision } from '../../components/actions/CollectedItemDecision';
import {
  AddSearchQuery,
  RestoreDefaultQueries,
  SearchQueryControls,
} from '../../components/actions/SearchQueryEditor';
import { StartCollectRun } from '../../components/actions/StartCollectRun';
import { StartInstagramRun } from '../../components/actions/StartInstagramRun';
import { WalkNow } from '../../components/actions/WalkNow';
import { DateOnly, Empty, Notice, PageHeader, When } from '../../components/ui';

export const dynamic = 'force-dynamic';

type Params = { verdict?: string; runId?: string; queue?: string };

export default async function CollectPage({ searchParams }: { searchParams: Promise<Params> }) {
  const locale = await getLocale();
  const t = translator(locale);
  const params = await searchParams;

  const queueOnly = params.queue === 'true';

  /**
   * Задан ли ключ к платному сборщику. Читается на сервере; в браузер
   * уходит одно булево значение, сам ключ — никогда.
   */
  const instagramReady = apifyConfigured();

  const [runs, feed, queries] = await Promise.all([
    listCollectRuns(prisma, 20),
    listCollectedItems(prisma, {
      ...(params.runId && { runId: params.runId }),
      ...(params.verdict === 'KEPT' || params.verdict === 'SKIPPED'
        ? { verdict: params.verdict }
        : {}),
      queue: queueOnly,
      limit: 50,
      offset: 0,
    }),
    listSearchQueries(prisma),
  ]);

  /*
   * Размер и цена обхода считаются ядром по включённым словам, а не берутся
   * из ответа прогона: экран должен назвать цену до нажатия, а не после.
   * Сборщик берёт свою долю на каждое слово, поэтому это произведение, а не
   * доля — и ошибка здесь была бы ошибкой в деньгах, а не в подписи.
   */
  const activeQueries = queries.filter((query) => query.active).length;
  const plannedResults = plannedWalkResults(activeQueries, DEFAULT_HASHTAG_LIMIT);
  const plannedCostUsd = estimateRunCostUsd(plannedResults);

  const budget = await budgetStatus(prisma, { plannedResults });
  const scheduler = schedulerState();

  return (
    <>
      <PageHeader title={t('collectTitle')} lead={t('collectLead')} />

      {/* --- Источники ---------------------------------------------- */}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('collectSources')}</h2>
        <p className="lead">{t('collectSourcesLead')}</p>

        {COLLECT_SOURCES.map((source) => {
          /*
           * Три режима — три цвета, и серединный нужен именно потому, что
           * «читаем» и «не можем» эту картину не описывают: публикации
           * застройщика в Instagram прочитать технически можно, но за
           * деньги и с оговоркой, поэтому включает их орган, а не система.
           */
          const needsKey = source.accessMode === 'KEY_REQUIRED';
          const manual = source.accessMode === 'MANUAL_ONLY';

          return (
            <div key={source.id} className="card card-nested" style={{ marginTop: 12 }}>
              <div className="row-between">
                <div>
                  <strong>{source.name[locale]}</strong>{' '}
                  <span className="faint">
                    {PLATFORM_LABELS[source.platform as Platform]?.[locale] ?? source.platform}
                  </span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {needsKey ? (
                    <span className={instagramReady ? 'tag tag-ok' : 'tag tag-warn'}>
                      {instagramReady ? t('collectReady') : t('collectNotReady')}
                    </span>
                  ) : null}
                  <span className={manual || needsKey ? 'tag tag-warn' : 'tag tag-ok'}>
                    {SOURCE_ACCESS_MODE_LABELS[source.accessMode][locale]}
                  </span>
                </div>
              </div>

              <p className="faint" style={{ margin: '4px 0 0' }}>
                {SOURCE_ACCESS_MODE_HINTS[source.accessMode][locale]}
              </p>

              <table className="kv" style={{ marginTop: 6 }}>
                <tbody>
                  <tr>
                    <th>{t('collectMethod')}</th>
                    <td>{source.method[locale]}</td>
                  </tr>

                  {source.limitation ? (
                    <tr>
                      <th>{t('collectLimitation')}</th>
                      <td>{source.limitation[locale]}</td>
                    </tr>
                  ) : null}

                  {/*
                   * Цена и оговорка стоят выше слепого пятна: прежде чем
                   * думать, чего источник не покажет, надо знать, что за
                   * него платят и на каком основании его вообще включают.
                   */}
                  {source.cost ? (
                    <tr>
                      <th>{t('collectCost')}</th>
                      <td>{source.cost[locale]}</td>
                    </tr>
                  ) : null}

                  {source.caveat ? (
                    <tr>
                      <th>{t('collectCaveat')}</th>
                      <td>{source.caveat[locale]}</td>
                    </tr>
                  ) : null}

                  {source.blindSpot ? (
                    <tr>
                      <th>{t('collectBlindSpot')}</th>
                      <td>{source.blindSpot[locale]}</td>
                    </tr>
                  ) : null}

                  {source.reference ? (
                    <tr>
                      <th>{t('collectReference')}</th>
                      <td className="mono faint">{source.reference}</td>
                    </tr>
                  ) : null}

                  {needsKey && !instagramReady ? (
                    <tr>
                      <th>{t('collectTokenHowToLabel')}</th>
                      <td>{t('collectTokenHowTo')}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* --- Прогон --------------------------------------------------- */}

      <StartCollectRun
        locale={locale}
        defaultChannel=""
        defaultMinCategories={DEFAULT_COLLECT_RULE.minCategories}
        maxCategories={POSITIVE_CATEGORIES.length}
      />

      {/*
       * Платный прогон стоит ниже бесплатного сознательно. Руки аналитика
       * привыкают к верхней форме, и привычка должна вести к той, которая
       * денег не стоит; к платной нужно спуститься отдельным движением.
       * Потолок, цена за тысячу и значение по умолчанию приходят из ядра —
       * иначе экран и счёт разойдутся.
       */}
      <StartInstagramRun
        locale={locale}
        defaultLimit={DEFAULT_POSTS_LIMIT}
        maxLimit={MAX_POSTS_LIMIT}
        defaultMinCategories={DEFAULT_COLLECT_RULE.minCategories}
        maxCategories={POSITIVE_CATEGORIES.length}
        pricePer1000Usd={APIFY_PRICE_PER_1000_USD}
        keyPresent={instagramReady}
      />

      {/* --- Обход без перечня ----------------------------------------- */}

      {/*
       * Состояние обхода стоит выше списка слов, хотя слова — его настройка.
       * Порядок задан вопросом, с которым аналитик приходит на экран: «идёт
       * ли сбор сам и будет ли идти дальше». Список слов отвечает на второй
       * вопрос — «по чему он ходит», — и читать его имеет смысл, уже зная
       * ответ на первый.
       */}
      <div className="card">
        <div className="row-between">
          <h2 style={{ marginTop: 0 }}>{t('walkTitle')}</h2>
          <span className={scheduler.enabled ? 'tag tag-ok' : 'tag tag-warn'}>
            {t('walkAuto')}: {scheduler.enabled ? t('walkAutoOn') : t('walkAutoOff')}
          </span>
        </div>
        <p className="lead">{t('walkLead')}</p>

        <div className="grid grid-2">
          <table className="kv">
            <tbody>
              {/*
               * У выключенного обхода период назван как «было бы»: сказать
               * «раз в три часа» рядом с пометкой «выключен» значило бы
               * показать два противоречащих утверждения и заставить
               * выяснять, какое из них правда.
               */}
              <tr>
                <th>{scheduler.enabled ? t('walkInterval') : t('walkIntervalDefault')}</th>
                <td className="num">
                  {scheduler.enabled ? scheduler.intervalMinutes : DEFAULT_INTERVAL_MINUTES}
                </td>
              </tr>
              <tr>
                <th>{t('walkLastRun')}</th>
                <td>
                  <When value={scheduler.lastRunAt} />
                </td>
              </tr>
              <tr>
                <th>{t('walkNextRun')}</th>
                <td>
                  <When value={scheduler.nextRunAt} />
                </td>
              </tr>
              <tr>
                <th>{t('walkCycles')}</th>
                <td className="num">{scheduler.cycles}</td>
              </tr>
            </tbody>
          </table>

          <table className="kv">
            <tbody>
              <tr>
                <th>{t('budgetDaily')}</th>
                <td className="mono">{money(dailyBudgetUsd())} $</td>
              </tr>
              <tr>
                <th>{t('budgetSpent')}</th>
                <td className="mono">{money(budget.spentUsd)} $</td>
              </tr>
              <tr>
                <th>{t('budgetRemaining')}</th>
                <td className="mono">{money(budget.remainingUsd)} $</td>
              </tr>
              <tr>
                <th>{t('budgetFits')}</th>
                <td className="num">{budget.affordableResults}</td>
              </tr>
              <tr>
                <th>{t('walkCeiling')}</th>
                <td className="num">{MAX_RESULTS_PER_WALK}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {scheduler.running ? (
          <p className="faint" style={{ marginTop: 6 }}>
            {t('walkRunningNow')}
          </p>
        ) : null}

        {/*
         * Текст решения о деньгах приходит готовым из ядра: там же, где
         * решают, пускать ли прогон. Второй экземпляр этого текста в
         * интерфейсе разошёлся бы с первым на первой же правке предела.
         */}
        <Notice kind={budget.allowed ? 'info' : 'warn'}>
          <strong>{t('budgetTitle')}.</strong> {locale === 'kk' ? budget.note.kk : budget.note.ru}
        </Notice>

        {scheduler.lastError ? (
          <Notice kind="error">
            <strong>{t('walkLastError')}.</strong> {scheduler.lastError}
          </Notice>
        ) : null}

        {scheduler.enabled ? null : (
          <p className="faint" style={{ marginTop: 6 }}>
            {t('walkAutoOffHint')}
          </p>
        )}

        <WalkNow
          locale={locale}
          plannedResults={plannedResults}
          plannedCostUsd={plannedCostUsd}
          allowed={budget.allowed}
        />

        <p className="faint" style={{ marginTop: 6 }}>
          {t('walkNowHint')}
        </p>
        <p className="faint" style={{ marginTop: 0 }}>
          {t('walkPlannedHint')} {t('budgetDayHint')}
        </p>
        <p className="faint" style={{ marginTop: 0 }}>
          {t('budgetChangeHint')}
        </p>

        <table className="kv" style={{ marginTop: 6 }}>
          <tbody>
            {/*
             * Ограничение Telegram названо здесь, а не только в README.
             * Обход по словам работает на Instagram и не работает на
             * Telegram, и аналитик, не знающий этого, будет ждать от обхода
             * новых каналов, которых обход не найдёт.
             */}
            <tr>
              <th>{t('walkTelegramTitle')}</th>
              <td>{t('walkTelegramHint')}</td>
            </tr>
            <tr>
              <th>{t('walkTelegramPerCycle')}</th>
              <td className="num">{MAX_TELEGRAM_CHANNELS_PER_CYCLE}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* --- Слова поиска ---------------------------------------------- */}

      <AddSearchQuery locale={locale} activeCount={activeQueries} maxActive={MAX_ACTIVE_QUERIES} />

      <div className="card">
        <div className="row-between">
          <h2 style={{ marginTop: 0 }}>{t('queriesTitle')}</h2>
          <span className="faint">
            {t('queriesActiveCount')}: {activeQueries} / {MAX_ACTIVE_QUERIES}
          </span>
        </div>
        <p className="lead">{t('queriesLead')}</p>

        {queries.length === 0 ? (
          <Empty text={t('queriesEmpty')} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('queriesTag')}</th>
                <th>{t('queriesGeo')}</th>
                <th>{t('queriesLastWalked')}</th>
                <th className="num">{t('queriesFound')}</th>
                <th>{t('termsState')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queries.map((query) => {
                const note = locale === 'kk' ? query.noteKk : query.noteRu;

                return (
                  <tr key={query.id}>
                    <td>
                      {/*
                       * Слово — ссылка на ту же страницу, которую откроет
                       * обход. Это единственный способ проверить систему
                       * снаружи: аналитик видит глазами то, что увидит
                       * сборщик, и не обязан верить на слово.
                       */}
                      <a
                        className="mono"
                        href={query.exploreUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={t('queriesOpenTagHint')}
                      >
                        <strong>#{query.tag}</strong>
                      </a>
                      {note ? (
                        <div className="faint" style={{ marginTop: 3 }}>
                          {note}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={query.geoAnchored ? 'tag tag-ok' : 'tag tag-warn'}>
                        {query.geoAnchored ? t('queriesGeoYes') : t('queriesGeoNo')}
                      </span>
                    </td>
                    <td>
                      {query.lastWalkedAt ? (
                        <When value={query.lastWalkedAt} />
                      ) : (
                        <span className="faint">{t('queriesNever')}</span>
                      )}
                    </td>
                    <td className="num">{query.lastWalkedAt ? query.lastFound : '—'}</td>
                    <td>
                      <span className={query.active ? 'tag tag-ok' : 'tag'}>
                        {query.active ? t('termsActive') : t('termsOff')}
                      </span>
                    </td>
                    <td>
                      <SearchQueryControls
                        queryId={query.id}
                        active={query.active}
                        locale={locale}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/*
         * Возврат набора стоит под списком, а не рядом с формой добавления:
         * его ищут в двух случаях — когда список пуст и начинать не с чего, и
         * когда видно, что слов стало меньше, чем помнится. Оба раза взгляд
         * уже внизу таблицы.
         */}
        <RestoreDefaultQueries locale={locale} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('collectRuns')}</h2>

        {runs.length === 0 ? (
          <Empty text={t('collectRunsEmpty')} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('collectRunTarget')}</th>
                <th>{t('dateTime')}</th>
                <th className="num">{t('collectFetched')}</th>
                <th className="num">{t('collectKept')}</th>
                <th className="num">{t('collectSkipped')}</th>
                <th className="num">{t('collectThreshold')}</th>
                <th className="num">{t('collectRunCost')}</th>
                <th>{t('actor')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                /*
                 * Прогон, не состоявшийся по решению самой программы, —
                 * такая же строка истории, как сбой, и числа у него такие
                 * же пустые. Нули вместо прочерков читались бы как «обход
                 * прошёл и ничего не нашёл», то есть ровно наоборот: не
                 * нашёл, потому что не ходил.
                 */
                const noNumbers = run.status === 'FAILED' || run.status === 'SKIPPED';

                /*
                 * Обход по словам — не аккаунт, и решётка с собачкой перед
                 * его именем превратили бы служебное имя цели в чьё-то
                 * несуществующее имя пользователя. Поэтому обход назван
                 * своей подписью из словаря, а не значением из базы: иначе
                 * в казахском интерфейсе стояла бы русская строка.
                 */
                const walk = run.target === HASHTAG_WALK_TARGET;

                return (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/collect?runId=${run.id}`}>
                        {walk ? (
                          <strong>{t('walkRunTarget')}</strong>
                        ) : (
                          <strong className="mono">@{run.target}</strong>
                        )}
                      </Link>
                      {run.status === 'FAILED' ? (
                        <div className="tag tag-danger" style={{ marginTop: 3 }}>
                          {run.error ?? 'Прогон не удался'}
                        </div>
                      ) : null}
                      {run.status === 'SKIPPED' ? (
                        <div className="tag tag-warn" style={{ marginTop: 3 }}>
                          {t('collectRunSkipped')}
                        </div>
                      ) : null}
                      {/*
                       * Пометка стоит рядом с именем прочитанного, а не в
                       * отдельном столбце в конце строки: демонстрационный
                       * прогон обязан читаться там же, где читают, что он
                       * прочитал. Иначе образец примут за живой сбор.
                       */}
                      {run.note ? (
                        <div className="faint" style={{ marginTop: 3, fontWeight: 400 }}>
                          {run.note}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <When value={run.startedAt} />
                    </td>
                    <td className="num">{noNumbers ? '—' : run.total}</td>
                    <td className="num">{noNumbers ? '—' : run.kept}</td>
                    <td className="num">{noNumbers ? '—' : run.skipped}</td>
                    <td className="num">{run.minCategories}</td>
                    {/*
                     * У бесплатного прогона прочерк, а не ноль: ноль
                     * читался бы как «платный прогон, который почему-то
                     * ничего не стоил», и сверка со счётом Apify начиналась
                     * бы с выяснения, какие из нулей настоящие.
                     */}
                    <td className="num mono">
                      {run.costUsd > 0 ? `${money(run.costUsd)} $` : '—'}
                    </td>
                    <td className="faint">{run.startedBy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* --- Лента собранного ----------------------------------------- */}

      <FilterForm locale={locale} action="/collect">
        <SelectFilter
          name="verdict"
          label={t('collectVerdict')}
          options={[
            { value: 'KEPT', label: COLLECT_VERDICT_LABELS.KEPT },
            { value: 'SKIPPED', label: COLLECT_VERDICT_LABELS.SKIPPED },
          ]}
          value={params.verdict}
          locale={locale}
          anyLabel={t('all')}
        />
        <CheckboxFilter name="queue" label={t('collectQueueOnly')} checked={queueOnly} />
      </FilterForm>

      <div className="card">
        <div className="row-between">
          <p className="faint" style={{ margin: 0 }}>
            {t('total')}: {feed.total}
          </p>
          <TermLegend locale={locale} />
        </div>

        {feed.items.length === 0 ? (
          <Empty text={t('empty')} />
        ) : (
          feed.items.map((item) => {
            const kept = item.verdict === 'KEPT';
            const decided = item.publicationId !== null || item.dismissedAt !== null;

            return (
              <article key={item.id} className="card card-nested" style={{ marginTop: 12 }}>
                <div className="row-between">
                  <div>
                    <strong className="mono">@{item.channel}</strong>
                    {item.author ? <span className="faint"> · {item.author}</span> : null}
                    <div className="faint">
                      <DateOnly value={item.publishedAt} /> · собрано{' '}
                      <DateOnly value={item.collectedAt} />
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className={kept ? 'tag tag-ok' : 'tag'}>
                      {COLLECT_VERDICT_LABELS[item.verdict as CollectVerdict]?.[locale] ??
                        item.verdict}
                    </span>
                    <span className="tag">
                      {COLLECT_REASON_LABELS[item.reason as CollectReason]?.[locale] ?? item.reason}
                    </span>
                  </div>
                </div>

                {/*
                 * Объяснение стоит выше текста намеренно. Аналитик
                 * открывает ленту не читать объявления, а проверять
                 * работу фильтра: сначала «почему так», потом текст,
                 * в котором это видно.
                 */}
                <Notice kind={kept ? 'info' : 'warn'}>
                  <strong>{t('collectWhy')}.</strong>{' '}
                  {locale === 'kk' ? item.explanation.kk : item.explanation.ru}
                </Notice>

                {item.hits.length > 0 ? (
                  <p className="faint" style={{ margin: '6px 0' }}>
                    {t('collectCaughtBy')}:{' '}
                    {uniqueTerms(item.hits).map((hit, index) => (
                      <span key={`${hit.termText}-${index}`}>
                        {index > 0 ? ' · ' : ''}
                        <span className="mono">«{hit.termText}»</span>{' '}
                        <span className="faint">
                          (
                          {WATCH_TERM_CATEGORY_LABELS[hit.category as WatchTermCategory]?.[
                            locale
                          ] ?? hit.category}
                          )
                        </span>
                      </span>
                    ))}
                  </p>
                ) : null}

                <AdText text={item.text} spans={spansFromHits(item.hits)} />

                <div className="row" style={{ marginTop: 6, gap: 10 }}>
                  {item.url ? (
                    <a className="faint" href={item.url} target="_blank" rel="noreferrer noopener">
                      {t('collectOpenSource')}
                    </a>
                  ) : null}
                </div>

                {/*
                 * Кнопки показываются только у того, что ждёт решения.
                 * Решённое не исчезает со страницы: по нему видно, что
                 * человек с фильтром согласился или не согласился —
                 * ради этого сравнения лента и нужна.
                 */}
                {kept && !decided ? (
                  <CollectedItemDecision itemId={item.id} locale={locale} />
                ) : null}

                {item.publicationId ? (
                  <p className="faint" style={{ marginTop: 8 }}>
                    {t('collectAccepted')}:{' '}
                    <Link href={`/publications/${item.publicationId}`}>{t('open')}</Link>
                  </p>
                ) : null}

                {item.dismissedAt ? (
                  <p className="faint" style={{ marginTop: 8 }}>
                    {t('collectDismissed')} <When value={item.dismissedAt} />
                    {item.dismissedComment ? `: ${item.dismissedComment}` : ''}
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </>
  );
}

/**
 * Одно слово показывается один раз, сколько бы раз оно ни встретилось.
 * Перечень ««квартир*», «квартир*», «квартир*»» не сообщает ничего, кроме
 * длины объявления; подсветка в тексте и так покажет все места.
 */
function uniqueTerms<T extends { termText: string; category: string }>(hits: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const hit of hits) {
    const key = `${hit.category}|${hit.termText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hit);
  }
  return result;
}

/**
 * Деньги в русском и казахском тексте: разделитель — запятая.
 *
 * То же решение, что в ядре (core/collect/budget.ts), и по той же причине:
 * запятая здесь — часть перевода, а не формат числа. «0.27 $» в строке,
 * которую читает аналитик, выглядит обрывком кода, а не суммой.
 *
 * Два знака после запятой — не украшение: дневной предел задаётся в десятых
 * доли доллара, и округление до целого превратило бы и предел, и расход в
 * ноль.
 */
function money(usd: number): string {
  return usd.toFixed(2).replace('.', ',');
}
