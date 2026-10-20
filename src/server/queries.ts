/**
 * Запросы чтения для API.
 *
 * Вынесены из маршрутов по одной причине: маршрут Next.js — плохое место для
 * логики. Его нельзя вызвать из теста без поднятого сервера, нельзя
 * переиспользовать из серверного компонента и неудобно читать. Здесь обычные
 * функции, принимающие клиент базы первым аргументом; маршрут остаётся
 * переходником в одну строку.
 *
 * Общее правило выдачи: список отдаёт ровно те поля, которые нужны списку.
 * Это не преждевременная оптимизация, а требование к интерфейсу: карта
 * восьми ЖК не должна тащить по сети восемь текстов объявлений.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import {
  type ConnectionInput,
  type ConnectionCluster,
  findConnections,
} from '../core/connections/graph';
import type { LinkStatus, Platform, RiskZone, SignalStatus, SuggestionStatus } from '../core/domain/enums';
import { notFound } from './http';

export type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Объекты реестра
// ---------------------------------------------------------------------------

export interface ProjectFilters {
  zone?: readonly RiskZone[];
  stage?: readonly string[];
  /** Поиск по названию и адресу, в том числе по казахским вариантам. */
  q?: string;
  /** Только объекты с непривязанными или спорными публикациями. */
  needsAttention?: boolean;
  limit: number;
  offset: number;
}

/**
 * Список объектов для карты и реестра.
 *
 * Порядок по убыванию балла не случаен: первый экран аналитика должен
 * начинаться с того, что требует действий, а не с алфавита.
 */
export async function listProjects(db: Db, filters: ProjectFilters) {
  const where: Prisma.ProjectWhereInput = {
    ...(filters.zone && { riskZone: { in: [...filters.zone] } }),
    ...(filters.stage && { stage: { in: [...filters.stage] } }),
    ...(filters.q && {
      OR: [
        { name: { contains: filters.q } },
        { nameKk: { contains: filters.q } },
        { address: { contains: filters.q } },
        { addressKk: { contains: filters.q } },
        { developer: { name: { contains: filters.q } } },
      ],
    }),
    ...(filters.needsAttention && {
      OR: [
        { legalBasisStatus: 'NOT_CHECKED' },
        { factors: { some: { status: 'NEEDS_CHECK' } } },
      ],
    }),
  };

  const [total, rows] = await Promise.all([
    db.project.count({ where }),
    db.project.findMany({
      where,
      orderBy: [{ riskScore: 'desc' }, { name: 'asc' }],
      take: filters.limit,
      skip: filters.offset,
      select: {
        id: true,
        slug: true,
        name: true,
        nameKk: true,
        address: true,
        addressKk: true,
        city: true,
        lat: true,
        lng: true,
        stage: true,
        riskScore: true,
        riskZone: true,
        scoredAt: true,
        legalBasisStatus: true,
        legalBasisType: true,
        declaredReadinessPct: true,
        verifiedReadinessPct: true,
        plannedCompletionAt: true,
        actualDelayDays: true,
        developer: { select: { id: true, name: true, nameKk: true, bin: true } },
        factors: { select: { code: true, status: true } },
        _count: { select: { publications: true, signals: true, appeals: true } },
      },
    }),
  ]);

  return {
    total,
    limit: filters.limit,
    offset: filters.offset,
    items: rows.map((row) => {
      const { factors, ...rest } = row;
      return {
        ...rest,
        confirmedCodes: factors
          .filter((factor) => factor.status === 'CONFIRMED')
          .map((factor) => factor.code)
          .sort(),
        needsCheckCount: factors.filter((factor) => factor.status === 'NEEDS_CHECK').length,
      };
    }),
  };
}

/** Сводка по зонам — для верхней полосы обзора. */
export async function zoneSummary(db: Db) {
  const rows = await db.project.groupBy({ by: ['riskZone'], _count: { _all: true } });
  const counts: Record<string, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const row of rows) counts[row.riskZone] = row._count._all;

  const unlinked = await db.publication.count({ where: { projectId: null } });
  const pendingSuggestions = await db.aiSuggestion.count({ where: { status: 'PENDING' } });
  const draftSignals = await db.signal.count({ where: { status: 'DRAFT' } });

  return { zones: counts, unlinkedPublications: unlinked, pendingSuggestions, draftSignals };
}

