import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { buildModel, verdictOf } from '../src/analysis.ts';
import { DEFAULT_COPY } from '../src/copy.ts';
import { recordRun } from '../src/finish.ts';
import { appendRun, readDebugHistory, readHistory } from '../src/history.ts';
import { mergeRuns } from '../src/merge.ts';
import { HISTORY_VERSION, type ResultRecord, type RunRecord } from '../src/model.ts';
import { reportData } from '../src/render.ts';

const tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'q6-report-merge-'));
const PNG = Buffer.from('\x89PNG\r\n\x1a\nrest', 'latin1');
const MINUTE = 60_000;

const aResult = (name: string, overrides: Partial<ResultRecord> = {}): ResultRecord => ({
  test: `S::${name}`,
  name,
  group: 'S',
  file: 's.spec.ts',
  tags: [],
  status: 'passed',
  ms: 1,
  steps: [],
  ...overrides,
});

const at = (minute: number) => new Date(Date.UTC(2026, 10, 26, 8, minute)).toISOString();

/** A run one shard recorded, starting and finishing at the minutes given. */
const aShard = (id: string, results: ResultRecord[], from: number, to: number, overrides: Partial<RunRecord> = {}): RunRecord => ({
  v: HISTORY_VERSION,
  id,
  runNumber: 0,
  batch: 'github-42-1',
  project: 'shop',
  lane: 'shop-web',
  laneLabel: 'Shop',
  isFull: true,
  startedAt: at(from),
  finishedAt: at(to),
  trigger: 'GitHub Actions',
  notStarted: 0,
  results,
  ...overrides,
});

/** Records a run in a reports folder of its own, as a shard's CI job does, and returns that folder. */
async function shardFolder(root: string, record: RunRecord, files: Record<string, Buffer | string> = {}): Promise<string> {
  const folder = path.join(root, record.id);
  mkdirSync(folder, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(folder, name), bytes);
  await recordRun({
    record,
    historyDir: path.join(folder, 'history'),
    outDir: path.join(folder, 'report'),
    reportsDir: folder,
    staging: path.join(folder, '.run', record.id),
    warn: () => {},
  });
  return folder;
}

const modelOf = (historyDir: string) => buildModel(reportData(readHistory(historyDir, 'shop'), 'shop', ['shop'], () => undefined));

/** Four shards of one CI run, side by side from minute 0 to minute 5, one of them failing with a screenshot and a trace. */
async function fourShards(root: string): Promise<string[]> {
  const failing = aResult('pay', {
    status: 'failed',
    error: 'Expected 1 to be 2',
    image: { path: 'failure-pay.png', type: 'image/png' },
    attachments: [{ name: 'Trace', path: 'trace.zip' }],
  });
  return [
    await shardFolder(root, aShard('shard-1', [aResult('a'), aResult('b')], 0, 5)),
    await shardFolder(root, aShard('shard-2', [aResult('c'), aResult('d')], 0, 5)),
    await shardFolder(root, aShard('shard-3', [aResult('e'), failing], 0, 5), { 'failure-pay.png': PNG, 'trace.zip': 'PK' }),
    await shardFolder(root, aShard('shard-4', [aResult('g'), aResult('h')], 0, 5)),
  ];
}

test('Four shards of one CI run become one run, each test once, failed by the shard that failed, with its screenshot and trace', async () => {
  const root = tempDir();
  const folders = await fourShards(root);
  const historyDir = path.join(root, 'merged', 'history');
  const merged = await mergeRuns({ from: folders, historyDir, outDir: path.join(root, 'merged', 'report'), warn: assert.fail });
  assert.equal(merged.added, 4);
  assert.equal(merged.summary, 'Merged 4 recorded runs, which the report shows as 1 run.');
  assert.equal(merged.pages.length, 1, "The project's report of full runs, and no debug page");
  const model = modelOf(historyDir);
  assert.equal(model.runs.length, 1, 'One run of the report');
  const run = model.runs[0]!;
  assert.equal(run.n, 1);
  assert.deepEqual(
    run.results.map((result) => result.name),
    ['a', 'b', 'c', 'd', 'e', 'pay', 'g', 'h'],
  );
  assert.equal(run.failed, 1);
  const pay = readHistory(historyDir, 'shop')
    .flatMap((record) => record.results)
    .find((result) => result.name === 'pay')!;
  assert.ok(existsSync(path.join(historyDir, 'shop', 'screenshots', pay.image!.path)), 'The screenshot came with its run');
  assert.ok(existsSync(path.join(historyDir, 'shop', 'attachments', pay.attachments![0]!.stored!)), 'So did the trace');
});

