// The report's numbers, from the records alone. Pure, because the page and the tests both run it.
import { type Brand, DEFAULT_BRAND } from './brand.ts';
import { type Copy, DEFAULT_COPY } from './copy.ts';
import type { FailureKind, ReportData, ResultRecord, RunRecord } from './model.ts';
import { kindFromWords } from './wording.ts';

export type CategoryKey = 'known' | 'wrong' | 'missing' | 'timeout' | 'env' | 'code' | 'flaky' | 'unsorted';

export const CATEGORIES: Record<CategoryKey, { label: string; description?: string }> = {
  known: { label: 'Known bug' },
  wrong: { label: 'Wrong result', description: 'A check found something other than it expected' },
  missing: { label: 'Not found', description: 'An element never appeared: the app changed, or the locator is out of date' },
  timeout: { label: 'Timed out', description: 'It ran out of time before it finished' },
  env: { label: 'Environment', description: 'The device, driver, session or network failed' },
  code: { label: 'Error thrown', description: 'An error was thrown, usually by the code under test' },
  flaky: { label: 'Flaky', description: 'Failed and passed again with nothing marking it as a bug' },
  unsorted: { label: 'Not sorted', description: 'Nothing about this error says what kind of failure it is' },
};
export const CATEGORY_ORDER: CategoryKey[] = ['known', 'wrong', 'missing', 'timeout', 'env', 'code', 'flaky', 'unsorted'];

/** How a known bug is marked differs by suite, so only its description comes from the copy. */
export const categoryDescription = (key: CategoryKey, copy: Copy): string => CATEGORIES[key].description ?? copy.knownBug;

type SortedCategory = Exclude<CategoryKey, 'known' | 'flaky'>;

const KIND_CATEGORY: Record<FailureKind, SortedCategory> = {
  check: 'wrong',
  error: 'code',
  timeout: 'timeout',
  env: 'env',
  missing: 'missing',
};

/** What an error's wording says, for a record whose recorder did not say; a wording it does not know claims nothing. */
export function classifyError(error: string): SortedCategory {
  const kind = kindFromWords(error);
  return kind ? KIND_CATEGORY[kind] : 'unsorted';
}

const sortedAs = (result: ResultRecord): SortedCategory => (result.kind && KIND_CATEGORY[result.kind]) ?? classifyError(result.error ?? '');

/**
 * What makes two failures one cause, with no idea where they happened. An error that names an element puts it in its first
 * quotes, and what follows varies per case, so only the first quote survives; long numbers are the timestamps tests put in their data.
 */
export function failureSignature(error: string): string {
  const line = error.split('\n')[0] ?? '';
  let quote = 0;
  return line.replace(/"[^"]*"/g, (text) => (quote++ === 0 ? text : '"..."')).replace(/\d{5,}/g, '...');
}

/**
 * The same with a recorder's word on where it failed. A line knows more than a value does, so only the first quoted name is
 * kept, which tells apart two locators that fail in one shared wait, and every value is masked.
 */
export function causeWords(error: string): string {
  const line = (error.split('\n')[0] ?? '').replace(/\{[^}]*\}/g, '{}').replace(/'[^']*'/g, "''");
  let quote = 0;
  return line.replace(/"[^"]*"/g, (text) => (quote++ === 0 ? text : '""')).replace(/\d+(\.\d+)?/g, '#');
}

/** One outage reaches every test wherever it stands, so where an environment failure happened says nothing about its cause. */
function causeKey(result: ResultRecord, sorted: SortedCategory): string {
  const error = result.error ?? '';
  if (!result.at) return failureSignature(error);
  return sorted === 'env' ? causeWords(error) : `${result.at} ${causeWords(error)}`;
}

export interface Result extends ResultRecord {
  run: Run;
  lane: string;
  key: string;
  prev?: Result;
  next?: Result;
  category?: CategoryKey;
  signature?: string;
}

export interface LaneStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  ms: number;
}

export interface Run {
  n: number;
  /** A narrowed attempt from the debug history, whose numbers are its own. */
  isDebug: boolean;
  id: string;
  at: number;
  commit?: string;
  branch?: string;
  trigger: string;
  url?: string;
  isFull: boolean;
  notStarted: number;
  lanes: string[];
  /** What it ran, in the words it was narrowed by; empty when it ran the whole suite. */
  narrowedTo: string;
  results: Result[];
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  rate: number;
  ms: number;
  cats: Record<CategoryKey, number>;
  byLane: Record<string, LaneStats>;
}

