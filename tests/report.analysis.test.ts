import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildModel,
  changesOf,
  classifyError,
  clustersOf,
  failingSince,
  failureSignature,
  flakyTests,
  type Model,
  slowerTests,
  verdictOf,
} from '../src/analysis.ts';
import { HISTORY_VERSION, type ReportData, type ResultRecord, type ResultStatus, type RunRecord } from '../src/model.ts';
import { sampleHistory } from './report-fixture.ts';

function result(name: string, status: ResultStatus, error?: string, ms = 1000, tags: string[] = []): ResultRecord {
  const knownBug = tags.find((tag) => tag.startsWith('@bug-'))?.slice(1);
  return {
    test: `F::${name}`,
    name,
    group: 'F',
    file: 'f.feature',
    tags,
    status,
    ms,
    steps: [],
    ...(knownBug ? { knownBug } : {}),
    ...(error ? { error } : {}),
  };
}

function run(day: number, results: ResultRecord[], overrides: Partial<RunRecord> = {}): RunRecord {
  const startedAt = new Date(Date.UTC(2026, 0, 1 + day)).toISOString();
  return {
    v: HISTORY_VERSION,
    id: `r${day}`,
    runNumber: day,
    batch: `b${day}`,
    project: 'p',
    lane: 'web',
    laneLabel: 'Web',
    isFull: true,
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 1000).toISOString(),
    trigger: 'Local',
    notStarted: 0,
    results,
    ...overrides,
  };
}

function model(records: RunRecord[]): Model {
  const data: ReportData = {
    project: 'p',
    projects: ['p'],
    records,
    shots: {},

    shotRuns: 10,
  };
  return buildModel(data);
}

const verdict = (m: Model, index = 0) => verdictOf(m.runs[index]!, m.copy);

const NOT_FOUND = '"Save button" was not found within 30000ms';
const WRONG = 'Expected "Total" to read "$7.00" but it read "$0.00"';
const OUTAGE = 'Could not start a session: the driver stopped';

test('An error is classified by its own words, and a locator name in quotes never counts as one', () => {
  assert.equal(classifyError(NOT_FOUND), 'missing');
  assert.equal(classifyError(WRONG), 'wrong');
  assert.equal(classifyError(OUTAGE), 'env');
  assert.equal(classifyError('connect ECONNREFUSED 127.0.0.1:4723'), 'env');
  assert.equal(classifyError('TypeError: cannot read properties of undefined'), 'unsorted', 'A wording it does not know claims nothing');
  assert.equal(classifyError('"Session timeout banner" was not found within 30000ms'), 'missing');
  assert.equal(classifyError('Expected "Appium settings" to read "On" but it read "Off"'), 'wrong');
});

test('Failures that differ only in their values are one cause, and different locators are two', () => {
  assert.equal(
    failureSignature('Expected "Price" to read "$7.00" but it read "$0.00"'),
    failureSignature('Expected "Price" to read "$1,234.50" but it read "$0.00"'),
  );
  assert.notEqual(failureSignature('Expected "Price" to read "$7.00"'), failureSignature('Expected "Total" to read "$7.00"'));
  assert.equal(failureSignature('"qa-1792998087898" was not found'), failureSignature('"qa-1792998087898" was not found'));
  assert.equal(failureSignature('Order 1792998087898 was refused'), failureSignature('Order 1793000000000 was refused'));
  assert.notEqual(failureSignature('Order 12 was refused'), failureSignature('Order 34 was refused'));
});

test('A result is new, still failing or fixed against the same test on the same lane, whichever runs lie between', () => {
  const m = model([
    run(1, [result('a', 'failed', WRONG), result('b', 'passed'), result('c', 'failed', WRONG)]),
    run(2, [result('a', 'passed')], { isFull: false }),
    run(3, [result('a', 'failed', WRONG), result('b', 'failed', WRONG), result('c', 'passed')]),
    run(4, [result('a', 'failed', WRONG), result('b', 'passed'), result('c', 'passed')]),
  ]);
  const third = changesOf(m.runs[2]!);
  assert.deepEqual(third.fresh.map((r) => r.name).sort(), ['a', 'b'], 'a passed in the narrowed run, b passed before');
  assert.deepEqual(
    third.fixed.map((r) => r.name),
    ['c'],
    'c failed two runs earlier, and the narrowed run did not hold it',
  );
  const fourth = changesOf(m.runs[3]!);
  assert.deepEqual(
    fourth.still.map((r) => r.name),
    ['a'],
  );
  assert.deepEqual(
    fourth.fixed.map((r) => r.name),
    ['b'],
  );
});

