import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma — серверная зависимость, в клиентский бандл её тянуть не нужно.
  serverExternalPackages: ['@prisma/client'],
  /**
   * Корень трассировки файлов — папка проекта, а не то, что Next угадает сам.
   *
   * Угадывает он по ближайшему package-lock.json вверх по дереву, поэтому
   * случайный lock-файл в домашней папке проверяющего уводит корень туда,
   * а вместе с ним — и список файлов, попадающих в сборку. Привязка к
   * __dirname делает результат сборки одинаковым на любой машине.
   */
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
