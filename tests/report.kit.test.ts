import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { ciContext, isFullRun } from '../src/context.ts';
import { finishLanes, mergeWorkers } from '../src/finish.ts';
import { readDebugHistory, readHistory } from '../src/history.ts';
import { atOf, keepImage, kindOfError, knownBugOf, laneFolder, rerunOf, writeResult } from '../src/kit.ts';
import { HISTORY_VERSION, type ReportData, type ResultRecord } from '../src/model.ts';
import { parseResultLine } from '../src/result-line.ts';
import { splitError } from '../src/split-error.ts';

const tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'q6-report-kit-'));
const PNG = Buffer.from('\x89PNG\r\n\x1a\nrest', 'latin1');

const passed = (name: string): ResultRecord => ({ test: `G::${name}`, name, group: 'G', tags: [], status: 'passed', ms: 5, steps: [] });

/** A real refusal, from a port that was free a moment ago, as a made-up error object proves nothing about what Node raises. */
async function refusedConnection(): Promise<Error> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return new Promise((resolve) => net.connect(port, '127.0.0.1').on('error', resolve));
}

test('A real refused connection is the environment, and so is one wrapped as a cause', async () => {
  const refused = await refusedConnection();
  assert.equal(kindOfError(refused), 'env');
  assert.equal(kindOfError(new TypeError('fetch failed', { cause: refused })), 'env');
});

test('A real assertion is a check, and so is what a matcher library raises', () => {
  let thrown: unknown;
  try {
    assert.equal(1, 2);
  } catch (error) {
    thrown = error;
  }
  assert.equal(kindOfError(thrown), 'check');
  assert.equal(kindOfError(Object.assign(new Error('expect(received).toBe(expected)'), { matcherResult: { pass: false } })), 'check');
});

