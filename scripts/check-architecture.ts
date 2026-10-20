/**
 * Проверка границ между слоями.
 *
 * Архитектура этого проекта держится на одном правиле: вся логика, за которую
 * система отвечает перед аналитиком — формула, зоны, предусловия, разбор
 * текста, кластеризация — лежит в src/core и не знает ни про Prisma, ни про
 * Next, ни про React. Именно поэтому её можно проверить 336 тестами за три
 * секунды, без базы и без браузера.
 *
 * Правило такого рода живёт ровно до первого удобного импорта. Кто-то добавит
 * в scoring/model.ts обращение к prisma, чтобы «не тащить данные через два
 * слоя», тесты продолжат проходить, и через день ядро станет непроверяемым
 * без базы. Поэтому граница проверяется скриптом, а не договорённостью:
 * нарушение останавливает npm run verify с указанием файла и строки.
 *
 * Проверяются четыре правила:
 *
 *   1. src/core не импортирует @prisma/client, lib/db, next и react.
 *      Единственное исключение — import type: типы стираются при сборке
 *      и ничего не тянут в рантайм. service.ts пользуется этим, чтобы
 *      описать форму данных, которую ему передаёт вызывающий слой.
 *
 *   2. src/components не импортирует lib/db и prisma. Представление получает
 *      готовые данные пропсами; компонент, который сам читает базу,
 *      невозможно отрисовать в тесте и нельзя переиспользовать.
 *
 *   3. src/core не импортирует src/server. Зависимость направлена в одну
 *      сторону: адаптеры знают про ядро, ядро про адаптеры — нет.
 *
 *   4. Клиентские компоненты ('use client') не импортируют серверные модули.
 *      Такой импорт в Next утащил бы серверный код в браузерный бандл.
 *
 * Скрипт сознательно работает на тексте файлов, а не на AST: правило
 * формулируется в терминах «какая строка импорта допустима», и регулярное
 * выражение здесь честнее, чем разбор дерева — его видно целиком.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

interface Violation {
  file: string;
  line: number;
  statement: string;
  rule: string;
}

/** Все файлы .ts/.tsx внутри каталога, рекурсивно. */
function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Строки импорта файла с номерами.
 *
 * Берётся и `import … from '…'`, и `require('…')`, и динамический
 * `import('…')`: правило о границе слоёв не должно зависеть от того,
 * каким синтаксисом импорт записан.
 */
function importsOf(source: string): { line: number; statement: string; target: string }[] {
  const result: { line: number; statement: string; target: string }[] = [];
  const lines = source.split('\n');

  lines.forEach((text, index) => {
    const patterns = [
      /^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/,
      /^\s*import\s*['"]([^'"]+)['"]/,
      /require\(\s*['"]([^'"]+)['"]\s*\)/,
      /\bimport\(\s*['"]([^'"]+)['"]\s*\)/,
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) {
        result.push({ line: index + 1, statement: text.trim(), target: match[1] });
        return;
      }
    }
  });

  return result;
}

/** Импорт только типов стирается компилятором и границу не нарушает. */
function isTypeOnly(statement: string): boolean {
  return /^\s*import\s+type\b/.test(statement) || /^\s*import\s*\{\s*type\s/.test(statement);
}

const violations: Violation[] = [];

function check(
  files: string[],
  rule: string,
  forbidden: (target: string) => boolean,
  options: { allowTypeOnly?: boolean; onlyClientFiles?: boolean } = {},
): void {
  for (const file of files) {
    const source = readFileSync(file, 'utf8');

    if (options.onlyClientFiles && !/^['"]use client['"]/m.test(source)) continue;

    for (const item of importsOf(source)) {
      if (!forbidden(item.target)) continue;
      if (options.allowTypeOnly && isTypeOnly(item.statement)) continue;

      violations.push({
        file: relative(ROOT, file),
        line: item.line,
        statement: item.statement,
        rule,
      });
    }
  }
}

const coreFiles = collect(join(SRC, 'core'));
const componentFiles = collect(join(SRC, 'components'));

// --- Правило 1: ядро без Prisma, Next и React -------------------------------

check(
  coreFiles,
  'src/core не должен импортировать Prisma, Next или React (кроме import type)',
  (target) =>
    target === '@prisma/client' ||
    target.startsWith('@prisma/') ||
    target === '.prisma/client' ||
    target === 'next' ||
    target.startsWith('next/') ||
    target === 'react' ||
    target.startsWith('react/') ||
    target === 'react-dom' ||
    /(^|\/)lib\/db$/.test(target) ||
    /\.\.?\/.*lib\/db$/.test(target),
  { allowTypeOnly: true },
);

// --- Правило 2: представление без доступа к базе ----------------------------

check(
  componentFiles,
  'src/components не должен обращаться к базе напрямую',
  (target) =>
    target === '@prisma/client' ||
    target.startsWith('@prisma/') ||
    /(^|\/)lib\/db$/.test(target) ||
    /\.\.?\/.*lib\/db$/.test(target),
);

// --- Правило 3: ядро не зависит от адаптеров --------------------------------

check(
  coreFiles,
  'src/core не должен импортировать src/server (зависимость только в одну сторону)',
  (target) => /(^|\/)server\//.test(target) && target.startsWith('.'),
  { allowTypeOnly: true },
);

// --- Правило 4: клиентские компоненты без серверных модулей -----------------

check(
  componentFiles,
  "компонент с 'use client' не должен импортировать серверные модули",
  (target) =>
    target.startsWith('.') &&
    (/(^|\/)server\/(queries|analysis|signals|page)$/.test(target) ||
      /(^|\/)lib\/db$/.test(target) ||
      /(^|\/)i18n\/server$/.test(target)),
  { onlyClientFiles: true },
);

// --- Отчёт ------------------------------------------------------------------

const BOLD = '[1m';
const RED = '[31m';
const GREEN = '[32m';
const DIM = '[2m';
const OFF = '[0m';

console.log();
console.log(`${BOLD}SAQ QURYLYS · проверка границ между слоями${OFF}`);
console.log();
console.log(`  Файлов в src/core:       ${coreFiles.length}`);
console.log(`  Файлов в src/components: ${componentFiles.length}`);
console.log();

if (violations.length === 0) {
  const rules = [
    'src/core не импортирует Prisma, Next и React в рантайме',
    'src/components не обращается к базе',
    'src/core не зависит от src/server',
    "компоненты с 'use client' не тянут серверные модули",
  ];
  for (const rule of rules) console.log(`    [${GREEN}ok${OFF}] ${rule}`);
  console.log();
  console.log(`  ${GREEN}Границы слоёв соблюдены. Ядро проверяемо без базы и браузера.${OFF}`);
  console.log();
  process.exit(0);
}

for (const item of violations) {
  console.log(`    [${RED}нарушение${OFF}] ${item.file}:${item.line}`);
  console.log(`                 ${item.rule}`);
  console.log(`                 ${DIM}${item.statement}${OFF}`);
  console.log();
}

console.log(
  `  ${RED}Нарушений границ: ${violations.length}.${OFF} ` +
    'Логика, за которую отвечает система, должна остаться проверяемой без базы.',
);
console.log();
process.exit(1);