export interface Lane {
  id: string;
  short: string;
  long: string;
}

export interface TestInfo {
  id: string;
  /** When it first ran, on any lane; the runs it first ran in may be gone from the history. */
  firstSeen: number;
  name: string;
  group: string;
  tags: string[];
  lanes: string[];
  first: Run;
  last: Run;
  /** Oldest first, one list per lane. */
  history: Record<string, Result[]>;
}

export interface Model {
  isDebug: boolean;
  mainReport?: string;
  trialReport?: string;
  project: string;
  projects: string[];
  runs: Run[];
  debugRuns: Run[];
  /** The runs trends draw: the full ones, or every run when no run was full. */
  trendRuns: Run[];
  lanes: Lane[];
  tests: TestInfo[];
  shots: Record<string, string>;
  /** Short text attachments by their stored path. */
  texts: Record<string, string>;
  shotRuns: number;
  debugShotRuns: number;
  /** Lanes that ever kept an image: on any other, a missing screenshot is what the suite is, and says nothing about a failure. */
  lanesWithImages: Set<string>;
  brand: Brand;
  copy: Copy;
}

function lanesOf(records: RunRecord[]): Lane[] {
  const seen = new Map<string, RunRecord>();
  records.forEach((record) => seen.set(record.lane, record));
  const shortOf = (record: RunRecord) => record.laneShort ?? record.lane;
  const all = [...seen.values()];
  // Two lanes with one short name, e.g: staging and production in Chrome, are told apart by their own names.
  return all.map((record) => ({
    id: record.lane,
    short: all.filter((other) => shortOf(other) === shortOf(record)).length > 1 ? record.lane : shortOf(record),
    long: record.laneLabel,
  }));
}

const emptyCats = (): Record<CategoryKey, number> => ({
  known: 0,
  wrong: 0,
  missing: 0,
  timeout: 0,
  env: 0,
  code: 0,
  flaky: 0,
  unsorted: 0,
});

function runFrom(n: number, records: RunRecord[]): Run {
  const first = records[0]!;
  const run: Run = {
    n,
    isDebug: false,
    id: first.batch,
    at: Math.min(...records.map((record) => Date.parse(record.startedAt))),
    ...(first.commit ? { commit: first.commit } : {}),
    ...(first.branch ? { branch: first.branch } : {}),
    trigger: first.trigger,
    ...(first.url ? { url: first.url } : {}),
    isFull: records.some((record) => record.isFull),
    notStarted: records.reduce((sum, record) => sum + record.notStarted, 0),
    lanes: [...new Set(records.map((record) => record.lane))],
    narrowedTo: first.narrowedTo ?? '',
    results: [],
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    rate: 1,
    ms: 0,
    cats: emptyCats(),
    byLane: {},
  };
  records.forEach((record) => {
    const lane = (run.byLane[record.lane] ??= { total: 0, passed: 0, failed: 0, skipped: 0, ms: 0 });
    lane.ms += Math.max(0, Date.parse(record.finishedAt) - Date.parse(record.startedAt));
    run.ms += Math.max(0, Date.parse(record.finishedAt) - Date.parse(record.startedAt));
    record.results.forEach((result) => {
      run.results.push({ ...result, run, lane: record.lane, key: `${result.test}|${record.lane}` });
      run[result.status]++;
      lane[result.status]++;
      lane.total++;
      run.total++;
    });
  });
  run.rate = run.passed + run.failed ? run.passed / (run.passed + run.failed) : 1;
  return run;
}

/**
 * How many times a result's test turned between passing and failing in its last 30 results, this one included.
 * An environment failure says nothing about the test, so it is passed over, or one outage would make every test look flaky.
 */
function flips(result: Result): number {
  const verdicts: boolean[] = [];
  let cursor: Result | undefined = result;
  for (let i = 0; cursor && i < 30; i++, cursor = cursor.prev) {
    if (cursor.status === 'skipped' || (cursor.status === 'failed' && sortedAs(cursor) === 'env')) continue;
    verdicts.push(cursor.status === 'failed');
  }
  return verdicts.filter((isFailed, i) => i > 0 && isFailed !== verdicts[i - 1]).length;
}

function categoryOf(result: Result): CategoryKey {
  if (result.knownBug) return 'known';
  const kind = sortedAs(result);
  if (kind === 'env') return 'env';
  const recoveredBothWays = result.prev?.status === 'passed' && result.next?.status === 'passed';
  // The newest result has no next one yet, so it counts as flaky when this test keeps turning.
  const keepsTurning = !result.next && result.prev?.status === 'passed' && flips(result) >= 3;
  return recoveredBothWays || keepsTurning ? 'flaky' : kind;
}

