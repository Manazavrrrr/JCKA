/**
 * Сервис риск-скоринга: единственная точка, через которую меняются факторы
 * и пересчитывается балл объекта.
 *
 * Три правила, на которых держится слой:
 *
 *  1. Балл нельзя записать напрямую. Поля Project.riskScore / riskZone —
 *     это кэш, который пересчитывается из таблицы RiskFactor. Любая попытка
 *     «поставить объекту 80 баллов» в обход факторов невозможна по API.
 *
 *  2. Любое изменение проходит проверку предусловий из ./eligibility.ts.
 *     Статус CONFIRMED не будет записан, если данные объекта не удовлетворяют
 *     условию ТЗ. Проверка на сервере, а не в интерфейсе.
 *
 *  3. Любое изменение попадает в AuditLog с автором и временем, а изменение
 *     балла — ещё и в ScoreSnapshot. Это требование ТЗ «Контроль решений»
 *     и одновременно источник данных для графика динамики риска.
 *
 * Вся арифметика и все формулировки живут в чистых модулях model/explain/
 * eligibility. Здесь только чтение, запись и порядок операций.
 */

import type { Prisma, PrismaClient, Project, RiskFactor } from '@prisma/client';

import {
  factorCodeSchema,
  factorOriginSchema,
  factorStatusSchema,
  legalBasisStatusSchema,
  legalBasisTypeSchema,
  projectStageSchema,
  type EvidenceKind,
  type FactorCode,
  type FactorOrigin,
  type FactorStatus,
  type LegalBasisStatus,
  type ProjectStage,
} from '../domain/enums';
import {
  assertFactorConfirmable,
  checkAllFactors,
  locateExcerpt,
  type EligibilityContext,
  type EligibilityVerdict,
} from './eligibility';
import { ScoringError } from './errors';
import { explainScore, summarizeScore, type ScoreExplanation } from './explain';
import { computeScore, resolveZone, sortFactorCodes } from './model';

/** Клиент Prisma или транзакционный клиент внутри $transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;

export { ScoringError } from './errors';

// ---------------------------------------------------------------------------
// Чтение состояния
// ---------------------------------------------------------------------------

const projectWithFactors = {
  factors: {
    include: { evidence: true },
    orderBy: { code: 'asc' },
  },
  appeals: true,
} satisfies Prisma.ProjectInclude;

export type ProjectWithFactors = Prisma.ProjectGetPayload<{ include: typeof projectWithFactors }>;

/**
 * Загружает объект вместе с факторами, доказательствами и обращениями.
 * Один запрос — чтобы расчёт и проверка предусловий видели одну и ту же картину.
 */
export async function loadProject(db: Db, projectId: string): Promise<ProjectWithFactors> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: projectWithFactors,
  });

  if (!project) {
    throw new ScoringError(`Объект ${projectId} не найден.`, 404);
  }

  return project;
}

/**
 * Строит контекст проверки предусловий из записи БД.
 *
 * Строковые поля приводятся Zod-схемами: в SQLite нет enum, и если в базу
 * попало постороннее значение, лучше упасть здесь с понятной ошибкой,
 * чем молча посчитать объект зелёным.
 */
export function buildEligibilityContext(project: ProjectWithFactors): EligibilityContext {
  const stage = parseStage(project.stage, project.slug);
  const legalBasisStatus = parseLegalBasisStatus(project.legalBasisStatus, project.slug);

  const evidenceByFactor: Partial<Record<FactorCode, { kind: EvidenceKind; excerpt: string | null }[]>> =
    {};

  for (const factor of project.factors) {
    const code = factorCodeSchema.safeParse(factor.code);
    if (!code.success) continue;
    evidenceByFactor[code.data] = factor.evidence.map((item) => ({
      kind: item.kind as EvidenceKind,
      excerpt: item.excerpt,
    }));
  }

  return {
    stage,
    legalBasisStatus,
    declaredReadinessPct: project.declaredReadinessPct,
    declaredReadinessSource: project.declaredReadinessSource,
    verifiedReadinessPct: project.verifiedReadinessPct,
    verifiedReadinessSource: project.verifiedReadinessSource,
    actualDelayDays: project.actualDelayDays,
    verifiedAppealCount: project.appeals.filter((appeal) => appeal.status === 'VERIFIED').length,
    evidenceByFactor,
  };
}

