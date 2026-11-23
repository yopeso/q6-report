// The Playwright Test recorder. Playwright loads a reporter's default export, so a suite turns this on with
// reporter: [['q6-report/playwright']]. It declares the shapes it reads from Playwright, so the package needs no Playwright.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { atOf, keepImage, knownBugOf, laneFolder, type LaneKind, laneKindOf, rerunOf, writeResult } from './kit.ts';
import type { Attachment, FailureKind, ImageType, LaneBrowser, ResultRecord, StepRecord } from './model.ts';
import { splitError } from './split-error.ts';
import { kindFromWords } from './wording.ts';

const FRAMEWORK = 'playwright-test';
const TRACE_NAME = 'Playwright trace';
const IMAGE_TYPES: Record<string, ImageType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

export interface PwError {
  message?: string;
  stack?: string;
  location?: { file: string; line: number; column?: number };
}

export interface PwAttachment {
  name: string;
  contentType: string;
  path?: string;
  body?: Uint8Array;
}

export interface PwStep {
  category: string;
  title: string;
  duration: number;
  error?: PwError;
  parent?: unknown;
}

export interface PwResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  retry: number;
  error?: PwError;
  errors?: PwError[];
  steps: PwStep[];
  attachments: PwAttachment[];
}

/** The options of a project that say which browser it runs, with the config's own merged in, as a reporter is handed them. */
export interface PwUse {
  browserName?: string;
  defaultBrowserType?: string;
  channel?: string;
}

export interface PwSuite {
  title: string;
  type: string;
  parent?: PwSuite;
  project?(): { name: string; use?: PwUse } | undefined;
}

export interface PwTest {
  title: string;
  location: { file: string };
  parent: PwSuite;
  tags: string[];
  retries: number;
  results: PwResult[];
}

export interface PwConfig {
  rootDir: string;
}

export interface PlaywrightRecorderOptions {
  /** The results file; one per process in the lane's folder when unset. */
  file?: string;
  /** Where results, images and attachments are kept; the lane's folder when unset. */
  folder?: string;
}

export interface MapOptions {
  rootDir: string;
  cwd: string;
  /** Keeps one attachment's file and returns its path inside the lane's folder, or nothing when it could not. */
  keep(attachment: PwAttachment, what: 'image' | 'attachment', name: string): string | undefined;
}

const posix = (file: string): string => file.split(path.sep).join('/');

/** A test is recorded at the attempt that decides it: a pass, a skip, or a failure with no retry left. */
export const isFinalAttempt = (test: Pick<PwTest, 'retries'>, result: Pick<PwResult, 'status' | 'retry'>): boolean =>
  result.status === 'passed' || result.status === 'skipped' || result.status === 'interrupted' || result.retry >= test.retries;

