/**
 * Карточка объявления — главный экран модуля 3.
 *
 * Здесь выполняется требование ТЗ о подсветке ключевых фраз, и здесь же
 * оно выполняется не так, как просили: подсветок две, и они отличаются на
 * глаз. Пунктир — цитата, на которой держится гипотеза ИИ. Заливка —
 * фрагмент, приложенный аналитиком к фактору как доказательство.
 *
 * Разница не оформительская. Одинаковое выделение означало бы, что машина
 * и человек утверждают одно и то же с одинаковой силой, и проверяющий,
 * читающий объявление, принял бы вопрос за вывод. Подробнее — в заголовке
 * components/AdText.tsx.
 *
 * Текст показан целиком и без обрезки. Подсветка на обрезанном тексте
 * вводит в заблуждение: выделенного фрагмента может не оказаться
 * в показанной части, и аналитик решит, что цитата исчезла.
 *
 * Порядок блоков на странице повторяет порядок работы: прочитать текст,
 * привязать к объекту, рассмотреть гипотезы, посмотреть на связи
 * продавца. Привязка стоит раньше гипотез намеренно — непривязанное
 * объявление не влияет ни на один балл, и работать с его гипотезами
 * бессмысленно, пока неизвестно, к какому объекту они относятся.
 */

import Link from 'next/link';

import {
  LINK_STATUS_LABELS,
  type LinkStatus,
  PLATFORM_LABELS,
  type Platform,
} from '../../../core/domain/enums';
import { translator } from '../../../i18n/dict';
import { getLocale } from '../../../i18n/server';
import { prisma } from '../../../lib/db';
import { orNotFound } from '../../../server/page';
import { listConnections, publicationDetail } from '../../../server/queries';
import { AdText, HighlightLegend, spansFrom } from '../../../components/AdText';
import { SuggestionCard } from '../../../components/SuggestionCard';
import { AnalyzePublication } from '../../../components/actions/AnalyzePublication';
import { LinkPublication, type LinkOption } from '../../../components/actions/LinkPublication';
import { DateOnly, Empty, Notice, PageHeader, When, ZoneTag } from '../../../components/ui';

export const dynamic = 'force-dynamic';

