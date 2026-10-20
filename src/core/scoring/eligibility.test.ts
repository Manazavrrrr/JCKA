/**
 * Тесты предусловий начисления факторов.
 *
 * Формула умеет складывать веса — вопрос в том, кто имеет право положить
 * фактор в эту сумму. Здесь проверяется именно это, в том числе главное
 * требование ТЗ: отсутствие данных не является отсутствием основания.
 */

import { describe, expect, it } from 'vitest';

import type { FactorCode } from '../domain/enums';
import {
  FactorEligibilityError,
  assertFactorConfirmable,
  checkAllFactors,
  checkFactorEligibility,
  locateExcerpt,
  type EligibilityContext,
} from './eligibility';

/** Базовый объект: строится, ничего не проверено, доказательств нет. */
function context(overrides: Partial<EligibilityContext> = {}): EligibilityContext {
  return {
    stage: 'FRAME',
    legalBasisStatus: 'NOT_CHECKED',
    declaredReadinessPct: null,
    declaredReadinessSource: null,
    verifiedReadinessPct: null,
    verifiedReadinessSource: null,
    actualDelayDays: null,
    verifiedAppealCount: 0,
    evidenceByFactor: {},
    ...overrides,
  };
}

function allowed(code: FactorCode, ctx: EligibilityContext): boolean {
  return checkFactorEligibility(code, ctx).allowed;
}

// ---------------------------------------------------------------------------

