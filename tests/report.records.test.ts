import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';

import { attemptGrid, buildModel, failingStretch } from '../src/analysis.ts';
import { ciContext } from '../src/context.ts';
import { clearStaleStaging, mergeWorkers, recordRun, stagingDir } from '../src/finish.ts';
import {
  appendRun,
  historyFile,
  keepAttachments,
  keepImages,
  moveOldScreenshots,
  parseHistory,
  pruneRunFiles,
  readDebugHistory,
  readHistory,
  RUN_LIMIT,
  SHOT_RUNS,
} from '../src/history.ts';
import { HISTORY_VERSION, type ReportData, type ResultRecord, type RunRecord } from '../src/model.ts';
import { debugScope, publishAttachments, reportData, reportHtml, reportSummary } from '../src/render.ts';
import { splitError } from '../src/split-error.ts';

/** What the page unpacks in the browser. */
function pageData(html: string): ReportData {
  const base64 = /<script id="report-data" type="text\/plain">([^<]*)<\/script>/.exec(html)?.[1];
  assert.ok(base64, 'The page holds its data');
  return JSON.parse(gunzipSync(Buffer.from(base64, 'base64')).toString('utf8')) as ReportData;
}

const tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'q6-report-'));

const PNG = Buffer.from('\x89PNG\r\n\x1a\nrest', 'latin1');
const imageAt = (file: string) => ({ image: { path: file, type: 'image/png' as const } });

test('An error loses its colour codes and its prefix, and a message with no stack stays whole', () => {
  assert.deepEqual(splitError(`${String.fromCharCode(27)}[31mError: red${String.fromCharCode(27)}[39m`), { error: 'red' });
  assert.deepEqual(splitError('Error: first\nsecond line\n    at x (y.ts:1:1)'), {
    error: 'first\nsecond line',
    stack: '    at x (y.ts:1:1)',
  });
  assert.equal(splitError(`Error: ${'x'.repeat(5000)}`).error.length, 2000);
});

test('Each CI names its own run, and a plain machine is local', () => {
  assert.deepEqual(ciContext({}), { trigger: 'Local' });
  assert.deepEqual(ciContext({ CI: 'true' }), { trigger: 'CI' });
  const github = ciContext({
    GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: '42',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_SHA: 'abc',
    GITHUB_REF_NAME: 'main',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'o/r',
  });
  assert.deepEqual(github, {
    trigger: 'GitHub Actions',
    batch: 'github-42-2',
    commit: 'abc',
    branch: 'main',
    url: 'https://github.com/o/r/actions/runs/42',
  });
  assert.equal(ciContext({ GITLAB_CI: 'true', CI_PIPELINE_ID: '7' }).batch, 'gitlab-7');
  assert.equal(ciContext({ JENKINS_URL: 'x', BUILD_TAG: 'j-1' }).batch, 'jenkins-j-1');
});

function aResult(name: string, overrides: Partial<ResultRecord> = {}): ResultRecord {
  return { test: `F::${name}`, name, group: 'F', file: 'f.feature', tags: [], status: 'passed', ms: 1, steps: [], ...overrides };
}

test("Workers merge into one list, and a scenario outline's repeated name gets told apart", () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, '0-0.jsonl'), `${JSON.stringify(aResult('a'))}\n${JSON.stringify(aResult('a'))}\n`);
  writeFileSync(path.join(dir, '0-1.jsonl'), `${JSON.stringify(aResult('b'))}\n`);
  writeFileSync(path.join(dir, 'ignored.txt'), 'x');
  const merged = mergeWorkers(dir);
  assert.equal(merged.workers, 2);
  assert.deepEqual(merged.results.map((result) => result.test).sort(), ['F::a', 'F::a #2', 'F::b']);
  assert.deepEqual(mergeWorkers(path.join(dir, 'missing')), { results: [], workers: 0 });
});

const aRun = (id: string, results: ResultRecord[] = [aResult('a')]): RunRecord => ({
  v: HISTORY_VERSION,
  id,
  runNumber: 0,
  batch: id,
  project: 'p',
  lane: 'l',
  laneLabel: 'L',
  isFull: true,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  trigger: 'Local',
  notStarted: 0,
  results,
});

