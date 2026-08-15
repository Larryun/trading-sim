// Resolution hooks module: appends `.ts` to extensionless relative specifiers
// so Node's native TypeScript type-stripping can follow src/'s imports.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    try {
      const base = context.parentURL ?? import.meta.url;
      const candidate = new URL(specifier + '.ts', base);
      if (existsSync(fileURLToPath(candidate))) {
        return next(specifier + '.ts', context);
      }
    } catch {
      // fall through to default resolution
    }
  }
  return next(specifier, context);
}