describe('R1 — установленное отсутствие правового основания', () => {
  const registryProof = {
    R1: [{ kind: 'REGISTRY_RECORD' as const, excerpt: 'В реестре записи нет' }],
  };

  it('не начисляется, когда основание не проверено', () => {
    const verdict = checkFactorEligibility(
      'R1',
      context({ legalBasisStatus: 'NOT_CHECKED', evidenceByFactor: registryProof }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason.ru).toContain('Отсутствие данных не является отсутствием основания');
  });

  it('не начисляется, когда основание подтверждено', () => {
    expect(
      allowed('R1', context({ legalBasisStatus: 'CONFIRMED_PRESENT', evidenceByFactor: registryProof })),
    ).toBe(false);
  });

  it('начисляется при установленном отсутствии основания с доказательством', () => {
    expect(
      allowed('R1', context({ legalBasisStatus: 'CONFIRMED_ABSENT', evidenceByFactor: registryProof })),
    ).toBe(true);
  });

  it('не начисляется без проверяемого доказательства, даже при CONFIRMED_ABSENT', () => {
    const verdict = checkFactorEligibility('R1', context({ legalBasisStatus: 'CONFIRMED_ABSENT' }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.missing).toHaveLength(1);
  });

  it('фрагмент объявления не заменяет документальное доказательство', () => {
    expect(
      allowed(
        'R1',
        context({
          legalBasisStatus: 'CONFIRMED_ABSENT',
          evidenceByFactor: { R1: [{ kind: 'TEXT_FRAGMENT', excerpt: 'разрешения нет' }] },
        }),
      ),
    ).toBe(false);
  });

  it('остаётся применимым при NOT_CHECKED — это открытый вопрос, а не «неприменимо»', () => {
    expect(checkFactorEligibility('R1', context()).applicable).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('R2 — прямое предложение внести деньги', () => {
  it('требует фрагмент текста или снимок экрана', () => {
    expect(allowed('R2', context())).toBe(false);
  });

  it('начисляется при наличии цитаты из публикации', () => {
    expect(
      allowed(
        'R2',
        context({
          evidenceByFactor: {
            R2: [{ kind: 'TEXT_FRAGMENT', excerpt: 'Бронь квартиры — 300 000 тенге' }],
          },
        }),
      ),
    ).toBe(true);
  });

  it('начисляется по снимку экрана', () => {
    expect(
      allowed('R2', context({ evidenceByFactor: { R2: [{ kind: 'SCREENSHOT' }] } })),
    ).toBe(true);
  });

  it('не начисляется по документу: нужен материал публикации', () => {
    expect(
      allowed('R2', context({ evidenceByFactor: { R2: [{ kind: 'DOCUMENT' }] } })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('R3 — активная реклама строящегося жилья', () => {
  const adProof = { R3: [{ kind: 'TEXT_FRAGMENT' as const, excerpt: 'Продажа квартир' }] };

  it('начисляется строящемуся объекту с зафиксированной публикацией', () => {
    expect(allowed('R3', context({ stage: 'FOUNDATION', evidenceByFactor: adProof }))).toBe(true);
  });

  it('неприменим к объекту, введённому в эксплуатацию', () => {
    const verdict = checkFactorEligibility(
      'R3',
      context({ stage: 'COMMISSIONED', evidenceByFactor: adProof }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.applicable).toBe(false);
  });

  it('не начисляется без зафиксированной публикации', () => {
    expect(allowed('R3', context({ stage: 'FINISHING' }))).toBe(false);
  });

  it('применим на всех стадиях до ввода в эксплуатацию', () => {
    for (const stage of ['PLANNING', 'FOUNDATION', 'FRAME', 'FACADE', 'FINISHING'] as const) {
      expect(allowed('R3', context({ stage, evidenceByFactor: adProof }))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe('R4 — подтверждённое коллективное обращение', () => {
  it('не начисляется без обращений', () => {
    expect(allowed('R4', context({ verifiedAppealCount: 0 }))).toBe(false);
  });

  it('начисляется при хотя бы одном проверенном обращении', () => {
    expect(allowed('R4', context({ verifiedAppealCount: 1 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('R5 — расхождение заявленной и подтверждённой готовности', () => {
  const sourced = {
    declaredReadinessSource: 'Сайт застройщика, 10.09.2026',
    verifiedReadinessSource: 'Акт выездной проверки №12',
  };

  it('начисляется при расхождении от 20 п.п. с источниками у обоих значений', () => {
    expect(
      allowed(
        'R5',
        context({ declaredReadinessPct: 70, verifiedReadinessPct: 45, ...sourced }),
      ),
    ).toBe(true);
  });

  it('порог ровно 20 п.п. считается достигнутым', () => {
    expect(
      allowed('R5', context({ declaredReadinessPct: 60, verifiedReadinessPct: 40, ...sourced })),
    ).toBe(true);
  });

  it('19 п.п. недостаточно', () => {
    const verdict = checkFactorEligibility(
      'R5',
      context({ declaredReadinessPct: 59, verifiedReadinessPct: 40, ...sourced }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.missing[0]?.ru).toContain('19 п.п.');
  });

  it('не начисляется без источника хотя бы у одного значения', () => {
    expect(
      allowed(
        'R5',
        context({
          declaredReadinessPct: 70,
          verifiedReadinessPct: 45,
          declaredReadinessSource: 'Сайт застройщика',
          verifiedReadinessSource: '   ',
        }),
      ),
    ).toBe(false);
  });

  it('не начисляется, если подтверждённая готовность неизвестна', () => {
    const verdict = checkFactorEligibility(
      'R5',
      context({ declaredReadinessPct: 70, verifiedReadinessPct: null, ...sourced }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason.ru).toContain('Нет пары значений');
  });
});

// ---------------------------------------------------------------------------

describe('R6 — простой или значимая просрочка', () => {
  const act = { R6: [{ kind: 'FIELD_CHECK' as const }] };

  it('начисляется при просрочке от порога и документальном подтверждении', () => {
    expect(allowed('R6', context({ actualDelayDays: 136, evidenceByFactor: act }))).toBe(true);
  });

  it('порог ровно 90 дней считается достигнутым', () => {
    expect(allowed('R6', context({ actualDelayDays: 90, evidenceByFactor: act }))).toBe(true);
    expect(allowed('R6', context({ actualDelayDays: 89, evidenceByFactor: act }))).toBe(false);
  });

  it('не начисляется без документа, даже при большой просрочке', () => {
    const verdict = checkFactorEligibility('R6', context({ actualDelayDays: 200 }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.missing).toHaveLength(1);
  });

  it('не начисляется, если просрочка вообще не зафиксирована', () => {
    const verdict = checkFactorEligibility('R6', context({ evidenceByFactor: act }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.missing[0]?.ru).toContain('не зафиксировано');
  });
});

// ---------------------------------------------------------------------------

describe('checkAllFactors', () => {
  it('возвращает вердикт по каждому из шести факторов', () => {
    const verdicts = checkAllFactors(context());
    expect(Object.keys(verdicts).sort()).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
  });

  it('у чистого объекта без данных ни один фактор начислить нельзя', () => {
    const verdicts = checkAllFactors(context());
    expect(Object.values(verdicts).every((verdict) => !verdict.allowed)).toBe(true);
  });

  it('каждый вердикт несёт условие начисления на двух языках', () => {
    for (const verdict of Object.values(checkAllFactors(context()))) {
      expect(verdict.requirement.ru.length).toBeGreaterThan(10);
      expect(verdict.requirement.kk.length).toBeGreaterThan(10);
    }
  });
});

describe('assertFactorConfirmable', () => {
  it('пропускает допустимое подтверждение', () => {
    expect(() =>
      assertFactorConfirmable('R4', context({ verifiedAppealCount: 2 })),
    ).not.toThrow();
  });

  it('бросает FactorEligibilityError с кодом фактора и вердиктом', () => {
    try {
      assertFactorConfirmable('R1', context());
      expect.unreachable('ожидалось исключение');
    } catch (error) {
      expect(error).toBeInstanceOf(FactorEligibilityError);
      const typed = error as FactorEligibilityError;
      expect(typed.code).toBe('R1');
      expect(typed.verdict.allowed).toBe(false);
      expect(typed.message).toContain('R1');
    }
  });
});

describe('locateExcerpt', () => {
  const text = 'Бронируем за 300 000 тенге. Фиксация цены на 6 месяцев.';

  it('находит позицию фрагмента в тексте', () => {
    expect(locateExcerpt(text, 'Фиксация цены')).toEqual({ charStart: 28, charEnd: 41 });
  });

  it('игнорирует окружающие пробелы в цитате', () => {
    expect(locateExcerpt(text, '  Фиксация цены  ')).toEqual({ charStart: 28, charEnd: 41 });
  });

  it('возвращает null, если фрагмента в тексте нет', () => {
    expect(locateExcerpt(text, 'первоначальный взнос')).toBeNull();
  });

  it('возвращает null для пустой цитаты', () => {
    expect(locateExcerpt(text, '   ')).toBeNull();
  });

  it('вырезанный по позициям фрагмент совпадает с цитатой', () => {
    const position = locateExcerpt(text, 'за 300 000 тенге');
    expect(position).not.toBeNull();
    expect(text.slice(position!.charStart, position!.charEnd)).toBe('за 300 000 тенге');
  });
});
