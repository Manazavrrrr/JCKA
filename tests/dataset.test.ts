/**
 * Согласованность демонстрационного набора с ядром скоринга.
 *
 * Набор данных — не отдельная сущность, а такой же вход для модели, как
 * ручной ввод аналитика. Поэтому каждый подтверждённый в наборе фактор
 * обязан проходить то же предусловие из eligibility.ts, что и фактор,
 * подтверждаемый через интерфейс. Если демо-данные не проходят собственные
 * проверки — значит, либо данные неверны, либо правило слишком строгое,
 * и на демонстрации это вскроется в самый неподходящий момент.
 */

import { describe, expect, it } from 'vitest';

import { projects, publications, type SeedProject } from '../prisma/seed-data';
import { FACTOR_CODES, type EvidenceKind, type FactorCode } from '../src/core/domain/enums';
import {
  checkFactorEligibility,
  locateExcerpt,
  type EligibilityContext,
} from '../src/core/scoring/eligibility';
import { explainScore, isReportReady } from '../src/core/scoring/explain';
import { computeScore, resolveZone, sortFactorCodes } from '../src/core/scoring/model';

// ---------------------------------------------------------------------------
// Подготовка
// ---------------------------------------------------------------------------

function contextOf(project: SeedProject): EligibilityContext {
  const evidenceByFactor: Partial<Record<FactorCode, { kind: EvidenceKind; excerpt: string | null }[]>> =
    {};

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

function confirmedCodes(project: SeedProject): FactorCode[] {
  return sortFactorCodes(
    project.factors.filter((factor) => factor.status === 'CONFIRMED').map((factor) => factor.code),
  );
}

function explainableFactors(project: SeedProject) {
  return project.factors.map((factor) => ({
    code: factor.code,
    status: factor.status,
    rationale: factor.rationale,
    confirmedBy: factor.confirmedBy,
    confirmedAt: factor.confirmedAt,
    evidenceCount: (factor.evidence ?? []).length,
  }));
}

const textByKey = new Map(publications.map((item) => [item.key, item.rawText]));

// ---------------------------------------------------------------------------
// Объём набора
// ---------------------------------------------------------------------------

describe('объём демонстрационного набора', () => {
  it('содержит не менее 8 объектов — требование раздела 7 ТЗ', () => {
    expect(projects.length).toBeGreaterThanOrEqual(8);
  });

  it('содержит не менее 12 публикаций', () => {
    expect(publications.length).toBeGreaterThanOrEqual(12);
  });

  it('содержит публикации без привязки — вход для демонстрации сопоставления ИИ', () => {
    const unlinked = publications.filter((item) => item.linkStatus === 'UNLINKED');
    expect(unlinked.length).toBeGreaterThanOrEqual(1);
  });

  it('не содержит повторяющихся slug и ключей', () => {
    expect(new Set(projects.map((item) => item.slug)).size).toBe(projects.length);
    expect(new Set(publications.map((item) => item.key)).size).toBe(publications.length);
  });

  it('каждый объект имеет координаты для карты и ожидание расчёта', () => {
    for (const project of projects) {
      expect(project.lat, project.key).toBeTypeOf('number');
      expect(project.lng, project.key).toBeTypeOf('number');
      expect(project.expectedScore, project.key).toBeGreaterThanOrEqual(0);
      expect(project.demoNote?.trim(), project.key).toBeTruthy();
    }
  });

  it('текст каждой публикации достаточен для разбора ИИ', () => {
    for (const publication of publications) {
      expect(publication.rawText.length, publication.key).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------
// Расчёт
// ---------------------------------------------------------------------------

describe('расчёт по набору данных', () => {
  it.each(projects.map((project) => [project.key, project] as const))(
    '%s: балл и зона совпадают с ожиданием из набора',
    (_key, project) => {
      const codes = confirmedCodes(project);
      expect(computeScore(codes)).toBe(project.expectedScore);
      expect(resolveZone(project.expectedScore, codes)).toBe(project.expectedZone);
    },
  );

  it('кэш балла в наборе согласован с объяснением', () => {
    for (const project of projects) {
      const explanation = explainScore(explainableFactors(project));
      expect(explanation.score).toBe(project.expectedScore);
      expect(explanation.zone).toBe(project.expectedZone);
    }
  });
});

// ---------------------------------------------------------------------------
// Контрольные сценарии ТЗ
// ---------------------------------------------------------------------------

describe('контрольные сценарии раздела 5 ТЗ', () => {
  function scenario(id: 'A' | 'B' | 'C'): SeedProject {
    const project = projects.find((item) => item.scenario === id);
    expect(project, `сценарий ${id} отсутствует в наборе`).toBeDefined();
    return project!;
  }

  it('А — 35 баллов, жёлтая зона, основание не проверено', () => {
    const project = scenario('A');
    expect(project.expectedScore).toBe(35);
    expect(project.expectedZone).toBe('YELLOW');
    expect(project.legalBasisStatus).toBe('NOT_CHECKED');

    const r1 = project.factors.find((factor) => factor.code === 'R1');
    expect(r1?.status).not.toBe('CONFIRMED');
  });

  it('Б — 70 баллов, красная зона, установлено отсутствие основания', () => {
    const project = scenario('B');
    expect(project.expectedScore).toBe(70);
    expect(project.expectedZone).toBe('RED');
    expect(project.legalBasisStatus).toBe('CONFIRMED_ABSENT');
    expect(confirmedCodes(project)).toEqual(['R1', 'R2', 'R3']);
  });

  it('В — 10 баллов, зелёная зона, основание подтверждено', () => {
    const project = scenario('C');
    expect(project.expectedScore).toBe(10);
    expect(project.expectedZone).toBe('GREEN');
    expect(project.legalBasisStatus).toBe('CONFIRMED_PRESENT');
  });

  it('А и Б отличаются только статусом основания, но дают разные зоны', () => {
    const a = scenario('A');
    const b = scenario('B');
    expect(a.expectedZone).toBe('YELLOW');
    expect(b.expectedZone).toBe('RED');
    expect(b.expectedScore - a.expectedScore).toBe(35); // вес R1
  });

  it('в наборе есть объект с 60+ баллами в жёлтой зоне', () => {
    const borderline = projects.filter(
      (project) => project.expectedScore >= 60 && project.expectedZone === 'YELLOW',
    );
    expect(borderline.length).toBeGreaterThanOrEqual(1);

    for (const project of borderline) {
      const codes = new Set(confirmedCodes(project));
      expect(codes.has('R1') && codes.has('R2')).toBe(false);
    }
  });

  it('в наборе представлены все три зоны', () => {
    const zones = new Set(projects.map((project) => project.expectedZone));
    expect([...zones].sort()).toEqual(['GREEN', 'RED', 'YELLOW']);
  });
});

// ---------------------------------------------------------------------------
// Предусловия
// ---------------------------------------------------------------------------

describe('каждый подтверждённый фактор проходит предусловие', () => {
  it.each(projects.map((project) => [project.key, project] as const))(
    '%s',
    (_key, project) => {
      const context = contextOf(project);
      for (const code of confirmedCodes(project)) {
        const verdict = checkFactorEligibility(code, context);
        expect(
          verdict.allowed,
          `${project.key} / ${code}: ${verdict.reason.ru} ${verdict.missing.map((m) => m.ru).join(' ')}`,
        ).toBe(true);
      }
    },
  );
});

describe('неприменимые факторы помечены корректно', () => {
  it('у сданного объекта R3 имеет статус NOT_APPLICABLE', () => {
    const commissioned = projects.filter((project) => project.stage === 'COMMISSIONED');
    expect(commissioned.length).toBeGreaterThanOrEqual(1);

    for (const project of commissioned) {
      const r3 = project.factors.find((factor) => factor.code === 'R3');
      expect(r3?.status).toBe('NOT_APPLICABLE');
      expect(checkFactorEligibility('R3', contextOf(project)).applicable).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Доказательства
// ---------------------------------------------------------------------------

describe('фрагменты-доказательства', () => {
  const fragments = projects.flatMap((project) =>
    project.factors.flatMap((factor) =>
      (factor.evidence ?? [])
        .filter((item) => item.publicationKey && item.fragment)
        .map((item) => ({
          label: `${project.key} / ${factor.code} / ${item.publicationKey}`,
          publicationKey: item.publicationKey!,
          fragment: item.fragment!,
        })),
    ),
  );

  it('в наборе есть текстовые доказательства', () => {
    expect(fragments.length).toBeGreaterThanOrEqual(10);
  });

  it.each(fragments.map((item) => [item.label, item] as const))(
    '%s — фрагмент дословно присутствует в тексте публикации',
    (_label, item) => {
      const rawText = textByKey.get(item.publicationKey);
      expect(rawText, `неизвестная публикация ${item.publicationKey}`).toBeDefined();

      const position = locateExcerpt(rawText!, item.fragment);
      expect(position, `фрагмент не найден: "${item.fragment}"`).not.toBeNull();
      expect(rawText!.slice(position!.charStart, position!.charEnd)).toBe(item.fragment.trim());
    },
  );
});

// ---------------------------------------------------------------------------
// Контроль решений
// ---------------------------------------------------------------------------

describe('контроль решений по набору', () => {
  it('каждое решение имеет автора, дату и обоснование', () => {
    for (const project of projects) {
      const explanation = explainScore(explainableFactors(project));
      expect(explanation.integrityWarnings, project.key).toHaveLength(0);
    }
  });

  it('объекты с подтверждёнными факторами готовы к выгрузке в сигнальную карточку', () => {
    const withFactors = projects.filter((project) => confirmedCodes(project).length > 0);
    expect(withFactors.length).toBeGreaterThanOrEqual(7);

    for (const project of withFactors) {
      expect(isReportReady(explainScore(explainableFactors(project))), project.key).toBe(true);
    }
  });

  it('у каждого фактора в наборе заполнено обоснование', () => {
    for (const project of projects) {
      for (const factor of project.factors) {
        expect(factor.rationale?.trim(), `${project.key} / ${factor.code}`).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Инварианты модели
// ---------------------------------------------------------------------------

describe('инварианты, которые нельзя нарушить редактированием набора', () => {
  it('R1 подтверждён только там, где установлено отсутствие основания', () => {
    for (const project of projects) {
      const r1 = project.factors.find((factor) => factor.code === 'R1');
      if (r1?.status === 'CONFIRMED') {
        expect(project.legalBasisStatus, project.key).toBe('CONFIRMED_ABSENT');
      }
    }
  });

  it('ни один объект со статусом NOT_CHECKED не имеет подтверждённого R1', () => {
    const notChecked = projects.filter((project) => project.legalBasisStatus === 'NOT_CHECKED');
    expect(notChecked.length).toBeGreaterThanOrEqual(1);

    for (const project of notChecked) {
      const r1 = project.factors.find((factor) => factor.code === 'R1');
      expect(r1?.status, project.key).not.toBe('CONFIRMED');
    }
  });

  it('расхождение готовности от порога всегда отражено в статусе R5', () => {
    for (const project of projects) {
      const declared = project.declaredReadinessPct;
      const verified = project.verifiedReadinessPct;
      if (declared == null || verified == null) continue;

      const gap = Math.abs(declared - verified);
      const r5 = project.factors.find((factor) => factor.code === 'R5');
      if (gap >= 20) {
        expect(r5?.status, `${project.key}: расхождение ${gap} п.п.`).toBe('CONFIRMED');
      } else {
        expect(r5?.status, `${project.key}: расхождение ${gap} п.п.`).not.toBe('CONFIRMED');
      }
    }
  });

  /**
   * Фактор описан не более одного раза — но не обязательно описан вообще.
   *
   * Отсутствие строки фактора — это не пробел в данных, а состояние «решения
   * по этому признаку ещё нет», и оно отличается от «проверен, не
   * подтвердился». Требовать все шесть строк у каждого объекта значило бы
   * запретить это состояние, а на нём держится шаг 6 тестового сценария:
   * принятая гипотеза ИИ именно создаёт фактор, а не переписывает готовый.
   */
  it('фактор описан не более одного раза и только допустимым кодом', () => {
    for (const project of projects) {
      const codes = project.factors.map((factor) => factor.code);
      expect(new Set(codes).size, project.key).toBe(codes.length);
      for (const code of codes) expect(FACTOR_CODES, project.key).toContain(code);
    }
  });

  /**
   * Предусловие демонстрации, закреплённое тестом.
   *
   * Если кто-то заведёт R6 у «Ульба Резиденс» заранее, шаг 6 сценария
   * перестанет что-либо показывать: аналитик нажмёт «Согласиться», и на
   * экране не изменится ничего. Поломка была бы незаметной — поэтому она
   * вынесена в проверку.
   */
  it('у «Ульба Резиденс» нет R6: его создаёт принятая гипотеза ИИ', () => {
    const ulba = projects.find((project) => project.key === 'ulba-residence');
    expect(ulba, 'объект сценария разбора объявления').toBeDefined();
    expect(ulba?.factors.some((factor) => factor.code === 'R6')).toBe(false);

    const source = publications.find((item) => item.key === 'pub-06');
    expect(source?.projectKey, 'публикация-источник гипотезы').toBe('ulba-residence');
    expect(source?.rawText).toContain('Срок сдачи дома перенесён');
  });
});