test('The same test on two lanes keeps two separate histories', () => {
  const m = model([
    run(1, [result('a', 'failed', WRONG)], { lane: 'web', batch: 'x' }),
    run(1, [result('a', 'passed')], { lane: 'ios', batch: 'x' }),
    run(2, [result('a', 'passed')], { lane: 'web', batch: 'y' }),
    run(2, [result('a', 'failed', WRONG)], { lane: 'ios', batch: 'y' }),
  ]);
  assert.equal(m.runs.length, 2, 'One batch is one run, whichever lanes it covers');
  const changes = changesOf(m.runs[1]!);
  assert.deepEqual(
    changes.fresh.map((r) => r.lane),
    ['ios'],
  );
  assert.deepEqual(
    changes.fixed.map((r) => r.lane),
    ['web'],
  );
});

test('A failing stretch starts at its first failure, not at the first failure of the test', () => {
  const m = model([
    run(1, [result('a', 'failed', WRONG)]),
    run(2, [result('a', 'passed')]),
    run(3, [result('a', 'failed', WRONG)]),
    run(4, [result('a', 'failed', WRONG)]),
  ]);
  assert.equal(failingSince(m.runs[3]!.results[0]!).run.n, 3);
});

test('A failure that recovers on both sides is flaky, and one that stays failing is not', () => {
  const m = model([
    run(1, [result('a', 'passed'), result('b', 'passed')]),
    run(2, [result('a', 'failed', NOT_FOUND), result('b', 'failed', WRONG)]),
    run(3, [result('a', 'passed'), result('b', 'failed', WRONG)]),
  ]);
  assert.equal(m.runs[1]!.results[0]!.category, 'flaky');
  assert.equal(m.runs[1]!.results[1]!.category, 'wrong');
});

test('A new failure on a test that only ever failed in outages is not called flaky', () => {
  const records = [
    run(0, [result('a', 'passed')]),
    run(1, [result('a', 'failed', OUTAGE)]),
    run(2, [result('a', 'passed')]),
    run(3, [result('a', 'failed', OUTAGE)]),
    run(4, [result('a', 'passed')]),
    run(5, [result('a', 'failed', WRONG)]),
  ];
  const last = model(records).runs.at(-1)!.results[0]!;
  assert.equal(last.category, 'wrong');
});

test('The newest failure of a test that keeps turning is flaky before it has a next result', () => {
  const pattern: ResultStatus[] = ['passed', 'failed', 'passed', 'failed', 'passed', 'failed'];
  const last = model(pattern.map((status, day) => run(day, [result('a', status, status === 'failed' ? NOT_FOUND : undefined)]))).runs.at(
    -1,
  )!.results[0]!;
  assert.equal(last.category, 'flaky');
});

test('An environment failure stays an environment failure even when it recovers on both sides', () => {
  const m = model([run(1, [result('a', 'passed')]), run(2, [result('a', 'failed', OUTAGE)]), run(3, [result('a', 'passed')])]);
  assert.equal(m.runs[1]!.results[0]!.category, 'env');
});

test('A known bug outranks every other reading of the failure', () => {
  const m = model([
    run(1, [result('a', 'passed', undefined, 1000, ['@bug-123'])]),
    run(2, [result('a', 'failed', NOT_FOUND, 1000, ['@bug-123'])]),
    run(3, [result('a', 'passed', undefined, 1000, ['@bug-123'])]),
  ]);
  assert.equal(m.runs[1]!.results[0]!.category, 'known');
  assert.equal(m.runs[1]!.results[0]!.knownBug, 'bug-123');
});

test('A cause is named after what most of its failures were', () => {
  const m = model([
    run(1, [result('a', 'passed'), result('b', 'failed', NOT_FOUND)]),
    run(2, [result('a', 'failed', NOT_FOUND), result('b', 'failed', NOT_FOUND)]),
    run(3, [result('a', 'passed'), result('b', 'failed', NOT_FOUND)]),
  ]);
  const [cluster] = clustersOf(m.runs);
  assert.equal(cluster!.count, 4);
  assert.equal(cluster!.category, 'missing', 'Three plain failures outweigh one flaky one');
});

