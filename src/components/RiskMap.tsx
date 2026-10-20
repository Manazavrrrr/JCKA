/**
 * Схема объектов региона.
 *
 * Карта здесь — не географическая карта, и это важно оговорить. Внешний
 * тайловый сервис не используется: приложение должно запускаться без
 * ключей и без интернета, иначе демонстрация зависит от вайфая в зале,
 * а внедрение — от закупки картографической лицензии.
 *
 * Поэтому объекты раскладываются по координатам на простой сетке:
 * относительное положение сохраняется, расстояния видны, цвет точки —
 * зона риска. Для задачи «где сосредоточены красные объекты» этого
 * достаточно. Подключение настоящей карты — замена одного компонента:
 * координаты уже лежат в lat/lng каждого объекта.
 *
 * Раскладка считается от границ набора, а не от фиксированного прямо-
 * угольника области: при любом наборе объектов точки занимают всю
 * площадь схемы, а не слипаются в углу.
 */

import Link from 'next/link';

import { RISK_ZONE_LABELS, type RiskZone } from '../core/domain/enums';
import { type Locale } from '../i18n/dict';

export interface MapPoint {
  id: string;
  slug: string;
  name: string;
  nameKk: string | null;
  lat: number | null;
  lng: number | null;
  riskScore: number;
  riskZone: string;
}

/** Отступ от краёв, чтобы точки на границе не обрезались. */
const PADDING_PCT = 7;

export function RiskMap({ points, locale }: { points: readonly MapPoint[]; locale: Locale }) {
  const placed = points.filter(
    (point): point is MapPoint & { lat: number; lng: number } =>
      typeof point.lat === 'number' && typeof point.lng === 'number',
  );

  if (placed.length === 0) {
    return (
      <div className="map">
        <div className="map-grid" />
      </div>
    );
  }

  const lats = placed.map((point) => point.lat);
  const lngs = placed.map((point) => point.lng);
  const bounds = {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };

  /** Один объект или объекты на одной широте — делитель не должен стать нулём. */
  const spanLat = bounds.maxLat - bounds.minLat || 1;
  const spanLng = bounds.maxLng - bounds.minLng || 1;
  const usable = 100 - PADDING_PCT * 2;

  return (
    <div className="map">
      <div className="map-grid" />
      {placed.map((point) => {
        const left = PADDING_PCT + ((point.lng - bounds.minLng) / spanLng) * usable;
        // Широта растёт к северу, координата сверху вниз — отсюда вычитание.
        const top = PADDING_PCT + ((bounds.maxLat - point.lat) / spanLat) * usable;
        const name = locale === 'kk' ? point.nameKk ?? point.name : point.name;
        const zone = RISK_ZONE_LABELS[point.riskZone as RiskZone];

        return (
          <Link
            key={point.id}
            href={`/projects/${point.slug}`}
            className={`map-pin zone-${point.riskZone}`}
            style={{ left: `${left}%`, top: `${top}%` }}
            title={`${name} — ${point.riskScore}, ${zone ? zone[locale] : point.riskZone}`}
            aria-label={name}
          />
        );
      })}
    </div>
  );
}
