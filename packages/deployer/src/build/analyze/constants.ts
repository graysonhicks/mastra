export const DEPS_TO_IGNORE = ['#tools'];

export const GLOBAL_EXTERNALS = [
  'pino',
  'pino-pretty',
  '@libsql/client',
  'pg',
  'libsql',
  '#tools',
  'typescript',
  'undici',
  'readable-stream',
  'zod',
  'zod/v3',
  'zod/v4',
];
export const DEPRECATED_EXTERNALS = ['fastembed', 'nodemailer', 'jsdom', 'sqlite3'];
export const NON_OPTIMIZED_DEPENDENCIES = ['zod', 'zod/v3', 'zod/v4'];
