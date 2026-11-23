import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitError } from '../src/split-error.ts';
import { isFinalAttempt, kindOfPlaywrightError, type PwAttachment, type PwResult, type PwTest, recordOf } from '../src/playwright.ts';

const CWD = '/work/shop';
const ESC = String.fromCharCode(27);

// Playwright's own words, as its reporter API hands them over, colours included.
const LOCATOR_EXPECT = `Error: ${ESC}[2mexpect(${ESC}[22m${ESC}[31mlocator${ESC}[39m${ESC}[2m).${ESC}[22mtoHaveText${ESC}[2m(${ESC}[22m${ESC}[32mexpected${ESC}[39m${ESC}[2m)${ESC}[22m failed\n\nLocator:  locator('#c')\nExpected: ${ESC}[32m"8"${ESC}[39m\nReceived: ${ESC}[31m"1"${ESC}[39m\nTimeout:  300ms`;
const MISSING_ELEMENT = `Error: ${ESC}[2mexpect(${ESC}[22m${ESC}[31mlocator${ESC}[39m${ESC}[2m).${ESC}[22mtoBeVisible${ESC}[2m(${ESC}[22m${ESC}[2m)${ESC}[22m failed\n\nLocator: locator('#nope')\nExpected: visible\nTimeout: 300ms\nError: element(s) not found`;
const VALUE_EXPECT = `Error: ${ESC}[2mexpect(${ESC}[22m${ESC}[31mreceived${ESC}[39m${ESC}[2m).${ESC}[22mtoBe${ESC}[2m(${ESC}[22m${ESC}[32mexpected${ESC}[39m${ESC}[2m) // Object.is equality${ESC}[22m\n\nExpected: 2\nReceived: 1`;
const EXPECT_WITH_MESSAGE = `Error: must be two\n\n${ESC}[2mexpect(${ESC}[22m${ESC}[31mreceived${ESC}[39m${ESC}[2m).${ESC}[22mtoBe${ESC}[2m(${ESC}[22m${ESC}[32mexpected${ESC}[39m${ESC}[2m) // Object.is equality${ESC}[22m\n\nExpected: 2\nReceived: 1`;
const TEST_TIMEOUT = `${ESC}[31mTest timeout of 800ms exceeded.${ESC}[39m`;
const ACTION_TIMEOUT = `TimeoutError: page.click: Timeout 300ms exceeded.\nCall log:\n${ESC}[2m  - waiting for locator('#nope')${ESC}[22m\n`;
const UNREACHABLE = `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:9/\nCall log:\n  - navigating to "http://127.0.0.1:9/", waiting until "load"\n`;

// What the recorder classifies: the message with its colours and its "Error:" removed.
const clean = (raw: string) => splitError(raw).error;

test('A failed expect is a check, with or without a message of the test own, and in a locator as in a value', () => {
  for (const raw of [LOCATOR_EXPECT, MISSING_ELEMENT, VALUE_EXPECT, EXPECT_WITH_MESSAGE])
    assert.equal(kindOfPlaywrightError(clean(raw)), 'check', clean(raw).split('\n')[0]);
});

test('A test timeout and an action timeout are timeouts', () => {
  assert.equal(kindOfPlaywrightError(clean(TEST_TIMEOUT)), 'timeout');
  assert.equal(kindOfPlaywrightError(clean(ACTION_TIMEOUT)), 'timeout');
});

test('A browser that cannot reach the app is the environment, and a plain exception is an error', () => {
  assert.equal(kindOfPlaywrightError(clean(UNREACHABLE)), 'env');
  assert.equal(kindOfPlaywrightError('TypeError: cart.items is undefined'), 'error');
});

test('Words that only look like an expect or a timeout are not one', () => {
  assert.equal(kindOfPlaywrightError('Cart total: expect(received).toBe(1) was not met'), 'error');
  assert.equal(kindOfPlaywrightError('The report says Test timeout of 5ms exceeded'), 'error');
});

const result = (extra: Partial<PwResult> = {}): PwResult => ({
  status: 'passed',
  duration: 12.4,
  retry: 0,
  steps: [],
  attachments: [],
  ...extra,
});

