'use client';

/**
 * Проверка правового основания привлечения средств.
 *
 * Самое важное поле ввода во всём приложении, и единственное, которому
 * отведён собственный компонент вместо строки в общей форме объекта.
 *
 * Причина — в различии трёх состояний, которое легко потерять. Техническое
 * задание говорит о «рекламе без разрешения», и соблазн сделать здесь галочку
 * «разрешение есть» велик. Но снятая галочка означала бы одновременно
 * «проверили, разрешения нет» и «ещё не проверяли», а это разные вещи:
 * первое даёт объекту 35 баллов и ведёт к сигналу в прокуратуру, второе —
 * задача в работу аналитику. Поэтому вариантов три, и выбран по умолчанию
 * тот, который ничего не утверждает.
 *
 * Второе: разрешение МИО — не единственное законное основание. Закон РК
 * о долевом участии называет также гарантию Единого оператора и участие
 * банка второго уровня, а после возведения каркаса — собственные средства.
 * Поэтому рядом со статусом выбирается способ: «основание подтверждено»
 * без указания какого именно не является результатом проверки.
 *
 * Третье: источник обязателен для любого результата, кроме «не проверено».
 * Вывод о наличии или отсутствии основания будет основанием для меры
 * воздействия, и на вопрос «откуда это известно» должен быть ответ в системе,
 * а не в памяти аналитика.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  LEGAL_BASIS_STATUSES,
  LEGAL_BASIS_STATUS_LABELS,
  LEGAL_BASIS_TYPES,
  LEGAL_BASIS_TYPE_LABELS,
  type LegalBasisStatus,
  type LegalBasisType,
} from '../../core/domain/enums';
import { type Locale, translator } from '../../i18n/dict';
import { api } from '../../lib/api-client';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export function LegalBasisForm({
  projectSlug,
  locale,
  status: initialStatus,
  type: initialType,
  source: initialSource,
  note: initialNote,
}: {
  projectSlug: string;
  locale: Locale;
  status: string;
  type: string;
  source: string | null;
  note: string | null;
}) {
  const t = translator(locale);
  const router = useRouter();
  const action = useAction();

  const [status, setStatus] = useState<LegalBasisStatus>(initialStatus as LegalBasisStatus);
  const [type, setType] = useState<LegalBasisType>(initialType as LegalBasisType);
  const [source, setSource] = useState(initialSource ?? '');
  const [note, setNote] = useState(initialNote ?? '');

  const sourceRequired = status !== 'NOT_CHECKED';
  const blocked = sourceRequired && source.trim().length === 0;

  async function submit() {
    await action.run(
      () =>
        api.post(`/api/projects/${projectSlug}/legal-basis`, {
          status,
          type,
          ...(source.trim() && { source: source.trim() }),
          ...(note.trim() && { note: note.trim() }),
        }),
      () => router.refresh(),
      'Результат проверки сохранён. Балл пересчитан.',
    );
  }

  return (
    <div className="no-print">
      <div className="notice notice-info">{t('scoringLegalBasisHint')}</div>

      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="lb-status">Результат проверки</label>
          <select
            id="lb-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as LegalBasisStatus)}
          >
            {LEGAL_BASIS_STATUSES.map((item) => (
              <option key={item} value={item}>
                {LEGAL_BASIS_STATUS_LABELS[item][locale]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="lb-type">Способ организации долевого участия</label>
          <select
            id="lb-type"
            value={type}
            onChange={(event) => setType(event.target.value as LegalBasisType)}
          >
            {LEGAL_BASIS_TYPES.map((item) => (
              <option key={item} value={item}>
                {LEGAL_BASIS_TYPE_LABELS[item][locale]}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="lb-source">
            {t('scoringLegalBasisSource')}
            {sourceRequired ? ' — обязательно' : ''}
          </label>
          <input
            id="lb-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="Номер разрешения, запись реестра, письмо оператора"
          />
        </div>

        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="lb-note">{t('comment')}</label>
          <textarea
            id="lb-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </div>

      {status === 'CONFIRMED_ABSENT' ? (
        <div className="notice notice-warn">
          Выбран результат «установлено отсутствие основания». После сохранения
          фактор R1 станет доступен для подтверждения — это 35 баллов и
          основание для приоритетной проверки.
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn-primary"
          disabled={action.busy || blocked}
          onClick={submit}
          title={blocked ? 'Укажите источник сведений' : undefined}
        >
          {t('save')}
        </button>
      </div>

      <Feedback failure={action.failure} done={action.done} />
    </div>
  );
}
