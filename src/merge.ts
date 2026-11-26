// Brings the runs several machines recorded into one history, e.g: the shards of one CI run, each of which recorded its share
// in a reports folder of its own. A CI saves a cached history once, so the shards cannot each add to the same one.
import { cpSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Brand } from './brand.ts';
import type { Copy } from './copy.ts';
import {
  appendDebugRun,
  appendRun,
  attachmentsDir,
  DEBUG_SHOT_RUNS,
  listDebugProjects,
  listProjects,
  newestRuns,
  pruneRunFiles,
  readDebugHistory,
  readHistory,
  screenshotsDir,
} from './history.ts';
import { type RunRecord, safeFolderName } from './model.ts';
import { reportUrl, writeReport } from './render.ts';

export interface MergeRunsOptions {
  /** Reports folders, each holding the history folder its run wrote, e.g: what each shard's CI job uploaded. */
  from: string[];
  /** The history the runs join. */
  historyDir: string;
  /** Where the pages go. */
  outDir: string;
  /** Told about each history line that had to be skipped, each folder that holds no run, and a lane in several batches. */
  warn: (message: string) => void;
  brand?: Partial<Brand>;
  copy?: Partial<Copy>;
}

export interface MergedRuns {
  /** How many recorded runs the history did not hold yet and now does, full and debug alike, e.g: one per shard. */
  added: number;
  /** What was merged, in one sentence to print: the runs recorded, and how many runs of the report they make. */
  summary: string;
  /** Every page written again, each project's report of full runs before its debug page. */
  pages: string[];
}

const counted = (count: number, what: string): string => `${count} ${what}${count === 1 ? '' : 's'}`;

/** Shards of one run are several recorded runs and one run of the report, which is what a reader of the job wants to see. */
function summaryOf(added: Found[]): string {
  if (added.length === 0) return 'The history already holds every run these folders hold, so nothing was added.';
  const runs = new Set(added.map(({ record, isDebug }) => `${record.project}|${isDebug}|${record.batch}`)).size;
  return `Merged ${counted(added.length, 'recorded run')}, which the report shows as ${counted(runs, 'run')}.`;
}

interface Found {
  record: RunRecord;
  isDebug: boolean;
  /** The history folder it was read from, which holds its screenshots and attachments. */
  source: string;
}

/** Every run the folders' histories hold, full and debug; a folder with no history is one whose run recorded nothing. */
function runsIn(folders: string[], warn: (message: string) => void): Found[] {
  return folders.flatMap((folder) => {
    if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`There is no folder at ${folder} to merge runs from.`);
    const source = path.join(folder, 'history');
    if (!existsSync(source)) {
      warn(`${folder} holds no history, so it adds no run, e.g: a shard that had no test of its own.`);
      return [];
    }
    const onSkip = (project: string) => (line: number, why: string) =>
      warn(`Skipping line ${line} of the ${project} history in ${folder}: ${why}`);
    const runs = [
      ...listProjects(source).flatMap((project) =>
        readHistory(source, project, onSkip(project)).map((record) => ({ record, isDebug: false, source })),
      ),
      ...listDebugProjects(source).flatMap((project) =>
        readDebugHistory(source, project, onSkip(project)).map((record) => ({ record, isDebug: true, source })),
      ),
    ];
    // A run's id names the folders its files are copied from and to, as on a finished run, so one that cannot is left out.
    return runs.filter(({ record }) => {
      const isSafe = typeof record.id === 'string' && /[a-z\d]/i.test(record.id) && safeFolderName(record.id) === record.id;
      if (!isSafe) warn(`Skipping the run ${JSON.stringify(record.id)} in ${folder}: its id cannot name a folder.`);
      return isSafe;
    });
  });
}