test('Shards side by side take as long as one of them, and lanes one after another as long as all of them together', async () => {
  const root = tempDir();
  const historyDir = path.join(root, 'merged', 'history');
  await mergeRuns({ from: await fourShards(root), historyDir, outDir: path.join(root, 'merged', 'report'), warn: assert.fail });
  const shards = modelOf(historyDir).runs[0]!;
  assert.equal(shards.ms, 5 * MINUTE, 'Four shards of 5 minutes each, side by side');
  assert.equal(shards.byLane['shop-web']!.ms, 5 * MINUTE);

  const sequential = tempDir();
  appendRun(sequential, aShard('web', [aResult('a')], 0, 5, { batch: 'nightly' }));
  appendRun(sequential, aShard('ios', [aResult('a')], 6, 10, { batch: 'nightly', lane: 'shop-ios' }));
  const nightly = modelOf(sequential).runs[0]!;
  assert.equal(nightly.ms, 9 * MINUTE, 'A lane of 5 minutes, then one of 4');
  assert.equal(nightly.byLane['shop-ios']!.ms, 4 * MINUTE);
});

test('A merged run takes the next number after the runs the history holds, which stay as they were', async () => {
  const root = tempDir();
  const historyDir = path.join(root, 'merged', 'history');
  appendRun(historyDir, aShard('last-night', [aResult('a')], 0, 1, { batch: 'github-41-1', startedAt: '2026-11-25T08:00:00.000Z' }));
  await mergeRuns({ from: await fourShards(root), historyDir, outDir: path.join(root, 'merged', 'report'), warn: assert.fail });
  const runs = modelOf(historyDir).runs;
  assert.deepEqual(
    runs.map((run) => [run.n, run.total]),
    [
      [1, 1],
      [2, 8],
    ],
  );
});

test('Merging the same folders again adds nothing, and the report stays one run', async () => {
  const root = tempDir();
  const folders = await fourShards(root);
  const historyDir = path.join(root, 'merged', 'history');
  const options = { from: folders, historyDir, outDir: path.join(root, 'merged', 'report'), warn: assert.fail };
  await mergeRuns(options);
  const again = await mergeRuns(options);
  assert.equal(again.added, 0);
  assert.equal(again.summary, 'The history already holds every run these folders hold, so nothing was added.');
  assert.equal(readHistory(historyDir, 'shop').length, 4);
  assert.equal(modelOf(historyDir).runs[0]!.total, 8);
});

test('A lane whose shards are in different batches is merged with a warning naming each batch, numbered in the order they ran', async () => {
  const root = tempDir();
  const folders = [
    await shardFolder(root, aShard('two', [aResult('b')], 10, 15, { batch: 'local-2' })),
    await shardFolder(root, aShard('one', [aResult('a')], 0, 5, { batch: 'local-1' })),
  ];
  const warned: string[] = [];
  const historyDir = path.join(root, 'merged', 'history');
  const merged = await mergeRuns({
    from: folders,
    historyDir,
    outDir: path.join(root, 'merged', 'report'),
    warn: (message) => warned.push(message),
  });
  assert.equal(merged.summary, 'Merged 2 recorded runs, which the report shows as 2 runs.');
  assert.equal(warned.length, 1);
  assert.match(warned[0]!, /^The lane shop-web of shop comes in 2 batches, local-1, local-2, so the report shows it as 2 runs\./);
  assert.match(warned[0]!, /Q6_BATCH/);
  assert.deepEqual(
    modelOf(historyDir).runs.map((run) => [run.n, run.id]),
    [
      [1, 'local-1'],
      [2, 'local-2'],
    ],
  );
});

test('A shard that recorded nothing is passed over with a note, and folders that hold no run at all are refused', async () => {
  const root = tempDir();
  const empty = path.join(root, 'empty-shard');
  mkdirSync(empty);
  const notes: string[] = [];
  const historyDir = path.join(root, 'merged', 'history');
  const outDir = path.join(root, 'merged', 'report');
  const merged = await mergeRuns({
    from: [empty, await shardFolder(root, aShard('one', [aResult('a')], 0, 5))],
    historyDir,
    outDir,
    warn: (message) => notes.push(message),
  });
  assert.equal(merged.added, 1);
  assert.deepEqual(notes, [`${empty} holds no history, so it adds no run, e.g: a shard that had no test of its own.`]);

  await assert.rejects(
    mergeRuns({ from: [empty], historyDir: path.join(root, 'none'), outDir, warn: () => {} }),
    /^Error: None of .*empty-shard holds a run with a test in it, so nothing was tested/,
  );
  await assert.rejects(
    mergeRuns({ from: [path.join(root, 'no-such-folder')], historyDir, outDir, warn: () => {} }),
    /^Error: There is no folder at .*no-such-folder to merge runs from\.$/,
  );
  await assert.rejects(mergeRuns({ from: [], historyDir, outDir, warn: () => {} }), /^Error: Name the reports folders/);
});