test('A broken or newer line in the history costs that line only, and says which', () => {
  const skipped: string[] = [];
  const text = [
    JSON.stringify(aRun('a')),
    '{"cut short',
    JSON.stringify({ ...aRun('b'), v: HISTORY_VERSION + 1 }),
    '{"v":1}',
    '',
    JSON.stringify(aRun('c')),
  ].join('\n');
  const records = parseHistory(text, (line, why) => skipped.push(`${line}: ${why}`));
  assert.deepEqual(
    records.map((record) => record.id),
    ['a', 'c'],
  );
  assert.equal(skipped.length, 3);
  assert.ok(skipped[0]!.startsWith('2:'));
});

test('Staging older than a day is cleared, and a running neighbour is left alone', () => {
  const reportsDir = tempDir();
  const old = stagingDir(reportsDir, 'old');
  const fresh = stagingDir(reportsDir, 'fresh');
  mkdirSync(old, { recursive: true });
  mkdirSync(fresh, { recursive: true });
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  utimesSync(old, past, past);
  clearStaleStaging(reportsDir);
  assert.ok(!existsSync(old));
  assert.ok(existsSync(fresh));
});

test('The summary a CI shows keeps a failure with a pipe in its text on one table row', () => {
  const data = reportData(
    [aRun('a', [aResult('a|b', { status: 'failed', error: 'Expected x | y\nsecond line' })])],
    'p',
    ['p'],
    () => undefined,
  );
  const summary = reportSummary(buildModel(data));
  assert.ok(summary.includes('| a\\|b | l | Expected x \\| y |'), summary);
  assert.ok(summary.startsWith('## p: 1 of 1 result failed'), summary);
});

test('A run joins its batch and gets the next number, and numbers carry on once older runs are dropped', () => {
  const historyDir = tempDir();
  for (let i = 0; i < RUN_LIMIT + 5; i++) appendRun(historyDir, { ...aRun(`r${i}`), lane: 'web' });
  appendRun(historyDir, { ...aRun('other-lane'), batch: `r${RUN_LIMIT + 4}`, lane: 'ios' });
  const records = readHistory(historyDir, 'p');
  assert.equal(new Set(records.map((record) => record.batch)).size, RUN_LIMIT, 'A batch of two lanes counts as one run');
  assert.equal(records.length, RUN_LIMIT + 1);
  assert.equal(records[0]!.runNumber, 6, 'The oldest five runs are gone and their numbers are not reused');
  assert.deepEqual(
    records.slice(-2).map((record) => record.runNumber),
    [RUN_LIMIT + 5, RUN_LIMIT + 5],
  );
  assert.deepEqual(buildModel(reportData(records, 'p', ['p'], () => undefined)).runs.at(-1)!.n, RUN_LIMIT + 5);
});

test('The history is one gzip file a person can read with zcat, and a write leaves no temporary file', () => {
  const historyDir = tempDir();
  appendRun(historyDir, aRun('a'));
  appendRun(historyDir, aRun('b'));
  const file = historyFile(historyDir, 'p');
  assert.ok(file.endsWith('history.jsonl.gz'));
  const lines = gunzipSync(readFileSync(file)).toString('utf8').trim().split('\n');
  assert.deepEqual(
    lines.map((line) => (JSON.parse(line) as RunRecord).id),
    ['a', 'b'],
  );
  assert.deepEqual(readdirSync(path.dirname(file)), ['history.jsonl.gz']);
});

test('A history cut short keeps the runs before the cut and warns about the one it lost', () => {
  const historyDir = tempDir();
  // Long, unrepetitive error text makes gzip write many blocks, as a real history does.
  const noisy = (id: string) =>
    aRun(id, [aResult(id, { error: Array.from({ length: 4000 }, () => Math.random().toString(36)).join(' ') })]);
  for (let i = 0; i < 6; i++) appendRun(historyDir, noisy(`r${i}`));
  const file = historyFile(historyDir, 'p');
  const whole = readFileSync(file);
  writeFileSync(file, whole.subarray(0, Math.floor(whole.length * 0.7)));
  const skipped: string[] = [];
  const records = readHistory(historyDir, 'p', (line, why) => skipped.push(`${line}: ${why}`));
  assert.ok(records.length >= 2 && records.length < 6, `${records.length} runs survived`);
  assert.deepEqual(
    records.map((record) => record.id),
    ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'].slice(0, records.length),
  );
  assert.equal(skipped.length, 1, 'The line the cut went through');
});