test('A timeout is named by its code, its type or how its message starts', () => {
  assert.equal(kindOfError(Object.assign(new Error('x'), { code: 'ERR_MOCHA_TIMEOUT' })), 'timeout');
  assert.equal(kindOfError(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(kindOfError(new Error('Test timed out in 5000ms.')), 'timeout');
  assert.equal(kindOfError(new Error('Exceeded timeout of 5000 ms for a test.')), 'timeout');
});

test('An error whose words only mention a timeout or a connection stays an error', () => {
  assert.equal(kindOfError(new TypeError('the session timed out on the server')), 'error');
  assert.equal(kindOfError(new Error('ECONNREFUSED is what it should have said')), 'error');
  assert.equal(kindOfError(new RangeError('assert failed')), 'error');
  assert.equal(kindOfError('a thrown string'), 'error');
  assert.equal(kindOfError(undefined), 'error');
});

test('Where a failure happened is the deepest frame in the suite, from its root', () => {
  const cwd = '/repo';
  const at = (...frames: string[]) => atOf(frames.map((frame) => `    ${frame}`).join('\n'), cwd);
  assert.equal(at('at thing (/repo/src/a.ts:12:3)'), 'src/a.ts:12');
  assert.equal(at('at /repo/src/a.ts:12:3'), 'src/a.ts:12');
  assert.equal(at('at async thing (file:///repo/src/a.ts:12:3)'), 'src/a.ts:12');
  assert.equal(at('❯ src/a.test.ts:7:15'), 'src/a.test.ts:7');
  assert.equal(at('at wrap (/repo/node_modules/lib/x.js:1:1)', 'at node:internal/process:2:2', 'at mine (/repo/a.ts:3:3)'), 'a.ts:3');
});

test('A stack with nowhere in the suite has no place to name', () => {
  assert.equal(atOf(undefined, '/repo'), undefined);
  assert.equal(atOf('', '/repo'), undefined);
  assert.equal(atOf('    at wrap (/repo/node_modules/lib/x.js:1:1)\n    at node:internal/process:2:2', '/repo'), undefined);
  assert.equal(atOf('    at <anonymous>\n    at Array.map (<anonymous>)', '/repo'), undefined);
  assert.equal(atOf('Error: see /repo/a.ts:1:1 for more', '/repo'), undefined, 'A path in a sentence is not a frame');
});

test('An error is split from a stack in either style', () => {
  assert.deepEqual(splitError('Error: boom\n    at a (b.ts:1:1)'), { error: 'boom', stack: '    at a (b.ts:1:1)' });
  assert.deepEqual(splitError('boom\n ❯ b.ts:1:1'), { error: 'boom', stack: ' ❯ b.ts:1:1' });
});

test('A line goes to its worker file with its version and when it finished, and a folder that cannot be written raises nothing', () => {
  const dir = tempDir();
  const file = path.join(dir, 'nested', 'w.jsonl');
  writeResult(file, passed('a'));
  const line = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  assert.equal(line.v, HISTORY_VERSION);
  assert.ok(!Number.isNaN(Date.parse(String(line.finishedAt))));
  const blocker = path.join(dir, 'a-file');
  writeFileSync(blocker, '');
  const said: string[] = [];
  assert.doesNotThrow(() => writeResult(path.join(blocker, 'w.jsonl'), passed('a'), (message) => said.push(message)));
  assert.match(said[0]!, /could not record "a"/);
});

test('A kept image stays inside the lane folder whatever its name, and a missing one is told about', () => {
  const dir = tempDir();
  const lane = path.join(dir, 'lane');
  const source = path.join(dir, 'shot.png');
  writeFileSync(source, PNG);
  const kept = keepImage(lane, source)!;
  assert.match(kept, /^images\/\d+-\d+-shot\.png$/);
  assert.ok(existsSync(path.join(lane, kept)));
  const said: string[] = [];
  assert.equal(
    keepImage(lane, path.join(dir, 'gone.png'), (message) => said.push(message)),
    undefined,
  );
  assert.equal(said.length, 1);
});

test('Both ways of marking a known bug count with no option, and a tag that only holds the word does not', () => {
  assert.equal(knownBugOf(['@smoke', '@bug-12'], {}), 'bug-12');
  assert.equal(knownBugOf(['@bug:SHOP-1'], {}), 'bug:SHOP-1');
  assert.equal(knownBugOf(['@BL-030'], {}), undefined, 'A tag of a project of its own is matched only by its own pattern');
  assert.equal(knownBugOf(['@BL-030'], { Q6_REPORT_BUG_TAG: '^@((?:bug|BL)[-:].+)$' }), 'BL-030');
  assert.equal(knownBugOf(['@debugging', '@bug', '@ladybug-1'], {}), undefined);
  assert.equal(knownBugOf(['@JIRA-7'], { Q6_REPORT_BUG_TAG: '^@JIRA-(.+)$' }), '7');
});

test('A test name reaches a rerun command quoted, and no template means no command', () => {
  assert.equal(rerunOf({ name: "it's; rm -rf /" }, { Q6_REPORT_RERUN: 'jest -t {name}' }), `jest -t 'it'\\''s; rm -rf /'`);
  assert.equal(rerunOf({ name: 'a' }, {}), undefined);
});

test('A lane names one folder whatever it was called', () => {
  assert.equal(laneFolder('jest', { Q6_REPORT_DIR: 'r' }), path.join('r', '.run', 'jest'));
  assert.equal(laneFolder('jest', { Q6_REPORT_DIR: 'r', Q6_REPORT_LANE: '../../etc' }), path.join('r', '.run', 'etc'));
  assert.equal(laneFolder('jest', {}), path.join('q6-report', '.run', 'jest'));
});

const parsed = (line: unknown) => parseResultLine(typeof line === 'string' ? line : JSON.stringify(line));
const good = { test: 'G::a', status: 'failed' };
const accepted = (line: unknown): ResultRecord => {
  const out = parsed(line);
  assert.ok('result' in out, JSON.stringify(out));
  return out.result;
};

test('A line that cannot be a result says why', () => {
  for (const [line, why] of [
    ['{"test":"cut sho', /not valid JSON/],
    ['[1,2]', /not a result/],
    ['null', /not a result/],
    ['"text"', /not a result/],
    [{ status: 'passed' }, /no test/],
    [{ test: '', status: 'passed' }, /no test/],
    [{ test: 'a' }, /status/],
    [{ test: 'a', status: 'broken' }, /status/],
    [{ ...good, v: HISTORY_VERSION + 1 }, /newer recorder/],
  ] as const) {
    const out = parsed(line);
    assert.ok('why' in out, JSON.stringify(line));
    assert.match(out.why, why);
  }
});

test('A field the report cannot use is dropped, and the rest of the line stays', () => {
  const result = accepted({
    ...good,
    kind: 'undefined',
    attempts: 0,
    failedAt: 7,
    ms: 'soon',
    tags: ['@a', 3],
    steps: [{ text: 'ok', status: 'passed', ms: 1 }, { text: 'bad', status: 'exploded' }, null],
    image: { path: 42 },
    attachments: [{ name: 'a' }],
    at: null,
    somethingElse: '<script>',
  });
  assert.equal(result.kind, undefined);
  assert.equal(result.attempts, undefined);
  assert.equal(result.failedAt, undefined, 'It points past the steps');
  assert.equal(result.ms, 0);
  assert.deepEqual(result.tags, ['@a']);
  assert.equal(result.steps.length, 1);
  assert.equal(result.image, undefined);
  assert.equal(result.attachments, undefined);
  assert.equal(result.at, undefined);
  assert.ok(!('somethingElse' in result), 'Only known fields reach the history');
  assert.equal(result.name, 'G::a', 'A test with no name of its own is called what it is');
});

test('A field the report can use comes through as it was written, markup included, since the page draws it as text', () => {
  const result = accepted({
    ...good,
    name: '<b>a</b>',
    group: 'g',
    file: 'f',
    at: 'f:1',
    kind: 'missing',
    attempts: 2,
    failedAt: 0,
    error: '<img src=x onerror=alert(1)>',
    stack: 's',
    knownBug: 'bug-1',
    rerun: 'r',
    rerunScope: '',
    steps: [{ keyword: 'Then', text: 't', status: 'failed', ms: 2 }],
    image: { path: 'images/1.png' },
    attachments: [{ name: 'a', path: 'b' }],
  });
  assert.equal(result.name, '<b>a</b>');
  assert.equal(result.error, '<img src=x onerror=alert(1)>');
  assert.equal(result.kind, 'missing');
  assert.equal(result.attempts, 2);
  assert.equal(result.failedAt, 0);
  assert.equal(result.rerunScope, '');
  assert.deepEqual(result.image, { path: 'images/1.png', type: 'image/png' });
  assert.deepEqual(result.attachments, [{ name: 'a', path: 'b' }]);
});

test('A recorder cannot say where the report keeps a file, and an attempt is a whole number from one', () => {
  const result = accepted({
    ...good,
    attachments: [
      { name: 'a', path: 'attachments/a.log', attempt: 2, stored: '../../../etc/hosts' },
      { name: 'b', path: 'attachments/b.log', attempt: 0 },
      { name: 'c', path: 'attachments/c.log', attempt: '2' },
      { name: 'd', path: 'attachments/d.log', attempt: 1.5 },
    ],
  });
  assert.deepEqual(result.attachments, [
    { name: 'a', path: 'attachments/a.log', attempt: 2 },
    { name: 'b', path: 'attachments/b.log' },
    { name: 'c', path: 'attachments/c.log' },
    { name: 'd', path: 'attachments/d.log' },
  ]);
});

test('A line cut short costs that one result and is told about, and the run still knows when it ran', () => {
  const dir = tempDir();
  const line = (name: string, finishedAt: string, ms: number) => JSON.stringify({ ...passed(name), finishedAt, ms });
  writeFileSync(path.join(dir, 'a.jsonl'), `${line('one', '2026-01-01T00:00:10.000Z', 4000)}\n{"test":"cut sho`);
  writeFileSync(path.join(dir, 'b.jsonl'), `${line('two', '2026-01-01T00:00:20.000Z', 1000)}\n`);
  const said: string[] = [];
  const merged = mergeWorkers(dir, (message) => said.push(message));
  assert.deepEqual(merged.results.map((result) => result.name).sort(), ['one', 'two']);
  assert.equal(merged.workers, 2);
  assert.equal(merged.startedAt, '2026-01-01T00:00:06.000Z', 'The earliest finish less its own time');
  assert.equal(merged.finishedAt, '2026-01-01T00:00:20.000Z');
  assert.match(said[0]!, /Skipping line 2 of a\.jsonl/);
});

function pageData(file: string): ReportData {
  const base64 = /<script id="report-data" type="text\/plain">([^<]*)<\/script>/.exec(readFileSync(file, 'utf8'))?.[1];
  assert.ok(base64);
  return JSON.parse(gunzipSync(Buffer.from(base64, 'base64')).toString('utf8')) as ReportData;
}

function writeLane(dir: string, lane: string, lines: unknown[]): void {
  const folder = path.join(dir, '.run', lane);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'w.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}

test('Finishing makes one run of every lane the recorders left, and clears them', async () => {
  const dir = tempDir();
  writeLane(dir, 'chrome', [passed('a')]);
  writeLane(dir, 'ios', [passed('a'), passed('b')]);
  const url = await finishLanes({ dir, project: 'shop', env: {}, cwd: dir });
  assert.match(url, /report\/shop\.html$/);
  const records = readHistory(path.join(dir, 'history'), 'shop');
  assert.deepEqual(
    records.map((record) => record.lane),
    ['chrome', 'ios'],
  );
  assert.equal(records[0]!.batch, records[1]!.batch, 'One run of the report');
  assert.equal(records[0]!.runNumber, records[1]!.runNumber);
  assert.deepEqual(readdirSync(path.join(dir, '.run')), []);
});

test('A lane its recorder marked as cancelled goes to the trial page, and leaves the history as it was', async () => {
  const dir = tempDir();
  writeLane(dir, 'chrome', [passed('a')]);
  await finishLanes({ dir, project: 'shop', env: {}, cwd: dir });
  const history = readFileSync(path.join(dir, 'history', 'shop', 'history.jsonl.gz'));
  writeLane(dir, 'chrome', [passed('a')]);
  writeFileSync(path.join(dir, '.run', 'chrome', 'narrowed.txt'), 'the scenarios that ran before it was cancelled\n');
  const url = await finishLanes({ dir, project: 'shop', env: {}, cwd: dir });
  assert.match(url, /report\/shop-debug\.html$/);
  assert.deepEqual(readFileSync(path.join(dir, 'history', 'shop', 'history.jsonl.gz')), history);
  const [trial] = readDebugHistory(path.join(dir, 'history'), 'shop');
  assert.equal(trial!.narrowedTo, 'the scenarios that ran before it was cancelled');
  assert.equal(trial!.isFull, false);
});

test("The report links to the trial runs' page once there are trial runs", async () => {
  const dir = tempDir();
  writeLane(dir, 'chrome', [passed('a')]);
  const first = await finishLanes({ dir, project: 'shop', env: {}, cwd: dir });
  assert.equal(pageData(new URL(first).pathname).trialReport, undefined);
  writeLane(dir, 'chrome', [passed('a')]);
  await finishLanes({ dir, project: 'shop', env: { Q6_RUN_NARROWED: '@smoke' }, cwd: dir });
  writeLane(dir, 'chrome', [passed('a')]);
  const next = await finishLanes({ dir, project: 'shop', env: {}, cwd: dir });
  assert.equal(pageData(new URL(next).pathname).trialReport, 'shop-debug.html');
});

test('Finishing with nothing recorded says where it looked, and a lane with no results costs nothing', async () => {
  const dir = tempDir();
  await assert.rejects(finishLanes({ dir, project: 'shop', env: {}, cwd: dir }), /No results under .*\.run/);
  mkdirSync(path.join(dir, '.run', 'empty'), { recursive: true });
  await assert.rejects(finishLanes({ dir, project: 'shop', env: {}, cwd: dir }), /No results under/);
  writeLane(dir, 'chrome', [passed('a')]);
  await finishLanes({ dir, project: 'shop', env: {}, cwd: dir });
  assert.equal(readHistory(path.join(dir, 'history'), 'shop').length, 1);
});

test("An image path that leaves its lane's folder never reaches the page", async () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, 'secret.png'), PNG);
  const failing = (name: string, image: string) => ({ ...passed(name), status: 'failed', error: 'x', image: { path: image } });
  writeLane(dir, 'chrome', [
    failing('a', '../../secret.png'),
    failing('b', '../../../../etc/hosts'),
    failing('c', path.join(dir, 'secret.png')),
  ]);
  const said: string[] = [];
  const url = await finishLanes({ dir, project: 'shop', env: {}, cwd: dir, warn: (message) => said.push(message) });
  const data = pageData(new URL(url).pathname);
  assert.deepEqual(data.shots, {});
  assert.ok(data.records[0]!.results.every((result) => !result.image));
  assert.equal(said.filter((message) => message.includes('Dropping the image')).length, 3);
});

