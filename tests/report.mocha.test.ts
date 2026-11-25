import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { attach, MochaRecorder, type MochaSuite, type MochaTest, screenshots, step, tagsInTitle } from '../src/mocha.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function folder(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'q6-report-mocha-'));
}

function suiteOf(title: string, parent?: MochaSuite): MochaSuite {
  const suite: MochaSuite = { title, parent, tests: [], suites: [], ...(parent ? {} : { root: true }) };
  parent?.suites.push(suite);
  return suite;
}

interface Fake extends MochaTest {
  retriesLeft: number;
  retry: number;
  original?: Fake;
}

/** A test as Mocha builds one, in a suite under the root, in a spec file under tests/. */
function testOf(title: string, fn: MochaTest['fn'], suite: MochaSuite, extra: Partial<Fake> = {}): Fake {
  const made: Fake = {
    title,
    file: path.join(process.cwd(), 'tests', 'cart.spec.mjs'),
    pending: false,
    parent: suite,
    fn,
    retriesLeft: 0,
    retry: 0,
    timeout: () => 500,
    retries() {
      return this.retriesLeft;
    },
    currentRetry() {
      return this.retry;
    },
    retriedTest() {
      return this.original;
    },
    ...extra,
  };
  suite.tests.push(made);
  return made;
}

/** Mocha's turn of one test: the each hooks around its function, its state set as Mocha sets it. */
async function runOne(
  recorder: MochaRecorder,
  test: Fake,
  state: (failed: boolean) => MochaTest['state'] = (failed) => (failed ? 'failed' : 'passed'),
) {
  const hooks = recorder.hooks();
  hooks.beforeEach.call({ currentTest: test });
  let failed = false;
  try {
    const fn = test.fn!;
    if (fn.length > 0) await new Promise<void>((resolve, reject) => fn.call({}, (error?: unknown) => (error ? reject(error) : resolve())));
    else await fn.call({});
  } catch {
    failed = true;
  }
  test.state = state(failed);
  await hooks.afterEach.call({ currentTest: test });
}

function lines(dir: string): Record<string, unknown>[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) => readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const recorderIn = (dir: string) => new MochaRecorder({ folder: dir, rootDir: path.join(process.cwd(), 'tests') });

test('The module has no default export, which Mocha would take in place of the module and so miss mochaHooks', async () => {
  const module = await import('../src/mocha.ts');
  assert.equal('default' in module, false);
  assert.equal(typeof module.mochaHooks.beforeEach, 'function');
});

test('A title tags a test with its @words, and only with words that start with @', () => {
  assert.deepEqual(tagsInTitle('pays by card @smoke @bug-42'), ['@smoke', '@bug-42']);
  assert.deepEqual(tagsInTitle('@fast first'), ['@fast']);
  assert.deepEqual(tagsInTitle('mail me at shop@example.com'), []);
});

test('A passing test is named for its file under the root, its suites and its title, with its steps', async () => {
  screenshots(undefined);
  const dir = folder();
  const cart = suiteOf('Cart', suiteOf(''));
  const passing = testOf(
    'adds an item @smoke',
    async () => {
      await step('open the shop', () => undefined);
      await step('add 1 item', () => undefined);
    },
    cart,
  );
  await runOne(recorderIn(dir), passing);
  const [line] = lines(dir);
  assert.equal(line!.test, 'cart.spec.mjs::Cart > adds an item @smoke');
  assert.equal(line!.group, 'Cart');
  assert.equal(line!.file, 'tests/cart.spec.mjs');
  assert.deepEqual(line!.tags, ['@smoke']);
  assert.equal(line!.status, 'passed');
  assert.equal(line!.attempts, 1);
  assert.deepEqual(
    (line!.steps as { text: string; status: string }[]).map(({ text, status }) => [text, status]),
    [
      ['open the shop', 'passed'],
      ['add 1 item', 'passed'],
    ],
  );
  assert.equal(line!.failedAt, undefined);
});

test('A failed step is where the test failed, and its screenshot is taken while the step fails, before the test ends', async () => {
  const dir = folder();
  const order: string[] = [];
  screenshots(() => {
    order.push('screenshot');
    return PNG;
  });
  const cart = suiteOf('Cart', suiteOf(''));
  const failing = testOf(
    'totals the cart',
    async () => {
      await step('open the shop', () => undefined);
      await step('read the cart', () => {
        assert.equal('1 item', '8 items');
      });
      order.push('after the step');
    },
    cart,
  );
  await runOne(recorderIn(dir), failing);
  order.push('test ended');
  const [line] = lines(dir);
  assert.deepEqual(order, ['screenshot', 'test ended']);
  assert.equal(line!.status, 'failed');
  assert.equal(line!.failedAt, 1);
  assert.deepEqual(
    (line!.steps as { status: string }[]).map((s) => s.status),
    ['passed', 'failed'],
  );
  assert.equal(line!.kind, 'check');
  assert.match(String(line!.error), /^Expected values to be strictly equal/);
  assert.match(String(line!.at), /^tests\/report\.mocha\.test\.ts:\d+$/);
  assert.deepEqual(line!.image, { path: (line!.image as { path: string }).path, type: 'image/png' });
  assert.ok(
    readFileSync(path.join(dir, (line!.image as { path: string }).path))
      .subarray(0, 4)
      .equals(Buffer.from(PNG.subarray(0, 4))),
  );
  screenshots(undefined);
});