test('A history that is not gzip at all is refused by name, and the fix is in the message', () => {
  const historyDir = tempDir();
  mkdirSync(path.join(historyDir, 'p'), { recursive: true });
  writeFileSync(historyFile(historyDir, 'p'), 'this was never a history');
  assert.throws(() => readHistory(historyDir, 'p'), /history\.jsonl\.gz cannot be read.*Move it away/s);
  assert.throws(() => appendRun(historyDir, aRun('a')), /Move it away/, 'A run does not write over what it could not read');
  assert.equal(readFileSync(historyFile(historyDir, 'p'), 'utf8'), 'this was never a history');
});

test('Screenshots and attachments stay for the newest runs, counting a run of three lanes once', () => {
  const reportsDir = tempDir();
  const historyDir = path.join(reportsDir, 'history');
  writeFileSync(path.join(reportsDir, 'failure-x.png'), PNG);
  writeFileSync(path.join(reportsDir, 'run.log'), 'started\n');
  const records: RunRecord[] = [];
  for (let night = 0; night < SHOT_RUNS + 2; night++) {
    for (const lane of ['web', 'android', 'ios']) {
      const result = aResult('a', { ...imageAt('failure-x.png'), attachments: [{ name: 'Log', path: 'run.log' }] });
      const record = { ...aRun(`n${night}-${lane}`, [result]), batch: `night-${night}`, lane };
      keepImages(record, historyDir, reportsDir, () => {});
      keepAttachments(record, historyDir, reportsDir, () => {});
      records.push(record);
    }
  }
  pruneRunFiles(historyDir, 'p', records);
  for (const folder of ['screenshots', 'attachments']) {
    const kept = readdirSync(path.join(historyDir, 'p', folder));
    assert.equal(kept.length, SHOT_RUNS * 3, folder);
    assert.ok(!kept.includes('n0-web') && kept.includes(`n${SHOT_RUNS + 1}-ios`) && kept.includes('n2-web'), folder);
  }
  assert.ok(existsSync(path.join(reportsDir, 'failure-x.png')), 'The file stays where someone running one test looks for it');
  assert.ok(existsSync(path.join(reportsDir, 'run.log')), 'So does an attachment');
});

test('A screenshot that was never written is not a dangling link', () => {
  const reportsDir = tempDir();
  const record = aRun('a', [aResult('a', imageAt('gone.png'))]);
  keepImages(record, path.join(reportsDir, 'history'), reportsDir, () => {});
  assert.equal(record.results[0]!.image, undefined);
});

test('A value from a run cannot close the data script, and comes back whole', () => {
  const hostile = `</script><script>alert(1)</script>${String.fromCharCode(0x2028)}`;
  const data: ReportData = {
    project: '<b>p</b>',
    projects: [],
    records: [aRun('a', [aResult('a', { error: hostile })])],
    shots: {},
    shotRuns: 1,
  };
  const html = reportHtml(data, 'var a="</script>";');
  assert.ok(html.includes('&#60;b&#62;p'));
  assert.equal(html.match(/<\/script>/g)?.length, 2, 'Only the two tags the page opens are ever closed');
  assert.equal(pageData(html).records[0]!.results[0]!.error, hostile);
});

test('The page of a 446-test suite at the run limit stays under 3 MB of compressed data', () => {
  const steps = Array.from({ length: 8 }, (_, i) => ({
    keyword: 'And',
    text: `the step number ${i} does the thing it should on this screen`,
    status: 'passed' as const,
    ms: 500,
  }));
  const records = Array.from({ length: RUN_LIMIT }, (_, run) =>
    aRun(
      `r${run}`,
      Array.from({ length: 446 }, (__, t) => aResult(`Scenario ${t} does what the product says it should do`, { steps, ms: 5000 + t })),
    ),
  );
  const html = reportHtml(
    reportData(records, 'p', ['p'], () => undefined),
    '',
  );
  assert.ok(Buffer.byteLength(html) < 3 * 1024 * 1024, `${Math.round(Buffer.byteLength(html) / 1024)} KB`);
});

test('A test keeps its first-seen date after the run it first ran in is dropped', () => {
  const historyDir = tempDir();
  const at = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
  for (let i = 0; i < RUN_LIMIT + 3; i++) appendRun(historyDir, { ...aRun(`r${i}`), startedAt: at(i), finishedAt: at(i) });
  const model = buildModel(reportData(readHistory(historyDir, 'p'), 'p', ['p'], () => undefined));
  assert.equal(model.runs[0]!.n, 4);
  assert.equal(new Date(model.tests[0]!.firstSeen).toISOString(), at(0));
});

