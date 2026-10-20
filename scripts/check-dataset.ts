/**
 * Проверка целостности демонстрационного набора данных.
 *
 *   npx tsx scripts/check-dataset.ts
 *
 * Скрипт не трогает БД и не требует Prisma — он работает с исходным набором
 * и движком скоринга. Это тот самый «воспроизводимый скрипт проверки»
 * из раздела 8 ТЗ: он подтверждает, что данные и формула согласованы,
 * ещё до запуска приложения.
 *
 * Что проверяется:
 *   1. Объём набора: не менее 8 объектов и 12 публикаций.
 *   2. Каждый фрагмент-доказательство дословно присутствует в тексте публикации.
 *   3. Балл и зона каждого объекта совпадают с ожиданием, записанным в наборе.
 *   4. Контрольные сценарии A, B и C дают числа из ТЗ.
 *   5. Инварианты модели, которые нельзя нарушить ни при каком редактировании:
 *      - R1 подтверждается только при legalBasisStatus = CONFIRMED_ABSENT;
 *      - R5 подтверждается только при расхождении готовности от 20 п.п.
 *        при наличии источников у обоих значений;
 *      - R3 не подтверждается для объектов, введённых в эксплуатацию;
 *      - R2 подтверждается только при наличии фрагмента-доказательства;
 *      - у каждого подтверждённого фактора есть автор и дата решения.
 */

import { isUnderConstruction, type EvidenceKind, type FactorCode } from '../src/core/domain/enums';
import {
  checkFactorEligibility,
  type EligibilityContext,
} from '../src/core/scoring/eligibility';
import {
  FACTOR_WEIGHTS,
  READINESS_GAP_THRESHOLD_PP,
  computeScore,
  readinessGapPp,
  resolveZone,
  sortFactorCodes,
} from '../src/core/scoring/model';
import { projects, publications, type SeedProject } from '../prisma/seed-data';

const problems: string[] = [];
const checks: string[] = [];

function fail(message: string): void {
  problems.push(message);
}

function pass(message: string): void {
  checks.push(message);
}

// ---------------------------------------------------------------------------
// 1. Объём набора
// ---------------------------------------------------------------------------

if (projects.length < 8) {
  fail(`Объектов в наборе ${projects.length}, по ТЗ требуется не менее 8.`);
} else {
  pass(`Объектов: ${projects.length} (требуется ≥ 8)`);
}

if (publications.length < 12) {
  fail(`Публикаций в наборе ${publications.length}, по ТЗ требуется не менее 12.`);
} else {
  pass(`Публикаций: ${publications.length} (требуется ≥ 12)`);
}

const unlinked = publications.filter((item) => item.linkStatus === 'UNLINKED');
if (unlinked.length === 0) {
  fail('Нет ни одной публикации без привязки — нечего показать на демонстрации работы ИИ.');
} else {
  pass(`Публикаций без привязки для разбора ИИ: ${unlinked.length}`);
}

const slugs = new Set(projects.map((item) => item.slug));
if (slugs.size !== projects.length) {
  fail('Найдены повторяющиеся slug у объектов.');
}

const pubKeys = new Set(publications.map((item) => item.key));
if (pubKeys.size !== publications.length) {
  fail('Найдены повторяющиеся ключи у публикаций.');
}

// ---------------------------------------------------------------------------
// 2. Фрагменты-доказательства
// ---------------------------------------------------------------------------

const textByKey = new Map(publications.map((item) => [item.key, item.rawText]));
let fragmentCount = 0;

for (const project of projects) {
  for (const factor of project.factors) {
    for (const evidence of factor.evidence ?? []) {
      if (!evidence.publicationKey || !evidence.fragment) continue;

      const rawText = textByKey.get(evidence.publicationKey);
      if (rawText === undefined) {
        fail(
          `${project.key} / ${factor.code}: доказательство ссылается на неизвестную публикацию "${evidence.publicationKey}".`,
        );
        continue;
      }

      fragmentCount += 1;
      if (!rawText.includes(evidence.fragment)) {
        fail(
          `${project.key} / ${factor.code}: фрагмент не найден в тексте публикации ${evidence.publicationKey}.\n` +
            `      искали: "${evidence.fragment}"`,
        );
      }
    }
  }
}

if (fragmentCount === 0) {
  fail('В наборе нет ни одного текстового фрагмента-доказательства.');
} else {
  pass(`Текстовых фрагментов-доказательств проверено: ${fragmentCount}`);
}

// ---------------------------------------------------------------------------
// 3. Балл и зона
// ---------------------------------------------------------------------------

function confirmed(project: SeedProject) {
  return sortFactorCodes(
    project.factors.filter((factor) => factor.status === 'CONFIRMED').map((factor) => factor.code),
  );
}

const table: string[] = [];

