/**
 * Загрузка демонстрационного набора данных.
 *
 *   npm run db:seed     — загрузить поверх существующей БД
 *   npm run db:reset    — пересоздать схему и загрузить заново
 *
 * Сид самопроверяющийся. Он не просто записывает строки, а:
 *   1) ищет каждый фрагмент-доказательство в тексте публикации дословно
 *      и падает с ошибкой, если фрагмент не найден — офсеты подсветки
 *      невозможно рассинхронизировать с текстом;
 *   2) считает балл и зону движком скоринга из src/core/scoring/model.ts
 *      и сверяет с ожиданием, записанным в наборе данных вручную.
 *      Расхождение останавливает загрузку.
 *
 * То есть успешная загрузка сида — уже доказательство, что формула и
 * контрольные сценарии A, B и C из ТЗ сходятся.
 */

import { PrismaClient } from '@prisma/client';

import {
  DEFAULT_COLLECT_RULE,
  DEFAULT_SEARCH_QUERIES,
  DEFAULT_WATCH_TERMS,
  INSTAGRAM_SOURCE_ID,
  runCollection,
  type RawItem,
  type WatchTerm,
} from '../src/core/collect';
import type { FactorCode, RiskZone } from '../src/core/domain/enums';
import { compareFields, findRegistrySource, reconcile } from '../src/core/registry';
import { computeScore, resolveZone, sortFactorCodes } from '../src/core/scoring/model';
import {
  COLLECT_DEMO_CHANNEL,
  DEMO_ANALYST,
  DEMO_SUPERVISOR,
  collectFeed,
  developers,
  projects,
  publications,
  registryChecks,
  type SeedEvidence,
  type SeedFactor,
  type SeedProject,
} from './seed-data';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/** Явная ошибка данных: сид обязан падать, а не записывать мусор. */
class SeedDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedDataError';
  }
}

/**
 * Находит дословный фрагмент в тексте публикации и возвращает офсеты.
 * Падает, если фрагмент отсутствует или встречается неоднозначно.
 */
function locateFragment(
  rawText: string,
  fragment: string,
  context: string,
): { charStart: number; charEnd: number } {
  const charStart = rawText.indexOf(fragment);
  if (charStart < 0) {
    throw new SeedDataError(
      `${context}: фрагмент-доказательство не найден в тексте публикации.\n` +
        `  Искали: "${fragment}"\n` +
        `  В тексте: "${rawText.slice(0, 120)}..."`,
    );
  }
  return { charStart, charEnd: charStart + fragment.length };
}

function toDate(value: string | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

/** Коды факторов, которые реально начисляют баллы. */
function confirmedCodes(factors: SeedFactor[]): FactorCode[] {
  return sortFactorCodes(
    factors.filter((factor) => factor.status === 'CONFIRMED').map((factor) => factor.code),
  );
}

// ---------------------------------------------------------------------------
// Очистка
// ---------------------------------------------------------------------------

async function clearDatabase(): Promise<void> {
  // Порядок важен: сначала зависимые таблицы.
  await prisma.registryCheck.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.scoreSnapshot.deleteMany();
  await prisma.signal.deleteMany();
  await prisma.aiSuggestion.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.riskFactor.deleteMany();
  await prisma.appeal.deleteMany();
  await prisma.collectedItem.deleteMany();
  await prisma.collectRun.deleteMany();
  await prisma.watchTerm.deleteMany();
  await prisma.searchQuery.deleteMany();
  await prisma.publication.deleteMany();
  await prisma.project.deleteMany();
  await prisma.developer.deleteMany();
}

// ---------------------------------------------------------------------------
// Загрузка
// ---------------------------------------------------------------------------

async function seedDevelopers(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const developer of developers) {
    const created = await prisma.developer.create({
      data: {
        name: developer.name,
        nameKk: developer.nameKk,
        bin: developer.bin,
        phone: developer.phone,
        isDemo: true,
      },
    });
    ids.set(developer.key, created.id);
  }
  return ids;
}

