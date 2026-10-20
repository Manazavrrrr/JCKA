/**
 * Разбор объявлений и решения аналитика по гипотезам.
 *
 * Здесь соединяются три вещи, каждая из которых проверяется отдельно:
 * чистый разбор текста (src/core/ai), чистая раскладка на гипотезы
 * (src/core/ai/suggestions) и база. Собственной логики в модуле минимум —
 * он записывает и читает.
 *
 * Главное решение этого модуля — что означает «принять гипотезу».
 *
 * Принятие гипотезы НЕ подтверждает фактор. Оно создаёт фактор со статусом
 * «требует проверки», прикладывает к нему цитату из объявления и помечает
 * происхождение как AI_ACCEPTED. Балл при этом не меняется.
 *
 * Так сделано потому, что согласие с гипотезой и подтверждение факта — разные
 * утверждения. «Да, в объявлении действительно требуют платную бронь» — это
 * согласие с прочтением текста. «Да, объект нарушает порядок привлечения
 * средств» — это вывод, за который аналитик отвечает и который требует
 * обоснования. Если бы принятие гипотезы сразу давало баллы, достаточно было
 * бы нажать «согласен» двенадцать раз, чтобы получить красную зону, не
 * проверив ни одного документа.
 */

import type { PrismaClient } from '@prisma/client';

import { analyze as analyzeWithProvider } from '../core/ai';
import type { AnalyzeInput, ProjectCandidate } from '../core/ai/provider';
import type { AnalysisResult } from '../core/ai/schemas';
import { summarizeAnalysis, toSuggestionRows } from '../core/ai/suggestions';
import { factorCodeSchema } from '../core/domain/enums';
import { writeAudit } from '../core/scoring/service';
import { HttpError, notFound } from './http';
import type { Db } from './queries';

// ---------------------------------------------------------------------------
// Реестр как подсказка для сопоставления
// ---------------------------------------------------------------------------

/**
 * Объекты реестра в том виде, в котором их использует сопоставление.
 *
 * Передаются именно известные телефоны застройщика: совпадение номера —
 * самый надёжный признак принадлежности объявления объекту, и он работает
 * даже тогда, когда название в тексте искажено или отсутствует.
 */
export async function registryCandidates(db: Db): Promise<ProjectCandidate[]> {
  const projects = await db.project.findMany({
    select: {
      id: true,
      name: true,
      nameKk: true,
      address: true,
      developer: { select: { name: true, phone: true } },
      publications: { select: { contactPhone: true }, where: { linkStatus: 'CONFIRMED' } },
    },
  });

  return projects.map((project) => {
    const phones = [
      project.developer.phone,
      ...project.publications.map((item) => item.contactPhone),
    ].filter((phone): phone is string => Boolean(phone));

    return {
      id: project.id,
      name: project.name,
      ...(project.nameKk && { nameKk: project.nameKk }),
      address: project.address,
      developerName: project.developer.name,
      ...(phones.length > 0 && { knownPhones: [...new Set(phones)] }),
    };
  });
}

// ---------------------------------------------------------------------------
// Разбор произвольного текста
// ---------------------------------------------------------------------------

export interface AnalyzeTextResult {
  analysis: AnalysisResult;
  summary: ReturnType<typeof summarizeAnalysis>;
  /** Гипотезы в том виде, в котором они были бы сохранены. */
  suggestions: ReturnType<typeof toSuggestionRows>;
}

/**
 * Разбирает текст, не записывая ничего.
 *
 * Это тот самый сценарий, который проверяют на защите: вставить своё
 * объявление и увидеть разбор. Запись в базу здесь была бы вредна — текст
 * чужой, объекта для него нет, а засорять реестр проверочными данными
 * во время демонстрации нельзя.
 */
