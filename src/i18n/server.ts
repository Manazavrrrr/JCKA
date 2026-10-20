/**
 * Язык интерфейса на сервере.
 *
 * Хранится в cookie, а не в localStorage и не в адресе страницы, и это
 * осознанный выбор. Страницы — серверные компоненты: они читают данные
 * напрямую из базы и собирают готовую разметку. localStorage на сервере
 * недоступен, поэтому язык из него пришёл бы только после загрузки
 * страницы — и аналитик увидел бы вспышку русского текста перед
 * казахским. Префикс в адресе (/kk/projects) удвоил бы все ссылки.
 *
 * Cookie читается до отрисовки, поэтому страница сразу приходит на нужном
 * языке. Переключатель ставит cookie на клиенте и просит Next перерисовать
 * серверную часть.
 */

import { cookies } from 'next/headers';

import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale, isLocale } from './dict';

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
