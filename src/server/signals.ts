/**
 * Сигнальная карточка — то, что уходит из системы наружу.
 *
 * Всё остальное в приложении можно переделать: фактор переподтвердить,
 * привязку снять, гипотезу пересмотреть. Сигнальная карточка —
 * единственная сущность, которая выходит за пределы системы: её
 * распечатывают, прикладывают к служебной записке, отправляют в
 * управление. Поэтому к ней два требования, которых нет больше нигде.
 *
 * Первое: снимок. Карточка хранит балл, зону и полный разбор факторов
 * на момент формирования, а не ссылку на текущее состояние объекта.
 * Иначе документ, подписанный в марте, в мае показывал бы другие цифры,
 * и сослаться на него было бы нельзя. Снимок лежит в factorsJson целиком,
 * вместе с формулой, обоснованиями, авторами подтверждений и количеством
 * доказательств по каждому фактору.
 *
 * Второе: предусловие. Карточку нельзя сформировать, пока объяснение
 * балла содержит изъяны целостности — подтверждённые факторы без автора
 * или без даты решения. Проверка живёт в isReportReady и намеренно
 * строже, чем «балл больше нуля»: документ без автора подтверждения
 * невозможно защитить, когда застройщик придёт оспаривать.
 *
 * Рассмотрение карточки — отдельное действие с отдельным автором.
 * Аналитик формирует (DRAFT), руководитель подтверждает (CONFIRMED) или
 * возвращает на доработку (RETURNED) с комментарием. Возврат не удаляет
 * карточку: причина возврата — такой же результат работы, как и сама
 * карточка, и в журнале остаётся кто, когда и почему вернул.
 */

import type { PrismaClient } from '@prisma/client';

import { isReportReady } from '../core/scoring/explain';
import { getProjectScoring, writeAudit } from '../core/scoring/service';
import { HttpError } from './http';
import { resolveProjectId } from './queries';

export interface CreateSignalInput {
  /** Идентификатор или slug объекта — карточка формируется на объект. */
  project: string;
  actor: string;
  /** Необязательная приписка аналитика к снимку. */
  note?: string | null;
}

export interface SignalSnapshot {
  score: number;
  zone: string;
  /** Формула в текстовом виде — попадает в печатную карточку как есть. */
  formula: string;
  zoneReason: { ru: string; kk: string };
  confirmedCodes: string[];
  needsCheckCodes: string[];
  contributions: unknown[];
  openQuestions: unknown[];
  /** Момент снятия снимка — отличается от createdAt только в теории, но нужен в печати. */
  capturedAt: string;
}

/**
 * Формирование карточки.
 *
 * Снимок снимается в той же транзакции, что и запись: между чтением
 * состояния и созданием карточки не должно быть окна, в котором другой
 * аналитик успеет снять подтверждение фактора.
 */
export async function createSignal(prisma: PrismaClient, input: CreateSignalInput) {
  const projectId = await resolveProjectId(prisma, input.project);

  return prisma.$transaction(async (tx) => {
    const view = await getProjectScoring(tx, projectId);
    const { explanation } = view;

    if (!isReportReady(explanation)) {
      throw new HttpError('PRECONDITION', reasonNotReady(explanation), {
        integrity: explanation.integrityWarnings.map((item) => item.ru),
      });
    }

    const snapshot: SignalSnapshot = {
      score: explanation.score,
      zone: explanation.zone,
      formula: explanation.formula,
      zoneReason: explanation.zoneReason,
      confirmedCodes: explanation.confirmedCodes,
      needsCheckCodes: explanation.needsCheckCodes,
      /** Все шесть факторов, а не только подтверждённые: карточка должна
       *  показывать и то, что проверили и не нашли. */
      contributions: explanation.contributions,
      openQuestions: explanation.openQuestions,
      capturedAt: new Date().toISOString(),
    };

    const signal = await tx.signal.create({
      data: {
        projectId,
        score: explanation.score,
        zone: explanation.zone,
        factorsJson: JSON.stringify(snapshot),
        summary: input.note?.trim() ? input.note.trim() : view.summary.ru,
        status: 'DRAFT',
        createdBy: input.actor,
      },
    });

    await writeAudit(tx, {
      entityType: 'Signal',
      entityId: signal.id,
      action: 'SIGNAL_CREATED',
      actor: input.actor,
      after: { projectId, score: explanation.score, zone: explanation.zone },
      comment: input.note ?? null,
    });

    return {
      signal: { ...signal, factors: snapshot },
      /**
       * Признак stale отдаётся вместе с карточкой: если кэш объекта
       * расходился с расчётом, снимок сделан по расчёту, и аналитик
       * должен знать, что в списке объектов балл может отличаться.
       */
      staleCacheAtCreation: view.stale,
    };
  });
}

