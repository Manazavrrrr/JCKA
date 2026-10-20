'use client';

/**
 * Привязка объявления к объекту реестра.
 *
 * Связь между объявлением и ЖК устанавливает человек, и это не осторожность,
 * а необходимость. Нечёткое сопоставление названий ошибается на обычных для
 * рынка вещах: «Алтай» и «Алтай Арман» — разные комплексы, один застройщик
 * ведёт несколько объектов с похожими названиями, а перекупщик пишет название
 * как придётся. Неверная привязка означает ложный риск на конкретном
 * застройщике — то есть именно тот вред, от которого система должна защищать.
 *
 * Поэтому гипотеза сопоставления показывается как предложение с процентом
 * схожести и основанием («совпало название и телефон»), а решение принимает
 * аналитик. Снятие привязки — такое же решение и так же попадает в журнал:
 * ошибочную связь нужно иметь возможность исправить, не теряя следа.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export interface LinkOption {
  id: string;
  name: string;
}

export function LinkPublication({
  publicationId,
  locale,
  currentProjectId,
  projects,
  suggested,
}: {
  publicationId: string;
  locale: Locale;
  currentProjectId: string | null;
  projects: readonly LinkOption[];
  /** Гипотезы сопоставления: объект, схожесть, основание. */
  suggested: readonly { projectId: string; projectName: string; score: number; reason: string }[];
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [projectId, setProjectId] = useState(
    currentProjectId ?? suggested[0]?.projectId ?? projects[0]?.id ?? '',
  );
  const [comment, setComment] = useState('');

  function link(target: string | null) {
    return action.run(
      () =>
        api.post(`/api/publications/${publicationId}/link`, {
          projectId: target,
          ...(comment.trim() && { comment: comment.trim() }),
        }),
      () => {
        setComment('');
        router.refresh();
      },
      target === null ? 'Привязка снята.' : 'Привязка подтверждена.',
    );
  }

  return (
    <div className="no-print">
      {suggested.length > 0 && !currentProjectId ? (
        <div className="notice notice-info">
          <strong>Предложения сопоставления.</strong> Это гипотезы, а не связи:
          подтверждение — за аналитиком.
          <ul>
            {suggested.map((item) => (
              <li key={item.projectId}>
                {item.projectName} — {Math.round(item.score * 100)}%, {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="link-project">{t('publicationsLink')}</label>
        <select
          id="link-project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="link-comment">{t('comment')}</label>
        <input
          id="link-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="На чём основано решение о связи"
        />
      </div>

      <div className="row">
        <button
          type="button"
          className="btn-primary"
          disabled={action.busy || !projectId || projectId === currentProjectId}
          onClick={() => link(projectId)}
        >
          {t('publicationsLink')}
        </button>
        {currentProjectId ? (
          <button type="button" className="btn" disabled={action.busy} onClick={() => link(null)}>
            {t('publicationsUnlink')}
          </button>
        ) : null}
      </div>

      <Feedback failure={action.failure} done={action.done} />
    </div>
  );
}
