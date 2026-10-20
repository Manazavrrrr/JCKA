/**
 * Мелкие части интерфейса, повторяющиеся на разных экранах.
 *
 * Собраны в одном файле потому, что каждая — несколько строк разметки, и
 * раскладывать их по отдельным файлам значило бы искать нужную в списке
 * из двенадцати почти одинаковых имён.
 *
 * Все компоненты здесь — серверные и без состояния: это чистые функции
 * из данных в разметку. Интерактив живёт в отдельных файлах с 'use
 * client' и рядом с тем действием, которое выполняет.
 *
 * Общее правило: ни один компонент не вычисляет предметные значения. Балл
 * и зона приходят готовыми из core/scoring, подписи — из
 * core/domain/enums. Если бы зона считалась здесь по баллу, в интерфейсе
 * появился бы второй, неизбежно расходящийся с первым, экземпляр правила
 * из технического задания.
 */

import Link from 'next/link';

import {
  FACTOR_STATUS_LABELS,
  type FactorStatus,
  type Label,
  RISK_ZONE_LABELS,
  type RiskZone,
} from '../core/domain/enums';
import { type Locale } from '../i18n/dict';

/** Зона риска: подпись приходит из перечислений, цвет — из класса. */
export function ZoneTag({ zone, locale }: { zone: string; locale: Locale }) {
  const label = RISK_ZONE_LABELS[zone as RiskZone];
  return (
    <span className={`zone zone-${zone}`}>{label ? label[locale] : zone}</span>
  );
}

/** Балл и зона вместе — основной показатель в списках и карточках. */
export function ScoreBadge({
  score,
  zone,
  locale,
}: {
  score: number;
  zone: string;
  locale: Locale;
}) {
  const label = RISK_ZONE_LABELS[zone as RiskZone];
  return (
    <span className={`score-badge zone-${zone}`} title={label ? label[locale] : zone}>
      <strong>{score}</strong>
      {/* «Балл» одинаков на двух языках — перевода здесь не нужно. */}
      <span>балл</span>
    </span>
  );
}

export function FactorStatusTag({
  status,
  locale,
}: {
  status: string;
  locale: Locale;
}) {
  const label = FACTOR_STATUS_LABELS[status as FactorStatus];
  const className =
    status === 'CONFIRMED'
      ? 'tag tag-danger'
      : status === 'NEEDS_CHECK'
        ? 'tag tag-warn'
        : 'tag';
  return <span className={className}>{label ? label[locale] : status}</span>;
}

/** Двуязычное значение с сервера. */
export function Bilingual({ value, locale }: { value: Label | null | undefined; locale: Locale }) {
  if (!value) return null;
  return <>{value[locale]}</>;
}

export function Stat({
  value,
  label,
  tone,
  href,
}: {
  value: number | string;
  label: string;
  tone?: RiskZone;
  href?: string;
}) {
  const body = (
    <div className="stat">
      <div className="stat-value" style={tone ? { color: `var(--zone-${tone.toLowerCase()})` } : undefined}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
  return href ? (
    <Link href={href} style={{ color: 'inherit' }}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="muted" style={{ padding: '8px 0' }}>{text}</p>;
}

/**
 * Дата и время решения.
 *
 * Формат фиксированный, а не локальный для браузера: карточка
 * распечатывается и подшивается, и дата в ней должна читаться одинаково
 * у аналитика, у руководителя и в бумажной копии.
 */
export function When({ value }: { value: string | Date | null | undefined }) {
  if (!value) return <span className="faint">—</span>;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return <span className="faint">—</span>;

  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <span className="nowrap mono">
      {`${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`}
    </span>
  );
}

export function DateOnly({ value }: { value: string | Date | null | undefined }) {
  if (!value) return <span className="faint">—</span>;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return <span className="faint">—</span>;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <span className="nowrap">{`${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`}</span>
  );
}

export function Notice({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'warn' | 'error';
  children: React.ReactNode;
}) {
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

export function PageHeader({
  title,
  lead,
  right,
}: {
  title: string;
  lead?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="row-between" style={{ marginBottom: 14 }}>
      <div>
        <h1>{title}</h1>
        {lead ? <p className="lead" style={{ marginBottom: 0 }}>{lead}</p> : null}
      </div>
      {right ? <div className="row no-print">{right}</div> : null}
    </div>
  );
}

