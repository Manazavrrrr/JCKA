import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Тесты покрывают чистое ядро: формулу балла, правило зоны, предусловия
 * факторов, объяснение и согласованность демонстрационного набора.
 *
 * Слой с БД (src/core/scoring/service.ts) в юнит-тесты не входит
 * сознательно: вся логика, которую имеет смысл проверять, вынесена из него
 * в чистые модули. Проверка самого набора данных выполняется скриптом
 * scripts/check-dataset.ts и тестом dataset.test.ts.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    reporters: ['default'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