for (const project of projects) {
  const codes = confirmed(project);
  const score = computeScore(codes);
  const zone = resolveZone(score, codes);

  if (score !== project.expectedScore) {
    fail(
      `${project.key}: рассчитан балл ${score}, в наборе записано ожидание ${project.expectedScore}.`,
    );
  }
  if (zone !== project.expectedZone) {
    fail(`${project.key}: рассчитана зона ${zone}, ожидалась ${project.expectedZone}.`);
  }

  const breakdown = codes.length
    ? codes.map((code) => `${code}(+${FACTOR_WEIGHTS[code]})`).join(' ')
    : 'факторов нет';

  table.push(
    [
      project.name.padEnd(22),
      String(score).padStart(3),
      zone.padEnd(6),
      breakdown.padEnd(40),
      project.scenario ? `сценарий ${project.scenario}` : '',
    ].join('  '),
  );
}

// ---------------------------------------------------------------------------
// 4. Контрольные сценарии из раздела 5 ТЗ
// ---------------------------------------------------------------------------

const expectedScenarios = [
  { id: 'A' as const, score: 35, zone: 'YELLOW' as const, note: 'отсутствие данных не превращается в R1' },
  { id: 'B' as const, score: 70, zone: 'RED' as const, note: 'установлено отсутствие основания + депозит' },
  { id: 'C' as const, score: 10, zone: 'GREEN' as const, note: 'действующая гарантия, обычная реклама' },
];

for (const expected of expectedScenarios) {
  const project = projects.find((item) => item.scenario === expected.id);
  if (!project) {
    fail(`Контрольный сценарий ${expected.id} отсутствует в наборе данных.`);
    continue;
  }
  const codes = confirmed(project);
  const score = computeScore(codes);
  const zone = resolveZone(score, codes);

  if (score !== expected.score || zone !== expected.zone) {
    fail(
      `Сценарий ${expected.id} ("${project.name}"): получено ${score}/${zone}, ` +
        `по ТЗ ожидается ${expected.score}/${expected.zone}.`,
    );
  } else {
    pass(`Сценарий ${expected.id}: ${score} баллов, ${zone} — ${expected.note}`);
  }
}

// Граничный случай зоны обязан присутствовать в наборе: 60+ баллов без R1+R2.
const borderline = projects.find((project) => {
  const codes = confirmed(project);
  return computeScore(codes) >= 60 && resolveZone(computeScore(codes), codes) === 'YELLOW';
});

if (!borderline) {
  fail(
    'В наборе нет объекта с 60+ баллами без комбинации R1+R2. ' +
      'Без него не проверяется правило жёлтой зоны при высоком балле.',
  );
} else {
  pass(
    `Граничный случай зоны: "${borderline.name}" — ` +
      `${computeScore(confirmed(borderline))} баллов, зона жёлтая (нет комбинации R1+R2)`,
  );
}

// ---------------------------------------------------------------------------
// 5. Инварианты модели
// ---------------------------------------------------------------------------

for (const project of projects) {
  const byCode = new Map(project.factors.map((factor) => [factor.code, factor]));

  // Каждый фактор описан ровно один раз.
  if (byCode.size !== project.factors.length) {
    fail(`${project.key}: один и тот же код фактора встречается несколько раз.`);
  }

  // R1 — ключевой инвариант всей модели.
  const r1 = byCode.get('R1');
  if (r1?.status === 'CONFIRMED' && project.legalBasisStatus !== 'CONFIRMED_ABSENT') {
    fail(
      `${project.key}: R1 подтверждён при статусе основания ${project.legalBasisStatus}. ` +
        'Начислять R1 можно только при CONFIRMED_ABSENT.',
    );
  }
  if (project.legalBasisStatus === 'NOT_CHECKED' && r1?.status === 'CONFIRMED') {
    fail(`${project.key}: отсутствие данных об основании превращено в подтверждённый R1.`);
  }

  // R5 — порог и наличие источников у обоих значений.
  const r5 = byCode.get('R5');
  const gap = readinessGapPp(project.declaredReadinessPct, project.verifiedReadinessPct);
  if (r5?.status === 'CONFIRMED') {
    if (gap === null) {
      fail(`${project.key}: R5 подтверждён, но одно из значений готовности не задано.`);
    } else if (gap < READINESS_GAP_THRESHOLD_PP) {
      fail(
        `${project.key}: R5 подтверждён при расхождении ${gap} п.п., ` +
          `порог — ${READINESS_GAP_THRESHOLD_PP} п.п.`,
      );
    }
    if (!project.declaredReadinessSource || !project.verifiedReadinessSource) {
      fail(`${project.key}: R5 подтверждён, но у значений готовности не указаны источники.`);
    }
  }
  if (r5?.status !== 'CONFIRMED' && gap !== null && gap >= READINESS_GAP_THRESHOLD_PP) {
    fail(
      `${project.key}: расхождение готовности ${gap} п.п. достигает порога, ` +
        'но R5 не подтверждён — данные и модель рассогласованы.',
    );
  }

  // R3 неприменим к введённому в эксплуатацию объекту.
  const r3 = byCode.get('R3');
  if (r3?.status === 'CONFIRMED' && !isUnderConstruction(project.stage)) {
    fail(`${project.key}: R3 подтверждён для объекта, введённого в эксплуатацию.`);
  }

  // R2 требует текстового доказательства.
  const r2 = byCode.get('R2');
  if (r2?.status === 'CONFIRMED') {
    const hasFragment = (r2.evidence ?? []).some(
      (evidence) => evidence.kind === 'TEXT_FRAGMENT' && evidence.fragment,
    );
    if (!hasFragment) {
      fail(`${project.key}: R2 подтверждён без фрагмента-доказательства из публикации.`);
    }
  }

  // Любое подтверждение — это решение человека с датой.
  for (const factor of project.factors) {
    if (factor.status === 'CONFIRMED' && (!factor.confirmedBy || !factor.confirmedAt)) {
      fail(`${project.key} / ${factor.code}: подтверждённый фактор без автора или даты решения.`);
    }
    if (!factor.rationale?.trim()) {
      fail(`${project.key} / ${factor.code}: не заполнено обоснование решения.`);
    }
  }
}