/**
 * Each attempt looks back at the one before it, then at the test's last full result. Nothing points the other way, so the
 * full runs read exactly as they would with no debugging at all. A category is only what the error says: retrying a test
 * until it passes is what debugging is, not flakiness.
 */
function debugRunsFrom(records: RunRecord[], lastFull: Map<string, Result>): Run[] {
  const batches = new Map<string, RunRecord[]>();
  records.forEach((record) => batches.set(record.batch, [...(batches.get(record.batch) ?? []), record]));
  const last = new Map(lastFull);
  return [...batches.values()].map((group) => {
    const run = runFrom(group[0]!.runNumber, group);
    run.isDebug = true;
    run.results.forEach((result) => {
      const prev = last.get(result.key);
      if (prev) result.prev = prev;
      last.set(result.key, result);
      if (result.status !== 'failed') return;
      result.category = result.knownBug ? 'known' : sortedAs(result);
      result.signature = causeKey(result, sortedAs(result));
      run.cats[result.category]++;
    });
    return run;
  });
}

export function buildModel(data: ReportData): Model {
  const batches = new Map<string, RunRecord[]>();
  [...data.records]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .forEach((record) => {
      const list = batches.get(record.batch);
      if (list) list.push(record);
      else batches.set(record.batch, [record]);
    });
  const runs = [...batches.values()].map((records) => runFrom(records[0]!.runNumber, records));

  const lastByKey = new Map<string, Result>();
  const tests = new Map<string, TestInfo>();
  runs.forEach((run) => {
    run.results.forEach((result) => {
      const prev = lastByKey.get(result.key);
      if (prev) {
        result.prev = prev;
        prev.next = result;
      }
      lastByKey.set(result.key, result);
      let info = tests.get(result.test);
      if (!info) {
        info = {
          id: result.test,
          firstSeen: run.at,
          name: result.name,
          group: result.group,
          tags: result.tags,
          lanes: [],
          first: run,
          last: run,
          history: {},
        };
        tests.set(result.test, info);
      }
      if (result.firstSeen) info.firstSeen = Math.min(info.firstSeen, Date.parse(result.firstSeen));
      info.tags = result.tags;
      info.last = run;
      if (!info.lanes.includes(result.lane)) info.lanes.push(result.lane);
      (info.history[result.lane] ??= []).push(result);
    });
  });
  // Categories look at both neighbours, so they wait until every result is linked.
  runs.forEach((run) => {
    run.results.forEach((result) => {
      if (result.status === 'passed' && (result.attempts ?? 1) > 1 && !result.knownBug) {
        // It failed and passed within this one run, so there is no cause to name, only a test that cannot be relied on.
        result.category = 'flaky';
        run.cats.flaky++;
      }
      if (result.status !== 'failed') return;
      result.category = categoryOf(result);
      result.signature = causeKey(result, sortedAs(result));
      run.cats[result.category]++;
    });
  });
  const debugRuns = debugRunsFrom(data.debugRecords ?? [], lastByKey);
  const full = runs.filter((run) => run.isFull);
  return {
    isDebug: Boolean(data.isDebug),
    ...(data.mainReport ? { mainReport: data.mainReport } : {}),
    ...(data.trialReport ? { trialReport: data.trialReport } : {}),
    project: data.project,
    projects: data.projects,
    runs,
    debugRuns,
    trendRuns: full.length ? full : runs,
    lanes: lanesOf([...data.records, ...(data.debugRecords ?? [])]),
    tests: [...tests.values()],
    shots: data.shots,
    texts: data.texts ?? {},
    shotRuns: data.shotRuns,
    debugShotRuns: data.debugShotRuns ?? 0,
    lanesWithImages: new Set(
      [...data.records, ...(data.debugRecords ?? [])]
        .filter((record) => record.results.some((result) => result.image))
        .map((record) => record.lane),
    ),
    brand: { ...DEFAULT_BRAND, ...data.brand },
    copy: { ...DEFAULT_COPY, ...data.copy },
  };
}

export interface Changes {
  fresh: Result[];
  still: Result[];
  fixed: Result[];
}