test("An image inside its lane's folder reaches the page, and one in the next lane's folder does not", async () => {
  const dir = tempDir();
  const failing = (name: string, image: string) => ({ ...passed(name), status: 'failed', error: 'x', image: { path: image } });
  writeLane(dir, 'chrome', [failing('mine', 'images/1.png'), failing('other', '../ios/images/2.png')]);
  mkdirSync(path.join(dir, '.run', 'chrome', 'images'));
  writeFileSync(path.join(dir, '.run', 'chrome', 'images', '1.png'), PNG);
  mkdirSync(path.join(dir, '.run', 'ios', 'images'), { recursive: true });
  writeFileSync(path.join(dir, '.run', 'ios', 'images', '2.png'), PNG);
  const url = await finishLanes({ dir, project: 'shop', env: {}, cwd: dir, warn: () => {} });
  const data = pageData(new URL(url).pathname);
  const image = (name: string) => data.records[0]!.results.find((result) => result.name === name)!.image;
  assert.ok(image('mine') && data.shots[image('mine')!.path], 'The page holds its own image');
  assert.equal(image('other'), undefined);
  assert.equal(Object.keys(data.shots).length, 1);
});

/** A lane whose one failed result attached the files given, written into its folder as a recorder would. */
function laneWithFiles(dir: string, files: Record<string, string | Buffer>, extra: Record<string, unknown> = {}): void {
  writeLane(dir, 'chrome', [
    {
      ...passed('a'),
      status: 'failed',
      error: 'x',
      attachments: Object.keys(files).map((file) => ({ name: path.basename(file), path: file })),
      ...extra,
    },
  ]);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, '.run', 'chrome', file)), { recursive: true });
    writeFileSync(path.join(dir, '.run', 'chrome', file), content);
  }
}

