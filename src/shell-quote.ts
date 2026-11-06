/**
 * A value from a test, ready for a command a person copies and runs. Double quotes read better and are safe only when
 * nothing inside can expand, including ! in an interactive shell, so anything else goes in single quotes.
 */
export const shellQuote = (value: string): string => (/^[\w@%+=:,./-]+$/.test(value) ? `"${value}"` : `'${value.replace(/'/g, `'\\''`)}'`);