async function seedProjects(developerIds: Map<string, string>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const project of projects) {
    const developerId = developerIds.get(project.developerKey);
    if (!developerId) {
      throw new SeedDataError(
        `Объект "${project.key}": не найден застройщик с ключом "${project.developerKey}".`,
      );
    }

    const created = await prisma.project.create({
      data: {
        slug: project.slug,
        name: project.name,
        nameKk: project.nameKk,
        address: project.address,
        addressKk: project.addressKk,
        lat: project.lat,
        lng: project.lng,
        developerId,
        stage: project.stage,
        plannedCompletionAt: toDate(project.plannedCompletionAt),
        actualDelayDays: project.actualDelayDays,
        declaredReadinessPct: project.declaredReadinessPct,
        declaredReadinessSource: project.declaredReadinessSource,
        declaredReadinessAt: toDate(project.declaredReadinessAt),
        verifiedReadinessPct: project.verifiedReadinessPct,
        verifiedReadinessSource: project.verifiedReadinessSource,
        verifiedReadinessAt: toDate(project.verifiedReadinessAt),
        legalBasisStatus: project.legalBasisStatus,
        legalBasisType: project.legalBasisType,
        legalBasisSource: project.legalBasisSource,
        legalBasisCheckedAt: toDate(project.legalBasisCheckedAt),
        legalBasisCheckedBy: project.legalBasisCheckedBy,
        legalBasisNote: project.legalBasisNote,
        // Балл проставляется ниже, после расчёта движком скоринга.
        riskScore: 0,
        riskZone: 'GREEN',
        isDemo: true,
      },
    });
    ids.set(project.key, created.id);
  }
  return ids;
}

async function seedPublications(
  projectIds: Map<string, string>,
): Promise<Map<string, { id: string; rawText: string }>> {
  const result = new Map<string, { id: string; rawText: string }>();

  for (const publication of publications) {
    let projectId: string | null = null;
    if (publication.projectKey) {
      projectId = projectIds.get(publication.projectKey) ?? null;
      if (!projectId) {
        throw new SeedDataError(
          `Публикация "${publication.key}": не найден объект "${publication.projectKey}".`,
        );
      }
    }

    const created = await prisma.publication.create({
      data: {
        projectId,
        platform: publication.platform,
        accountName: publication.accountName,
        accountUrl: publication.accountUrl,
        contactPhone: publication.contactPhone,
        url: publication.url,
        publishedAt: toDate(publication.publishedAt),
        capturedAt: new Date(publication.capturedAt),
        rawText: publication.rawText,
        linkStatus: publication.linkStatus,
        linkConfidence: publication.linkConfidence,
        linkedBy: publication.linkedBy,
        linkedAt: toDate(publication.linkedAt),
        isDemo: true,
      },
    });

    result.set(publication.key, { id: created.id, rawText: publication.rawText });
  }

  return result;
}

async function seedEvidence(
  factorId: string,
  evidenceList: SeedEvidence[],
  pubs: Map<string, { id: string; rawText: string }>,
  context: string,
): Promise<void> {
  for (const item of evidenceList) {
    let publicationId: string | null = null;
    let charStart: number | undefined;
    let charEnd: number | undefined;

    if (item.publicationKey) {
      const publication = pubs.get(item.publicationKey);
      if (!publication) {
        throw new SeedDataError(
          `${context}: доказательство ссылается на неизвестную публикацию "${item.publicationKey}".`,
        );
      }
      publicationId = publication.id;

      if (item.fragment) {
        const offsets = locateFragment(publication.rawText, item.fragment, context);
        charStart = offsets.charStart;
        charEnd = offsets.charEnd;
      }
    }

    await prisma.evidence.create({
      data: {
        factorId,
        publicationId,
        kind: item.kind,
        excerpt: item.fragment,
        charStart,
        charEnd,
        sourceLabel: item.sourceLabel,
        sourceUrl: item.sourceUrl,
        capturedAt: new Date(item.capturedAt),
        note: item.note,
      },
    });
  }
}

