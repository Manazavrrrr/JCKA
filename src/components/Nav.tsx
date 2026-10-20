'use client';

/**
 * Навигация по пяти модулям.
 *
 * Клиентский компонент по одной причине: нужен текущий адрес, чтобы
 * отметить открытый раздел через aria-current. Данные для счётчиков
 * приходят сверху, из серверной оболочки, — компонент сам ничего не
 * запрашивает.
 *
 * Счётчики на пунктах показывают не объём базы, а объём работы: сколько
 * гипотез ждёт решения, сколько объявлений не разобрано, сколько карточек
 * не рассмотрено. Это те три числа, по которым аналитик решает, с чего
 * начать день, и их отсутствие в навигации заставило бы его обходить
 * разделы по очереди.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { type Locale, translator } from '../i18n/dict';

export interface NavCounts {
  pendingSuggestions: number;
  unlinkedPublications: number;
  draftSignals: number;
  /** Собранное, по чему аналитик ещё не принял решение. */
  collectQueue: number;
}

export function Nav({ locale, counts }: { locale: Locale; counts: NavCounts }) {
  const t = translator(locale);
  const pathname = usePathname();

  const items = [
    { href: '/', label: t('navOverview'), exact: true },
    { href: '/projects', label: t('navProjects') },
    /**
     * Сбор стоит перед объявлениями: он их поставляет. Пункт «Слова-ловушки»
     * — настройка этого же сбора, поэтому идёт сразу следом, а не в конце
     * списка рядом с разделами, с которыми у него нет ничего общего.
     */
    { href: '/collect', label: t('navCollect'), count: counts.collectQueue },
    { href: '/terms', label: t('navTerms') },
    { href: '/publications', label: t('navPublications'), count: counts.unlinkedPublications },
    /**
     * Реестры идут после объявлений: сначала находится реклама, потом
     * проверяется, что про этот объект говорит государство.
     */
    { href: '/registry', label: t('navRegistry') },
    { href: '/suggestions', label: t('navSuggestions'), count: counts.pendingSuggestions },
    { href: '/signals', label: t('navSignals'), count: counts.draftSignals },
    { href: '/connections', label: t('navConnections') },
    { href: '/analyze', label: t('navAnalyze') },
  ];

  return (
    <nav className="nav">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
            {item.label}
            {item.count ? <span className="nav-count">{item.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