function testOf(results: PwResult[], extra: Partial<PwTest> = {}): PwTest {
  const root = { title: '', type: 'root' };
  const project = { title: 'chrome', type: 'project', parent: root, project: () => ({ name: '' }) };
  const file = { title: 'cart.spec.ts', type: 'file', parent: project };
  const describe = { title: 'Cart', type: 'describe', parent: file };
  return { title: 'totals', location: { file: `${CWD}/tests/cart.spec.ts` }, parent: describe, tags: [], retries: 1, results, ...extra };
}

const kept: string[] = [];
const keep = (attachment: PwAttachment, what: 'image' | 'attachment', name: string) => {
  kept.push(`${what}:${name}`);
  return `${what === 'image' ? 'images' : 'attachments'}/${attachment.path ?? attachment.name}`;
};
const options = { rootDir: `${CWD}/tests`, cwd: CWD, keep };

test('A test is named for its file under the root, its describes and its title, and located from the working folder', () => {
  const record = recordOf(testOf([result()]), result(), options);
  assert.equal(record.test, 'cart.spec.ts::Cart > totals');
  assert.equal(record.group, 'Cart');
  assert.equal(record.file, 'tests/cart.spec.ts');
  assert.equal(record.attempts, 1);
  assert.equal(record.status, 'passed');
  assert.equal(record.ms, 12);
});

test('A project of its own name keeps two projects running one spec from sharing a history', () => {
  const base = testOf([result()]);
  const named = {
    ...base,
    parent: {
      ...base.parent,
      parent: { ...base.parent.parent!, parent: { title: 'webkit', type: 'project', project: () => ({ name: 'webkit' }) } },
    },
  };
  assert.equal(recordOf(named, result(), options).test, 'webkit | cart.spec.ts::Cart > totals');
});

test('A test outside any describe has an empty group', () => {
  const lone = testOf([result()]);
  lone.parent = lone.parent.parent!;
  assert.equal(recordOf(lone, result(), options).group, '');
});

test('Only a test step with no parent is a step, and the first failed one is where it failed', () => {
  const outer = { category: 'test.step', title: 'read the cart', duration: 5.6, error: { message: 'boom' } };
  const final = result({
    status: 'failed',
    error: { message: 'boom' },
    steps: [
      { category: 'test.step', title: 'open the shop', duration: 1 },
      { category: 'expect', title: 'expect.toBe', duration: 1, error: { message: 'boom' } },
      outer,
      { category: 'test.step', title: 'nested', duration: 1, parent: outer },
      { category: 'hook', title: 'After Hooks', duration: 1 },
    ],
  });
  const record = recordOf(testOf([final], { retries: 0 }), final, options);
  assert.deepEqual(record.steps, [
    { keyword: '', text: 'open the shop', status: 'passed', ms: 1 },
    { keyword: '', text: 'read the cart', status: 'failed', ms: 6 },
  ]);
  assert.equal(record.failedAt, 1);
});

test('A failure outside every step has no failedAt, and it reads its place from the error location', () => {
  const final = result({
    status: 'failed',
    steps: [{ category: 'test.step', title: 'open', duration: 1 }],
    errors: [
      {
        message: clean(VALUE_EXPECT),
        stack: `${clean(VALUE_EXPECT)}\n    at /work/shop/tests/cart.spec.ts:9:5`,
        location: { file: `${CWD}/tests/cart.spec.ts`, line: 9, column: 5 },
      },
    ],
  });
  const record = recordOf(testOf([final], { retries: 0 }), final, options);
  assert.equal(record.failedAt, undefined);
  assert.equal(record.at, 'tests/cart.spec.ts:9');
  assert.equal(record.kind, 'check');
  assert.equal(record.error, 'expect(received).toBe(expected) // Object.is equality\n\nExpected: 2\nReceived: 1');
  assert.match(record.stack ?? '', /^\s*at \/work\/shop\/tests\/cart.spec.ts:9:5/);
});

test('A failure with no location reads its place from the stack', () => {
  const final = result({ status: 'failed', error: { message: 'Error: x', stack: 'Error: x\n    at /work/shop/tests/cart.spec.ts:4:1' } });
  assert.equal(recordOf(testOf([final], { retries: 0 }), final, options).at, 'tests/cart.spec.ts:4');
});

