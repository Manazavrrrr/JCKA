'use client';

/**
 * Переключатель языка.
 *
 * Ставит cookie и просит Next перерисовать серверную часть страницы.
 * Перезагрузки нет: router.refresh() обновляет серверные компоненты,
 * сохраняя состояние открытых форм. Аналитик, набравший обоснование
 * фактора и переключивший язык, не теряет набранное.
 */

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { LOCALES, LOCALE_COOKIE, type Locale, UI } from '../i18n/dict';

export function LocaleSwitch({ current }: { current: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(locale: Locale) {
    if (locale === current) return;
    // Год — чтобы выбор языка не сбрасывался между сменами.
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div className="lang" role="group" aria-label="Язык интерфейса / Интерфейс тілі">
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          aria-pressed={locale === current}
          disabled={pending}
          onClick={() => choose(locale)}
        >
          {locale === 'ru' ? UI.langRu[current] : UI.langKk[current]}
        </button>
      ))}
    </div>
  );
}
