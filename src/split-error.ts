const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const MAX_MESSAGE = 2000;
const MAX_STACK = 4000;

/** Splits an error's text into the message a person reads and the stack below it. */
export function splitError(raw: string): { error: string; stack?: string } {
  const clean = raw.replace(ANSI, '').trim();
  const firstFrame = clean.search(/\n\s+(at |❯ )/);
  const message = (firstFrame === -1 ? clean : clean.slice(0, firstFrame)).replace(/^Error:\s*/, '').trim();
  const stack = firstFrame === -1 ? undefined : clean.slice(firstFrame + 1, firstFrame + 1 + MAX_STACK);
  return { error: message.slice(0, MAX_MESSAGE), ...(stack ? { stack } : {}) };
}