export async function analyzeText(
  db: Db,
  input: { text: string; title?: string; locale?: 'ru' | 'kk'; useRegistry?: boolean },
): Promise<AnalyzeTextResult> {
  const text = input.text.trim();
  if (text.length < 20) {
    throw new HttpError('VALIDATION', 'Текст объявления слишком короткий для разбора.', {
      text: ['Нужно не менее 20 символов.'],
    });
  }

  const payload: AnalyzeInput = {
    text,
    ...(input.title && { title: input.title }),
    ...(input.locale && { locale: input.locale }),
    ...(input.useRegistry !== false && { projects: await registryCandidates(db) }),
  };

  const analysis = await analyzeWithProvider(payload);

  return {
    analysis,
    summary: summarizeAnalysis(analysis),
    suggestions: toSuggestionRows(analysis),
  };
}

// ---------------------------------------------------------------------------
// Разбор сохранённой публикации
// ---------------------------------------------------------------------------

/**
 * Разбирает текст публикации и сохраняет гипотезы.
 *
 * Прежние необработанные гипотезы по этой публикации удаляются: повторный
 * разбор не должен оставлять в очереди два набора предложений по одному
 * тексту. Рассмотренные гипотезы сохраняются — это след решения человека,
 * и удалять его нельзя даже ради чистоты очереди.
 */
