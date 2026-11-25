// The Mocha recorder. Mocha loads a root hook plugin's mochaHooks, so a suite turns this on with --require q6-report/mocha,
// and a test marks its steps with step(). It declares the shapes it reads from Mocha, so the package needs no Mocha.
// It has no default export: Mocha takes a required module's default in place of the module, which would hide mochaHooks.
import { AsyncLocalStorage } from 'node:async_hooks';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { atOf, keepImage, kindOfError, knownBugOf, laneFolder, rerunOf, writeResult } from './kit.ts';
import type { Attachment, FailureKind, ResultRecord, StepRecord } from './model.ts';
import { splitError } from './split-error.ts';
import { kindFromWords } from './wording.ts';

const FRAMEWORK = 'mocha';
const WRAPPED = Symbol('q6-report wrapped');

/** A test's function, which Mocha calls with a done callback when it declares one. */
type TestFunction = ((this: unknown, done?: (error?: unknown) => void) => unknown) & { [WRAPPED]?: true };

export interface MochaSuite {
  title: string;
  root?: boolean;
  parent?: MochaSuite;
  tests: MochaTest[];
  suites: MochaSuite[];
}

export interface MochaTest {
  title: string;
  file?: string;
  state?: 'passed' | 'failed' | 'pending';
  pending: boolean;
  timedOut?: boolean;
  parent?: MochaSuite;
  fn?: TestFunction;
  timeout(): number;
  retries(): number;
  currentRetry(): number;
  /** The test a retry was cloned from, which Mocha keeps from 9 on. */
  retriedTest?(): MochaTest | undefined;
}

/** What a root hook is called on: currentTest in an each hook, and the hook itself, whose parent is the root suite. */
export interface MochaHookContext {
  currentTest?: MochaTest;
  test?: { parent?: MochaSuite };
}

export interface MochaRootHooks {
  beforeEach(this: MochaHookContext): void;
  afterEach(this: MochaHookContext): Promise<void>;
  afterAll(this: MochaHookContext): void;
}

export interface MochaRecorderOptions {
  /** The results file; one per process in the lane's folder when unset. */
  file?: string;
  /** Where results, images and attachments are kept; the lane's folder when unset. */
  folder?: string;
  /** What a test's id is relative to, e.g: the folder of the spec files; the working folder when unset. */
  rootDir?: string;
}

/** Takes a screenshot as image bytes, e.g: from a browser the suite drives. */
export type Screenshot = () => Uint8Array | Promise<Uint8Array>;

type Keep = (file: string, what: 'image' | 'attachment', name: string) => string | undefined;

/** One attempt of a test as it runs, with what its test keeps across attempts and how its recorder keeps a file. */
interface Attempt {
  test: MochaTest;
  started: number;
  steps: StepRecord[];
  failedAt?: number;
  error?: unknown;
  /** The failed attempt's screenshot, in a scratch file until the attempt is decided: the result's image, or a file of its retry. */
  shot?: string;
  attachments: Attachment[];
  keep: Keep;
}

const insideStep = new AsyncLocalStorage<true>();
let running: Attempt | undefined;
let takeScreenshot: Screenshot | undefined;

const posix = (file: string): string => file.split(path.sep).join('/');

/** The test a retry was cloned from, so every attempt of one test is one test. */
const originalOf = (test: MochaTest): MochaTest => test.retriedTest?.() ?? test;

function suitesOf(test: MochaTest): string[] {
  const titles: string[] = [];
  for (let suite = test.parent; suite && !suite.root; suite = suite.parent) if (suite.title) titles.unshift(suite.title);
  return titles;
}

const TAG = /(?:^|\s)(@\S+)/g;

/** The @words of a title, which is how a Mocha suite tags a test and greps for it. */
export const tagsInTitle = (title: string): string[] => [...title.matchAll(TAG)].map((found) => found[1]!);

/**
 * How an error reads in the report: an assertion's or a plain Error's own message, and any other error's type before it.
 * An assertion is what kindOfError calls a check: an expect's, with its matcher result, or node:assert's.
 */
function messageOf(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const { name, message, matcherResult, code } = error as { name?: unknown; message?: unknown; matcherResult?: unknown; code?: unknown };
  const text = String(message ?? error);
  const isAssertion = Boolean(matcherResult) || code === 'ERR_ASSERTION' || /AssertionError/.test(String(name ?? ''));
  return isAssertion || !name || name === 'Error' ? text : `${String(name)}: ${text}`;
}

const kindOf = (error: unknown, message: string): FailureKind => kindFromWords(message) ?? kindOfError(error);

/** Takes an attempt's screenshot once, with what the suite gave screenshots(); a screenshot that fails is said, never thrown. */
async function screenshotOf(attempt: Attempt): Promise<void> {
  if (attempt.shot || !takeScreenshot) return;
  try {
    const bytes = await takeScreenshot();
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'q6-report-screenshot-')), 'screenshot.png');
    writeFileSync(file, bytes);
    attempt.shot = file;
  } catch (error) {
    console.error(`The report could not take a screenshot of "${attempt.test.title}": ${String(error)}`);
  }
}