test('An error outside every step has no failedAt, and reads with its type unless it is a plain Error', async () => {
  screenshots(undefined);
  const dir = folder();
  const root = suiteOf('');
  testOf(
    'throws a type error',
    async () => {
      await step('open the shop', () => undefined);
      throw new TypeError('cart.items is undefined');
    },
    root,
  );
  testOf(
    'throws a plain error',
    () => {
      throw new Error('Expected the server to hold the login, and it holds []');
    },
    root,
  );
  const recorder = recorderIn(dir);
  for (const each of root.tests) await runOne(recorder, each as Fake);
  const [typed, plain] = lines(dir);
  assert.equal(typed!.error, 'TypeError: cart.items is undefined');
  assert.equal(typed!.kind, 'error');
  assert.equal(typed!.failedAt, undefined);
  assert.equal(typed!.group, '');
  assert.equal(plain!.error, 'Expected the server to hold the login, and it holds []');
  assert.equal(plain!.kind, 'check');
});

test('A test that calls back keeps its callback, and the error it hands done is its failure', async () => {
  screenshots(undefined);
  const dir = folder();
  const root = suiteOf('');
  const calling = testOf(
    'calls back with an error',
    function (done) {
      setTimeout(() => done?.(new Error('the payment service answered 503')), 1);
    },
    root,
  );
  const recorder = recorderIn(dir);
  recorder.hooks().beforeEach.call({ currentTest: calling });
  assert.equal(calling.fn!.length, 1, 'Mocha still sees a function that takes done');
  await new Promise<void>((resolve) => calling.fn!.call({}, () => resolve()));
  calling.state = 'failed';
  await recorder.hooks().afterEach.call({ currentTest: calling });
  assert.equal(lines(dir)[0]!.error, 'the payment service answered 503');
});

test('A test Mocha timed out reads as its timeout, and so does the bare Timeout WebdriverIO ends a test with', async () => {
  screenshots(undefined);
  const dir = folder();
  const root = suiteOf('');
  const mocha = testOf('waits for a service that never answers', () => new Promise(() => undefined), root, { timedOut: true });
  const recorder = recorderIn(dir);
  recorder.hooks().beforeEach.call({ currentTest: mocha });
  mocha.state = 'failed';
  await recorder.hooks().afterEach.call({ currentTest: mocha });
  const wdio = testOf(
    'waits on WebdriverIO',
    () => {
      throw new Error('Timeout');
    },
    root,
  );
  await runOne(recorder, wdio);
  const [byMocha, byWdio] = lines(dir);
  assert.equal(byMocha!.error, 'Timeout of 500ms exceeded.');
  assert.equal(byMocha!.kind, 'timeout');
  assert.equal(byWdio!.kind, 'timeout');
});

test('A pass on the retry is one test of two attempts, keeping the failed attempt screenshot as one of its files', async () => {
  screenshots(() => PNG);
  const dir = folder();
  const root = suiteOf('');
  let calls = 0;
  const first = testOf(
    'survives a flaky page',
    () => {
      if (calls++ === 0) throw new Error('passes only on the retry');
    },
    root,
    { retriesLeft: 1 },
  );
  const recorder = recorderIn(dir);
  // Mocha leaves a retried attempt with no state, and runs its clone, which copies the wrapped function.
  await runOne(recorder, first, () => undefined);
  assert.equal(lines(dir).length, 0, 'The attempt a retry follows writes nothing');
  const wrapped = first.fn;
  const clone = testOf('survives a flaky page', wrapped, root, { retriesLeft: 1, retry: 1, original: first });
  await runOne(recorder, clone);
  assert.equal(clone.fn, wrapped, 'A clone is not wrapped twice');
  const [line] = lines(dir);
  assert.equal(line!.status, 'passed');
  assert.equal(line!.attempts, 2);
  assert.deepEqual(
    (line!.attachments as { name: string; attempt: number }[]).map(({ name, attempt }) => [name, attempt]),
    [['screenshot', 1]],
  );
  assert.equal(line!.image, undefined);
  screenshots(undefined);
});