test('A screenshot that is not an image outlives its lane, kept beside the page as an attachment', async () => {
  const dir = tempDir();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  laneWithFiles(dir, { 'images/shot.svg': svg }, { attachments: undefined, image: { path: 'images/shot.svg' } });
  const url = await finishLanes({ dir, project: 'shop', env: {}, cwd: dir, warn: () => {} });
  const data = pageData(new URL(url).pathname);
  const [file] = data.records[0]!.results[0]!.attachments!;
  assert.equal(data.records[0]!.results[0]!.image, undefined, 'It never reaches the page as an image');
  assert.ok(!existsSync(path.join(dir, '.run', 'chrome')), 'Its lane folder is gone');
  assert.equal(readFileSync(path.join(dir, 'report', 'shop-attachments', file!.stored!), 'utf8'), svg);
});

test('A file a test attached is kept beside the page, and only short UTF-8 text is held in the page as well', async () => {
  const dir = tempDir();
  const video = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const files = {
    'attachments/order.log': 'café\n',
    'attachments/long.log': 'x'.repeat(64 * 1024 + 1),
    'attachments/run.mp4': video,
    'attachments/wide.txt': Buffer.from('wide', 'utf16le'),
    'attachments/broken.txt': Buffer.from([0x63, 0x61, 0x66, 0xc3]),
  };
  laneWithFiles(dir, files);
  const url = await finishLanes({ dir, project: 'shop', env: {}, cwd: dir, warn: () => {} });
  const data = pageData(new URL(url).pathname);
  const kept = data.records[0]!.results[0]!.attachments!;
  assert.deepEqual(
    kept.map((file) => file.name),
    ['order.log', 'long.log', 'run.mp4', 'wide.txt', 'broken.txt'],
  );
  kept.forEach((file) => {
    const content = files[file.path as keyof typeof files];
    assert.ok(readFileSync(path.join(dir, 'report', 'shop-attachments', file.stored!)).equals(Buffer.from(content)), file.name);
    assert.ok(readFileSync(path.join(dir, 'history', 'shop', 'attachments', file.stored!)).equals(Buffer.from(content)), file.name);
  });
  assert.deepEqual(data.texts, { [kept[0]!.stored!]: 'café\n' }, 'A long log, a video, UTF-16 and broken UTF-8 open from their files');
});

