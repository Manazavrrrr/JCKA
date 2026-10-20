/**
 * Динамика риска во времени.
 *
 * График нужен не для красоты. Балл объекта — величина, которая меняется
 * от решений людей, и важен не только он сам, но и его направление: объект
 * с 40 баллами, выросшими с 10 за месяц, требует иного внимания, чем объект,
 * стоящий на 40 баллах полгода.
 *
 * Полосы зон нарисованы по тем же порогам, что и расчёт, и взяты из модели,
 * а не вписаны числами: иначе при изменении порога в ТЗ график начал бы
 * расходиться с баллом.
 *
 * Важная оговорка про шкалу времени: точки расставлены равномерно, а не
 * пропорционально датам. Снимков немного (они создаются только при реальном
 * изменении балла), и пропорциональная шкала слепила бы несколько решений
 * одного дня в одну вертикальную линию. Здесь график отвечает на вопрос
 * «как менялось», а не «когда именно» — на второй отвечает журнал решений,
 * который стоит ниже на той же странице.
 *
 * Чистый SVG без библиотек: ещё одна зависимость ради двадцати точек не нужна,
 * а печать такого графика работает без оговорок.
 */

import { RED_THRESHOLD, YELLOW_THRESHOLD } from '../core/scoring/model';
import { type Locale } from '../i18n/dict';
import { When } from './ui';

export interface ScorePoint {
  at: string;
  score: number;
  zone: string;
  factors: readonly string[];
  reason: string | null;
}

const WIDTH = 680;
const HEIGHT = 140;
const PAD_LEFT = 34;
const PAD_RIGHT = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const MAX = 100;

function yOf(score: number): number {
  const usable = HEIGHT - PAD_TOP - PAD_BOTTOM;
  return PAD_TOP + (1 - score / MAX) * usable;
}

function xOf(index: number, count: number): number {
  const usable = WIDTH - PAD_LEFT - PAD_RIGHT;
  if (count <= 1) return PAD_LEFT + usable / 2;
  return PAD_LEFT + (index / (count - 1)) * usable;
}

export function ScoreHistory({
  points,
  locale,
}: {
  points: readonly ScorePoint[];
  locale: Locale;
}) {
  if (points.length === 0) {
    return (
      <p className="muted">
        {locale === 'kk'
          ? 'Балл әлі өзгермеген: тарих жазбасы жоқ.'
          : 'Балл ещё не менялся: записей истории нет.'}
      </p>
    );
  }

  const count = points.length;
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(index, count)} ${yOf(point.score)}`)
    .join(' ');

  const last = points[count - 1];
  const first = points[0];
  const delta = last && first ? last.score - first.score : 0;

  return (
    <>
      <svg
        className="sparkline"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          locale === 'kk'
            ? `Қауіп динамикасы: ${count} нүкте, соңғы балл ${last?.score ?? 0}.`
            : `Динамика риска: ${count} точек, последний балл ${last?.score ?? 0}.`
        }
      >
        {/* Полосы зон: фон говорит, в какой зоне проходила линия. */}
        <rect
          className="zone-band"
          x={PAD_LEFT}
          y={yOf(MAX)}
          width={WIDTH - PAD_LEFT - PAD_RIGHT}
          height={yOf(RED_THRESHOLD) - yOf(MAX)}
          fill="var(--zone-red-soft)"
        />
        <rect
          className="zone-band"
          x={PAD_LEFT}
          y={yOf(RED_THRESHOLD)}
          width={WIDTH - PAD_LEFT - PAD_RIGHT}
          height={yOf(YELLOW_THRESHOLD) - yOf(RED_THRESHOLD)}
          fill="var(--zone-yellow-soft)"
        />
        <rect
          className="zone-band"
          x={PAD_LEFT}
          y={yOf(YELLOW_THRESHOLD)}
          width={WIDTH - PAD_LEFT - PAD_RIGHT}
          height={yOf(0) - yOf(YELLOW_THRESHOLD)}
          fill="var(--zone-green-soft)"
        />

        {[0, YELLOW_THRESHOLD, RED_THRESHOLD, MAX].map((value) => (
          <g key={value}>
            <line
              className="axis"
              x1={PAD_LEFT}
              y1={yOf(value)}
              x2={WIDTH - PAD_RIGHT}
              y2={yOf(value)}
            />
            <text x={4} y={yOf(value) + 4} fontSize={10} fill="var(--text-faint)">
              {value}
            </text>
          </g>
        ))}

        <path className="line" d={path} />

        {points.map((point, index) => (
          <circle
            key={point.at}
            cx={xOf(index, count)}
            cy={yOf(point.score)}
            r={4}
            fill={`var(--zone-${point.zone.toLowerCase()})`}
            stroke="var(--surface)"
            strokeWidth={1.5}
          >
            <title>{`${point.score} — ${point.reason ?? ''}`}</title>
          </circle>
        ))}
      </svg>

      <p className="faint" style={{ margin: '4px 0 10px' }}>
        {locale === 'kk' ? 'Барлық өзгеріс' : 'Всего изменений'}: {count}.{' '}
        {delta === 0
          ? locale === 'kk'
            ? 'Бастапқы деңгеймен бірдей.'
            : 'Относительно первой точки без изменений.'
          : `${locale === 'kk' ? 'Бастапқыдан' : 'От первой точки'}: ${delta > 0 ? '+' : ''}${delta}.`}
      </p>

      <table>
        <thead>
          <tr>
            <th>{locale === 'kk' ? 'Күні' : 'Дата'}</th>
            <th className="num">{locale === 'kk' ? 'Балл' : 'Балл'}</th>
            <th>{locale === 'kk' ? 'Факторлар' : 'Факторы'}</th>
            <th>{locale === 'kk' ? 'Себебі' : 'Причина'}</th>
          </tr>
        </thead>
        <tbody>
          {[...points].reverse().map((point) => (
            <tr key={point.at}>
              <td>
                <When value={point.at} />
              </td>
              <td className="num">
                <span className={`zone zone-${point.zone}`}>{point.score}</span>
              </td>
              <td>
                {point.factors.length === 0 ? (
                  <span className="faint">—</span>
                ) : (
                  <span className="row" style={{ gap: 4 }}>
                    {point.factors.map((code) => (
                      <span className="tag tag-code" key={code}>
                        {code}
                      </span>
                    ))}
                  </span>
                )}
              </td>
              <td className="faint">{point.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