/**
 * Карточка объекта целиком.
 *
 * Публикации включаются без текста: текст нужен только на карточке
 * объявления, а в списке создаёт лишние десятки килобайт на каждый объект.
 */
export async function projectDetail(db: Db, projectId: string) {
  const project = await db.project.findFirst({
    where: { OR: [{ id: projectId }, { slug: projectId }] },
    include: {
      developer: true,
      factors: {
        include: { evidence: { orderBy: { createdAt: 'asc' } } },
        orderBy: { code: 'asc' },
      },
      appeals: { orderBy: { registeredAt: 'desc' } },
      publications: {
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true,
          platform: true,
          accountName: true,
          contactPhone: true,
          url: true,
          publishedAt: true,
          capturedAt: true,
          linkStatus: true,
          linkConfidence: true,
        },
      },
      signals: { orderBy: { createdAt: 'desc' } },
      scoreSnapshots: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!project) throw notFound('Объект');
  return project;
}

/** Идентификатор объекта по id или по slug — в адресах удобнее slug. */
export async function resolveProjectId(db: Db, idOrSlug: string): Promise<string> {
  const project = await db.project.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: { id: true },
  });
  if (!project) throw notFound('Объект');
  return project.id;
}

// ---------------------------------------------------------------------------
// Публикации
// ---------------------------------------------------------------------------

export interface PublicationFilters {
  platform?: readonly Platform[];
  linkStatus?: readonly LinkStatus[];
  projectId?: string;
  /** true — только публикации без привязки к объекту. */
  unlinked?: boolean;
  q?: string;
  limit: number;
  offset: number;
}

/**
 * Список объявлений для модуля мониторинга.
 *
 * Текст обрезается до начала: список нужен для выбора, а не для чтения.
 * Полный текст с офсетами для подсветки отдаёт карточка.
 */
export async function listPublications(db: Db, filters: PublicationFilters) {
  const where: Prisma.PublicationWhereInput = {
    ...(filters.platform && { platform: { in: [...filters.platform] } }),
    ...(filters.linkStatus && { linkStatus: { in: [...filters.linkStatus] } }),
    ...(filters.projectId && { projectId: filters.projectId }),
    ...(filters.unlinked && { projectId: null }),
    ...(filters.q && {
      OR: [
        { rawText: { contains: filters.q } },
        { accountName: { contains: filters.q } },
        { contactPhone: { contains: filters.q } },
      ],
    }),
  };

  const [total, rows] = await Promise.all([
    db.publication.count({ where }),
    db.publication.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { capturedAt: 'desc' }],
      take: filters.limit,
      skip: filters.offset,
      select: {
        id: true,
        platform: true,
        accountName: true,
        accountUrl: true,
        contactPhone: true,
        url: true,
        publishedAt: true,
        capturedAt: true,
        rawText: true,
        linkStatus: true,
        linkConfidence: true,
        linkedBy: true,
        linkedAt: true,
        project: { select: { id: true, slug: true, name: true, riskZone: true } },
        _count: { select: { aiSuggestions: true, evidence: true } },
      },
    }),
  ]);

  return {
    total,
    limit: filters.limit,
    offset: filters.offset,
    items: rows.map(({ rawText, ...rest }) => ({
      ...rest,
      excerpt: rawText.length > 240 ? `${rawText.slice(0, 240)}…` : rawText,
      textLength: rawText.length,
    })),
  };
}

/**
 * Карточка объявления с полным текстом.
 *
 * Отдаются и гипотезы ИИ, и подтверждённые доказательства — интерфейс
 * обязан показывать их по-разному, поэтому и приходят они раздельно,
 * а не одним списком «найденное».
 */