test("An attachment that leaves its lane's folder, or is not there, is told about and reaches nothing", async () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, 'secret.txt'), 'secret');
  mkdirSync(path.join(dir, '.run', 'chrome', 'attachments'), { recursive: true });
  symlinkSync(path.join(dir, 'secret.txt'), path.join(dir, '.run', 'chrome', 'attachments', 'link.txt'));
  writeLane(dir, 'chrome', [
    {
      ...passed('a'),
      attachments: [
        { name: 'up', path: '../../secret.txt' },
        { name: 'absolute', path: path.join(dir, 'secret.txt') },
        { name: 'linked', path: 'attachments/link.txt' },
        { name: 'gone', path: 'attachments/never-written.log' },
        { name: 'folder', path: 'attachments' },
      ],
    },
  ]);
  const said: string[] = [];
  const url = await finishLanes({ dir, project: 'shop', env: {}, cwd: dir, warn: (message) => said.push(message) });
  const data = pageData(new URL(url).pathname);
  assert.equal(data.records[0]!.results[0]!.attachments, undefined);
  assert.equal(said.filter((message) => message.startsWith('Dropping the attachment')).length, 5);
  assert.ok(!existsSync(path.join(dir, 'report', 'shop-attachments')), 'Nothing was kept, so no folder is written');
  assert.ok(!existsSync(path.join(dir, 'history', 'shop', 'attachments')));
});