/** Keeps an attempt's screenshot as the decided attempt's image or as a retried attempt's file, and drops its scratch copy. */
function keepShot(attempt: Attempt, what: 'image' | 'attachment'): string | undefined {
  if (!attempt.shot) return undefined;
  try {
    return attempt.keep(attempt.shot, what, 'screenshot');
  } finally {
    rmSync(path.dirname(attempt.shot), { recursive: true, force: true });
    attempt.shot = undefined;
  }
}

/**
 * Runs a step, and records it under the test running, unless it runs inside another step, which it is then part of. A
 * step that fails stays the test's failure, and the first one to fail takes the screenshot, while the test still holds
 * whatever it drives.
 */
export async function step<T>(text: string, body: () => T | Promise<T>): Promise<T> {
  const attempt = running;
  if (!attempt || insideStep.getStore()) return body();
  const started = performance.now();
  const record: StepRecord = { keyword: '', text, status: 'passed', ms: 0 };
  attempt.steps.push(record);
  try {
    return await insideStep.run(true, body);
  } catch (error) {
    record.status = 'failed';
    if (attempt.failedAt === undefined) {
      attempt.failedAt = attempt.steps.length - 1;
      await screenshotOf(attempt);
    }
    throw error;
  } finally {
    record.ms = Math.round(performance.now() - started);
  }
}

/** Keeps a file of the test running, e.g: a log or a video, as it is at this moment, under a name of the suite's own. */
export function attach(name: string, file: string): void {
  const attempt = running;
  if (!attempt) {
    console.error(`"${name}" was attached while no test was running, so no result holds it`);
    return;
  }
  const kept = attempt.keep(file, 'attachment', name);
  if (kept) attempt.attachments.push({ name, path: kept, attempt: attempt.test.currentRetry() + 1 });
}

/** Says how to take a screenshot, which the recorder does when a test fails, e.g: from the browser the suite drives. */
export function screenshots(take: Screenshot | undefined): void {
  takeScreenshot = take;
}

/**
 * Mocha hands a failed test's error to its reporters only, never to a hook, and reads a test's function only when the
 * test runs, so the function is wrapped as the test starts and the error is kept on its way out. A retry's clone copies
 * the function, already wrapped, and its error goes to the attempt running.
 */
function keepErrors(test: MochaTest): void {
  const fn = test.fn;
  if (!fn || fn[WRAPPED]) return;
  const original = originalOf(test);
  const keep = (error: unknown): void => {
    if (running && originalOf(running.test) === original) running.error ??= error;
  };
  const wrapped: TestFunction =
    fn.length > 0
      ? function (this: unknown, done?: (error?: unknown) => void) {
          try {
            return fn.call(this, (error?: unknown) => {
              if (error) keep(error);
              done?.(error);
            });
          } catch (error) {
            keep(error);
            throw error;
          }
        }
      : async function (this: unknown) {
          try {
            return await fn.call(this);
          } catch (error) {
            keep(error);
            throw error;
          }
        };
  wrapped[WRAPPED] = true;
  test.fn = wrapped;
}

export class MochaRecorder {
  protected readonly folder: string;
  protected readonly file: string;
  protected readonly rootDir: string;
  private counter = 0;
  private readonly files = new WeakMap<MochaTest, Attachment[]>();
  private readonly recorded = new WeakSet<MochaTest>();

  constructor(options: MochaRecorderOptions = {}) {
    this.folder = options.folder ?? laneFolder(FRAMEWORK);
    this.file = options.file ?? path.join(this.folder, `${FRAMEWORK}-${process.pid}.jsonl`);
    this.rootDir = options.rootDir ?? process.cwd();
  }

  /** The root hooks Mocha runs around every test, as a root hook plugin hands them. */
  hooks(): MochaRootHooks {
    const open = (test: MochaTest) => this.open(test);
    const close = (test: MochaTest) => this.close(test);
    const notRun = (root: MochaSuite) => this.notRun(root);
    return {
      beforeEach() {
        if (this.currentTest) open(this.currentTest);
      },
      async afterEach() {
        if (this.currentTest) await close(this.currentTest);
      },
      afterAll() {
        if (this.test?.parent) notRun(this.test.parent);
      },
    };
  }

  /** A test's tags: the @words of its title and of its suites' titles. A framework that takes tags elsewhere adds them here. */
  protected tagsOf(test: MochaTest): string[] {
    return [...suitesOf(test), test.title].flatMap(tagsInTitle);
  }