export async function analyzePublication(
  prisma: PrismaClient,
  publicationId: string,
  actor: string,
): Promise<AnalyzeTextResult & { saved: number }> {
  const publication = await prisma.publication.findUnique({
    where: { id: publicationId },
    select: { id: true, rawText: true, projectId: true },
  });
  if (!publication) throw notFound('Публикация');

  const projects = await registryCandidates(prisma);
  const analysis = await analyzeWithProvider({ text: publication.rawText, projects });
  const rows = toSuggestionRows(analysis, { projectId: publication.projectId });

  await prisma.$transaction(async (tx) => {
    await tx.aiSuggestion.deleteMany({ where: { publicationId, status: 'PENDING' } });

    for (const row of rows) {
      await tx.aiSuggestion.create({
        data: {
          publicationId,
          projectId: row.projectId,
          kind: row.kind,
          factorCode: row.factorCode,
          payloadJson: JSON.stringify(row.payload),
          confidence: row.confidence,
          evidenceExcerpt: row.evidenceExcerpt,
          charStart: row.charStart,
          charEnd: row.charEnd,
          provider: analysis.provider,
          model: analysis.model,
          status: 'PENDING',
        },
      });
    }

    /**
     * Факт разбора попадает в журнал: если гипотеза появилась, должно быть
     * видно, когда и каким провайдером она создана. Иначе невозможно
     * объяснить, откуда в очереди взялось предложение.
     */
    await writeAudit(tx, {
      entityType: 'Publication',
      entityId: publicationId,
      action: 'AI_SUGGESTION_CREATED',
      actor,
      after: {
        provider: analysis.provider,
        model: analysis.model,
        suggestions: rows.length,
        durationMs: analysis.durationMs,
      },
      comment: `Разбор текста: ${rows.length} гипотез.`,
    });
  });

  return {
    analysis,
    summary: summarizeAnalysis(analysis),
    suggestions: rows,
    saved: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Решение по гипотезе
// ---------------------------------------------------------------------------

export interface ReviewSuggestionInput {
  suggestionId: string;
  decision: 'ACCEPTED' | 'REJECTED';
  actor: string;
  comment?: string | null;
}

export interface ReviewSuggestionResult {
  suggestionId: string;
  status: 'ACCEPTED' | 'REJECTED';
  /** Созданный или найденный фактор — всегда в статусе «требует проверки». */
  factorId: string | null;
  /** Привязанная публикация, если решением было сопоставление с объектом. */
  linkedProjectId: string | null;
  /**
   * Всегда 0. Поле присутствует в ответе намеренно: интерфейс показывает
   * его строкой «балл не изменился», чтобы согласие с гипотезой не
   * воспринималось как начисление риска.
   */
  scoreDelta: 0;
}

/**
 * Решение аналитика по гипотезе ИИ.
 *
 * Отклонение — это просто статус и автор. Принятие делает одно из двух,
 * в зависимости от вида гипотезы:
 *
 *   - FACTOR_HYPOTHESIS: создаёт фактор в статусе «требует проверки»
 *     с происхождением AI_ACCEPTED и прикладывает цитату доказательством;
 *   - PROJECT_MATCH: привязывает публикацию к объекту реестра.
 *
 * Ни то, ни другое не меняет балл. Балл меняется только тогда, когда
 * аналитик отдельно подтверждает фактор с обоснованием, и предусловия
 * фактора при этом проверяются заново.
 */
export async function reviewSuggestion(
  prisma: PrismaClient,
  input: ReviewSuggestionInput,
): Promise<ReviewSuggestionResult> {
  return prisma.$transaction(async (tx) => {
    const suggestion = await tx.aiSuggestion.findUnique({ where: { id: input.suggestionId } });
    if (!suggestion) throw notFound('Гипотеза');

    if (suggestion.status !== 'PENDING') {
      throw new HttpError(
        'PRECONDITION',
        `Гипотеза уже рассмотрена (${suggestion.status}) ${suggestion.reviewedBy ?? ''}. ` +
          'Повторное решение не принимается: журнал решений должен оставаться однозначным.',
      );
    }

    await tx.aiSuggestion.update({
      where: { id: suggestion.id },
      data: { status: input.decision, reviewedBy: input.actor, reviewedAt: new Date() },
    });

    let factorId: string | null = null;
    let linkedProjectId: string | null = null;

    if (input.decision === 'ACCEPTED') {
      if (suggestion.kind === 'FACTOR_HYPOTHESIS') {
        factorId = await acceptFactorHypothesis(tx, suggestion, input.actor);
      }
      if (suggestion.kind === 'PROJECT_MATCH') {
        linkedProjectId = await acceptProjectMatch(tx, suggestion, input.actor);
      }
    }

    await writeAudit(tx, {
      entityType: 'AiSuggestion',
      entityId: suggestion.id,
      action: input.decision === 'ACCEPTED' ? 'AI_SUGGESTION_ACCEPTED' : 'AI_SUGGESTION_REJECTED',
      actor: input.actor,
      before: { status: 'PENDING' },
      after: {
        status: input.decision,
        kind: suggestion.kind,
        factorCode: suggestion.factorCode,
        factorId,
        linkedProjectId,
      },
      ...(input.comment && { comment: input.comment }),
    });

    return {
      suggestionId: suggestion.id,
      status: input.decision,
      factorId,
      linkedProjectId,
      scoreDelta: 0 as const,
    };
  });
}

/**
 * Принятая гипотеза о факторе превращается в задачу проверки, а не в балл.
 *
 * Если фактор уже подтверждён или отклонён аналитиком, статус не трогается:
 * мнение человека не может быть перезаписано согласием с гипотезой.
 */
async function acceptFactorHypothesis(
  tx: Db,
  suggestion: {
    id: string;
    projectId: string | null;
    publicationId: string | null;
    factorCode: string | null;
    evidenceExcerpt: string | null;
    charStart: number | null;
    charEnd: number | null;
    confidence: number;
    provider: string;
  },
  actor: string,
): Promise<string> {
  if (!suggestion.projectId) {
    throw new HttpError(
      'PRECONDITION',
      'Гипотезу о факторе нельзя принять, пока публикация не привязана к объекту: ' +
        'фактор начисляется объекту, а не объявлению.',
    );
  }

  const code = factorCodeSchema.parse(suggestion.factorCode);

  const existing = await tx.riskFactor.findUnique({
    where: { projectId_code: { projectId: suggestion.projectId, code } },
  });

  const factor = existing
    ? existing
    : await tx.riskFactor.create({
        data: {
          projectId: suggestion.projectId,
          code,
          status: 'NEEDS_CHECK',
          origin: 'AI_ACCEPTED',
          rationale:
            `Гипотеза ИИ принята аналитиком ${actor} как основание для проверки ` +
            `(уверенность разбора ${suggestion.confidence.toFixed(2)}). ` +
            'Статус «требует проверки»: для подтверждения нужны документы.',
        },
      });

  /**
   * Цитата прикладывается доказательством и тогда, когда фактор уже
   * существовал: добавление основания ничего не утверждает, но делает
   * будущее решение аналитика проверяемым.
   */
  if (suggestion.evidenceExcerpt && suggestion.publicationId) {
    await tx.evidence.create({
      data: {
        factorId: factor.id,
        publicationId: suggestion.publicationId,
        kind: 'TEXT_FRAGMENT',
        excerpt: suggestion.evidenceExcerpt,
        charStart: suggestion.charStart,
        charEnd: suggestion.charEnd,
        sourceLabel: `Гипотеза ИИ (${suggestion.provider}), принята ${actor}`,
        note: 'Основание добавлено при принятии гипотезы. Подтверждение фактора — отдельное решение.',
      },
    });
  }

  return factor.id;
}

/** Принятое сопоставление привязывает публикацию к объекту. */
async function acceptProjectMatch(
  tx: Db,
  suggestion: { id: string; publicationId: string | null; projectId: string | null; confidence: number },
  actor: string,
): Promise<string> {
  if (!suggestion.publicationId || !suggestion.projectId) {
    throw new HttpError('PRECONDITION', 'Сопоставление без публикации или объекта невозможно принять.');
  }

  await tx.publication.update({
    where: { id: suggestion.publicationId },
    data: {
      projectId: suggestion.projectId,
      linkStatus: 'CONFIRMED',
      linkConfidence: suggestion.confidence,
      linkedBy: actor,
      linkedAt: new Date(),
    },
  });

  /**
   * Остальные сопоставления по этой публикации отклоняются автоматически:
   * объявление относится к одному объекту, и оставлять в очереди
   * конкурирующие предложения после выбора не нужно.
   */
  await tx.aiSuggestion.updateMany({
    where: {
      publicationId: suggestion.publicationId,
      kind: 'PROJECT_MATCH',
      status: 'PENDING',
      id: { not: suggestion.id },
    },
    data: { status: 'REJECTED', reviewedBy: actor, reviewedAt: new Date() },
  });

  await writeAudit(tx, {
    entityType: 'Publication',
    entityId: suggestion.publicationId,
    action: 'PUBLICATION_LINKED',
    actor,
    after: { projectId: suggestion.projectId, via: 'AI_SUGGESTION' },
    comment: 'Привязка по принятому сопоставлению ИИ.',
  });

  return suggestion.projectId;
}

// ---------------------------------------------------------------------------
// Привязка публикации вручную
// ---------------------------------------------------------------------------

export interface LinkPublicationInput {
  publicationId: string;
  /** null — снять привязку. */
  projectId: string | null;
  actor: string;
  comment?: string | null;
}

/**
 * Привязка объявления к объекту вручную.
 *
 * Снятие привязки — отдельный случай, а не «привязка к null»: публикация
 * возвращается в очередь неразобранных, а в журнале остаётся отметка, кто
 * и когда счёл связь ошибочной.
 */
export async function linkPublication(
  prisma: PrismaClient,
  input: LinkPublicationInput,
): Promise<{ publicationId: string; projectId: string | null; linkStatus: string }> {
  return prisma.$transaction(async (tx) => {
    const publication = await tx.publication.findUnique({
      where: { id: input.publicationId },
      select: { id: true, projectId: true },
    });
    if (!publication) throw notFound('Публикация');

    if (input.projectId) {
      const project = await tx.project.findUnique({
        where: { id: input.projectId },
        select: { id: true },
      });
      if (!project) throw notFound('Объект');
    }

    const linkStatus = input.projectId ? 'CONFIRMED' : 'UNLINKED';

    await tx.publication.update({
      where: { id: publication.id },
      data: {
        projectId: input.projectId,
        linkStatus,
        linkConfidence: null,
        linkedBy: input.actor,
        linkedAt: new Date(),
      },
    });

    await writeAudit(tx, {
      entityType: 'Publication',
      entityId: publication.id,
      action: input.projectId ? 'PUBLICATION_LINKED' : 'PUBLICATION_UNLINKED',
      actor: input.actor,
      before: { projectId: publication.projectId },
      after: { projectId: input.projectId },
      ...(input.comment && { comment: input.comment }),
    });

    return { publicationId: publication.id, projectId: input.projectId, linkStatus };
  });
}