function parseStage(value: string, slug: string): ProjectStage {
  const parsed = projectStageSchema.safeParse(value);
  if (!parsed.success) {
    throw new ScoringError(`Объект ${slug}: недопустимая стадия строительства "${value}".`, 500);
  }
  return parsed.data;
}

function parseLegalBasisStatus(value: string, slug: string): LegalBasisStatus {
  const parsed = legalBasisStatusSchema.safeParse(value);
  if (!parsed.success) {
    throw new ScoringError(`Объект ${slug}: недопустимый статус основания "${value}".`, 500);
  }
  return parsed.data;
}

function toExplainable(factors: readonly (RiskFactor & { evidence: unknown[] })[]) {
  return factors.flatMap((factor) => {
    const code = factorCodeSchema.safeParse(factor.code);
    const status = factorStatusSchema.safeParse(factor.status);
    if (!code.success || !status.success) return [];
    const origin = factorOriginSchema.safeParse(factor.origin);
    return [
      {
        code: code.data,
        status: status.data,
        origin: origin.success ? origin.data : undefined,
        rationale: factor.rationale,
        confirmedBy: factor.confirmedBy,
        confirmedAt: factor.confirmedAt,
        evidenceCount: factor.evidence.length,
      },
    ];
  });
}

/** Коды факторов со статусом CONFIRMED — вход формулы балла. */
export function confirmedCodesOf(project: ProjectWithFactors): FactorCode[] {
  return sortFactorCodes(
    project.factors.flatMap((factor) => {
      if (factor.status !== 'CONFIRMED') return [];
      const code = factorCodeSchema.safeParse(factor.code);
      return code.success ? [code.data] : [];
    }),
  );
}

// ---------------------------------------------------------------------------
// Пересчёт
// ---------------------------------------------------------------------------

export interface RecalculationResult {
  projectId: string;
  score: number;
  zone: string;
  previousScore: number;
  previousZone: string;
  changed: boolean;
  explanation: ScoreExplanation;
}

/**
 * Пересчитывает балл и зону объекта из его факторов.
 *
 * Снимок в историю и запись в журнал создаются только при фактическом
 * изменении результата: иначе открытие карточки объекта засоряло бы
 * и график динамики, и журнал действий.
 */
export async function recalculateProject(
  db: Db,
  projectId: string,
  options: { actor: string; reason: string },
): Promise<RecalculationResult> {
  const project = await loadProject(db, projectId);
  const codes = confirmedCodesOf(project);
  const score = computeScore(codes);
  const zone = resolveZone(score, codes);
  const explanation = explainScore(toExplainable(project.factors));

  const previousScore = project.riskScore;
  const previousZone = project.riskZone;
  const changed = previousScore !== score || previousZone !== zone;

  await db.project.update({
    where: { id: projectId },
    data: { riskScore: score, riskZone: zone, scoredAt: new Date() },
  });

  if (changed) {
    await db.scoreSnapshot.create({
      data: {
        projectId,
        score,
        zone,
        factorCodesJson: JSON.stringify(codes),
        reason: options.reason,
      },
    });

    await writeAudit(db, {
      entityType: 'Project',
      entityId: projectId,
      action: 'SCORE_RECALCULATED',
      actor: options.actor,
      before: { score: previousScore, zone: previousZone },
      after: { score, zone, factors: codes },
      comment: options.reason,
    });
  }

  return { projectId, score, zone, previousScore, previousZone, changed, explanation };
}

// ---------------------------------------------------------------------------
// Изменение статуса фактора
// ---------------------------------------------------------------------------

export interface EvidenceInput {
  kind: EvidenceKind;
  excerpt?: string | null;
  publicationId?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  note?: string | null;
}