  /** The one place a file is copied: an image or an attachment goes into the folder and its path inside it comes back. */
  protected keep(file: string, what: 'image' | 'attachment', name: string): string | undefined {
    if (what === 'image') return keepImage(this.folder, file);
    try {
      const kept = `attachments/${process.pid}-${++this.counter}-${path.basename(file)}`;
      mkdirSync(path.join(this.folder, 'attachments'), { recursive: true });
      copyFileSync(file, path.join(this.folder, kept));
      return kept;
    } catch (error) {
      console.error(`The report could not keep the attachment "${name}" (${file}): ${String(error)}`);
      return undefined;
    }
  }

  private attemptOf(test: MochaTest): Attempt {
    const original = originalOf(test);
    const attachments = this.files.get(original) ?? [];
    this.files.set(original, attachments);
    return { test, started: performance.now(), steps: [], attachments, keep: (file, what, name) => this.keep(file, what, name) };
  }

  private open(test: MochaTest): void {
    running = this.attemptOf(test);
    keepErrors(test);
  }

  private async close(test: MochaTest): Promise<void> {
    const attempt = running;
    running = undefined;
    if (!attempt || attempt.test !== test) return;
    try {
      if (!test.pending && test.state !== 'passed') await screenshotOf(attempt);
      // An attempt that failed with a retry left has no state, and the retry decides the test; its screenshot stays one
      // of the test's files, as the retry may take one of its own.
      if (test.state === undefined && !test.pending && test.currentRetry() < test.retries()) {
        const kept = keepShot(attempt, 'attachment');
        if (kept) attempt.attachments.push({ name: 'screenshot', path: kept, attempt: test.currentRetry() + 1 });
        return;
      }
      this.write(attempt);
    } catch (error) {
      console.error(`The report could not record "${test.title}": ${String(error)}`);
    }
  }

  /** Every test Mocha never ran: one skipped before it started, and one a failed hook or a bail kept from running. */
  private notRun(root: MochaSuite): void {
    const walk = (suite: MochaSuite): void => {
      for (const test of suite.tests) {
        if (this.recorded.has(originalOf(test))) continue;
        try {
          this.write(
            this.attemptOf(test),
            test.pending ? undefined : 'Mocha never ran it, e.g: a hook before it failed, or the run bailed',
          );
        } catch (error) {
          console.error(`The report could not record "${test.title}": ${String(error)}`);
        }
      }
      suite.suites.forEach(walk);
    };
    walk(root);
  }

  private write(attempt: Attempt, neverRan?: string): void {
    this.recorded.add(originalOf(attempt.test));
    writeResult(this.file, this.recordOf(attempt, neverRan), console.error);
  }

  private recordOf(attempt: Attempt, neverRan: string | undefined): ResultRecord {
    const { test } = attempt;
    const suites = suitesOf(test);
    const file = test.file ? posix(path.relative(process.cwd(), test.file)) : undefined;
    const id = `${test.file ? posix(path.relative(this.rootDir, test.file)) : ''}::${[...suites, test.title].join(' > ')}`;
    const status = test.pending ? 'skipped' : test.state === 'passed' ? 'passed' : 'failed';
    const tags = this.tagsOf(test);
    const knownBug = knownBugOf(tags);
    const rerun = rerunOf({ name: test.title, file });
    const image = keepShot(attempt, 'image');
    return {
      test: id,
      name: test.title,
      group: suites.join(' > '),
      ...(file ? { file } : {}),
      tags,
      status,
      ms: neverRan === undefined && test.state !== undefined ? Math.round(performance.now() - attempt.started) : 0,
      steps: status === 'skipped' ? [] : attempt.steps,
      ...(status === 'failed' && attempt.failedAt !== undefined ? { failedAt: attempt.failedAt } : {}),
      ...(status === 'failed' ? failureOf(attempt, neverRan) : {}),
      attempts: test.currentRetry() + 1,
      ...(knownBug ? { knownBug } : {}),
      ...(rerun ? { rerun } : {}),
      ...(status === 'failed' && image ? { image: { path: image, type: 'image/png' as const } } : {}),
      ...(attempt.attachments.length ? { attachments: attempt.attachments } : {}),
    };
  }
}

function failureOf(attempt: Attempt, neverRan: string | undefined): Pick<ResultRecord, 'error' | 'stack' | 'at' | 'kind'> {
  const { test, error } = attempt;
  if (neverRan) return { error: neverRan, kind: 'error' };
  // A test Mocha's own timer ended never returned, so nothing came out of its function.
  if (error === undefined && test.timedOut) return { error: `Timeout of ${test.timeout()}ms exceeded.`, kind: 'timeout' };
  if (error === undefined) return { error: 'The test failed without an error', kind: 'error' };
  const message = splitError(messageOf(error)).error;
  const raw = (error as { stack?: unknown }).stack;
  const stack = splitError(typeof raw === 'string' ? raw : '').stack;
  const at = atOf(stack, process.cwd());
  return { error: message, ...(stack ? { stack } : {}), ...(at ? { at } : {}), kind: kindOf(error, message) };
}

/** The recorder a suite gets from --require q6-report/mocha, writing into the lane's folder. */
export const mochaHooks: MochaRootHooks = new MochaRecorder().hooks();
