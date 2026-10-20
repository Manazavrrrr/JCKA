/**
 * Разбор произвольного объявления из командной строки.
 *
 * Скрипт существует для того, чтобы требование ТЗ «ИИ работает на новом
 * тексте» можно было проверить, не открывая интерфейс и не трогая базу:
 *
 *   echo "текст объявления" | npm run analyze
 *   npm run analyze -- "текст объявления"
 *   npm run analyze -- --file ./ad.txt
 *
 * Выводится то же самое, что увидит аналитик в интерфейсе: извлечённые
 * сущности, гипотезы факторов с цитатами и обязательные проверки,
 * которые нельзя выполнить по тексту объявления.
 *
 * Важное свойство вывода: скрипт печатает именно гипотезы, а не баллы.
 * Балл появляется только после подтверждения фактов аналитиком, поэтому
 * здесь его нет и быть не может.
 */

import { readFileSync } from 'node:fs';

import { developers, projects } from '../prisma/seed-data';
import { analyze, describeProviders } from '../src/core/ai';
import type { ProjectCandidate } from '../src/core/ai/provider';

// ---------------------------------------------------------------------------
// Разбор аргументов
// ---------------------------------------------------------------------------

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function resolveText(argv: readonly string[]): string {
  const fileFlag = argv.indexOf('--file');
  if (fileFlag !== -1) {
    const path = argv[fileFlag + 1];
    if (!path) {
      console.error('Ошибка: после --file нужно указать путь к файлу.');
      process.exit(1);
    }
    return readFileSync(path, 'utf8');
  }

  const positional = argv.filter((item) => !item.startsWith('--'));
  if (positional.length > 0) return positional.join(' ');

  return readStdin();
}

// ---------------------------------------------------------------------------
// Реестр объектов для сопоставления
// ---------------------------------------------------------------------------

/**
 * Берётся демонстрационный реестр из seed-данных, а не база: скрипт должен
 * работать до первого `db:push`, иначе проверить разбор на свежей машине
 * не получится.
 */