test('Shards of a narrowed run join the debug history and its page, and leave the full runs alone', async () => {
  const root = tempDir();
  const historyDir = path.join(root, 'merged', 'history');
  appendRun(historyDir, aShard('last-night', [aResult('a')], 0, 1, { batch: 'github-41-1' }));
  const narrowed = (id: string, name: string) => aShard(id, [aResult(name)], 0, 5, { isFull: false, narrowedTo: '@smoke' });
  const merged = await mergeRuns({
    from: [await shardFolder(root, narrowed('one', 'a')), await shardFolder(root, narrowed('two', 'b'))],
    historyDir,
    outDir: path.join(root, 'merged', 'report'),
    warn: assert.fail,
  });
  assert.equal(merged.added, 2);
  assert.equal(merged.pages.length, 2, 'The report of full runs, then the debug page');
  assert.deepEqual(
    readHistory(historyDir, 'shop').map((record) => record.id),
    ['last-night'],
  );
  assert.deepEqual(
    readDebugHistory(historyDir, 'shop').map((record) => record.runNumber),
    [1, 1],
  );
});

test('q6-report merge adds the folders it is given to the history of --dir and prints each page', async () => {
  const root = tempDir();
  const folders = await fourShards(root);
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const dir = path.join(root, 'report-job');
  const ran = spawnSync(process.execPath, ['--import', 'tsx', cli, 'merge', '--dir', dir, ...folders], {
    encoding: 'utf8',
    env: { ...process.env, Q6_HISTORY_DIR: '' },
  });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(
    ran.stdout,
    /^Merged 4 recorded runs, which the report shows as 1 run\.\nReport: file:\/\/.*\/report-job\/report\/shop\.html\n$/,
  );
  assert.deepEqual(readdirSync(path.join(dir, 'history', 'shop')).sort(), ['attachments', 'history.jsonl.gz', 'screenshots']);

  const none = spawnSync(process.execPath, ['--import', 'tsx', cli, 'merge', '--dir', dir, path.join(root, 'missing')], {
    encoding: 'utf8',
  });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /^There is no folder at .*missing to merge runs from\.\n$/);
});

test('A run whose id cannot name a folder is left out with a warning, and nothing outside its history is copied', async () => {
  const root = tempDir();
  const folder = await shardFolder(root, aShard('fine', [aResult('a')], 0, 5));
  // What a tampered history would hold: a run whose id climbs out of the folder its files are copied from.
  mkdirSync(path.join(root, 'secret'));
  writeFileSync(path.join(root, 'secret', 'key.txt'), 'not for the report');
  const file = path.join(folder, 'history', 'shop', 'history.jsonl.gz');
  // From <shard>/history/shop/screenshots, four levels up is the folder beside the shard.
  const lines = [...readHistory(path.join(folder, 'history'), 'shop'), aShard('../../../../secret', [aResult('b')], 0, 5)];
  writeFileSync(file, gzipSync(lines.map((line) => JSON.stringify(line)).join('\n') + '\n'));
  const warned: string[] = [];
  const historyDir = path.join(root, 'job', 'merged', 'history');
  const merged = await mergeRuns({
    from: [folder],
    historyDir,
    outDir: path.join(root, 'job', 'merged', 'report'),
    warn: (m) => warned.push(m),
  });
  assert.equal(merged.added, 1);
  assert.deepEqual(warned, [`Skipping the run "../../../../secret" in ${folder}: its id cannot name a folder.`]);
  assert.deepEqual(
    readHistory(historyDir, 'shop').map((record) => record.id),
    ['fine'],
  );
  assert.ok(!existsSync(path.join(root, 'job', 'secret')), 'Nothing was copied from outside the shard');
});

/** Shard n of a four-way split of shop-web, recorded alone as its CI job does; an empty shard records a run with no test. */
const shardOf4 = (n: number, results: ResultRecord[]) => aShard(`shard-${n}`, results, 0, 5, { shard: { current: n, total: 4 } });

