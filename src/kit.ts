// What every Node recorder shares, so a recorder holds only the mapping from its framework's events to a result.
// Nothing here may throw into a test: a recording that breaks is told about, and the test carries on.
import { appendFileSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { type FailureKind, HISTORY_VERSION, type ResultRecord, safeFolderName } from './model.ts';
import { shellQuote } from './shell-quote.ts';

type Env = Record<string, string | undefined>;
type Warn = (message: string) => void;

const DEFAULT_DIR = 'q6-report';
const DEFAULT_BUG_TAG = '^@(bug[-:].+)$';
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

export const reportFolder = (env: Env = process.env): string => env.Q6_REPORT_DIR || DEFAULT_DIR;
export const runRoot = (dir: string): string => path.join(dir, '.run');

/** Where a recorder writes its lane's results; the lane is the framework's name unless a suite names it. */
export const laneFolder = (framework: string, env: Env = process.env): string =>
  path.join(runRoot(reportFolder(env)), safeFolderName(env.Q6_REPORT_LANE || framework));

/** Adds one line to a worker's own file, so parallel workers never share one. */
export function writeResult(file: string, result: ResultRecord, warn: Warn = console.error): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ v: HISTORY_VERSION, finishedAt: new Date().toISOString(), ...result })}\n`);
  } catch (error) {
    warn(`The report could not record "${result.name}": ${String(error)}`);
  }
}

/** Copies a screenshot into the lane's folder, which travels with its results, and returns its path inside that folder. */
export function keepImage(folder: string, file: string, warn: Warn = console.error): string | undefined {
  try {
    const name = `${process.pid}-${Date.now()}-${path.basename(file)}`;
    mkdirSync(path.join(folder, 'images'), { recursive: true });
    copyFileSync(file, path.join(folder, 'images', name));
    return `images/${name}`;
  } catch (error) {
    warn(`The report could not keep the image ${file}: ${String(error)}`);
    return undefined;
  }
}

const hasNetworkCode = (error: { code?: unknown; cause?: { code?: unknown } }): boolean =>
  NETWORK_CODES.has(String(error.code)) || NETWORK_CODES.has(String(error.cause?.code));

/** What a real error object says it is, from its type and code; only a timeout has no better signal than its own message. */
export function kindOfError(error: unknown): FailureKind {
  if (!error || typeof error !== 'object') return 'error';
  const known = error as { code?: unknown; cause?: { code?: unknown }; name?: unknown; message?: unknown; matcherResult?: unknown };
  if (hasNetworkCode(known)) return 'env';
  if (known.code === 'ERR_MOCHA_TIMEOUT' || known.name === 'TimeoutError') return 'timeout';
  if (/^(test )?timed? ?out\b|exceeded timeout/i.test(String(known.message ?? '').split('\n')[0] ?? '')) return 'timeout';
  if (known.matcherResult || known.code === 'ERR_ASSERTION' || /AssertionError/.test(String(known.name ?? ''))) return 'check';
  return 'error';
}

/** Where a failure happened: the deepest frame of a stack in the suite's own code, as file:line from its root. */
export function atOf(stack: string | undefined, cwd: string = process.cwd()): string | undefined {
  for (const line of (stack ?? '').split('\n')) {
    const found = /(?:^\s*(?:at|❯)\s+(?:.*\()?)((?:file:\/\/)?[^\s()]+?):(\d+)(?::\d+)?\)?\s*$/.exec(line);
    if (!found) continue;
    const file = found[1]!.replace(/^file:\/\//, '');
    if (file.startsWith('node:') || file.includes('node_modules') || file.startsWith('internal/')) continue;
    const relative = path.isAbsolute(file) ? path.relative(cwd, file) : file;
    return `${relative.split(path.sep).join('/')}:${found[2]!}`;
  }
  return undefined;
}

/** The known bug a test's tags mark, by the pattern Q6_REPORT_BUG_TAG gives; its first group is the bug, or the whole match. */
export function knownBugOf(tags: readonly string[], env: Env = process.env): string | undefined {
  const pattern = new RegExp(env.Q6_REPORT_BUG_TAG || DEFAULT_BUG_TAG, 'i');
  for (const tag of tags) {
    const found = pattern.exec(tag);
    if (found) return found[1] ?? found[0];
  }
  return undefined;
}

/** The command that runs a test again, from the template in Q6_REPORT_RERUN; a name reaches the shell quoted. */
export function rerunOf(test: { name: string; file?: string }, env: Env = process.env): string | undefined {
  const template = env.Q6_REPORT_RERUN;
  if (!template) return undefined;
  return template.replaceAll('{name}', shellQuote(test.name)).replaceAll('{file}', shellQuote(test.file ?? ''));
}
