'use client';

/**
 * Общий механизм для всех кнопок, меняющих данные.
 *
 * Каждое действие в системе — подтверждение фактора, привязка объявления,
 * формирование карточки — проходит один и тот же путь: заблокировать кнопку,
 * вызвать API, при успехе обновить страницу, при отказе показать причину.
 * Этот путь написан здесь один раз.
 *
 * Два решения стоит объяснить.
 *
 * Первое: обновление делается через router.refresh(), а не перезагрузкой
 * страницы. Страницы — серверные компоненты, refresh перерисовывает их
 * свежими данными с сервера, но сохраняет позицию прокрутки и содержимое
 * других открытых форм. Подтвердив R3, аналитик остаётся там же, где был,
 * и видит новый балл.
 *
 * Второе: отказ не затирается следующей попыткой до её завершения, и текст
 * отказа хранится целиком, вместе с перечнем недостающих условий. Сервер
 * отвечает на невыполненное предусловие списком «не хватает: ...» — именно
 * его аналитик и должен прочитать, иначе запрет выглядит произволом.
 */

import { useCallback, useState, useTransition } from 'react';

import { ApiCallError } from '../../lib/api-client';

export interface ActionFailure {
  message: string;
  /** Недостающие условия из проверки предусловий. */
  missing: string[];
  /** Ошибки по полям формы. */
  fields: Record<string, string[]>;
}

export interface ActionState {
  busy: boolean;
  failure: ActionFailure | null;
  /** Сообщение об успехе, если действию есть что сказать. */
  done: string | null;
}

export function useAction() {
  const [state, setState] = useState<ActionState>({ busy: false, failure: null, done: null });
  const [, startTransition] = useTransition();

  const reset = useCallback(() => {
    setState({ busy: false, failure: null, done: null });
  }, []);

  /**
   * Выполняет действие.
   *
   * @param work      обращение к API
   * @param after     что сделать при успехе: обычно router.refresh
   * @param successText сообщение, если его стоит показать
   */
  const run = useCallback(
    async <T,>(
      work: () => Promise<T>,
      after?: (result: T) => void,
      successText?: string,
    ): Promise<T | null> => {
      setState({ busy: true, failure: null, done: null });
      try {
        const result = await work();
        // Обновление страницы — переход React: до его завершения кнопка
        // остаётся заблокированной, иначе двойной клик отправит действие дважды.
        startTransition(() => {
          after?.(result);
        });
        setState({ busy: false, failure: null, done: successText ?? null });
        return result;
      } catch (error) {
        setState({ busy: false, done: null, failure: toFailure(error) });
        return null;
      }
    },
    [],
  );

  return { ...state, run, reset };
}

function toFailure(error: unknown): ActionFailure {
  if (error instanceof ApiCallError) {
    return { message: error.message, missing: error.missing, fields: error.details };
  }
  if (error instanceof Error) {
    return { message: error.message, missing: [], fields: {} };
  }
  return { message: 'Непредвиденная ошибка.', missing: [], fields: {} };
}