test('A slow failure does not make a test look slower, and a small change is left alone', () => {
  const steady = Array.from({ length: 12 }, (_, day) =>
    run(day, [
      result('a', 'passed', undefined, 10000),
      result('b', 'passed', undefined, day > 6 ? 11000 : 10000),
      result('c', day === 11 ? 'failed' : 'passed', day === 11 ? NOT_FOUND : undefined, day === 11 ? 90000 : 10000),
    ]),
  );
  const slow = Array.from({ length: 12 }, (_, day) => run(day, [result('a', 'passed', undefined, day > 6 ? 16000 : 10000)]));
  assert.deepEqual(slowerTests(model(steady).tests, model(steady).runs), []);
  const m = model(slow);
  assert.equal(slowerTests(m.tests, m.runs)[0]!.worst.up, 6000);
});

test('Trends leave narrowed runs out, unless every run was narrowed', () => {
  assert.deepEqual(
    model([run(1, [result('a', 'passed')]), run(2, [result('a', 'passed')], { isFull: false })]).trendRuns.map((r) => r.n),
    [1],
  );
  assert.deepEqual(
    model([run(1, [result('a', 'passed')], { isFull: false })]).trendRuns.map((r) => r.n),
    [1],
  );
});

test('The verdict says what happened, in the words a person would use', () => {
  assert.equal(verdict(model([run(1, [result('a', 'passed')])])).line, 'The one result passed.');
  assert.equal(verdict(model([run(1, [result('a', 'passed'), result('b', 'passed')])])).line, 'All 2 results passed.');
  const failed = verdict(model([run(1, [result('a', 'failed', WRONG), result('b', 'failed', WRONG), result('c', 'passed')])]));
  assert.equal(failed.line, '2 of 3 results failed, from 1 cause.');
  const broken = verdict(model([run(1, [], { notStarted: 2 })]));
  assert.equal(broken.line, 'This run could not start.');
  assert.ok(broken.isFailing);
  const partly = verdict(model([run(1, [result('a', 'passed')], { notStarted: 1 })]));
  assert.ok(partly.isFailing, 'A file of tests that never started is not a clean run, whatever the rest did');
  assert.equal(broken.small, '2 test files failed before any test began.');
  assert.equal(partly.small, 'But 1 test file never started.');
});

test('A skipped result is never told as a pass', () => {
  const allSkipped = verdict(model([run(1, [result('a', 'skipped'), result('b', 'skipped')])]));
  assert.equal(allSkipped.line, 'All 2 results were skipped.');
  assert.equal(allSkipped.small, 'Nothing was tested.');
  assert.ok(allSkipped.isFailing, 'A run that tested nothing proved nothing');
  assert.equal(verdict(model([run(1, [result('a', 'skipped')])])).line, 'The one result was skipped.');
  const some = verdict(model([run(1, [result('a', 'passed'), result('b', 'passed'), result('c', 'skipped')])]));
  assert.equal(some.line, '2 of 3 results passed, and 1 was skipped.');
  assert.ok(!some.isFailing);
  assert.equal(
    verdict(model([run(1, [result('a', 'passed'), result('b', 'skipped'), result('c', 'skipped')])])).line,
    '1 of 3 results passed, and 2 were skipped.',
  );
});

test('A run that could not start still counts as a run with no results', () => {
  const m = model([run(1, [], { notStarted: 1 })]);
  assert.equal(m.runs[0]!.total, 0);
  assert.equal(m.runs[0]!.rate, 1);
  assert.deepEqual(clustersOf(m.runs), []);
});

test('The sample holds every state the page has to show', () => {
  const m = buildModel({
    project: 'shop',
    projects: ['shop'],
    records: sampleHistory(),
    shots: {},

    shotRuns: 10,
  });
  const newest = m.runs.at(-1)!;
  const changes = changesOf(newest);
  assert.ok(changes.fresh.length > 0 && changes.still.length > 0);
  assert.ok(flakyTests(m.tests, m.runs).length > 0);
  assert.ok(slowerTests(m.tests, m.runs).length > 0);
  assert.ok(m.runs.some((candidate) => candidate.cats.env > 0));
  const card = newest.results.find((r) => r.name.startsWith('Checkout refuses') && r.status === 'failed')!;
  assert.notEqual(card.category, 'flaky', 'A new bug on a test that only ever failed in outages');
});

