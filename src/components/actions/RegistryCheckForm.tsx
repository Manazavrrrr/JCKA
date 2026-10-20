'use client';

/**
 * Проверка в реестре: машинный запрос и занесение ручной выписки.
 *
 * Две формы живут в одном компоненте, и это не экономия на файлах.
 * Выбор реестра — первое, что делает аналитик, и именно он решает, какая
 * форма вообще возможна: у источника с открытым API есть кнопка запроса,
 * у источника без него — только поля ручной выписки. Разведённые по двум
 * карточкам, эти формы заставляли бы выбирать реестр дважды и позволяли бы
 * выбрать в них разные, а потом удивляться, почему кнопка не работает.
 *
 * Поэтому переключателя «авто/вручную» здесь нет. Режим определяется
 * режимом доступа выбранного реестра, и невозможное состояние — «отправить
 * запрос к elicense.kz» — не достижимо нажатием. Сервер всё равно проверит
 * это сам, но интерфейс не должен предлагать то, что заведомо отклонят.
 *
 * Ручная выписка показывает поле пояснения как обязательное и говорит об
 * этом до отправки, а не после отказа. Проверка без описания — утверждение
 * человека без содержания: через месяц такая запись неотличима от случайно
 * нажатой кнопки.
 *
 * Несошедшийся контрольный разряд БИН показывается предупреждением рядом с
 * выбранным застройщиком, но кнопку не блокирует. БИН вносит человек, и
 * инструмент надзорного органа не отказывается отправлять запрос из-за
 * собственного подозрения — он сообщает о нём и отправляет.
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import {
  REGISTRY_ACCESS_MODE_LABELS,
  REGISTRY_ANSWERS,
  REGISTRY_ANSWER_HINTS,
  REGISTRY_ANSWER_LABELS,
  type RegistryAccessMode,
  type RegistryAnswer,
} from '../../core/registry';
import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export interface RegistrySourceOption {
  id: string;
  name: string;
  accessMode: RegistryAccessMode;
  reference: string;
}

export interface RegistryDeveloperOption {
  id: string;
  name: string;
  binFormatted: string;
  binLooksValid: boolean;
  projects: Array<{ id: string; name: string }>;
}

/** Ответ машинной проверки — ровно то, что нужно сказать человеку сразу. */
interface RunResult {
  answer: RegistryAnswer;
  error: string | null;
  disagreements: number;
  bearingOnR1: 'WITHDRAWS_R1' | 'NO_BEARING';
}