async function seedFactorsAndEvidence(
  project: SeedProject,
  projectId: string,
  pubs: Map<string, { id: string; rawText: string }>,
): Promise<void> {
  const seen = new Set<FactorCode>();

  for (const factor of project.factors) {
    if (seen.has(factor.code)) {
      throw new SeedDataError(
        `Объект "${project.key}": фактор ${factor.code} описан более одного раза.`,
      );
    }
    seen.add(factor.code);

    if (factor.status === 'CONFIRMED' && !factor.confirmedBy) {
      throw new SeedDataError(
        `Объект "${project.key}", фактор ${factor.code}: подтверждённый фактор обязан иметь автора решения.`,
      );
    }

    const created = await prisma.riskFactor.create({
      data: {
        projectId,
        code: factor.code,
        status: factor.status,
        origin: factor.origin,
        rationale: factor.rationale,
        confirmedBy: factor.confirmedBy,
        confirmedAt: toDate(factor.confirmedAt),
      },
    });

    if (factor.evidence?.length) {
      await seedEvidence(
        created.id,
        factor.evidence,
        pubs,
        `Объект "${project.key}", фактор ${factor.code}`,
      );
    }
  }
}

async function seedAppeals(project: SeedProject, projectId: string): Promise<void> {
  for (const appeal of project.appeals ?? []) {
    await prisma.appeal.create({
      data: {
        projectId,
        registeredAt: new Date(appeal.registeredAt),
        signatories: appeal.signatories,
        status: appeal.status,
        reference: appeal.reference,
        summary: appeal.summary,
        isDemo: true,
      },
    });
  }
}

/**
 * Считает балл движком скоринга и сверяет его с ожиданием из ТЗ.
 * Возвращает рассчитанные значения для записи в карточку объекта.
 */
function scoreAndVerify(project: SeedProject): { score: number; zone: RiskZone; codes: FactorCode[] } {
  const codes = confirmedCodes(project.factors);
  const score = computeScore(codes);
  const zone = resolveZone(score, codes);

  if (score !== project.expectedScore || zone !== project.expectedZone) {
    throw new SeedDataError(
      `Объект "${project.key}": расчёт не совпал с ожиданием из ТЗ.\n` +
        `  Подтверждённые факторы: ${codes.join(' + ') || '—'}\n` +
        `  Рассчитано: ${score} баллов, зона ${zone}\n` +
        `  Ожидалось:  ${project.expectedScore} баллов, зона ${project.expectedZone}`,
    );
  }

  return { score, zone, codes };
}

/**
 * Восстанавливает историю изменения риска, проигрывая подтверждения факторов
 * в хронологическом порядке. Даёт осмысленный график динамики в карточке.
 */
async function seedScoreHistory(
  project: SeedProject,
  projectId: string,
  createdAtBase: Date,
): Promise<void> {
  await prisma.scoreSnapshot.create({
    data: {
      projectId,
      score: 0,
      zone: 'GREEN',
      factorCodesJson: JSON.stringify([]),
      reason: 'Объект поставлен на мониторинг, факторы не зафиксированы',
      createdAt: createdAtBase,
    },
  });

  const timeline = project.factors
    .filter((factor) => factor.status === 'CONFIRMED' && factor.confirmedAt)
    .sort((a, b) => new Date(a.confirmedAt!).getTime() - new Date(b.confirmedAt!).getTime());

  const accumulated: FactorCode[] = [];
  for (const factor of timeline) {
    accumulated.push(factor.code);
    const codes = sortFactorCodes(accumulated);
    const score = computeScore(codes);
    const zone = resolveZone(score, codes);

    await prisma.scoreSnapshot.create({
      data: {
        projectId,
        score,
        zone,
        factorCodesJson: JSON.stringify(codes),
        reason: `Подтверждён фактор ${factor.code} (+${score - computeScore(codes.filter((c) => c !== factor.code))})`,
        createdAt: new Date(factor.confirmedAt!),
      },
    });

    await prisma.auditLog.create({
      data: {
        entityType: 'RiskFactor',
        entityId: `${project.slug}:${factor.code}`,
        action: 'FACTOR_CONFIRMED',
        actor: factor.confirmedBy ?? DEMO_ANALYST,
        afterJson: JSON.stringify({ code: factor.code, status: 'CONFIRMED', score, zone }),
        comment: factor.rationale,
        createdAt: new Date(factor.confirmedAt!),
      },
    });
  }
}