function recorded(results: ResultRecord[], over: Partial<RunRecord> = {}): RunRecord {
  return {
    v: HISTORY_VERSION,
    id: 'r1',
    runNumber: 1,
    batch: 'b1',
    project: 'p',
    lane: 'l',
    laneLabel: 'l',
    isFull: true,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    trigger: 'Local',
    notStarted: 0,
    results,
    ...over,
  };
}

const modelOf = (records: RunRecord[], debugRecords?: RunRecord[]): Model =>
  buildModel({
    project: 'p',
    projects: ['p'],
    records,
    shots: {},
    shotRuns: 10,
    ...(debugRecords ? { debugRecords } : {}),
  });

const failing = (name: string, over: Partial<ResultRecord>): ResultRecord => ({ ...result(name, 'failed', 'boom'), ...over });
const categoryOf = (over: Partial<ResultRecord>) => modelOf([recorded([failing('t', over)])]).runs[0]!.results[0]!.category;

test('A recorder word on a failure beats its wording, for each kind', () => {
  // Each wording says something else, so the kind has to be what decided it.
  assert.equal(categoryOf({ kind: 'check', error: 'connect ECONNREFUSED' }), 'wrong');
  assert.equal(categoryOf({ kind: 'error', error: 'Expected 1 but got 2' }), 'code');
  assert.equal(categoryOf({ kind: 'timeout', error: 'was not found' }), 'timeout');
  assert.equal(categoryOf({ kind: 'env', error: 'Expected 1 but got 2' }), 'env');
  assert.equal(categoryOf({ kind: 'missing', error: 'Expected 1 but got 2' }), 'missing');
});

test('A failure with no kind falls to its wording, and one no rule recognises is Not sorted and nothing else', () => {
  assert.equal(categoryOf({ error: 'Expected 1 but got 2' }), 'wrong');
  assert.equal(categoryOf({ error: 'the frobnicator is sad' }), 'unsorted');
  assert.equal(categoryOf({ error: '' }), 'unsorted');
});

test('A known bug outranks every kind', () => {
  assert.equal(categoryOf({ kind: 'env', knownBug: 'bug-1' }), 'known');
});

test('An outage named by its kind does not make a test look flaky, as one named by its wording does not', () => {
  const pass = (run: number) =>
    recorded([result('t', 'passed')], { id: `r${run}`, batch: `b${run}`, runNumber: run, startedAt: `2026-01-0${run}T00:00:00.000Z` });
  const fail = (run: number, over: Partial<ResultRecord>) =>
    recorded([failing('t', over)], { id: `r${run}`, batch: `b${run}`, runNumber: run, startedAt: `2026-01-0${run}T00:00:00.000Z` });
  const outage = { kind: 'env' as const, error: 'plain words' };
  const flaky = modelOf([
    pass(1),
    fail(2, outage),
    pass(3),
    fail(4, outage),
    pass(5),
    fail(6, { error: 'Expected 1 but got 2', kind: 'check' }),
  ]);
  assert.equal(flaky.runs.at(-1)!.results[0]!.category, 'wrong', 'The outages between its passes are passed over, so it has not turned');
  assert.equal(flaky.runs[1]!.results[0]!.category, 'env', 'An outage stays an outage between two passes');
});

test('A pass on a retry counts as flaky in that run, without being a failure or a cause', () => {
  const model = modelOf([recorded([{ ...result('t', 'passed'), attempts: 2 }, result('u', 'passed')])]);
  const run = model.runs[0]!;
  assert.equal(run.results[0]!.category, 'flaky');
  assert.equal(run.results[1]!.category, undefined, 'One attempt is no retry');
  assert.equal(run.cats.flaky, 1);
  assert.equal(run.failed, 0);
  assert.equal(clustersOf([run]).length, 0);
  assert.equal(verdictOf(run, model.copy).isFailing, false);
  assert.equal(flakyTests(model.tests, model.runs)[0]!.test.name, 't');
});

test('A pass on a retry is not flaky when a person marked the test as a known bug, or when it is a trial run', () => {
  assert.equal(
    modelOf([recorded([{ ...result('t', 'passed'), attempts: 2, knownBug: 'bug-1' }])]).runs[0]!.results[0]!.category,
    undefined,
  );
  const trial = modelOf([], [recorded([{ ...result('t', 'passed'), attempts: 2 }], { isFull: false })]);
  assert.equal(trial.debugRuns[0]!.results[0]!.category, undefined, 'Retrying a test is what debugging is');
});

