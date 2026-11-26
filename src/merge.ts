// Brings the runs several machines recorded into one history, e.g: the shards of one CI run, each of which recorded its share
// in a reports folder of its own. A CI saves a cached history once, so the shards cannot each add to the same one.
import { cpSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { missingShardsClause, shardsLeftOut } from './analysis.ts';
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
  /** One sentence for each lane of a split run that is missing parts, which a merge fails on; empty when nothing is missing. */
  missing: string[];
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
 * nothing; folders whose runs tested nothing are refused, and each part of a split run that left no run is written onto
 * its lane's runs and returned, for the page to show and the command to fail on.
 */
export async function mergeRuns(options: MergeRunsOptions): Promise<MergedRuns> {
  const { from, historyDir, outDir, warn, brand, copy } = options;
  if (from.length === 0) throw new Error('Name the reports folders to merge runs from, e.g: one per shard.');
  const found = runsIn(from, warn).sort((a, b) => Date.parse(a.record.startedAt) - Date.parse(b.record.startedAt));
  // A shard with nothing of its own records a run with no test, so shards that all had none still tested nothing.
  if (found.every(({ record }) => !record.results.length && !record.notStarted))
    throw new Error(
      `None of ${from.join(', ')} holds a run with a test in it, so nothing was tested: every shard had no test of its own, e.g: a TEST_SUITE that matches none, or each stopped before it recorded one.`,
    );
  const onSkip = (project: string) => (line: number, why: string) => warn(`Skipping line ${line} of the ${project} history: ${why}`);
  // The runs each project's full and debug histories hold, read once each.
  const held = new Map<string, RunRecord[]>();
  const heldBy = (project: string, isDebug: boolean): RunRecord[] => {
    const key = `${isDebug}|${project}`;
    if (!held.has(key)) held.set(key, (isDebug ? readDebugHistory : readHistory)(historyDir, project, onSkip(project)));
    return held.get(key)!;
  };
  const toAdd = found.filter(({ record, isDebug }) => !heldBy(record.project, isDebug).some((run) => run.id === record.id));
  // Each lane of a split run, in one batch, with the parts none of its records is, those the history holds included.
  const groupOf = ({ record, isDebug }: { record: RunRecord; isDebug: boolean }) =>
    `${isDebug}|${record.project}|${record.batch}|${record.lane}`;
  const missing: string[] = [];
  for (const key of new Set(toAdd.map(groupOf))) {
    const adding = toAdd.filter((one) => groupOf(one) === key);
    const { record, isDebug } = adding[0]!;
    const group = [
      ...adding.map((one) => one.record),
      ...heldBy(record.project, isDebug).filter((run) => groupOf({ record: run, isDebug }) === key),
    ];
    const left = shardsLeftOut(group);
    if (!left.length) continue;
    for (const one of adding) one.record.missingShards = left;
    const total = Math.max(...group.map((run) => run.shard?.total ?? 0));
    const clause = missingShardsClause({ missingShards: [{ lane: record.lane, shards: left, total }] });
    missing.push(
      `${clause[0]!.toUpperCase()}${clause.slice(1)} in the batch ${record.batch} of ${record.project}, so its run is missing that part's tests: a part leaves no run when it stops before its first test, and its job's log says why.`,
    );
  }
  for (const one of toAdd) {
    const { record, isDebug } = one;
    copyRunFiles(one, historyDir);
    if (isDebug) appendDebugRun(historyDir, record, onSkip(record.project));
    else appendRun(historyDir, record, onSkip(record.project));
    heldBy(record.project, isDebug).push(record);
  }
  warnOfSplitLanes(toAdd, warn);

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
  return { added: toAdd.length, summary: summaryOf(toAdd), missing, pages };
}
