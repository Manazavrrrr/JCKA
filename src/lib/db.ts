/**
 * Клиент Prisma.
 *
 * В режиме разработки Next.js пересоздаёт модули при горячей перезагрузке,
 * поэтому клиент кэшируется в globalThis — иначе SQLite быстро упирается
 * в лимит открытых соединений.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