test('A timed out and an interrupted test are failed, and a skipped one has no error', () => {
  for (const status of ['timedOut', 'interrupted'] as const)
    assert.equal(recordOf(testOf([result({ status })], { retries: 0 }), result({ status }), options).status, 'failed');
  const skipped = recordOf(testOf([result({ status: 'skipped' })]), result({ status: 'skipped' }), options);
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.error, undefined);
});

test('A test is recorded at its last attempt only: a pass, a skip, a failure with no retry left', () => {
  const t = { retries: 1 };
  assert.equal(isFinalAttempt(t, { status: 'failed', retry: 0 }), false);
  assert.equal(isFinalAttempt(t, { status: 'timedOut', retry: 0 }), false);
  assert.equal(isFinalAttempt(t, { status: 'failed', retry: 1 }), true);
  assert.equal(isFinalAttempt(t, { status: 'passed', retry: 1 }), true);
  assert.equal(isFinalAttempt(t, { status: 'skipped', retry: 0 }), true);
  assert.equal(isFinalAttempt({ retries: 0 }, { status: 'failed', retry: 0 }), true);
});

test('A pass on a retry keeps every attempt, and the attachments of each with the attempt that made them', () => {
  kept.length = 0;
  const failed = result({
    status: 'failed',
    retry: 0,
    attachments: [
      { name: 'trace', contentType: 'application/zip', path: 'a/trace.zip' },
      { name: 'screenshot', contentType: 'image/png', path: 'a/shot.png' },
    ],
  });
  const passed = result({ retry: 1, attachments: [{ name: 'notes', contentType: 'text/plain', body: new Uint8Array([104]) }] });
  const record = recordOf(testOf([failed, passed]), passed, options);
  assert.equal(record.attempts, 2);
  assert.equal(record.status, 'passed');
  assert.deepEqual(record.attachments, [
    { name: 'Playwright trace', path: 'attachments/a/trace.zip', attempt: 1 },
    { name: 'screenshot', path: 'attachments/a/shot.png', attempt: 1 },
    { name: 'notes', path: 'attachments/notes', attempt: 2 },
  ]);
  assert.equal(record.image, undefined);
});

test('The failing attempt screenshot is the result image, with the type it says, and is not also an attachment', () => {
  kept.length = 0;
  const final = result({
    status: 'failed',
    retry: 1,
    error: { message: 'x' },
    attachments: [
      { name: 'screenshot', contentType: 'image/jpeg', path: 'b/shot.jpg' },
      { name: 'video', contentType: 'video/webm', path: 'b/v.webm' },
    ],
  });
  const record = recordOf(testOf([result({ status: 'failed' }), final]), final, options);
  assert.deepEqual(record.image, { path: 'images/b/shot.jpg', type: 'image/jpeg' });
  assert.deepEqual(record.attachments, [{ name: 'video', path: 'attachments/b/v.webm', attempt: 2 }]);
  assert.deepEqual(kept, ['image:screenshot', 'attachment:video']);
});

test('A screenshot with no path or no image type is an attachment, not the image', () => {
  const final = result({ attachments: [{ name: 'screenshot', contentType: 'text/plain', path: 'c/shot.txt' }] });
  const record = recordOf(testOf([final]), final, options);
  assert.equal(record.image, undefined);
  assert.equal(record.attachments?.[0]?.name, 'screenshot');
});

test('An attachment that could not be kept is left out, and the test is still recorded', () => {
  const final = result({ attachments: [{ name: 'log', contentType: 'text/plain', path: 'd/log.txt' }] });
  const record = recordOf(testOf([final]), final, { ...options, keep: () => undefined });
  assert.equal(record.attachments, undefined);
  assert.equal(record.status, 'passed');
});

test('Tags come as Playwright gives them, and a bug tag marks a known bug', () => {
  const record = recordOf(testOf([result()], { tags: ['@smoke', '@bug-42'] }), result(), options);
  assert.deepEqual(record.tags, ['@smoke', '@bug-42']);
  assert.equal(record.knownBug, 'bug-42');
});