function registry(): ProjectCandidate[] {
  const byKey = new Map(developers.map((developer) => [developer.key, developer]));

  return projects.map((project) => {
    const developer = byKey.get(project.developerKey);
    return {
      id: project.key,
      name: project.name,
      nameKk: project.nameKk,
      address: project.address,
      developerName: developer?.name,
      knownPhones: developer?.phone ? [developer.phone] : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Печать
// ---------------------------------------------------------------------------

function line(char = '─'): string {
  return char.repeat(72);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const text = resolveText(argv).trim();

  if (!text) {
    console.error(
      [
        'Не передан текст объявления.',
        '',
        'Примеры:',
        '  npm run analyze -- "Продаём квартиры в строящемся доме, бронь 150 000 ₸"',
        '  npm run analyze -- --file ./ad.txt',
        '  cat ad.txt | npm run analyze',
      ].join('\n'),
    );
    process.exit(1);
  }

  const { active, providers } = describeProviders(process.env);
  for (const provider of providers) {
    const mark = provider.id === active ? '→' : ' ';
    const state = provider.available ? 'доступен' : 'недоступен';
    console.log(`${mark} ${provider.id.padEnd(6)} ${state.padEnd(11)} ${provider.description.ru}`);
  }
  console.log(line('═'));

  const result = await analyze({ text, projects: registry() }, process.env);

  console.log(`Провайдер:        ${result.provider}${result.model ? ` (${result.model})` : ''}`);
  console.log(`Время разбора:    ${result.durationMs} мс`);
  console.log(`Объявление жилья: ${result.isHousingAd ? 'да' : 'нет'}`);
  console.log(`Строящийся дом:   ${result.mentionsUnderConstruction ? 'упомянут' : 'не упомянут'}`);
  console.log(line('═'));

  console.log('СВОДКА');
  console.log(result.summary.ru);
  console.log(line());

  console.log('ИЗВЛЕЧЁННЫЕ СУЩНОСТИ');
  const { extracted } = result;
  const join = (values: readonly string[]): string => (values.length > 0 ? values.join(' | ') : '—');

  console.log(`  Названия:      ${join(extracted.projectNames.map((item) => item.fragment))}`);
  console.log(`  Адреса:        ${join(extracted.addresses.map((item) => item.fragment))}`);
  console.log(`  Телефоны:      ${join(extracted.phones.map((item) => item.normalized))}`);
  console.log(
    `  Суммы:         ${join(
      extracted.amounts.map((item) =>
        item.amount === null ? item.fragment : `${item.amount.toLocaleString('ru-RU')} ₸`,
      ),
    )}`,
  );
  console.log(
    `  Готовность:    ${join(extracted.readinessMentions.map((item) => `${item.value}%`))}`,
  );
  console.log(
    `  Сроки сдачи:   ${join(extracted.completionYears.map((item) => String(item.year)))}`,
  );
  console.log(`  Переносы:      ${join(extracted.delayMentions.map((item) => item.fragment))}`);
  console.log(
    `  Заявленное основание: ${join(extracted.legalBasisClaims.map((item) => item.fragment))}`,
  );
  console.log(line());

  console.log('ФОРМУЛИРОВКИ О РАСЧЁТАХ');
  if (extracted.paymentTerms.length === 0) {
    console.log('  не найдены');
  }
  for (const term of extracted.paymentTerms) {
    const flag = term.riskBearing ? '⚠ риск-несущая' : '✓ законная схема';
    const amount = term.amount === null ? '' : ` — ${term.amount.toLocaleString('ru-RU')} ₸`;
    console.log(`  ${flag}  ${term.label.ru}${amount}`);
    console.log(`     «${term.fragment}»  [${term.charStart}..${term.charEnd}]`);
  }
  console.log(line());

  console.log('ГИПОТЕЗЫ ФАКТОРОВ (не баллы — требуют подтверждения аналитиком)');
  if (result.factorHypotheses.length === 0) {
    console.log('  не выдвинуты');
  }
  for (const hypothesis of result.factorHypotheses) {
    const mark = hypothesis.lowConfidence ? 'низкая уверенность' : 'уверенность';
    console.log(`  ${hypothesis.code}  ${mark} ${percent(hypothesis.confidence)}`);
    console.log(`     основание: ${hypothesis.rationale.ru}`);
    console.log(`     проверка:  ${hypothesis.verification.ru}`);
    if (hypothesis.span) {
      console.log(
        `     цитата:    «${hypothesis.span.fragment}»  [${hypothesis.span.charStart}..${hypothesis.span.charEnd}]`,
      );
      const slice = text.slice(hypothesis.span.charStart, hypothesis.span.charEnd);
      if (slice !== hypothesis.span.fragment) {
        console.log('     ВНИМАНИЕ:  цитата не совпадает с текстом по позициям');
      }
    } else {
      console.log('     цитата:    отсутствует');
    }
  }
  console.log(line());

  console.log('СОПОСТАВЛЕНИЕ С РЕЕСТРОМ');
  if (result.projectMatches.length === 0) {
    console.log('  совпадений не найдено');
  }
  for (const match of result.projectMatches) {
    console.log(
      `  ${percent(match.score).padStart(4)}  ${match.projectName}  [${match.matchedOn.join(', ')}]`,
    );
    console.log(`     ${match.rationale.ru}`);
  }
  console.log(line());

  console.log('ОБЯЗАТЕЛЬНЫЕ ПРОВЕРКИ ВНЕ ТЕКСТА ОБЪЯВЛЕНИЯ');
  for (const check of result.checks) {
    console.log(`  • ${check.ru}`);
  }

  if (result.warnings.length > 0) {
    console.log(line());
    console.log('ПРЕДУПРЕЖДЕНИЯ');
    for (const warning of result.warnings) {
      console.log(`  • ${warning.ru}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error('Разбор не выполнен:', error);
  process.exit(1);
});