export function RegistryCheckForm({
  locale,
  sources,
  developers,
}: {
  locale: Locale;
  sources: RegistrySourceOption[];
  developers: RegistryDeveloperOption[];
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [developerId, setDeveloperId] = useState(developers[0]?.id ?? '');
  const [projectId, setProjectId] = useState('');
  const [answer, setAnswer] = useState<RegistryAnswer>('FOUND');
  const [note, setNote] = useState('');
  const [attachment, setAttachment] = useState('');
  const [summary, setSummary] = useState<string | null>(null);

  const source = useMemo(() => sources.find((item) => item.id === sourceId) ?? null, [sources, sourceId]);
  const developer = useMemo(
    () => developers.find((item) => item.id === developerId) ?? null,
    [developers, developerId],
  );

  const automatic = source?.accessMode === 'OPEN_API';

  /**
   * Смена застройщика сбрасывает выбранный объект: объекты принадлежат
   * застройщику, и сохранённый от прошлого выбора id указывал бы на чужой.
   */
  function chooseDeveloper(id: string) {
    setDeveloperId(id);
    setProjectId('');
  }

  function run() {
    setSummary(null);
    return action.run(
      () =>
        api.post<RunResult>('/api/registry/checks', {
          mode: 'AUTO',
          sourceId,
          developerId,
          ...(projectId && { projectId }),
        }),
      (result) => {
        setSummary(describe(result, locale));
        router.refresh();
      },
    );
  }

  function record() {
    setSummary(null);
    return action.run(
      () =>
        api.post<{ id: string }>('/api/registry/checks', {
          mode: 'MANUAL',
          sourceId,
          developerId,
          ...(projectId && { projectId }),
          answer,
          note: note.trim(),
          ...(attachment.trim() && { attachment: attachment.trim() }),
          ...(source?.reference && { requestUrl: source.reference }),
        }),
      () => {
        setSummary('Ручная проверка занесена. На балл объекта она не влияет.');
        setNote('');
        setAttachment('');
        router.refresh();
      },
    );
  }

  const noteTooShort = note.trim().length < 10;
  const incomplete = sourceId.length === 0 || developerId.length === 0;

  return (
    <div className="card no-print">
      <h2 style={{ marginTop: 0 }}>{t('registryRun')}</h2>

      <div className="grid grid-3">
        <div className="field">
          <label htmlFor="registry-source">{t('registrySource')}</label>
          <select
            id="registry-source"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
          >
            {sources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {REGISTRY_ACCESS_MODE_LABELS[item.accessMode][locale]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="registry-developer">{t('registryDeveloper')}</label>
          <select
            id="registry-developer"
            value={developerId}
            onChange={(event) => chooseDeveloper(event.target.value)}
          >
            {developers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.binFormatted}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="registry-project">{t('project')}</label>
          <select
            id="registry-project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">{t('all')}</option>
            {(developer?.projects ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {developer && !developer.binLooksValid ? (
        <p className="tag tag-warn" style={{ marginTop: 6 }}>
          {t('registryBinWarning')}
        </p>
      ) : null}

      {automatic ? (
        <>
          <p className="faint" style={{ marginTop: 8 }}>
            {t('registryRunHint')}
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={action.busy || incomplete}
              onClick={run}
            >
              {action.busy ? t('loading') : t('registryRunNow')}
            </button>
          </div>
        </>
      ) : (
        <>
          {/*
           * У источника без API кнопка запроса не показывается вовсе.
           * Показанная и отключённая, она обещала бы, что когда-нибудь
           * заработает, — а она не заработает: у портала нет API, и это
           * свойство портала, а не недоделка системы.
           */}
          <p className="faint" style={{ marginTop: 8 }}>
            {t('registryManualHint')}
          </p>

          <div className="grid grid-2" style={{ marginTop: 6 }}>
            <div className="field">
              <label htmlFor="registry-answer">{t('registryAnswer')}</label>
              <select
                id="registry-answer"
                value={answer}
                onChange={(event) => setAnswer(event.target.value as RegistryAnswer)}
              >
                {REGISTRY_ANSWERS.map((value) => (
                  <option key={value} value={value}>
                    {REGISTRY_ANSWER_LABELS[value][locale]}
                  </option>
                ))}
              </select>
              <p className="faint" style={{ margin: '4px 0 0' }}>
                {REGISTRY_ANSWER_HINTS[answer][locale]}
              </p>
            </div>

            <div className="field">
              <label htmlFor="registry-attachment">{t('registryAttachment')}</label>
              <input
                id="registry-attachment"
                type="text"
                value={attachment}
                onChange={(event) => setAttachment(event.target.value)}
                placeholder="Исх. № 04-12/318 от 14.10.2026"
              />
              <p className="faint" style={{ margin: '4px 0 0' }}>
                {t('registryAttachmentHint')}
              </p>
            </div>
          </div>

          <div className="field" style={{ marginTop: 6 }}>
            <label htmlFor="registry-note">{t('registryNote')}</label>
            <textarea
              id="registry-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Открыт homeportal.kz, поиск по БИН застройщика: объект в перечне гарантированных не значится."
            />
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={action.busy || incomplete || noteTooShort}
              onClick={record}
            >
              {action.busy ? t('loading') : t('registryManualAdd')}
            </button>
            {noteTooShort ? (
              <span className="faint">Пояснение обязательно: не короче десяти знаков.</span>
            ) : null}
          </div>
        </>
      )}

      <Feedback failure={action.failure} done={action.failure ? null : summary} />
    </div>
  );
}

/**
 * Итог машинной проверки одной фразой.
 *
 * Сказать нужно три вещи, и именно в этом порядке: что ответил реестр,
 * сколько расхождений в сверке и что из этого следует для фактора R1.
 * Последнее — всегда, в том числе когда не следует ничего: молчание на
 * этом месте читалось бы как «балл уже изменён».
 */
function describe(result: RunResult, locale: Locale): string {
  const answer = REGISTRY_ANSWER_LABELS[result.answer][locale].toLowerCase();

  if (result.answer === 'UNAVAILABLE') {
    return `Ответ не получен${result.error ? `: ${result.error}` : '.'} Проверка сохранена — след попытки останется в истории.`;
  }

  const disagreements =
    result.disagreements === 0
      ? 'расхождений со сверкой нет'
      : `расхождений: ${result.disagreements}`;

  const bearing =
    result.bearingOnR1 === 'WITHDRAWS_R1'
      ? 'Это снимает основание для фактора R1 — снять его нужно в карточке объекта вручную.'
      : 'На фактор R1 ответ не влияет; балл объекта не изменился.';

  return `Реестр ответил: ${answer}, ${disagreements}. ${bearing}`;
}