test('A project named by a suite stays one folder under the history', async () => {
  const dir = tempDir();
  writeLane(dir, 'chrome', [passed('a')]);
  await finishLanes({ dir, project: '../../escaped', env: {}, cwd: dir });
  assert.ok(existsSync(path.join(dir, 'history', 'escaped', 'history.jsonl.gz')));
  assert.ok(!existsSync(path.join(dir, '..', '..', 'escaped')));
});

test("A pull request's run goes to the trial page, and the next full run is untouched by it", async () => {
  const dir = tempDir();
  const historyDir = path.join(dir, 'history');
  const pullRequest = { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main', GITHUB_RUN_ID: '9' };
  writeLane(dir, 'chrome', [passed('a')]);
  await finishLanes({ dir, project: 'shop', env: {}, cwd: dir });
  const before = readFileSync(path.join(historyDir, 'shop', 'history.jsonl.gz'));
  writeLane(dir, 'chrome', [passed('a')]);
  const url = await finishLanes({ dir, project: 'shop', env: pullRequest, cwd: dir });
  assert.match(url, /shop-debug\.html$/);
  assert.ok(readFileSync(path.join(historyDir, 'shop', 'history.jsonl.gz')).equals(before), 'The history file did not change');
  assert.equal(readDebugHistory(historyDir, 'shop').length, 1);
  assert.match(readFileSync(path.join(dir, 'report', 'shop-debug.md'), 'utf8'), /^## shop, trial run:/);
});

test('Only the variable its own CI documents makes a run a pull request', () => {
  const isPull = (env: Record<string, string>) => ciContext(env).isPullRequest === true;
  assert.ok(isPull({ GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main' }));
  assert.ok(isPull({ GITLAB_CI: 'true', CI_MERGE_REQUEST_IID: '12' }));
  assert.ok(isPull({ JENKINS_URL: 'http://j', CHANGE_ID: '12' }));
  assert.ok(!isPull({ GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: '' }), 'A push sets it empty');
  assert.ok(!isPull({ GITHUB_ACTIONS: 'true' }));
  assert.ok(!isPull({ GITLAB_CI: 'true' }));
  assert.ok(!isPull({ JENKINS_URL: 'http://j' }));
  // A variable that happens to share a name means nothing outside the CI that documents it.
  assert.ok(!isPull({ CHANGE_ID: '12' }));
  assert.ok(!isPull({ CI_MERGE_REQUEST_IID: '12' }));
  assert.ok(!isPull({ GITHUB_BASE_REF: 'main' }));
  assert.ok(!isPull({ GITLAB_CI: 'true', CHANGE_ID: '12' }));
});

test("A pull request's branch is the one a person named, and not its merge ref", () => {
  assert.equal(ciContext({ GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: 'fix-it', GITHUB_REF_NAME: '12/merge' }).branch, 'fix-it');
  assert.equal(
    ciContext({ GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'main' }).branch,
    'main',
    'A push sets the head ref empty',
  );
});

test('What decides a full run, in order: a pull request, then Q6_RUN_SCOPE, then whether it was narrowed', () => {
  const pull = { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main' };
  assert.equal(isFullRun({}, false), true);
  assert.equal(isFullRun({}, true), false);
  assert.equal(isFullRun({ Q6_RUN_SCOPE: 'full' }, true), true);
  assert.equal(isFullRun({ Q6_RUN_SCOPE: 'debug' }, false), false);
  assert.equal(isFullRun(pull, false), false);
  assert.equal(isFullRun({ ...pull, Q6_RUN_SCOPE: 'full' }, false), false);
});