/** Each result against the same test's previous result on the same lane, so a narrowed run compares fairly. */
export function changesOf(run: Run): Changes {
  const failed = run.results.filter((result) => result.status === 'failed');
  return {
    fresh: failed.filter((result) => result.prev?.status !== 'failed'),
    still: failed.filter((result) => result.prev?.status === 'failed'),
    fixed: run.results.filter((result) => result.status === 'passed' && result.prev?.status === 'failed'),
  };
}

/** The oldest result of the unbroken stretch of failures this one ends. */
export function failingSince(result: Result): Result {
  let cursor = result;
  while (cursor.prev?.status === 'failed') cursor = cursor.prev;
  return cursor;
}

export interface AttemptRow {
  key: string;
  name: string;
  lane: string;
  /** The test's newest full result, the line every attempt is measured from. */
  lastFull?: Result;
  /** One per attempt, oldest first; unset where that attempt did not run this test. */
  cells: (Result | undefined)[];
  isFailing: boolean;
}

/**
 * What each attempt did to each test, for a debugging session across several tests. Tests that never failed in any
 * attempt fold into a count, so a whole suite shows the handful that matter; the ones failing in their newest attempt come first.
 */
export function attemptGrid(model: Model): { rows: AttemptRow[]; alwaysPassed: number } {
  const rows = new Map<string, AttemptRow>();
  model.debugRuns.forEach((run, column) => {
    run.results.forEach((result) => {
      let row = rows.get(result.key);
      if (!row) {
        const lastFull = model.tests.find((test) => test.id === result.test)?.history[result.lane]?.at(-1);
        row = {
          key: result.key,
          name: result.name,
          lane: result.lane,
          ...(lastFull ? { lastFull } : {}),
          cells: model.debugRuns.map(() => undefined),
          isFailing: false,
        };
        rows.set(result.key, row);
      }
      row.cells[column] = result;
      row.isFailing = result.status === 'failed';
    });
  });
  const all = [...rows.values()];
  const shown = all.filter((row) => row.cells.some((cell) => cell?.status === 'failed') || row.lastFull?.status === 'failed');
  return { rows: shown.sort((a, b) => Number(b.isFailing) - Number(a.isFailing)), alwaysPassed: all.length - shown.length };
}

export interface FailingStretch {
  runs: number;
  since: Result;
  /** It was failing already in the oldest run the history holds, so it has lasted longer than can be counted. */
  isCut: boolean;
}

export function failingStretch(result: Result): FailingStretch {
  const since = failingSince(result);
  const isCut = !since.prev && since.firstSeen !== undefined && Date.parse(since.firstSeen) < since.run.at;
  let runs = 1;
  // Counted along the results, because a debug attempt's run number and a full run's are not on one scale.
  for (let cursor = result; cursor !== since && cursor.prev; cursor = cursor.prev) runs++;
  return { runs, since, isCut };
}

export interface Cluster {
  signature: string;
  error: string;
  category: CategoryKey;
  bug?: string;
  count: number;
  tests: string[];
  lanes: string[];
  first: Run;
  last: Run;
  results: Result[];
  runIds: Set<number>;
}