test('A step inside a step is part of it, and a step outside a test just runs', async () => {
  screenshots(undefined);
  assert.equal(await step('no test runs', () => 7), 7);
  const dir = folder();
  const nested = testOf(
    'nests a step',
    async () => {
      await step('outer', async () => {
        await step('inner', () => undefined);
      });
    },
    suiteOf(''),
  );
  await runOne(recorderIn(dir), nested);
  assert.deepEqual(
    (lines(dir)[0]!.steps as { text: string }[]).map((s) => s.text),
    ['outer'],
  );
});

test('A test skipped before it started is skipped, and one Mocha never ran is a failure that says so', () => {
  screenshots(undefined);
  const dir = folder();
  const root = suiteOf('');
  const checkout = suiteOf('Checkout', root);
  testOf('applies a coupon', undefined, root, { pending: true });
  testOf('pays by card', () => undefined, checkout);
  const recorder = recorderIn(dir);
  recorder.hooks().afterAll.call({ test: { parent: root } });
  const [skipped, neverRan] = lines(dir);
  assert.equal(skipped!.status, 'skipped');
  assert.deepEqual(skipped!.steps, []);
  assert.equal(neverRan!.status, 'failed');
  assert.equal(neverRan!.group, 'Checkout');
  assert.equal(neverRan!.error, 'Mocha never ran it, e.g: a hook before it failed, or the run bailed');
  assert.equal(neverRan!.kind, 'error');
});

test('A test recorded once is not recorded again when the run ends', async () => {
  screenshots(undefined);
  const dir = folder();
  const root = suiteOf('');
  const ran = testOf('adds an item', () => undefined, root);
  const recorder = recorderIn(dir);
  await runOne(recorder, ran);
  recorder.hooks().afterAll.call({ test: { parent: root } });
  assert.equal(lines(dir).length, 1);
});

test('A test skipped as it runs is skipped, with no screenshot', async () => {
  let taken = 0;
  screenshots(() => {
    taken++;
    return PNG;
  });
  const dir = folder();
  const skipping = testOf(
    'is skipped as it runs',
    () => {
      throw new Error('sync skip; aborting execution');
    },
    suiteOf(''),
  );
  await runOne(recorderIn(dir), skipping, () => {
    skipping.pending = true;
    return 'pending';
  });
  assert.equal(lines(dir)[0]!.status, 'skipped');
  assert.equal(taken, 0);
  screenshots(undefined);
});

test('Suite titles tag a test too, and a bug tag marks a known bug', async () => {
  screenshots(undefined);
  const dir = folder();
  const tagged = suiteOf('Tags @smoke', suiteOf(''));
  testOf('is a known bug @bug-42', () => undefined, tagged);
  await runOne(recorderIn(dir), tagged.tests[0] as Fake);
  const [line] = lines(dir);
  assert.deepEqual(line!.tags, ['@smoke', '@bug-42']);
  assert.equal(line!.knownBug, 'bug-42');
});

test('A file attached keeps its content as it was and the attempt that kept it', async () => {
  screenshots(undefined);
  const dir = folder();
  const notes = path.join(folder(), 'notes.txt');
  writeFileSync(notes, 'two steps, no failure');
  const attaching = testOf(
    'adds an item',
    () => {
      attach('notes', notes);
      writeFileSync(notes, 'changed later');
    },
    suiteOf(''),
  );
  await runOne(recorderIn(dir), attaching);
  const [kept] = lines(dir)[0]!.attachments as { name: string; path: string; attempt: number }[];
  assert.equal(kept!.name, 'notes');
  assert.equal(kept!.attempt, 1);
  assert.equal(readFileSync(path.join(dir, kept!.path), 'utf8'), 'two steps, no failure');
});

test('A screenshot that fails is said, and the test is still recorded', async () => {
  const said: string[] = [];
  const error = console.error;
  console.error = (message: string) => said.push(message);
  try {
    screenshots(() => {
      throw new Error('no session');
    });
    const dir = folder();
    const failing = testOf(
      'totals the cart',
      () => {
        throw new Error('boom');
      },
      suiteOf(''),
    );
    await runOne(recorderIn(dir), failing);
    assert.equal(lines(dir)[0]!.status, 'failed');
    assert.match(said.join('\n'), /could not take a screenshot of "totals the cart": Error: no session/);
  } finally {
    console.error = error;
    screenshots(undefined);
  }
});

test('A results file that cannot be written is said, and never throws into the test', async () => {
  screenshots(undefined);
  const said: string[] = [];
  const error = console.error;
  console.error = (message: string) => said.push(message);
  try {
    const dir = folder();
    chmodSync(dir, 0o500);
    const passing = testOf('adds an item', () => undefined, suiteOf(''));
    await runOne(new MochaRecorder({ folder: dir, file: path.join(dir, 'locked', 'mocha.jsonl') }), passing);
    assert.match(said.join('\n'), /could not record "adds an item"/);
    chmodSync(dir, 0o700);
  } finally {
    console.error = error;
  }
});
