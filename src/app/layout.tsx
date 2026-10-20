/**
 * Оболочка приложения.
 *
 * Серверный компонент: читает язык из cookie и считает числа для
 * навигации. Благодаря этому страница приходит сразу на нужном языке и
 * с актуальными счётчиками, без промежуточного состояния загрузки.
 *
 * Счётчики считаются здесь, а не на каждой странице, потому что они
 * показываются на всех: лишний запрос в SQLite дешевле дублирования
 * логики и расхождений между разделами.
 */

import type { Metadata } from 'next';

import { Nav } from '../components/Nav';
import { LocaleSwitch } from '../components/LocaleSwitch';
import { translator } from '../i18n/dict';
import { getLocale } from '../i18n/server';
import { prisma } from '../lib/db';

import './globals.css';

export const metadata: Metadata = {
  title: 'SAQ QURYLYS — мониторинг рисков долевого строительства',
  description:
    'Выявление подозрительных объявлений о продаже жилья на стадии строительства, ' +
    'сопоставление с реестром объектов и проверяемая оценка риска.',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = translator(locale);

  const [pendingSuggestions, unlinkedPublications, draftSignals, collectQueue] = await Promise.all([
    prisma.aiSuggestion.count({ where: { status: 'PENDING' } }),
    prisma.publication.count({ where: { linkStatus: 'UNLINKED' } }),
    prisma.signal.count({ where: { status: 'DRAFT' } }),
    /**
     * Очередь сбора: фильтр элемент взял, а человек по нему ещё не решил.
     * Отклонённое и уже заведённое объявлением из счётчика уходит — иначе
     * число перестало бы означать работу и стало бы означать объём базы.
     */
    prisma.collectedItem.count({
      where: { verdict: 'KEPT', publicationId: null, dismissedAt: null },
    }),
  ]);

  return (
    <html lang={locale}>
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <strong>{t('appName')}</strong>
              <span>{t('appTagline')}</span>
            </div>
            <Nav
              locale={locale}
              counts={{ pendingSuggestions, unlinkedPublications, draftSignals, collectQueue }}
            />
            <LocaleSwitch current={locale} />
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