export default async function PublicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const locale = await getLocale();
  const t = translator(locale);
  const { id } = await params;

  const publication = await orNotFound(publicationDetail(prisma, id));

  /**
   * Список объектов для привязки и группы связей читаются параллельно:
   * ни один из них не зависит от другого, а страница должна открываться
   * одним обращением к базе по времени, а не тремя подряд.
   */
  const [projects, connections] = await Promise.all([
    prisma.project.findMany({
      select: { id: true, name: true, nameKk: true, riskZone: true },
      orderBy: { name: 'asc' },
    }),
    listConnections(prisma),
  ]);

  const options: LinkOption[] = projects.map((item) => ({
    id: item.id,
    name: locale === 'kk' && item.nameKk ? item.nameKk : item.name,
  }));

  /**
   * Гипотезы сопоставления берутся из нерассмотренных предложений ИИ,
   * а не из нечёткого поиска на месте: предложение должно быть тем самым,
   * которое лежит в очереди, иначе аналитик увидит в двух местах два
   * разных набора вариантов.
   */
  const suggested = publication.aiSuggestions
    .filter((item) => item.kind === 'PROJECT_MATCH' && item.status === 'PENDING' && item.projectId)
    .map((item) => {
      const payload = readRecord(item.payloadJson);
      const name =
        typeof payload?.projectName === 'string'
          ? payload.projectName
          : (options.find((option) => option.id === item.projectId)?.name ?? 'объект реестра');
      return {
        projectId: item.projectId as string,
        projectName: name,
        score: item.confidence,
        reason: matchedReason(payload),
      };
    });

  const spans = spansFrom({
    suggestions: publication.aiSuggestions,
    evidence: publication.evidence,
  });

  const pending = publication.aiSuggestions.filter((item) => item.status === 'PENDING');
  const reviewed = publication.aiSuggestions.filter((item) => item.status !== 'PENDING');

  /** Группа связей, в которую попало это объявление. Её может не быть. */
  const cluster = connections.items.find((item) => item.publicationIds.includes(publication.id));
  const relatedIds = cluster ? cluster.publicationIds.filter((item) => item !== publication.id) : [];
  const related =
    relatedIds.length > 0
      ? await prisma.publication.findMany({
          where: { id: { in: relatedIds } },
          select: {
            id: true,
            platform: true,
            accountName: true,
            contactPhone: true,
            publishedAt: true,
            project: { select: { slug: true, name: true, riskZone: true } },
          },
          orderBy: { publishedAt: 'desc' },
        })
      : [];

  const platformLabel = PLATFORM_LABELS[publication.platform as Platform];
  const linkLabel = LINK_STATUS_LABELS[publication.linkStatus as LinkStatus];

  return (
    <>
      <PageHeader
        title={platformLabel ? platformLabel[locale] : publication.platform}
        lead={publication.accountName ?? 'Аккаунт не указан'}
        right={
          <Link className="btn no-print" href="/publications">
            {t('back')}
          </Link>
        }
      />

      {!publication.projectId ? (
        <Notice kind="warn">
          <strong>Объявление не привязано к объекту реестра.</strong> Пока связь не установлена,
          найденные в тексте признаки не влияют ни на один балл: неизвестно, о каком объекте идёт
          речь.
        </Notice>
      ) : null}

      <div className="split">
        <div className="card">
          <h2>{t('publicationsText')}</h2>
          <HighlightLegend locale={locale} />
          <AdText text={publication.rawText} spans={spans} />

          <p className="faint">
            {publication.rawText.length} символов · подсвечено фрагментов: {spans.length}
          </p>

          {publication.url ? (
            <p className="faint">
              Источник: <span className="mono">{publication.url}</span>
            </p>
          ) : null}
        </div>

        <div className="card">
          <h2>Сведения о размещении</h2>
          <table className="kv">
            <tbody>
              <tr>
                <th>{t('platform')}</th>
                <td>{platformLabel ? platformLabel[locale] : publication.platform}</td>
              </tr>
              <tr>
                <th>{t('account')}</th>
                <td>{publication.accountName ?? <span className="faint">—</span>}</td>
              </tr>
              <tr>
                <th>{t('phone')}</th>
                <td className="mono">{publication.contactPhone ?? <span className="faint">—</span>}</td>
              </tr>
              <tr>
                <th>{t('published')}</th>
                <td>
                  <DateOnly value={publication.publishedAt} />
                </td>
              </tr>
              <tr>
                <th>Собрано</th>
                <td>
                  <When value={publication.capturedAt} />
                </td>
              </tr>
              <tr>
                <th>Состояние привязки</th>
                <td>
                  {linkLabel ? linkLabel[locale] : publication.linkStatus}
                  {publication.linkConfidence !== null
                    ? ` · ${Math.round(publication.linkConfidence * 100)}%`
                    : null}
                </td>
              </tr>
              <tr>
                <th>{t('publicationsLinked')}</th>
                <td>
                  {publication.project ? (
                    <>
                      <Link href={`/projects/${publication.project.slug}`}>
                        {locale === 'kk' && publication.project.nameKk
                          ? publication.project.nameKk
                          : publication.project.name}
                      </Link>{' '}
                      <ZoneTag zone={publication.project.riskZone} locale={locale} />
                      <div className="faint">
                        {publication.linkedBy ?? 'автор не указан'},{' '}
                        <When value={publication.linkedAt} />
                      </div>
                    </>
                  ) : (
                    <span className="tag tag-warn">не привязано</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <LinkPublication
            publicationId={publication.id}
            locale={locale}
            currentProjectId={publication.projectId}
            projects={options}
            suggested={suggested}
          />
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <h2>{t('analyzeHypotheses')}</h2>
          <span className="faint">
            не рассмотрено: {pending.length} · рассмотрено: {reviewed.length}
          </span>
        </div>

        <Notice kind="info">
          Гипотеза ИИ не начисляет баллов. Согласие с гипотезой создаёт фактор в статусе «требует
          проверки»; балл меняется только после подтверждения фактора с обоснованием и документами
          на карточке объекта.
        </Notice>

        <AnalyzePublication
          publicationId={publication.id}
          locale={locale}
          hasSuggestions={publication.aiSuggestions.length > 0}
        />

        {publication.aiSuggestions.length === 0 ? (
          <Empty text="Объявление ещё не разобрано." />
        ) : (
          <>
            {pending.map((item) => (
              <SuggestionCard key={item.id} suggestion={item} locale={locale} />
            ))}
            {reviewed.length > 0 ? (
              <details className="no-print">
                <summary>
                  {t('suggestionsReviewed')} ({reviewed.length})
                </summary>
                {reviewed.map((item) => (
                  <SuggestionCard key={item.id} suggestion={item} locale={locale} />
                ))}
              </details>
            ) : null}
          </>
        )}
      </div>

      <div className="card">
        <h2>{t('scoringEvidence')}</h2>
        <p className="faint" style={{ marginTop: 0 }}>
          Фрагменты, приложенные аналитиками к факторам риска. Каждый из них подсвечен в тексте
          плотной заливкой.
        </p>

        {publication.evidence.length === 0 ? (
          <Empty text="Из этого объявления ещё не приложено ни одного доказательства." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Фактор</th>
                <th>Фрагмент</th>
                <th>Источник</th>
                <th>Добавлено</th>
              </tr>
            </thead>
            <tbody>
              {publication.evidence.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.factor ? (
                      <span className="tag tag-evidence">{item.factor.code}</span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td>{item.excerpt ?? <span className="faint">без цитаты</span>}</td>
                  <td className="faint">{item.sourceLabel ?? '—'}</td>
                  <td>
                    <When value={item.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="row-between">
          <h2>{t('publicationsConnections')}</h2>
          <Link className="no-print" href="/connections">
            все группы связей
          </Link>
        </div>

        {!cluster ? (
          <Empty text="Другие размещения с тем же телефоном или аккаунтом не найдены." />
        ) : (
          <>
            <p className="faint" style={{ marginTop: 0 }}>
              {t('connectionsBasis')}:{' '}
              {cluster.basis
                .map((item) => (item === 'PHONE' ? t('connectionsBasisPhone') : t('connectionsBasisAccount')))
                .join(', ')}
              {cluster.crossProject ? (
                <>
                  {' · '}
                  <span className="tag tag-warn">{t('connectionsCross')}</span>
                </>
              ) : null}
            </p>

            {related.length === 0 ? (
              <Empty text={t('empty')} />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t('platform')}</th>
                    <th>{t('account')}</th>
                    <th>{t('navProjects')}</th>
                    <th>{t('published')}</th>
                  </tr>
                </thead>
                <tbody>
                  {related.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/publications/${item.id}`}>
                          {PLATFORM_LABELS[item.platform as Platform]?.[locale] ?? item.platform}
                        </Link>
                      </td>
                      <td>
                        {item.accountName ?? <span className="faint">—</span>}
                        <div className="faint mono">{item.contactPhone ?? '—'}</div>
                      </td>
                      <td>
                        {item.project ? (
                          <>
                            <Link href={`/projects/${item.project.slug}`}>{item.project.name}</Link>{' '}
                            <ZoneTag zone={item.project.riskZone} locale={locale} />
                          </>
                        ) : (
                          <span className="tag tag-warn">не привязано</span>
                        )}
                      </td>
                      <td>
                        <DateOnly value={item.publishedAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="faint">
              Совпадение телефона или имени аккаунта само по себе нарушением не является: агентство
              вправе работать с несколькими застройщиками. Это повод посмотреть на размещения
              вместе.
            </p>
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function readRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Основание гипотезы сопоставления человеческими словами.
 *
 * «совпало название и телефон» объясняет предложение; «NAME, PHONE» —
 * нет. Аналитик решает по основанию, а не по проценту: совпадение одного
 * названия у двух объектов одного застройщика бывает случайным,
 * совпадение телефона — почти никогда.
 */
function matchedReason(payload: Record<string, unknown> | null): string {
  if (!payload) return 'основание не указано';

  const matched = Array.isArray(payload.matchedOn)
    ? payload.matchedOn.filter((item): item is string => typeof item === 'string')
    : [];

  if (matched.length === 0) {
    const rationale = payload.rationale;
    if (typeof rationale === 'object' && rationale !== null && 'ru' in rationale) {
      const ru = (rationale as { ru?: unknown }).ru;
      if (typeof ru === 'string') return ru;
    }
    return 'основание не указано';
  }

  const words = matched.map((item) =>
    item === 'NAME'
      ? 'название'
      : item === 'ADDRESS'
        ? 'адрес'
        : item === 'PHONE'
          ? 'телефон'
          : item === 'DEVELOPER'
            ? 'застройщик'
            : item,
  );

  return `совпало: ${words.join(', ')}`;
}