export interface SetFactorStatusInput {
  projectId: string;
  code: FactorCode;
  status: FactorStatus;
  /** Обоснование решения — обязательно, это след решения человека. */
  rationale: string;
  actor: string;
  origin?: FactorOrigin;
  /** Доказательства, добавляемые вместе с решением. */
  evidence?: readonly EvidenceInput[];
}

const AUDIT_BY_STATUS: Record<FactorStatus, string> = {
  CONFIRMED: 'FACTOR_CONFIRMED',
  REJECTED: 'FACTOR_REJECTED',
  NEEDS_CHECK: 'FACTOR_NEEDS_CHECK',
  NOT_APPLICABLE: 'FACTOR_NEEDS_CHECK',
};

/**
 * Решение аналитика по фактору.
 *
 * Порядок операций важен и повторяет логику проверки:
 *   1) добавляем доказательства — проверка предусловий должна их увидеть;
 *   2) проверяем предусловие, если статус CONFIRMED;
 *   3) пишем статус с автором и датой;
 *   4) пишем журнал;
 *   5) пересчитываем балл.
 *
 * Всё в одной транзакции: объект не может остаться с подтверждённым фактором
 * и старым баллом.
 */
export async function setFactorStatus(
  prisma: PrismaClient,
  input: SetFactorStatusInput,
): Promise<RecalculationResult> {
  if (!input.rationale.trim()) {
    throw new ScoringError('Обоснование решения обязательно: решение должно быть объяснимым.');
  }

  return prisma.$transaction(async (tx) => {
    const project = await loadProject(tx, input.projectId);
    const existing = project.factors.find((factor) => factor.code === input.code) ?? null;

    const factor = await tx.riskFactor.upsert({
      where: { projectId_code: { projectId: input.projectId, code: input.code } },
      create: {
        projectId: input.projectId,
        code: input.code,
        status: 'NEEDS_CHECK',
        origin: input.origin ?? 'MANUAL',
        rationale: input.rationale.trim(),
      },
      update: {},
    });

    if (input.evidence?.length) {
      await attachEvidence(tx, factor.id, input.evidence);
    }

    if (input.status === 'CONFIRMED') {
      const refreshed = await loadProject(tx, input.projectId);
      assertFactorConfirmable(input.code, buildEligibilityContext(refreshed));
    }

    const now = new Date();
    const confirming = input.status === 'CONFIRMED';

    await tx.riskFactor.update({
      where: { id: factor.id },
      data: {
        status: input.status,
        origin: input.origin ?? existing?.origin ?? 'MANUAL',
        rationale: input.rationale.trim(),
        // Автор и дата фиксируются у любого решения, а не только у подтверждения:
        // «проверено, не подтвердилось» — тоже решение, за которое кто-то отвечает.
        confirmedBy: input.actor,
        confirmedAt: confirming ? now : existing?.status === input.status ? existing.confirmedAt : now,
      },
    });

    await writeAudit(tx, {
      entityType: 'RiskFactor',
      entityId: factor.id,
      action: AUDIT_BY_STATUS[input.status],
      actor: input.actor,
      before: existing
        ? { status: existing.status, rationale: existing.rationale }
        : { status: null },
      after: { code: input.code, status: input.status, rationale: input.rationale.trim() },
      comment: input.rationale.trim(),
    });

    return recalculateProject(tx, input.projectId, {
      actor: input.actor,
      reason: `${input.code}: ${describeStatus(input.status)}`,
    });
  });
}

function describeStatus(status: FactorStatus): string {
  switch (status) {
    case 'CONFIRMED':
      return 'фактор подтверждён';
    case 'REJECTED':
      return 'фактор проверен, не подтвердился';
    case 'NOT_APPLICABLE':
      return 'фактор признан неприменимым';
    default:
      return 'фактор отправлен на проверку';
  }
}

/**
 * Прикрепляет доказательства к фактору.
 *
 * Для фрагмента текста позиция вычисляется по актуальному тексту публикации
 * и не принимается с клиента: если фрагмент в тексте не найден, доказательство
 * не создаётся. Так подсветка в ленте публикаций не может указать не на то место.
 */