/** A lane in more than one batch is more than one run of the report, which shards of one run must not be. */
function warnOfSplitLanes(added: Found[], warn: (message: string) => void): void {
  const batches = new Map<string, Set<string>>();
  for (const { record } of added) {
    const key = `${record.project}|${record.lane}`;
    batches.set(key, (batches.get(key) ?? new Set()).add(record.batch));
  }
  for (const [key, seen] of batches) {
    if (seen.size < 2) continue;
    const [project, lane] = key.split('|');
    warn(
      `The lane ${lane} of ${project} comes in ${seen.size} batches, ${[...seen].join(', ')}, so the report shows it as ${seen.size} runs. Runs that are one, e.g: the shards of one CI run, share a batch: the CI's own run id gives one, and Q6_BATCH does by hand.`,
    );
  }
}

/** Copies a run's own screenshot and attachment folders, which its record's paths point into, next to the other runs'. */
function copyRunFiles({ record, source }: Found, historyDir: string): void {
  for (const dirOf of [screenshotsDir, attachmentsDir]) {
    const from = path.join(dirOf(source, record.project), record.id);
    if (existsSync(from)) cpSync(from, path.join(dirOf(historyDir, record.project), record.id), { recursive: true });
  }
}

/**
 * Adds the runs the folders hold and the history lacks, oldest first so they are numbered in the order they ran, and writes
 * each project's pages again. A run the history already holds is left as it is, so merging the same folders twice adds
 * nothing; folders that hold no run at all are refused, since that is a run in which nothing was tested.
 */
export async function mergeRuns(options: MergeRunsOptions): Promise<MergedRuns> {
  const { from, historyDir, outDir, warn, brand, copy } = options;
  if (from.length === 0) throw new Error('Name the reports folders to merge runs from, e.g: one per shard.');
  const found = runsIn(from, warn).sort((a, b) => Date.parse(a.record.startedAt) - Date.parse(b.record.startedAt));
  if (found.length === 0)
    throw new Error(
      `None of ${from.join(', ')} holds a run, so nothing was tested: every shard had no test of its own, e.g: a TEST_SUITE that matches none, or each stopped before it recorded one.`,
    );
  const onSkip = (project: string) => (line: number, why: string) => warn(`Skipping line ${line} of the ${project} history: ${why}`);
  // The ids each project's full and debug histories hold, read once each and kept up to date as runs are added.
  const held = new Map<string, Set<string>>();
  const heldBy = (project: string, isDebug: boolean): Set<string> => {
    const key = `${isDebug}|${project}`;
    let ids = held.get(key);
    if (!ids) {
      const read = isDebug ? readDebugHistory : readHistory;
      ids = new Set(read(historyDir, project, onSkip(project)).map((run) => run.id));
      held.set(key, ids);
    }
    return ids;
  };
  const added: Found[] = [];
  for (const one of found) {
    const { record, isDebug } = one;
    const ids = heldBy(record.project, isDebug);
    if (ids.has(record.id)) continue;
    copyRunFiles(one, historyDir);
    if (isDebug) appendDebugRun(historyDir, record, onSkip(record.project));
    else appendRun(historyDir, record, onSkip(record.project));
    ids.add(record.id);
    added.push(one);
  }
  warnOfSplitLanes(added, warn);

  const pages: string[] = [];
  for (const project of [...new Set(found.map(({ record }) => record.project))].sort()) {
    const full = readHistory(historyDir, project, onSkip(project));
    const debug = readDebugHistory(historyDir, project, onSkip(project));
    pruneRunFiles(
      historyDir,
      project,
      full,
      newestRuns(debug, DEBUG_SHOT_RUNS).map((run) => run.id),
    );
    const common = { historyDir, outDir, project, ...(brand ? { brand } : {}), ...(copy ? { copy } : {}) };
    if (full.length) pages.push(reportUrl((await writeReport({ ...common, onSkip: onSkip(project) })).html));
    if (debug.length) pages.push(reportUrl((await writeReport({ ...common, isDebug: true })).html));
  }
  return { added: added.length, summary: summaryOf(added), pages };
}