export async function publicationDetail(db: Db, publicationId: string) {
  const publication = await db.publication.findUnique({
    where: { id: publicationId },
    include: {
      project: { select: { id: true, slug: true, name: true, nameKk: true, riskZone: true } },
      aiSuggestions: { orderBy: [{ status: 'asc' }, { confidence: 'desc' }] },
      evidence: {
        include: { factor: { select: { id: true, code: true, status: true, projectId: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!publication) throw notFound('Публикация');
  return publication;
}

// ---------------------------------------------------------------------------
// Гипотезы ИИ
// ---------------------------------------------------------------------------

export interface SuggestionFilters {
  status?: readonly SuggestionStatus[];
  kind?: readonly string[];
  publicationId?: string;
  projectId?: string;
  limit: number;
  offset: number;
}

export async function listSuggestions(db: Db, filters: SuggestionFilters) {
  const where: Prisma.AiSuggestionWhereInput = {
    ...(filters.status && { status: { in: [...filters.status] } }),
    ...(filters.kind && { kind: { in: [...filters.kind] } }),
    ...(filters.publicationId && { publicationId: filters.publicationId }),
    ...(filters.projectId && { projectId: filters.projectId }),
  };

  const [total, items] = await Promise.all([
    db.aiSuggestion.count({ where }),
    db.aiSuggestion.findMany({
      where,
      orderBy: [{ status: 'asc' }, { confidence: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
      skip: filters.offset,
      include: {
        publication: {
          select: { id: true, platform: true, accountName: true, projectId: true },
        },
        project: { select: { id: true, slug: true, name: true } },
      },
    }),
  ]);

  return { total, limit: filters.limit, offset: filters.offset, items };
}

// ---------------------------------------------------------------------------
// Сигнальные карточки
// ---------------------------------------------------------------------------

export async function listSignals(
  db: Db,
  filters: { status?: readonly SignalStatus[]; projectId?: string; limit: number; offset: number },
) {
  const where: Prisma.SignalWhereInput = {
    ...(filters.status && { status: { in: [...filters.status] } }),
    ...(filters.projectId && { projectId: filters.projectId }),
  };

  const [total, items] = await Promise.all([
    db.signal.count({ where }),
    db.signal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
      skip: filters.offset,
      include: {
        project: {
          select: { id: true, slug: true, name: true, nameKk: true, riskZone: true, riskScore: true },
        },
      },
    }),
  ]);

  return { total, limit: filters.limit, offset: filters.offset, items };
}

export async function signalDetail(db: Db, signalId: string) {
  const signal = await db.signal.findUnique({
    where: { id: signalId },
    include: { project: { include: { developer: true } } },
  });

  if (!signal) throw notFound('Сигнальная карточка');

  return {
    ...signal,
    /**
     * Снимок факторов разворачивается здесь, а не в интерфейсе: карточка
     * обязана показывать состояние на момент формирования сигнала, даже
     * если данные объекта с тех пор изменились.
     */
    factors: parseJson(signal.factorsJson),
  };
}

// ---------------------------------------------------------------------------
// Связанные аккаунты и телефоны
// ---------------------------------------------------------------------------

/**
 * Группы связанных публикаций.
 *
 * Поиск идёт по всем публикациям сразу и только так имеет смысл: связь
 * существует между карточками, а не внутри одной. Поэтому фильтры к запросу
 * применяются после построения групп, а не до него — иначе фильтр «объект
 * Алтай Арман» скрыл бы ровно то, что нужно увидеть: размещения того же
 * продавца по другим ЖК.
 */
export async function listConnections(
  db: Db,
  filters: { projectId?: string; crossProjectOnly?: boolean } = {},
): Promise<{ total: number; items: ConnectionCluster[] }> {
  const rows = await db.publication.findMany({
    select: {
      id: true,
      projectId: true,
      platform: true,
      accountName: true,
      contactPhone: true,
      publishedAt: true,
      project: { select: { name: true } },
    },
  });

  const input: ConnectionInput[] = rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    platform: row.platform,
    accountName: row.accountName,
    contactPhone: row.contactPhone,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }));

  let clusters = findConnections(input);

  if (filters.projectId) {
    clusters = clusters.filter((cluster) =>
      cluster.projects.some((project) => project.id === filters.projectId),
    );
  }
  if (filters.crossProjectOnly) {
    clusters = clusters.filter((cluster) => cluster.crossProject);
  }

  return { total: clusters.length, items: clusters };
}

// ---------------------------------------------------------------------------

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