/**
 * Сигнальные карточки в трёх состояниях, чтобы модуль 05 был наполнен сразу:
 * черновик, подтверждённый сигнал и возвращённый на доработку.
 */
async function seedSignals(projectIds: Map<string, string>): Promise<void> {
  const buildFactorsSnapshot = (project: SeedProject) =>
    JSON.stringify(
      project.factors.map((factor) => ({
        code: factor.code,
        status: factor.status,
        origin: factor.origin,
        rationale: factor.rationale,
        evidenceCount: factor.evidence?.length ?? 0,
      })),
    );

  const byKey = (key: string): SeedProject => {
    const project = projects.find((item) => item.key === key);
    if (!project) throw new SeedDataError(`Не найден объект "${key}" для сигнальной карточки.`);
    return project;
  };

  const drafts: Array<{
    key: string;
    status: 'DRAFT' | 'CONFIRMED' | 'RETURNED';
    summary: string;
    createdAt: string;
    reviewedBy?: string;
    reviewedAt?: string;
    reviewComment?: string;
  }> = [
    {
      key: 'ertis-sarayy',
      status: 'DRAFT',
      summary:
        'Установлено отсутствие применимого правового основания при одновременном предложении внести депозит 10% и активной рекламе на стадии котлована. Требуется решение по направлению материалов на углублённую проверку.',
      createdAt: '2026-08-26T10:00:00.000Z',
    },
    {
      key: 'samal-towers',
      status: 'CONFIRMED',
      summary:
        'Подтверждены отсутствие правового основания, два независимых условия внесения денег и просрочка срока ввода более четырёх месяцев. Материалы проверены аналитиком.',
      createdAt: '2026-09-30T07:00:00.000Z',
      reviewedBy: DEMO_SUPERVISOR,
      reviewedAt: '2026-10-01T04:30:00.000Z',
      reviewComment: 'Факторы и доказательства проверены, сигнал подтверждён.',
    },
    {
      key: 'grand-ertis',
      status: 'RETURNED',
      summary:
        'Балл 75 при отсутствии подтверждённого R2. Зона жёлтая. Возвращено для дополнительной проверки рекламных размещений по объекту.',
      createdAt: '2026-09-22T08:00:00.000Z',
      reviewedBy: DEMO_SUPERVISOR,
      reviewedAt: '2026-09-23T05:15:00.000Z',
      reviewComment:
        'Проверить размещения в мессенджерах за июль–август: возможны публикации с условиями оплаты, не попавшие в ленту.',
    },
  ];

  for (const draft of drafts) {
    const project = byKey(draft.key);
    const projectId = projectIds.get(draft.key)!;
    const codes = confirmedCodes(project.factors);

    const signal = await prisma.signal.create({
      data: {
        projectId,
        score: computeScore(codes),
        zone: resolveZone(computeScore(codes), codes),
        factorsJson: buildFactorsSnapshot(project),
        summary: draft.summary,
        status: draft.status,
        createdBy: DEMO_ANALYST,
        createdAt: new Date(draft.createdAt),
        reviewedBy: draft.reviewedBy,
        reviewedAt: toDate(draft.reviewedAt),
        reviewComment: draft.reviewComment,
      },
    });

    await prisma.auditLog.create({
      data: {
        entityType: 'Signal',
        entityId: signal.id,
        action: 'SIGNAL_CREATED',
        actor: DEMO_ANALYST,
        afterJson: JSON.stringify({ status: 'DRAFT', score: signal.score, zone: signal.zone }),
        createdAt: new Date(draft.createdAt),
      },
    });

    if (draft.status !== 'DRAFT' && draft.reviewedAt) {
      await prisma.auditLog.create({
        data: {
          entityType: 'Signal',
          entityId: signal.id,
          action: draft.status === 'CONFIRMED' ? 'SIGNAL_CONFIRMED' : 'SIGNAL_RETURNED',
          actor: draft.reviewedBy ?? DEMO_SUPERVISOR,
          beforeJson: JSON.stringify({ status: 'DRAFT' }),
          afterJson: JSON.stringify({ status: draft.status }),
          comment: draft.reviewComment,
          createdAt: new Date(draft.reviewedAt),
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Слой сбора
// ---------------------------------------------------------------------------

/**
 * Слова-ловушки из набора по умолчанию.
 *
 * Набор лежит в src/core/collect/defaults.ts и оттуда же берётся кнопкой
 * «вернуть набор по умолчанию». Второй копии списка в проекте нет.
 */
async function seedWatchTerms(): Promise<WatchTerm[]> {
  const created: WatchTerm[] = [];

  for (const term of DEFAULT_WATCH_TERMS) {
    const row = await prisma.watchTerm.create({
      data: {
        category: term.category,
        language: term.language,
        text: term.text,
        active: term.active,
        noteRu: term.note?.ru ?? null,
        noteKk: term.note?.kk ?? null,
        createdBy: DEMO_ANALYST,
      },
    });

    created.push({
      id: row.id,
      category: term.category,
      language: term.language,
      text: row.text,
      active: row.active,
      note: term.note ?? null,
    });
  }

  return created;
}

/**
 * Поисковые слова из набора по умолчанию.
 *
 * Второй копии списка в проекте нет: он лежит в src/core/collect/discovery.ts
 * и оттуда же берётся кнопкой «вернуть набор по умолчанию». Последний обход
 * не проставляется — ни по одному слову ещё не ходили, и выдавать обратное
 * было бы той же подменой, против которой построен весь слой сбора.
 */
async function seedSearchQueries(): Promise<{ total: number; active: number }> {
  for (const query of DEFAULT_SEARCH_QUERIES) {
    await prisma.searchQuery.create({
      data: {
        sourceId: INSTAGRAM_SOURCE_ID,
        tag: query.tag,
        active: query.active,
        noteRu: query.note.ru,
        noteKk: query.note.kk,
        createdBy: DEMO_ANALYST,
      },
    });
  }

  return {
    total: DEFAULT_SEARCH_QUERIES.length,
    active: DEFAULT_SEARCH_QUERIES.filter((query) => query.active).length,
  };
}

/**
 * Демонстрационный прогон по публичному каналу.
 *
 * Прогон выполняется тем же кодом, что и настоящий сбор: лента из
 * seed-data прогоняется через runCollection, и в базу ложится то, что
 * вернуло ядро. Никаких заранее написанных вердиктов — иначе демонстрация
 * показывала бы не работу системы, а аккуратно набранный текст.
 *
 * Ожидания из набора данных сверяются с результатом, и расхождение
 * останавливает загрузку. Это даёт то же свойство, что и проверка баллов:
 * успешный сид доказывает, что слой сбора работает, а не просто заполнен.
 */
async function seedCollectRun(terms: WatchTerm[]): Promise<{ total: number; kept: number }> {
  const items: RawItem[] = collectFeed.map((entry) => ({
    sourceId: 'telegram-public',
    externalId: entry.externalId,
    text: entry.rawText,
    url: entry.url,
    author: entry.author,
    publishedAt: entry.publishedAt,
  }));

  const result = runCollection(items, terms, { rule: DEFAULT_COLLECT_RULE });

  for (const [index, collected] of result.items.entries()) {
    const expected = collectFeed[index]!;

    if (
      collected.decision.verdict !== expected.expect.verdict ||
      collected.decision.reason !== expected.expect.reason
    ) {
      throw new SeedDataError(
        `Элемент ленты ${expected.externalId}: ожидалось ` +
          `${expected.expect.verdict}/${expected.expect.reason}, ` +
          `слой сбора вернул ${collected.decision.verdict}/${collected.decision.reason}.\n` +
          `  Текст: ${expected.rawText.slice(0, 80)}…\n` +
          `  Пояснение системы: ${collected.decision.explanation.ru}`,
      );
    }
  }

  const startedAt = new Date('2026-10-10T14:00:00.000Z');
  const finishedAt = new Date('2026-10-10T14:00:12.000Z');

  const run = await prisma.collectRun.create({
    data: {
      sourceId: 'telegram-public',
      target: COLLECT_DEMO_CHANNEL,
      startedAt,
      finishedAt,
      status: 'OK',
      minCategories: DEFAULT_COLLECT_RULE.minCategories,
      total: result.stats.total,
      kept: result.stats.kept,
      skipped: result.stats.skipped,
      statsJson: JSON.stringify(result.stats.termUsage),
      startedBy: DEMO_ANALYST,
    },
  });

  for (const collected of result.items) {
    await prisma.collectedItem.create({
      data: {
        runId: run.id,
        sourceId: collected.sourceId,
        externalId: collected.externalId,
        url: collected.url,
        author: collected.author,
        publishedAt: collected.publishedAt ? new Date(collected.publishedAt) : null,
        rawText: collected.text,
        fingerprint: collected.fingerprint,
        verdict: collected.decision.verdict,
        reason: collected.decision.reason,
        explanationRu: collected.decision.explanation.ru,
        explanationKk: collected.decision.explanation.kk,
        // Позиции и цитаты сохраняются вместе с решением: подсветка в карточке
        // должна работать и после того, как слово-ловушку переименуют.
        hitsJson: JSON.stringify(
          [...collected.decision.hits, ...collected.decision.excludedBy].map((hit) => ({
            termId: hit.termId,
            termText: hit.termText,
            category: hit.category,
            fragment: hit.fragment,
            charStart: hit.charStart,
            charEnd: hit.charEnd,
            quote: hit.quote,
          })),
        ),
        createdAt: finishedAt,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      entityType: 'CollectRun',
      entityId: run.id,
      action: 'COLLECT_RUN_FINISHED',
      actor: DEMO_ANALYST,
      afterJson: JSON.stringify({
        sourceId: 'telegram-public',
        target: COLLECT_DEMO_CHANNEL,
        total: result.stats.total,
        kept: result.stats.kept,
        skipped: result.stats.skipped,
      }),
      comment: `Прогон по каналу ${COLLECT_DEMO_CHANNEL}: взято ${result.stats.kept} из ${result.stats.total}.`,
      createdAt: finishedAt,
    },
  });

  return { total: result.stats.total, kept: result.stats.kept };
}

// ---------------------------------------------------------------------------
// Проверки в реестрах
// ---------------------------------------------------------------------------

/**
 * Загружает демонстрационные проверки и попутно сверяет сам набор.
 *
 * Сверка здесь не формальность. Вердикты строк и отношение к фактору R1
 * не переписываются из набора руками, а считаются теми же функциями
 * src/core/registry/check.ts, которыми их будет считать приложение.
 * Поэтому если кто-нибудь однажды сделает так, что ответ «записи нет»
 * начнёт начислять R1, сид это покажет сразу — на нём стоит проверка.
 */
async function seedRegistryChecks(
  developerIds: Map<string, string>,
  projectIds: Map<string, string>,
): Promise<{ total: number; withdrawals: number; disagreements: number }> {
  let withdrawals = 0;
  let disagreements = 0;

  for (const check of registryChecks) {
    const source = findRegistrySource(check.sourceId);
    if (source === null) {
      throw new SeedDataError(
        `Проверка ${check.key} ссылается на источник «${check.sourceId}», которого нет в каталоге src/core/registry/sources.ts.`,
      );
    }

    // Источник, который читается только глазами, не может быть отмечен
    // как машинная проверка: иначе на экране появится ложное «автоматически».
    if (source.accessMode === 'WEB_ONLY' && !check.manual) {
      throw new SeedDataError(
        `Проверка ${check.key} по источнику «${check.sourceId}» помечена как автоматическая, но источник читается только вручную.`,
      );
    }

    const developerId = developerIds.get(check.developerKey);
    if (developerId === undefined) {
      throw new SeedDataError(
        `Проверка ${check.key} ссылается на застройщика «${check.developerKey}», которого нет в наборе.`,
      );
    }

    const developer = developers.find((item) => item.key === check.developerKey);

    let projectId: string | null = null;
    if (check.projectKey !== undefined) {
      projectId = projectIds.get(check.projectKey) ?? null;
      if (projectId === null) {
        throw new SeedDataError(
          `Проверка ${check.key} ссылается на объект «${check.projectKey}», которого нет в наборе.`,
        );
      }
    }

    const rows = (check.comparison ?? []).map((row) => ({
      key: row.key,
      label: { ru: row.labelRu, kk: row.labelKk },
      declared: row.declared,
      registry: row.registry,
    }));

    const result = reconcile(check.sourceId, check.answer, rows);

    // Проверка набора: ответ «записи нет» и недоступность службы не имеют
    // права снимать или начислять что-либо по R1.
    if (check.answer !== 'FOUND' && result.bearingOnR1 !== 'NO_BEARING') {
      throw new SeedDataError(
        `Проверка ${check.key}: ответ «${check.answer}» не должен влиять на фактор R1.`,
      );
    }
    if (result.bearingOnR1 === 'WITHDRAWS_R1') withdrawals += 1;
    disagreements += result.disagreements;

    await prisma.registryCheck.create({
      data: {
        sourceId: check.sourceId,
        developerId,
        projectId,
        bin: developer?.bin ?? null,
        requestUrl: check.requestUrl ?? null,
        requestJson: check.requestJson ?? null,
        answer: check.answer,
        responseJson: check.responseJson ?? null,
        error: check.error ?? null,
        comparisonJson:
          result.fields.length > 0 ? JSON.stringify(compareFields(rows)) : null,
        disagreements: result.disagreements,
        bearingOnR1: result.bearingOnR1,
        manual: check.manual,
        attachment: check.attachment ?? null,
        note: check.note,
        checkedAt: new Date(check.checkedAt),
        checkedBy: check.checkedBy,
        isDemo: true,
      },
    });
  }

  return { total: registryChecks.length, withdrawals, disagreements };
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('SAQ QURYLYS · загрузка демонстрационных данных\n');

  await clearDatabase();

  const developerIds = await seedDevelopers();
  console.log(`  застройщики: ${developerIds.size}`);

  const projectIds = await seedProjects(developerIds);
  const pubs = await seedPublications(projectIds);
  console.log(`  публикации:  ${pubs.size}`);

  const watchTerms = await seedWatchTerms();
  const queries = await seedSearchQueries();
  const collect = await seedCollectRun(watchTerms);
  console.log(`  сбор:        ${watchTerms.length} слов-ловушек, взято ${collect.kept} из ${collect.total}`);
  console.log(`  поиск:       ${queries.total} запросов, из них включено ${queries.active}`);

  const rows: string[] = [];

  for (const project of projects) {
    const projectId = projectIds.get(project.key)!;

    await seedFactorsAndEvidence(project, projectId, pubs);
    await seedAppeals(project, projectId);

    // Балл считает движок скоринга, затем результат сверяется с ожиданием ТЗ.
    const { score, zone, codes } = scoreAndVerify(project);

    await prisma.project.update({
      where: { id: projectId },
      data: { riskScore: score, riskZone: zone, scoredAt: new Date() },
    });

    await seedScoreHistory(project, projectId, new Date('2026-07-01T00:00:00.000Z'));

    const scenario = project.scenario ? `сценарий ${project.scenario}` : '—';
    rows.push(
      [
        project.name.padEnd(22),
        String(score).padStart(3),
        zone.padEnd(6),
        (codes.join('+') || '—').padEnd(17),
        scenario,
      ].join('  '),
    );
  }

  await seedSignals(projectIds);

  const registry = await seedRegistryChecks(developerIds, projectIds);
  console.log(
    `  реестры:     ${registry.total} проверок, из них снимают R1: ${registry.withdrawals}, расхождений в сверке: ${registry.disagreements}`,
  );

  const counts = {
    objects: await prisma.project.count(),
    publications: await prisma.publication.count(),
    unlinked: await prisma.publication.count({ where: { linkStatus: 'UNLINKED' } }),
    factors: await prisma.riskFactor.count(),
    confirmedFactors: await prisma.riskFactor.count({ where: { status: 'CONFIRMED' } }),
    needsCheck: await prisma.riskFactor.count({ where: { status: 'NEEDS_CHECK' } }),
    evidence: await prisma.evidence.count(),
    appeals: await prisma.appeal.count(),
    signals: await prisma.signal.count(),
    snapshots: await prisma.scoreSnapshot.count(),
    auditLog: await prisma.auditLog.count(),
    watchTerms: await prisma.watchTerm.count(),
    searchQueries: await prisma.searchQuery.count(),
    searchQueriesActive: await prisma.searchQuery.count({ where: { active: true } }),
    collected: await prisma.collectedItem.count(),
    collectedKept: await prisma.collectedItem.count({ where: { verdict: 'KEPT' } }),
    registryChecks: await prisma.registryCheck.count(),
    registryManual: await prisma.registryCheck.count({ where: { manual: true } }),
  };

  console.log('\n  Объект                  Балл  Зона    Факторы            Сценарий');
  console.log('  ' + '─'.repeat(74));
  for (const row of rows) console.log('  ' + row);

  console.log('\n  Итого:');
  console.log(`    объектов ................... ${counts.objects}`);
  console.log(`    публикаций ................. ${counts.publications} (из них без привязки: ${counts.unlinked})`);
  console.log(`    факторов ................... ${counts.factors} (подтверждено: ${counts.confirmedFactors}, нужна проверка: ${counts.needsCheck})`);
  console.log(`    доказательств .............. ${counts.evidence}`);
  console.log(`    обращений .................. ${counts.appeals}`);
  console.log(`    сигнальных карточек ........ ${counts.signals}`);
  console.log(`    снимков истории риска ...... ${counts.snapshots}`);
  console.log(`    записей журнала действий ... ${counts.auditLog}`);
  console.log(`    слов-ловушек ............... ${counts.watchTerms}`);
  console.log(
    `    поисковых запросов ......... ${counts.searchQueries} (включено: ${counts.searchQueriesActive})`,
  );
  console.log(`    элементов сбора ............ ${counts.collected} (взято в работу: ${counts.collectedKept})`);
  console.log(`    проверок в реестрах ........ ${counts.registryChecks} (вручную: ${counts.registryManual})`);

  console.log('\n  Расчёт по всем объектам совпал с ожиданием ТЗ, включая сценарии A, B и C.');
  console.log('  Ни один ответ реестра «записи нет» не начислил фактор R1 — так и задумано.');
  console.log('  Все записи помечены как демонстрационные (isDemo = true).\n');
}

main()
  .catch((error) => {
    if (error instanceof SeedDataError) {
      console.error(`\nОшибка в демонстрационных данных:\n${error.message}\n`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