pass('Инварианты модели соблюдены (R1 по трёхзначному статусу, порог R5, R3 после ввода, доказательства R2, авторство решений)');

// ---------------------------------------------------------------------------
// 6. Предусловия начисления
//
// Демо-данные не имеют привилегий: каждый подтверждённый в наборе фактор
// обязан пройти ту же проверку из src/core/scoring/eligibility.ts, что и
// фактор, подтверждаемый аналитиком через интерфейс. Если набор не проходит
// собственные правила, значит либо данные неверны, либо правило слишком
// строгое — и выяснить это нужно до демонстрации, а не во время неё.
// ---------------------------------------------------------------------------

function eligibilityContextOf(project: SeedProject): EligibilityContext {
  const evidenceByFactor: Partial<
    Record<FactorCode, { kind: EvidenceKind; excerpt: string | null }[]>
  > = {};

  for (const factor of project.factors) {
    evidenceByFactor[factor.code] = (factor.evidence ?? []).map((item) => ({
      kind: item.kind,
      excerpt: item.fragment ?? null,
    }));
  }

  return {
    stage: project.stage,
    legalBasisStatus: project.legalBasisStatus,
    declaredReadinessPct: project.declaredReadinessPct ?? null,
    declaredReadinessSource: project.declaredReadinessSource ?? null,
    verifiedReadinessPct: project.verifiedReadinessPct ?? null,
    verifiedReadinessSource: project.verifiedReadinessSource ?? null,
    actualDelayDays: project.actualDelayDays ?? null,
    verifiedAppealCount: (project.appeals ?? []).filter((item) => item.status === 'VERIFIED').length,
    evidenceByFactor,
  };
}

let eligibilityChecked = 0;

for (const project of projects) {
  const context = eligibilityContextOf(project);

  for (const code of confirmed(project)) {
    eligibilityChecked += 1;
    const verdict = checkFactorEligibility(code, context);
    if (!verdict.allowed) {
      const missing = verdict.missing.map((item) => item.ru).join(' ');
      fail(
        `${project.key} / ${code}: фактор подтверждён в наборе, но не проходит предусловие.\n` +
          `      причина: ${verdict.reason.ru}` +
          (missing ? `\n      не хватает: ${missing}` : ''),
      );
    }
  }

  // Неприменимость должна быть отражена в статусе, а не оставлена «на проверку».
  for (const factor of project.factors) {
    const verdict = checkFactorEligibility(factor.code, context);
    if (!verdict.applicable && factor.status !== 'NOT_APPLICABLE') {
      fail(
        `${project.key} / ${factor.code}: фактор неприменим (${verdict.reason.ru}), ` +
          `но имеет статус ${factor.status} вместо NOT_APPLICABLE.`,
      );
    }
  }
}

pass(`Предусловий начисления проверено: ${eligibilityChecked} (каждый подтверждённый фактор)`);

// ---------------------------------------------------------------------------
// Отчёт
// ---------------------------------------------------------------------------

console.log('\nSAQ QURYLYS · проверка демонстрационного набора\n');
console.log('  Объект                  Балл  Зона    Факторы');
console.log('  ' + '─'.repeat(86));
for (const row of table) console.log('  ' + row);

console.log('\n  Проверки:');
for (const check of checks) console.log(`    [ok] ${check}`);

if (problems.length > 0) {
  console.error(`\n  Найдено проблем: ${problems.length}`);
  for (const problem of problems) console.error(`    [!!] ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('\n  Набор данных согласован с моделью риск-скоринга. Проблем не найдено.\n');