test('A failure older than the history is counted as at least that long, and a new one exactly', () => {
  const historyDir = tempDir();
  const at = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
  const bad = aResult('a', { status: 'failed', error: 'Expected "X" to read "1" but it read "2"' });
  for (let i = 0; i < RUN_LIMIT + 3; i++) appendRun(historyDir, { ...aRun(`r${i}`, [bad]), startedAt: at(i), finishedAt: at(i) });
  const cut = failingStretch(buildModel(reportData(readHistory(historyDir, 'p'), 'p', ['p'], () => undefined)).runs.at(-1)!.results[0]!);
  assert.deepEqual([cut.runs, cut.isCut], [RUN_LIMIT, true]);

  const young = tempDir();
  for (let i = 0; i < 3; i++) appendRun(young, { ...aRun(`r${i}`, [bad]), startedAt: at(i), finishedAt: at(i) });
  const exact = failingStretch(buildModel(reportData(readHistory(young, 'p'), 'p', ['p'], () => undefined)).runs.at(-1)!.results[0]!);
  assert.deepEqual([exact.runs, exact.isCut], [3, false]);
});

function sessionModel() {
  const bad = (name: string) => aResult(name, { status: 'failed', error: 'Expected "X" to read "1" but it read "2"' });
  const good = (name: string) => aResult(name);
  const at = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
  const attempt = (i: number, results: ResultRecord[]) => ({
    ...aRun(`d${i}`, results),
    runNumber: i + 1,
    isFull: false,
    startedAt: at(10 + i),
    finishedAt: at(10 + i),
  });
  const data: ReportData = {
    project: 'p',
    projects: ['p'],
    shots: {},
    shotRuns: 10,
    records: [
      {
        ...aRun('f1', [good('fixed'), bad('stuck'), good('fine'), bad('broke-before')]),
        runNumber: 1,
        startedAt: at(0),
        finishedAt: at(0),
      },
    ],
    debugRecords: [
      attempt(0, [bad('fixed'), bad('stuck'), good('fine')]),
      attempt(1, [good('fixed'), bad('stuck'), good('fine'), good('new-and-fine'), good('broke-before')]),
    ],
  };
  return buildModel(data);
}

test('The grid shows every test that ever failed, failing ones first, and folds the rest into a count', () => {
  const { rows, alwaysPassed } = attemptGrid(sessionModel());
  assert.deepEqual(
    rows.map((row) => row.name),
    ['stuck', 'fixed', 'broke-before'],
  );
  assert.equal(alwaysPassed, 2, 'Passing in every attempt that ran it, and passing in the last full run');
  const [stuck, fixed, brokeBefore] = rows;
  assert.deepEqual(
    stuck!.cells.map((cell) => cell?.status),
    ['failed', 'failed'],
  );
  assert.deepEqual(
    fixed!.cells.map((cell) => cell?.status),
    ['failed', 'passed'],
  );
  assert.deepEqual(
    brokeBefore!.cells.map((cell) => cell?.status),
    [undefined, 'passed'],
    'An attempt that did not run it leaves a gap',
  );
  assert.equal(stuck!.lastFull?.status, 'failed');
  assert.equal(brokeBefore!.lastFull?.status, 'failed', 'It shows because the last full run failed it, though no attempt did');
});

test('An attempt that could not start leaves an empty column and nothing else', () => {
  const data: ReportData = {
    project: 'p',
    projects: ['p'],
    shots: {},
    shotRuns: 10,
    records: [],
    debugRecords: [
      { ...aRun('d0', []), runNumber: 1, isFull: false, notStarted: 1 },
      { ...aRun('d1', [aResult('a', { status: 'failed', error: 'x' })]), runNumber: 2, isFull: false },
    ],
  };
  const { rows } = attemptGrid(buildModel(data));
  assert.equal(rows.length, 1);
  assert.deepEqual(
    rows[0]!.cells.map((cell) => cell?.status),
    [undefined, 'failed'],
  );
});

