// What check:recorders runs the Mocha recorder on: each test has an outcome its record must hold exactly.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { remote } from 'webdriverio';

// The recorder the run requires, from the package as installed, so its hooks and these calls are one module.
const { attach, screenshots, step } = await import(process.env.Q6_RECORDER ?? 'q6-report/mocha');

const PAGE = `data:text/html,${encodeURIComponent('<h1>Shop</h1><p id="cart">1 item</p>')}`;
let browser;

before(async function () {
  this.timeout(60_000);
  browser = await remote({
    logLevel: 'error',
    capabilities: { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-gpu'] } },
  });
  screenshots(async () => Buffer.from(await browser.takeScreenshot(), 'base64'));
});

after(async () => {
  await browser?.deleteSession();
});

describe('Cart', () => {
  it('adds an item', async () => {
    await step('open the shop', async () => {
      await browser.url(PAGE);
    });
    await step('add 1 item', () => {});
    const notes = path.join(mkdtempSync(path.join(os.tmpdir(), 'shop-')), 'notes.txt');
    writeFileSync(notes, 'two steps, no failure');
    attach('notes', notes);
  });

  it('totals the cart', async () => {
    await step('open the shop', async () => {
      await browser.url(PAGE);
    });
    await step('read the cart', async () => {
      assert.equal(await browser.$('#cart').getText(), '8 items');
    });
    await step('leave the shop', () => {});
  });

  it('waits for a service that never answers', async function () {
    this.timeout(500);
    await new Promise(() => {});
  });

  it.skip('applies a coupon', () => {});

  it('survives a flaky page', function () {
    this.retries(1);
    assert.ok(this.test.currentRetry() > 0, 'passes only on the retry');
  });

  it('is skipped as it runs', function () {
    this.skip();
  });

  it('calls back', (done) => {
    setTimeout(done, 1);
  });

  it('nests a step', async () => {
    await step('outer', async () => {
      await step('inner', () => {});
    });
  });
});

describe('Tags @smoke', () => {
  it('is tagged by its suite', () => {});

  it('is tagged by its title @fast', () => {});
});

it('known bug @bug-42', () => {
  assert.equal(1 + 1, 3);
});

it('throws a plain error outside every step', async () => {
  await step('open the shop', () => {});
  throw new TypeError('cart.items is undefined');
});

describe('Checkout', () => {
  before(() => {
    throw new Error('the payment service is down');
  });

  it('pays by card', () => {});
});