export interface ReviewSignalInput {
  signalId: string;
  decision: 'CONFIRMED' | 'RETURNED';
  actor: string;
  comment?: string | null;
}

/**
 * Рассмотрение карточки.
 *
 * Повторное рассмотрение запрещено: карточка — документ, и менять решение
 * по нему нужно новой карточкой, а не правкой старой. Возврат требует
 * комментария, подтверждение — нет: «согласен» не нуждается в объяснении,
 * «переделать» без объяснения бесполезно.
 */
export async function reviewSignal(prisma: PrismaClient, input: ReviewSignalInput) {
  if (input.decision === 'RETURNED' && !input.comment?.trim()) {
    throw new HttpError(
      'PRECONDITION',
      'Возврат карточки требует комментария: аналитик должен понять, что исправить.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const signal = await tx.signal.findUnique({ where: { id: input.signalId } });
    if (!signal) throw new HttpError('NOT_FOUND', 'Сигнальная карточка не найдена.');

    if (signal.status !== 'DRAFT') {
      throw new HttpError(
        'PRECONDITION',
        `Карточка уже рассмотрена (${signal.status}) ` +
          `${signal.reviewedBy ?? 'неизвестно кем'}. ` +
          'Изменение решения оформляется новой карточкой.',
      );
    }

    const updated = await tx.signal.update({
      where: { id: signal.id },
      data: {
        status: input.decision,
        reviewedBy: input.actor,
        reviewedAt: new Date(),
        reviewComment: input.comment?.trim() || null,
      },
    });

    await writeAudit(tx, {
      entityType: 'Signal',
      entityId: signal.id,
      action: input.decision === 'CONFIRMED' ? 'SIGNAL_CONFIRMED' : 'SIGNAL_RETURNED',
      actor: input.actor,
      before: { status: signal.status },
      after: { status: updated.status },
      comment: input.comment ?? null,
    });

    return {
      signalId: updated.id,
      status: updated.status,
      reviewedBy: updated.reviewedBy,
      reviewedAt: updated.reviewedAt?.toISOString() ?? null,
      /**
       * Балл объекта рассмотрением карточки не меняется — и это стоит
       * сказать вслух в ответе. Подтверждение карточки означает согласие
       * с документом, а не новый факт об объекте.
       */
      scoreDelta: 0 as const,
    };
  });
}

// ---------------------------------------------------------------------------

/** Текст отказа пишется для аналитика: он должен знать, что именно починить. */
function reasonNotReady(explanation: {
  confirmedCodes: readonly string[];
  integrityWarnings: readonly { ru: string }[];
}): string {
  if (explanation.confirmedCodes.length === 0) {
    return (
      'Карточку нельзя сформировать: у объекта нет подтверждённых факторов риска. ' +
      'Сигнал без подтверждённого фактора не содержит утверждения, которое можно проверить.'
    );
  }

  return (
    'Карточку нельзя сформировать: есть подтверждённые факторы без автора или даты решения. ' +
    explanation.integrityWarnings.map((item) => item.ru).join(' ')
  );
}