export function clustersOf(runs: Run[]): Cluster[] {
  const clusters = new Map<string, Cluster>();
  runs.forEach((run) => {
    run.results.forEach((result) => {
      if (result.status !== 'failed') return;
      const signature = result.signature ?? '';
      let cluster = clusters.get(signature);
      if (!cluster) {
        cluster = {
          signature,
          error: result.error ?? '',
          category: result.category ?? 'unsorted',
          ...(result.knownBug ? { bug: result.knownBug } : {}),
          count: 0,
          tests: [],
          lanes: [],
          first: run,
          last: run,
          results: [],
          runIds: new Set(),
        };
        clusters.set(signature, cluster);
      }
      cluster.count++;
      cluster.last = run;
      cluster.error = result.error ?? cluster.error;
      cluster.results.push(result);
      cluster.runIds.add(run.n);
      if (!cluster.tests.includes(result.test)) cluster.tests.push(result.test);
      if (!cluster.lanes.includes(result.lane)) cluster.lanes.push(result.lane);
    });
  });
  // One error can be flaky on some nights and not on others; a cause is called what it mostly was.
  for (const cluster of clusters.values()) {
    const counts = new Map<CategoryKey, number>();
    cluster.results.forEach((result) => counts.set(result.category ?? 'unsorted', (counts.get(result.category ?? 'unsorted') ?? 0) + 1));
    cluster.category = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  return [...clusters.values()].sort((a, b) => b.count - a.count);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export interface FlakyTest {
  test: TestInfo;
  count: number;
  perLane: { lane: string; count: number }[];
  rate: number;
}

export function flakyTests(tests: TestInfo[], runs: Run[]): FlakyTest[] {
  const inPeriod = new Set(runs.map((run) => run.n));
  return tests
    .map((test) => {
      const perLane = test.lanes
        .map((lane) => ({
          lane,
          count: (test.history[lane] ?? []).filter((result) => inPeriod.has(result.run.n) && result.category === 'flaky').length,
        }))
        .filter((entry) => entry.count > 0);
      const judged = test.lanes
        .flatMap((lane) => test.history[lane] ?? [])
        .filter((result) => inPeriod.has(result.run.n) && result.status !== 'skipped');
      return {
        test,
        perLane,
        count: perLane.reduce((sum, entry) => sum + entry.count, 0),
        rate: judged.filter((result) => result.status === 'passed').length / Math.max(1, judged.length),
      };
    })
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

export interface SlowerTest {
  test: TestInfo;
  worst: { lane: string; before: number; recent: number; up: number };
  perLane: { lane: string; before: number; recent: number; up: number }[];
}

const SLOWER_MIN_PASSES = 8;
const SLOWER_RECENT = 5;
const SLOWER_MIN_MS = 2000;

/** The median of a test's last passes against the passes before them, in the period; a failure's timeout says nothing here. */
export function slowerTests(tests: TestInfo[], runs: Run[]): SlowerTest[] {
  const inPeriod = new Set(runs.map((run) => run.n));
  return tests
    .flatMap((test) => {
      const perLane = test.lanes
        .flatMap((lane) => {
          const passes = (test.history[lane] ?? [])
            .filter((result) => inPeriod.has(result.run.n) && result.status === 'passed')
            .map((result) => result.ms);
          if (passes.length < SLOWER_MIN_PASSES) return [];
          const recent = median(passes.slice(-SLOWER_RECENT));
          const before = median(passes.slice(0, -SLOWER_RECENT));
          return recent - before >= SLOWER_MIN_MS ? [{ lane, before, recent, up: recent - before }] : [];
        })
        .sort((a, b) => b.up - a.up);
      return perLane[0] ? [{ test, worst: perLane[0], perLane }] : [];
    })
    .sort((a, b) => b.worst.up - a.worst.up);
}

/** The pass rate over a lane's results in the last window of runs up to each run, so one bad night reads as a dip. */
export function laneRate(lane: string, runs: Run[], index: number, window = 7): number {
  let passed = 0;
  let judged = 0;
  runs.slice(Math.max(0, index - window + 1), index + 1).forEach((run) => {
    const stats = run.byLane[lane];
    if (!stats) return;
    passed += stats.passed;
    judged += stats.passed + stats.failed;
  });
  return judged ? passed / judged : 1;
}

/** One sentence for the verdict, and the numbers under it. Shared by the page and the CI summary. */
export function verdictOf(run: Run, copy: Copy): { line: string; small: string; isFailing: boolean } {
  const changes = changesOf(run);
  const startUnits = `${run.notStarted} ${run.notStarted === 1 ? copy.startUnit : copy.startUnits}`;
  if (!run.total)
    return {
      line: 'This run could not start.',
      small: `${startUnits} failed before any ${copy.test} began.`,
      isFailing: true,
    };
  if (!run.failed && !run.passed && !run.notStarted)
    return {
      line: run.total === 1 ? 'The one result was skipped.' : `All ${run.total} results were skipped.`,
      small: 'Nothing was tested.',
      isFailing: true,
    };
  if (!run.failed) {
    const passed = run.skipped
      ? `${run.passed} of ${run.total} results passed, and ${run.skipped} ${run.skipped === 1 ? 'was' : 'were'} skipped.`
      : run.total === 1
        ? 'The one result passed.'
        : `All ${run.total} results passed.`;
    if (run.notStarted)
      return {
        line: passed,
        small: `But ${startUnits} never started.`,
        isFailing: true,
      };
    return {
      line: passed,
      small: changes.fixed.length ? `${changes.fixed.length} fixed since the last run.` : 'Nothing changed since the last run.',
      isFailing: false,
    };
  }
  const causes = clustersOf([run]).length;
  return {
    line: `${run.failed} of ${run.total} ${run.total === 1 ? 'result' : 'results'} failed, from ${causes} ${causes === 1 ? 'cause' : 'causes'}.`,
    small: `${changes.fresh.length} new, ${changes.still.length} still failing, ${changes.fixed.length} fixed.`,
    isFailing: true,
  };
}
