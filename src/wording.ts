import type { FailureKind } from './model.ts';

const ENVIRONMENT =
  /session|econnrefused|econnreset|etimedout|enotfound|socket hang up|net::err|did not boot|chromedriver|appium|emulator|simulator|webdriver|proxy error|timed? ?out waiting for (a )?(device|driver)/i;
const WRONG_RESULT = /^expected\b|\bassert|to (read|hold|contain|equal|be|have)\b.* but\b|but (it )?(read|held|was|got)\b/i;
const NOT_FOUND = /(was )?not (found|displayed|clickable|visible)|still not displayed|never appeared|no such element/i;

/**
 * What an error's wording says it is, for a framework that hands its recorder only text, and for records with no kind.
 * The words are browser and device drivers', network errors' and assertion messages', so an error none of them fits has no
 * kind rather than a guessed one.
 */
export function kindFromWords(error: string): FailureKind | undefined {
  // Quotes hold a locator's name or a value from the app, and a button called "Session timeout" is no driver failure.
  const words = (error.split('\n')[0] ?? '').replace(/"[^"]*"/g, '""');
  if (ENVIRONMENT.test(words)) return 'env';
  if (NOT_FOUND.test(words)) return 'missing';
  if (WRONG_RESULT.test(words)) return 'check';
  return undefined;
}
