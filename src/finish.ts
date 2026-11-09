import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Brand } from './brand.ts';
import type { Copy } from './copy.ts';
import {
  appendDebugRun,
  appendRun,
  DEBUG_SHOT_RUNS,
  keepAttachments,
  keepImages,
  newestRuns,
  pruneRunFiles,
  readDebugHistory,
  readHistory,
} from './history.ts';
import { isFullRun, runContext } from './context.ts';
import { reportFolder, runRoot } from './kit.ts';
import { HISTORY_VERSION, type ResultRecord, type RunRecord, safeFolderName } from './model.ts';
import { reportUrl, writeReport } from './render.ts';
import { parseResultLine } from './result-line.ts';

export const stagingDir = (reportsDir: string, runId: string): string => path.join(reportsDir, '.run', runId);

export function newRunId(now = new Date()): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
}

const STALE_MS = 24 * 60 * 60 * 1000;

/** A run cut short leaves its worker files behind; a day later no run can still be writing them. */
export function clearStaleStaging(reportsDir: string, now = Date.now()): void {
  const root = path.join(reportsDir, '.run');
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    const dir = path.join(root, entry);
    if (now - statSync(dir).mtimeMs > STALE_MS) rmSync(dir, { recursive: true, force: true });
  }
}

export interface MergedResults {
  results: ResultRecord[];
  workers: number;
  /** When the first test began and the last one ended, from the lines themselves, so a folder that travelled still knows. */
  startedAt?: string;
  finishedAt?: string;
}