test('A debug page carries only the tests debugged from the full runs, and none of their screenshots', () => {
  const records = [aRun('f1', [aResult('a'), aResult('b'), aResult('c', imageAt('f1/1.png'))])];
  const scoped = debugScope(records, [aRun('d1', [aResult('a')])]);
  assert.deepEqual(
    scoped[0]!.results.map((result) => result.name),
    ['a'],
  );
  assert.deepEqual(debugScope(records, [aRun('d1', [aResult('z')])]), [], 'A run with none of them is dropped');
  assert.equal(records[0]!.results.length, 3, 'The history itself is not touched');
  const read: string[] = [];
  const data = reportData(records, 'p', ['p'], (shot) => (read.push(shot), 'x'), [aRun('d1', [aResult('a', imageAt('d1/1.png'))])]);
  assert.deepEqual(read, ['d1/1.png']);
  assert.deepEqual(Object.keys(data.shots), ['d1/1.png']);
});

test('A debug run of a whole suite that fails everywhere stays under its screenshot budget, newest first', () => {
  const shot = 'x'.repeat(200 * 1024);
  const attempt = (id: string) =>
    aRun(
      id,
      Array.from({ length: 20 }, (_, i) => aResult(`t${i}`, imageAt(`${id}/${i}.png`))),
    );
  const data = reportData([], 'p', ['p'], () => shot, [attempt('old'), attempt('mid'), attempt('new')]);
  const kept = Object.keys(data.shots);
  assert.ok(kept.length * shot.length <= 5 * 1024 * 1024, `${kept.length} screenshots`);
  assert.ok(kept.filter((key) => key.startsWith('new/')).length === 20, 'The newest attempt keeps all of them');
  assert.equal(kept.filter((key) => key.startsWith('old/')).length, 0, 'The oldest gives way first');
});

test('Text attachments stay under the page budget, newest run first, and only from runs that keep their files', () => {
  const megabyte = 'x'.repeat(1024 * 1024);
  const records = Array.from({ length: SHOT_RUNS + 2 }, (_, night) =>
    aRun(`r${night}`, [aResult('a', { attachments: [{ name: 'log', path: 'log', stored: `r${night}/1-log` }] })]),
  );
  const read: string[] = [];
  const data = reportData(
    records,
    'p',
    ['p'],
    () => undefined,
    undefined,
    (stored) => {
      read.push(stored);
      return megabyte;
    },
  );
  assert.deepEqual(Object.keys(data.texts!).sort(), ['r11/1-log', 'r10/1-log', 'r7/1-log', 'r8/1-log', 'r9/1-log'].sort());
  assert.ok(!read.includes('r0/1-log') && !read.includes('r1/1-log'), 'A run whose files are gone is never read');
  const none = reportData([aRun('a', [aResult('a', { attachments: [{ name: 'old', path: 'old.log' }] })])], 'p', ['p'], () => undefined);
  assert.ok(!('texts' in none), 'A page with no text attachment carries no field for them');
});

test('The folder beside the page holds exactly the runs the history keeps files for', () => {
  const root = tempDir();
  const historyDir = path.join(root, 'history');
  const outDir = path.join(root, 'report');
  const store = path.join(historyDir, 'p', 'attachments');
  const beside = path.join(outDir, 'p-attachments');
  for (const run of ['a', 'b']) {
    mkdirSync(path.join(store, run), { recursive: true });
    writeFileSync(path.join(store, run, '1-run.log'), run);
  }
  mkdirSync(path.join(beside, 'gone'), { recursive: true });
  mkdirSync(path.join(beside, '.b.123.tmp'), { recursive: true });
  publishAttachments(historyDir, 'p', outDir);
  assert.deepEqual(readdirSync(beside).sort(), ['a', 'b'], 'A run no longer kept, and a copy cut short, go');
  assert.equal(readFileSync(path.join(beside, 'b', '1-run.log'), 'utf8'), 'b');
  writeFileSync(path.join(beside, 'a', '1-run.log'), 'already here');
  publishAttachments(historyDir, 'p', outDir);
  assert.equal(readFileSync(path.join(beside, 'a', '1-run.log'), 'utf8'), 'already here', 'A run already there is not copied again');
  rmSync(store, { recursive: true });
  publishAttachments(historyDir, 'p', outDir);
  assert.ok(!existsSync(beside), 'With nothing kept, there is no folder');
  publishAttachments(historyDir, 'q', outDir);
  assert.ok(!existsSync(path.join(outDir, 'q-attachments')), 'A project that never attached anything gets no folder');
});

function recording(reportsDir: string, record: RunRecord, warn: (message: string) => void = () => {}) {
  return recordRun({
    record,
    historyDir: path.join(reportsDir, 'history'),
    outDir: path.join(reportsDir, 'report'),
    reportsDir,
    staging: stagingDir(reportsDir, record.id),
    warn,
  });
}