async function attachEvidence(
  tx: Prisma.TransactionClient,
  factorId: string,
  items: readonly EvidenceInput[],
): Promise<void> {
  for (const item of items) {
    let charStart: number | null = null;
    let charEnd: number | null = null;

    if (item.kind === 'TEXT_FRAGMENT') {
      if (!item.publicationId || !item.excerpt?.trim()) {
        throw new ScoringError(
          'Фрагмент текста требует публикации и самого фрагмента: доказательство должно быть проверяемым.',
        );
      }

      const publication = await tx.publication.findUnique({
        where: { id: item.publicationId },
        select: { rawText: true },
      });

      if (!publication) {
        throw new ScoringError(`Публикация ${item.publicationId} не найдена.`, 404);
      }

      const position = locateExcerpt(publication.rawText, item.excerpt);
      if (!position) {
        throw new ScoringError(
          'Указанный фрагмент не найден в тексте публикации. ' +
            'Скопируйте цитату дословно, иначе ссылку на источник нельзя будет проверить.',
        );
      }

      charStart = position.charStart;
      charEnd = position.charEnd;
    }

    await tx.evidence.create({
      data: {
        factorId,
        publicationId: item.publicationId ?? null,
        kind: item.kind,
        excerpt: item.excerpt?.trim() ?? null,
        charStart,
        charEnd,
        sourceLabel: item.sourceLabel ?? null,
        sourceUrl: item.sourceUrl ?? null,
        note: item.note ?? null,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Правовое основание
// ---------------------------------------------------------------------------

export interface SetLegalBasisInput {
  projectId: string;
  status: LegalBasisStatus;
  type: string;
  source?: string | null;
  note?: string | null;
  actor: string;
}

/**
 * Фиксирует результат проверки правового основания.
 *
 * Отдельная операция, а не часть обновления объекта: от этого поля зависит
 * фактор R1, поэтому у решения обязаны быть источник, автор и дата.
 *
 * Если основание признано подтверждённым, а R1 уже был начислен, фактор
 * автоматически переводится в «проверен, не подтвердился» — иначе объект
 * остался бы с 35 баллами за риск, которого больше нет.
 */
export async function setLegalBasis(
  prisma: PrismaClient,
  input: SetLegalBasisInput,
): Promise<RecalculationResult> {
  const type = legalBasisTypeSchema.parse(input.type);
  const status = legalBasisStatusSchema.parse(input.status);

  if (status !== 'NOT_CHECKED' && !input.source?.trim()) {
    throw new ScoringError(
      'Результат проверки основания требует указания источника: ' +
        'вывод о наличии или отсутствии основания должен быть проверяемым.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const project = await loadProject(tx, input.projectId);

    await tx.project.update({
      where: { id: input.projectId },
      data: {
        legalBasisStatus: status,
        legalBasisType: type,
        legalBasisSource: input.source?.trim() ?? null,
        legalBasisNote: input.note?.trim() ?? null,
        legalBasisCheckedAt: status === 'NOT_CHECKED' ? null : new Date(),
        legalBasisCheckedBy: status === 'NOT_CHECKED' ? null : input.actor,
      },
    });

    await writeAudit(tx, {
      entityType: 'Project',
      entityId: input.projectId,
      action: 'PROJECT_UPDATED',
      actor: input.actor,
      before: {
        legalBasisStatus: project.legalBasisStatus,
        legalBasisType: project.legalBasisType,
        legalBasisSource: project.legalBasisSource,
      },
      after: { legalBasisStatus: status, legalBasisType: type, legalBasisSource: input.source ?? null },
      comment: input.note?.trim() ?? null,
    });

    // Снятие R1 при подтверждённом основании.
    const r1 = project.factors.find((factor) => factor.code === 'R1');
    if (status !== 'CONFIRMED_ABSENT' && r1?.status === 'CONFIRMED') {
      await tx.riskFactor.update({
        where: { id: r1.id },
        data: {
          status: 'REJECTED',
          rationale:
            'Снято автоматически: статус правового основания изменён, ' +
            'условие начисления R1 (установленное отсутствие основания) больше не выполняется.',
          confirmedBy: input.actor,
          confirmedAt: new Date(),
        },
      });

      await writeAudit(tx, {
        entityType: 'RiskFactor',
        entityId: r1.id,
        action: 'FACTOR_REJECTED',
        actor: input.actor,
        before: { status: 'CONFIRMED' },
        after: { status: 'REJECTED' },
        comment: 'Изменён статус правового основания — R1 снят автоматически.',
      });
    }

    return recalculateProject(tx, input.projectId, {
      actor: input.actor,
      reason: `Проверка правового основания: ${status}`,
    });
  });
}

// ---------------------------------------------------------------------------
// Представление для интерфейса
// ---------------------------------------------------------------------------

export interface ProjectScoringView {
  project: Project;
  explanation: ScoreExplanation;
  eligibility: Record<FactorCode, EligibilityVerdict>;
  summary: { ru: string; kk: string };
  /** true, если кэш в Project расходится с расчётом из факторов. */
  stale: boolean;
}

/**
 * Полное состояние скоринга объекта для панели аналитика.
 *
 * Отдельно считается признак stale: если кэш разошёлся с факторами,
 * интерфейс покажет это явно, а не выдаст устаревший балл за актуальный.
 */
export async function getProjectScoring(
  db: Db,
  projectId: string,
): Promise<ProjectScoringView> {
  const project = await loadProject(db, projectId);
  const context = buildEligibilityContext(project);
  const explanation = explainScore(toExplainable(project.factors));

  return {
    project,
    explanation,
    eligibility: checkAllFactors(context),
    summary: {
      ru: summarizeScore(explanation, 'ru'),
      kk: summarizeScore(explanation, 'kk'),
    },
    stale: project.riskScore !== explanation.score || project.riskZone !== explanation.zone,
  };
}

/** История изменения риска для графика динамики. */
export async function getScoreHistory(db: Db, projectId: string) {
  const snapshots = await db.scoreSnapshot.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });

  return snapshots.map((item) => ({
    at: item.createdAt.toISOString(),
    score: item.score,
    zone: item.zone,
    factors: JSON.parse(item.factorCodesJson) as FactorCode[],
    reason: item.reason,
  }));
}

// ---------------------------------------------------------------------------
// Журнал действий
// ---------------------------------------------------------------------------

export interface AuditInput {
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  before?: unknown;
  after?: unknown;
  comment?: string | null;
}

/**
 * Запись в журнал действий.
 *
 * Вынесена в экспортируемую функцию, потому что ею пользуются все модули:
 * привязка публикаций, принятие гипотез ИИ, работа с сигнальными карточками.
 * Единая точка гарантирует, что ни одно действие не окажется без автора.
 */
export async function writeAudit(db: Db, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actor: input.actor,
      beforeJson: input.before === undefined ? null : JSON.stringify(input.before),
      afterJson: input.after === undefined ? null : JSON.stringify(input.after),
      comment: input.comment ?? null,
    },
  });
}

/** Журнал по объекту: его собственные записи плюс записи его факторов. */
export async function getProjectAudit(db: Db, projectId: string, limit = 100) {
  const factors = await db.riskFactor.findMany({
    where: { projectId },
    select: { id: true, code: true },
  });

  const factorIds = factors.map((factor) => factor.id);
  const codeById = new Map(factors.map((factor) => [factor.id, factor.code]));

  const entries = await db.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'Project', entityId: projectId },
        { entityType: 'RiskFactor', entityId: { in: factorIds } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return entries.map((entry) => ({
    id: entry.id,
    at: entry.createdAt.toISOString(),
    action: entry.action,
    actor: entry.actor,
    subject: entry.entityType === 'RiskFactor' ? (codeById.get(entry.entityId) ?? null) : null,
    comment: entry.comment,
    before: entry.beforeJson ? JSON.parse(entry.beforeJson) : null,
    after: entry.afterJson ? JSON.parse(entry.afterJson) : null,
  }));
}
