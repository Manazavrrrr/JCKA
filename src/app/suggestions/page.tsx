/**
 * Очередь гипотез ИИ.
 *
 * Экран существует не для удобства, а чтобы ответить на вопрос, который
 * задают системам с машинным разбором первым: сколько раз она ошиблась.
 *
 * Поэтому очередь показывает не только нерассмотренное. Фильтр по
 * состоянию позволяет открыть отклонённые гипотезы и прочитать их
 * подряд — а это ровно та картина, по которой видно, где правила
 * срабатывают не на том. Очередь, из которой отклонённые исчезают,
 * выглядит безупречной и ничего не даёт улучшить.
 *
 * По умолчанию открыты нерассмотренные и упорядочены по уверенности:
 * начинать разбор разумнее с того, в чём разбор уверен, — такие гипотезы
 * решаются быстрее и освобождают внимание для сомнительных.
 *
 * Решение по гипотезе принимается здесь же, не открывая объявление. Это
 * сознательный размен: цитата в карточке показана, и для гипотез вроде
 * «оплата на личную карту» её достаточно. Ссылка на объявление рядом —
 * для случаев, когда нужен весь текст.
 */

import Link from 'next/link';

import {
  SUGGESTION_KINDS,
  SUGGESTION_KIND_LABELS,
  SUGGESTION_STATUSES,
  SUGGESTION_STATUS_LABELS,
} from '../../core/domain/enums';
import { translator } from '../../i18n/dict';
import { getLocale } from '../../i18n/server';
import { prisma } from '../../lib/db';
import { listSuggestions } from '../../server/queries';
import { FilterForm, SelectFilter, optionsFrom } from '../../components/Filters';
import { SuggestionCard } from '../../components/SuggestionCard';
import { Empty, PageHeader, Stat } from '../../components/ui';

export const dynamic = 'force-dynamic';

type Params = {
  status?: string;
  kind?: string;
  projectId?: string;
};

export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const locale = await getLocale();
  const t = translator(locale);
  const params = await searchParams;

  /**
   * Отсутствие параметра и пустой параметр значат разное.
   *
   * Экран открыт впервые (параметра нет) — показываются нерассмотренные:
   * очередь открывают, чтобы работать. Аналитик выбрал «Все» в фильтре —
   * форма отправляет пустое значение, и ограничение снимается. Без этого
   * различения «Все» невозможно было бы выбрать: пустое значение
   * возвращало бы к состоянию по умолчанию.
   */
  const status = params.status === undefined ? 'PENDING' : params.status;

  const [page, pendingCount, acceptedCount, rejectedCount] = await Promise.all([
    listSuggestions(prisma, {
      status: status ? ([status] as never) : undefined,
      kind: params.kind ? [params.kind] : undefined,
      projectId: params.projectId || undefined,
      limit: 60,
      offset: 0,
    }),
    prisma.aiSuggestion.count({ where: { status: 'PENDING' } }),
    prisma.aiSuggestion.count({ where: { status: 'ACCEPTED' } }),
    prisma.aiSuggestion.count({ where: { status: 'REJECTED' } }),
  ]);

  return (
    <>
      <PageHeader title={t('suggestionsTitle')} lead={t('suggestionsLead')} />

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <Stat value={pendingCount} label={t('suggestionsPending')} href="/suggestions" />
        <Stat
          value={acceptedCount}
          label={SUGGESTION_STATUS_LABELS.ACCEPTED[locale]}
          href="/suggestions?status=ACCEPTED"
        />
        <Stat
          value={rejectedCount}
          label={SUGGESTION_STATUS_LABELS.REJECTED[locale]}
          href="/suggestions?status=REJECTED"
        />
      </div>

      <div className="notice notice-info">
        <strong>Согласие с гипотезой не начисляет баллов.</strong> Оно создаёт у объекта фактор
        в статусе «требует проверки». Баллы появляются только после подтверждения фактора
        с обоснованием и документами — на карточке объекта.
      </div>

      <FilterForm locale={locale} action="/suggestions">
        <SelectFilter
          name="status"
          label="Состояние"
          options={optionsFrom(SUGGESTION_STATUSES, SUGGESTION_STATUS_LABELS)}
          value={status}
          locale={locale}
          anyLabel={t('all')}
        />
        <SelectFilter
          name="kind"
          label="Вид гипотезы"
          options={optionsFrom(SUGGESTION_KINDS, SUGGESTION_KIND_LABELS)}
          value={params.kind}
          locale={locale}
          anyLabel={t('all')}
        />
      </FilterForm>

      <div className="card">
        <p className="faint" style={{ marginTop: 0 }}>
          {t('total')}: {page.total}
        </p>

        {page.items.length === 0 ? (
          <Empty text={t('empty')} />
        ) : (
          page.items.map((item) => (
            <div key={item.id}>
              {item.project ? (
                <p className="faint">
                  Объект: <Link href={`/projects/${item.project.slug}`}>{item.project.name}</Link>
                </p>
              ) : (
                <p className="faint">
                  Объявление не привязано к объекту — согласие с гипотезой не создаст фактор.
                </p>
              )}
              <SuggestionCard suggestion={item} locale={locale} showPublicationLink />
            </div>
          ))
        )}
      </div>
    </>
  );
}