test('Recording a run adds it to the history, keeps its screenshot, clears its staging and writes the page', async () => {
  const reportsDir = tempDir();
  const staging = stagingDir(reportsDir, 'a');
  mkdirSync(staging, { recursive: true });
  writeFileSync(path.join(reportsDir, 'failure-x.png'), PNG);
  const url = await recording(reportsDir, aRun('a', [aResult('a', { status: 'failed', error: 'no', ...imageAt('failure-x.png') })]));
  assert.ok(url.startsWith('file://') && url.endsWith('/report/p.html'), url);
  assert.ok(!existsSync(staging));
  assert.deepEqual(readHistory(path.join(reportsDir, 'history'), 'p')[0]!.results[0]!.image, { path: 'a/1.png', type: 'image/png' });
  assert.equal(pageData(readFileSync(path.join(reportsDir, 'report', 'p.html'), 'utf8')).shots['a/1.png'], PNG.toString('base64'));
});

test('A history whose screenshots are under the old folder name keeps showing them once the next run is recorded', async () => {
  const reportsDir = tempDir();
  const historyDir = path.join(reportsDir, 'history');
  appendRun(historyDir, aRun('before', [aResult('a', { status: 'failed', error: 'no', ...imageAt('before/1.png') })]));
  mkdirSync(path.join(historyDir, 'p', 'shots', 'before'), { recursive: true });
  writeFileSync(path.join(historyDir, 'p', 'shots', 'before', '1.png'), PNG);
  writeFileSync(path.join(reportsDir, 'failure-x.png'), PNG);
  await recording(reportsDir, aRun('after', [aResult('a', { status: 'failed', error: 'no', ...imageAt('failure-x.png') })]));
  const shots = pageData(readFileSync(path.join(reportsDir, 'report', 'p.html'), 'utf8')).shots;
  assert.equal(shots['before/1.png'], PNG.toString('base64'), "The earlier run's screenshot is still on the page");
  assert.equal(shots['after/1.png'], PNG.toString('base64'));
  assert.deepEqual(readdirSync(path.join(historyDir, 'p', 'screenshots')).sort(), ['after', 'before']);
  assert.ok(!existsSync(path.join(historyDir, 'p', 'shots')), 'The old folder is gone');
});

test('A run under both folder names keeps the one under the new name, and every other run is moved', () => {
  const historyDir = tempDir();
  const write = (folder: string, run: string, content: string) => {
    mkdirSync(path.join(historyDir, 'p', folder, run), { recursive: true });
    writeFileSync(path.join(historyDir, 'p', folder, run, '1.png'), content);
  };
  write('shots', 'only-old', 'old');
  write('shots', 'both', 'old');
  write('screenshots', 'both', 'new');
  moveOldScreenshots(historyDir, 'p');
  const read = (run: string) => readFileSync(path.join(historyDir, 'p', 'screenshots', run, '1.png'), 'utf8');
  assert.deepEqual([read('only-old'), read('both')], ['old', 'new']);
  assert.ok(!existsSync(path.join(historyDir, 'p', 'shots')));
  moveOldScreenshots(historyDir, 'none');
});

test('Recording a narrowed run leaves the history and the page of full runs exactly as they were', async () => {
  const reportsDir = tempDir();
  await recording(reportsDir, aRun('full'));
  const history = historyFile(path.join(reportsDir, 'history'), 'p');
  const page = path.join(reportsDir, 'report', 'p.html');
  const [historyBefore, pageBefore] = [readFileSync(history), readFileSync(page)];
  const url = await recording(reportsDir, { ...aRun('narrowed'), isFull: false });
  assert.ok(url.endsWith('/report/p-debug.html'), url);
  assert.deepEqual(readFileSync(history), historyBefore);
  assert.deepEqual(readFileSync(page), pageBefore);
  assert.equal(readDebugHistory(path.join(reportsDir, 'history'), 'p').length, 1);
});

test('A history line that had to be skipped reaches the caller, naming its project and line', async () => {
  const reportsDir = tempDir();
  const history = historyFile(path.join(reportsDir, 'history'), 'p');
  mkdirSync(path.dirname(history), { recursive: true });
  writeFileSync(history, gzipSync('{"cut short\n'));
  const warned: string[] = [];
  await recording(reportsDir, aRun('a'), (message) => warned.push(message));
  assert.deepEqual(warned, ['Skipping line 1 of the p history: it is not valid JSON']);
});