test('A shard that left no run is named by the merge, which fails, and the page says the run is missing it', async () => {
  const root = tempDir();
  const folders = [
    await shardFolder(root, shardOf4(1, [aResult('a')])),
    await shardFolder(root, shardOf4(2, [aResult('b')])),
    await shardFolder(root, shardOf4(4, [])),
  ];
  const historyDir = path.join(root, 'merged', 'history');
  const merged = await mergeRuns({ from: folders, historyDir, outDir: path.join(root, 'merged', 'report'), warn: assert.fail });
  assert.deepEqual(merged.missing, [
    "Shard 3 of 4 of shop-web left no run in the batch github-42-1 of shop, so its run is missing that part's tests: a part leaves no run when it stops before its first test, and its job's log says why.",
  ]);
  assert.equal(merged.pages.length, 1, 'The page is written all the same, showing what ran');
  const run = modelOf(historyDir).runs[0]!;
  assert.deepEqual(run.missingShards, [{ lane: 'shop-web', shards: [3], total: 4 }]);
  assert.deepEqual(verdictOf(run, DEFAULT_COPY), {
    line: 'All 2 results passed.',
    small: 'But shard 3 of 4 of shop-web left no run.',
    isFailing: true,
  });
});

test('A shard merged later than its siblings, e.g: from a job run again, is no longer missing', async () => {
  const root = tempDir();
  const historyDir = path.join(root, 'merged', 'history');
  const options = { historyDir, outDir: path.join(root, 'merged', 'report'), warn: assert.fail };
  const first = await mergeRuns({
    ...options,
    from: [await shardFolder(root, shardOf4(1, [aResult('a')])), await shardFolder(root, shardOf4(2, [aResult('b')]))],
  });
  assert.deepEqual(
    modelOf(historyDir).runs[0]!.missingShards,
    [{ lane: 'shop-web', shards: [3, 4], total: 4 }],
    'Shards 3 and 4 left no run when it merged',
  );
  assert.match(first.missing[0]!, /^Shards 3 and 4 of 4 of shop-web left no run/);
  const late = await mergeRuns({
    ...options,
    from: [await shardFolder(root, shardOf4(3, [aResult('c')])), await shardFolder(root, shardOf4(4, [aResult('d')]))],
  });
  assert.deepEqual(late.missing, []);
  const run = modelOf(historyDir).runs[0]!;
  assert.deepEqual(run.missingShards, []);
  assert.equal(verdictOf(run, DEFAULT_COPY).line, 'All 4 results passed.');
});

test("An empty shard's own page says it had no test of its own, and is not a run that could not start", async () => {
  const root = tempDir();
  const folder = await shardFolder(root, shardOf4(4, []));
  const run = modelOf(path.join(folder, 'history')).runs[0]!;
  assert.equal(run.isEmptyShard, true);
  assert.deepEqual(run.missingShards, [], "A shard's own history never says its siblings are missing");
  assert.deepEqual(verdictOf(run, DEFAULT_COPY), {
    line: 'This shard had no test of its own.',
    small: "Its run's other shards hold them.",
    isFailing: false,
  });
});

test('Shards that each had no test of their own are refused, since together they tested nothing', async () => {
  const root = tempDir();
  const folders = [await shardFolder(root, shardOf4(1, [])), await shardFolder(root, shardOf4(2, []))];
  await assert.rejects(
    mergeRuns({ from: folders, historyDir: path.join(root, 'merged', 'history'), outDir: path.join(root, 'out'), warn: () => {} }),
    /holds a run with a test in it, so nothing was tested/,
  );
});

test('q6-report merge writes the page and exits 1 naming the shard a split run is missing', async () => {
  const root = tempDir();
  const folders = [await shardFolder(root, shardOf4(1, [aResult('a')])), await shardFolder(root, shardOf4(2, [aResult('b')]))];
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const dir = path.join(root, 'report-job');
  const ran = spawnSync(process.execPath, ['--import', 'tsx', cli, 'merge', '--dir', dir, ...folders], {
    encoding: 'utf8',
    env: { ...process.env, Q6_HISTORY_DIR: '' },
  });
  assert.equal(ran.status, 1);
  assert.match(ran.stdout, /^Merged 2 recorded runs, which the report shows as 1 run\.\nReport: file:\/\/.*shop\.html\n$/);
  assert.match(ran.stderr, /^Shards 3 and 4 of 4 of shop-web left no run in the batch github-42-1 of shop/);
});