/** Reads every worker's results, in a stable order; a scenario outline repeats its name, so its rows are numbered. */
export function mergeWorkers(dir: string, warn: (message: string) => void = () => {}): MergedResults {
  if (!existsSync(dir)) return { results: [], workers: 0 };
  const files = readdirSync(dir).filter((file) => file.endsWith('.jsonl'));
  let started = Infinity;
  let finished = -Infinity;
  const results = files
    .flatMap((file) =>
      readFileSync(path.join(dir, file), 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((line, index) => {
          const parsed = parseResultLine(line);
          if ('why' in parsed) {
            // A worker killed mid-write leaves a line cut short, which costs that one result and not the whole report.
            warn(`Skipping line ${index + 1} of ${file}: ${parsed.why}`);
            return [];
          }
          if (parsed.finishedAt) {
            const end = Date.parse(parsed.finishedAt);
            started = Math.min(started, end - parsed.result.ms);
            finished = Math.max(finished, end);
          }
          return [parsed.result];
        }),
    )
    .sort((a, b) => (a.file ?? '').localeCompare(b.file ?? ''));
  const seen = new Map<string, number>();
  for (const result of results) {
    const count = (seen.get(result.test) ?? 0) + 1;
    seen.set(result.test, count);
    if (count > 1) result.test = `${result.test} #${count}`;
  }
  return {
    results,
    workers: files.length,
    ...(Number.isFinite(started) ? { startedAt: new Date(started).toISOString(), finishedAt: new Date(finished).toISOString() } : {}),
  };
}

export interface RecordRunOptions {
  record: RunRecord;
  historyDir: string;
  /** Where the page, its JSON and its Markdown summary go. */
  outDir: string;
  /** The folder a result's image and attachment paths are relative to, and have to stay inside. */
  reportsDir: string;
  /** The worker files of this run, removed once the run is recorded. */
  staging: string;
  /** Told about each history line that had to be skipped, and each image or attachment that had to be dropped. */
  warn: (message: string) => void;
  brand?: Partial<Brand>;
  copy?: Partial<Copy>;
}

/**
 * A narrowed run keeps its own short history and its own page. It says nothing about the project, so it must not take a
 * run's place in the report, push a real run out of the limit, or become what the next full run compares against.
 */
async function recordDebugRun({ record, historyDir, outDir, staging, warn, brand, copy }: RecordRunOptions): Promise<string> {
  const { project } = record;
  const onSkip = (line: number, why: string) => warn(`Skipping line ${line} of the ${project} debug history: ${why}`);
  const kept = appendDebugRun(historyDir, record, onSkip);
  rmSync(staging, { recursive: true, force: true });
  pruneRunFiles(
    historyDir,
    project,
    readHistory(historyDir, project),
    newestRuns(kept, DEBUG_SHOT_RUNS).map((run) => run.id),
  );
  const written = await writeReport({ historyDir, outDir, project, isDebug: true, ...(brand ? { brand } : {}), ...(copy ? { copy } : {}) });
  return reportUrl(written.html);
}

/** Adds a finished run to its project's history and rewrites its report. Returns where the page is. */
export async function recordRun(options: RecordRunOptions): Promise<string> {
  const { record, historyDir, outDir, reportsDir, staging, warn, brand, copy } = options;
  const { project } = record;
  // The run's id names the folder its images and attachments go in.
  if (safeFolderName(record.id) !== record.id)
    throw new Error(`The run id "${record.id}" cannot name a folder. newRunId gives one that can.`);
  keepImages(record, historyDir, reportsDir, warn);
  // After the images, as an image the page cannot hold has become an attachment.
  keepAttachments(record, historyDir, reportsDir, warn);
  if (!record.isFull) return recordDebugRun(options);
  const onSkip = (line: number, why: string) => warn(`Skipping line ${line} of the ${project} history: ${why}`);
  const kept = appendRun(historyDir, record, onSkip);
  rmSync(staging, { recursive: true, force: true });
  pruneRunFiles(
    historyDir,
    project,
    kept,
    newestRuns(readDebugHistory(historyDir, project), DEBUG_SHOT_RUNS).map((run) => run.id),
  );
  const written = await writeReport({ historyDir, outDir, project, ...(brand ? { brand } : {}), ...(copy ? { copy } : {}) });
  return reportUrl(written.html);
}

export interface FinishLanesOptions {
  /** The folder recorders wrote under; Q6_REPORT_DIR, or q6-report beside the suite, without it. */
  dir?: string;
  /** The project's name; Q6_REPORT_PROJECT, or the suite's own folder name, without it. */
  project?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  warn?: (message: string) => void;
  brand?: Partial<Brand>;
  copy?: Partial<Copy>;
}

/** A lane's file in which its recorder says the run was not the whole suite, and what it was instead, e.g: cancelled. */
const NARROWED_FILE = 'narrowed.txt';

function laneNarrowedTo(folder: string): string {
  const file = path.join(folder, NARROWED_FILE);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

/** Records what recorders left, one run of the report with a lane per folder, for a suite that has no Node inside it. */
export async function finishLanes(options: FinishLanesOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const warn = options.warn ?? console.warn;
  const dir = path.resolve(cwd, options.dir ?? reportFolder(env));
  const root = runRoot(dir);
  const lanes = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  const merged = lanes.map((lane) => ({ lane, folder: path.join(root, lane), ...mergeWorkers(path.join(root, lane), warn) }));
  const filled = merged.filter((lane) => lane.results.length);
  if (!filled.length)
    throw new Error(`No results under ${root}. A recorder writes them while the suite runs, and Q6_REPORT_DIR says where.`);
  const project = options.project ?? env.Q6_REPORT_PROJECT ?? path.basename(path.resolve(cwd));
  const context = runContext(env, cwd);
  const batch = env.Q6_BATCH ?? context.batch ?? newRunId();
  const now = new Date().toISOString();
  let url = '';
  for (const { lane, folder, results, startedAt, finishedAt } of filled) {
    const narrowedTo = env.Q6_RUN_NARROWED ?? laneNarrowedTo(folder);
    url = await recordRun({
      record: {
        v: HISTORY_VERSION,
        id: newRunId(),
        runNumber: 0,
        batch,
        project,
        lane,
        laneLabel: lane,
        narrowedTo,
        isFull: isFullRun(env, Boolean(narrowedTo)),
        startedAt: startedAt ?? now,
        finishedAt: finishedAt ?? now,
        ...(context.commit ? { commit: context.commit } : {}),
        ...(context.branch ? { branch: context.branch } : {}),
        trigger: context.trigger,
        ...(context.url ? { url: context.url } : {}),
        notStarted: 0,
        results,
      },
      historyDir: env.Q6_HISTORY_DIR ? path.resolve(cwd, env.Q6_HISTORY_DIR) : path.join(dir, 'history'),
      outDir: path.join(dir, 'report'),
      reportsDir: folder,
      staging: folder,
      warn,
      ...(options.brand ? { brand: options.brand } : {}),
      ...(options.copy ? { copy: options.copy } : {}),
    });
  }
  return url;
}