const causesOf = (results: ResultRecord[]): string[][] =>
  clustersOf(modelOf([recorded(results)]).runs).map((cluster) => cluster.results.map((one) => one.name));

test('Two failures on one line that differ only in their values are one cause', () => {
  assert.equal(
    causesOf([
      failing('a', { at: 'h.py:9', error: 'Expected 2 but got 1' }),
      failing('b', { at: 'h.py:9', error: 'Expected 40 but got 30' }),
    ]).length,
    1,
  );
  assert.equal(
    causesOf([failing('a', { at: 'h.py:9', error: "assert 'x' == 'y'" }), failing('b', { at: 'h.py:9', error: "assert 'p' == 'q'" })])
      .length,
    1,
  );
  assert.equal(
    causesOf([failing('a', { at: 'h.kt:9', error: 'Locate {"id":"a"}' }), failing('b', { at: 'h.kt:9', error: 'Locate {"id":"b"}' })])
      .length,
    1,
  );
});

test('A structure in an error is a value, so its first key does not name a cause the way a first quote does', () => {
  assert.equal(
    causesOf([
      failing('a', { at: 'h.kt:9', error: 'Locate {"css":"#a"}' }),
      failing('b', { at: 'h.kt:9', error: 'Locate {"xpath":"//b"}' }),
    ]).length,
    1,
  );
});

test('The same words on two lines are two causes, which a message alone would merge', () => {
  const words = 'expect(received).toBe(expected)';
  assert.equal(causesOf([failing('a', { at: 'a.ts:1', error: words }), failing('b', { at: 'b.ts:1', error: words })]).length, 2);
});

test('Two locators failing in one shared wait are two causes, and one locator from anywhere in it is one', () => {
  const at = 'src/shared/wait.ts:40';
  const missing = (name: string, locator: string) =>
    failing(name, { at, kind: 'missing', error: `"${locator}" was not found within 30000ms` });
  assert.equal(causesOf([missing('a', 'Save button'), missing('b', 'Pay button')]).length, 2);
  assert.equal(causesOf([missing('a', 'Save button'), missing('b', 'Save button')]).length, 1);
  assert.equal(
    causesOf([
      failing('a', { at, error: 'Expected "Total" to read "$7.00" but it read "$0.00"' }),
      failing('b', { at, error: 'Expected "Total" to read "$9.00" but it read "$1.00"' }),
    ]).length,
    1,
    'Only the first quote names the thing, and the rest are values',
  );
  assert.equal(
    causesOf([
      failing('a', { at, error: 'Expected "Drink" to read "Latte" but it read "Mocha"' }),
      failing('b', { at, error: 'Expected "Drink" to read "Cola" but it read "Water"' }),
    ]).length,
    1,
    'The same with values that hold no number',
  );
});

test('One outage is one cause wherever each test stood when it hit it', () => {
  const outage = (name: string, at: string) =>
    failing(name, { at, kind: 'env', error: 'ConnectionRefusedError: [Errno 61] Connection refused' });
  assert.equal(causesOf([outage('a', 'a.py:1'), outage('b', 'b.py:2'), outage('c', 'c.py:3')]).length, 1);
  const worded = (name: string, at: string) => failing(name, { at, error: 'connect ECONNREFUSED 127.0.0.1:4723' });
  assert.equal(causesOf([worded('a', 'a.ts:1'), worded('b', 'b.ts:2')]).length, 1, 'One the wording calls an outage too');
});

test('With no at the key stays what it was, so an older record keeps its cause', () => {
  const [a, b] = ['Order 12 was refused', 'Order 34 was refused'];
  assert.equal(causesOf([failing('a', { error: a }), failing('b', { error: b })]).length, 2);
  assert.equal(
    causesOf([failing('a', { error: 'Expected "P" to read "1"' }), failing('b', { error: 'Expected "P" to read "2"' })]).length,
    1,
  );
});

test('A lane has a screen once any result on it kept an image, and a trial run counts', () => {
  const image = { path: 'r/1.png', type: 'image/png' as const };
  const model = modelOf(
    [recorded([{ ...failing('a', {}), image }], { lane: 'chrome' }), recorded([failing('b', {})], { lane: 'api' })],
    [recorded([{ ...failing('c', {}), image }], { lane: 'ios', isFull: false, batch: 'd1', id: 'd1' })],
  );
  assert.deepEqual([...model.lanesWithImages].sort(), ['chrome', 'ios']);
});