// Playwright words a failed assertion "expect(<what>).<matcher>(...)", on its first line or below a message the test gave.
const FAILED_EXPECT = /^expect(\.soft|\.poll)?\(\w*\)\.(not\.)?\w+\(/m;
const TIMEOUT = /^Test timeout of \d+ms exceeded|^TimeoutError:|\bTimeout \d+ms exceeded/;

/** Playwright hands a reporter an error's text and place and nothing of its type, so its wording is all there is. */
export function kindOfPlaywrightError(error: string): FailureKind {
  const byWords = kindFromWords(error);
  if (byWords) return byWords;
  if (FAILED_EXPECT.test(error)) return 'check';
  if (TIMEOUT.test((error.split('\n')[0] ?? '').trim())) return 'timeout';
  return 'error';
}

function describesOf(test: PwTest): string[] {
  const titles: string[] = [];
  for (let suite: PwSuite | undefined = test.parent; suite; suite = suite.parent)
    if (suite.type === 'describe') titles.unshift(suite.title);
  return titles;
}

function projectOf(test: PwTest): string {
  for (let suite: PwSuite | undefined = test.parent; suite; suite = suite.parent) {
    const name = suite.project?.()?.name;
    if (name) return name;
  }
  return '';
}

function useOf(test: PwTest): PwUse {
  for (let suite: PwSuite | undefined = test.parent; suite; suite = suite.parent) {
    const project = suite.project?.();
    if (project) return project.use ?? {};
  }
  return {};
}

const isChannelOf = (channel: string | undefined, brand: string): boolean => channel === brand || Boolean(channel?.startsWith(`${brand}-`));

/**
 * The browser a project runs, as Playwright picks it: its browserName, else its device's defaultBrowserType, else
 * Chromium; on Chromium a channel names the branded build, e.g: chrome-beta is Chrome and msedge is Edge.
 */
export function browserOfProject(use: PwUse): LaneBrowser | undefined {
  const engine = use.browserName ?? use.defaultBrowserType ?? 'chromium';
  if (engine === 'firefox' || engine === 'webkit') return engine;
  if (engine !== 'chromium') return undefined;
  if (isChannelOf(use.channel, 'chrome')) return 'chrome';
  if (isChannelOf(use.channel, 'msedge')) return 'edge';
  return 'chromium';
}

/** What a test's lane ran in, read from its project, unless the suite names it in Q6_REPORT_BROWSER and Q6_REPORT_PLATFORM. */
export function laneKindOfTest(test: PwTest, env: Record<string, string | undefined> = process.env): LaneKind {
  const browser = browserOfProject(useOf(test));
  return { ...(browser ? { browser, platform: 'web' } : {}), ...laneKindOf(env) };
}

function stepsOf(result: PwResult): { steps: StepRecord[]; failedAt?: number } {
  const own = result.steps.filter((step) => step.category === 'test.step' && !step.parent);
  const steps = own.map((step): StepRecord => ({
    keyword: '',
    text: step.title,
    status: step.error ? 'failed' : 'passed',
    ms: Math.round(step.duration),
  }));
  const failedAt = own.findIndex((step) => step.error);
  return { steps, ...(failedAt === -1 ? {} : { failedAt }) };
}

function failureOf(result: PwResult, cwd: string) {
  const error = result.errors?.[0] ?? result.error;
  if (!error) return undefined;
  const message = splitError(error.message ?? error.stack ?? 'The test failed without an error');
  const stack = splitError(error.stack ?? '').stack;
  const place = error.location ? `${posix(path.relative(cwd, error.location.file))}:${error.location.line}` : atOf(stack, cwd);
  return { error: message.error, ...(stack ? { stack } : {}), ...(place ? { at: place } : {}), kind: kindOfPlaywrightError(message.error) };
}

/** What one test is, as the report records it, from the attempt that decided it and the attempts before. */
export function recordOf(test: PwTest, result: PwResult, options: MapOptions): ResultRecord {
  const { rootDir, cwd, keep } = options;
  const describes = describesOf(test);
  const project = projectOf(test);
  const file = posix(path.relative(cwd, test.location.file));
  const id = `${posix(path.relative(rootDir, test.location.file))}::${[...describes, test.title].join(' > ')}`;
  const status = result.status === 'passed' || result.status === 'skipped' ? result.status : 'failed';
  const { steps, failedAt } = stepsOf(result);
  const failure = status === 'failed' ? failureOf(result, cwd) : undefined;
  const knownBug = knownBugOf(test.tags);
  const rerun = rerunOf({ name: test.title, file });
  const attempts = test.results.length ? test.results : [result];

  const screenshot = result.attachments.find((item) => item.name === 'screenshot' && item.path && item.contentType in IMAGE_TYPES);
  const imagePath = screenshot && keep(screenshot, 'image', 'screenshot');
  const attachments: Attachment[] = [];
  attempts.forEach((attempt, index) => {
    for (const item of attempt.attachments) {
      if (item === screenshot) continue;
      const name = item.name === 'trace' ? TRACE_NAME : item.name;
      const kept = keep(item, 'attachment', name);
      if (kept) attachments.push({ name, path: kept, attempt: index + 1 });
    }
  });

  return {
    test: project ? `${project} | ${id}` : id,
    name: test.title,
    group: describes.join(' > '),
    file,
    tags: [...test.tags],
    status,
    ms: Math.round(result.duration),
    steps,
    ...(failedAt === undefined || status !== 'failed' ? {} : { failedAt }),
    ...(failure ?? {}),
    attempts: attempts.length,
    ...(knownBug ? { knownBug } : {}),
    ...(rerun ? { rerun } : {}),
    ...(screenshot && imagePath ? { image: { path: imagePath, type: IMAGE_TYPES[screenshot.contentType]! } } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
}

const EXTENSIONS: Record<string, string> = {
  'text/plain': '.txt',
  'application/json': '.json',
  'text/markdown': '.md',
  'text/html': '.html',
};

export default class PlaywrightRecorder {
  protected readonly folder: string;
  protected readonly file: string;
  private rootDir = process.cwd();
  private counter = 0;

  constructor(options: PlaywrightRecorderOptions = {}) {
    this.folder = options.folder ?? laneFolder(FRAMEWORK);
    this.file = options.file ?? path.join(this.folder, `${FRAMEWORK}-${process.pid}.jsonl`);
  }

  // The results are this reporter's alone, so Playwright still adds a reporter that prints.
  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: PwConfig): void {
    this.rootDir = config.rootDir;
  }

  onTestEnd(test: PwTest, result: PwResult): void {
    try {
      if (!isFinalAttempt(test, result)) return;
      const record = recordOf(test, result, {
        rootDir: this.rootDir,
        cwd: process.cwd(),
        keep: (attachment, what, name) => this.keepAttachment(attachment, what, name),
      });
      writeResult(this.file, record, console.error, laneKindOfTest(test));
    } catch (error) {
      console.error(`The report could not record "${test.title}": ${String(error)}`);
    }
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

  // An attachment with only a body has no file, so it is written to one and kept like any other.
  private keepAttachment(attachment: PwAttachment, what: 'image' | 'attachment', name: string): string | undefined {
    if (attachment.path) return this.keep(attachment.path, what, name);
    if (!attachment.body) return undefined;
    let scratch: string | undefined;
    try {
      scratch = mkdtempSync(path.join(os.tmpdir(), 'q6-report-body-'));
      const base = name.replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '') || 'attachment';
      const file = path.join(scratch, path.extname(base) ? base : `${base}${EXTENSIONS[attachment.contentType.split(';')[0]!] ?? ''}`);
      writeFileSync(file, attachment.body);
      return this.keep(file, what, name);
    } catch (error) {
      console.error(`The report could not keep the attachment "${name}": ${String(error)}`);
      return undefined;
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
  }
}
