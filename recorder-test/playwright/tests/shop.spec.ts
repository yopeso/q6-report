import { expect, test } from 'playwright/test';

const PAGE = '<h1>Shop</h1><p id="cart">1 item</p>';

test.describe('Cart', () => {
  test('adds an item', async () => {
    await test.step('open the shop', async () => {});
    await test.step('add 1 item', async () => {});
    await test.info().attach('notes', { body: 'two steps, no failure', contentType: 'text/plain' });
  });

  test('totals the cart', async ({ page }) => {
    await page.setContent(PAGE);
    await test.step('open the shop', async () => {});
    await test.step('read the cart', async () => {
      expect(await page.locator('#cart').textContent()).toBe('8 items');
    });
    await test.step('leave the shop', async () => {});
  });

  test('waits for a service that never answers', async () => {
    test.setTimeout(500);
    await new Promise(() => {});
  });

  test.skip('applies a coupon', async () => {});

  test('survives a flaky page', async ({ page }, testInfo) => {
    await page.setContent(PAGE);
    expect(testInfo.retry, 'passes only on the retry').toBeGreaterThan(0);
  });
});

test.describe('Tags', () => {
  test('is tagged by an option', { tag: '@smoke' }, async () => {});

  test('is tagged by its title @fast', async () => {});
});

test('known bug @bug-42', async () => {
  expect(1 + 1).toBe(3);
});

test('throws a plain error outside every step', async () => {
  await test.step('open the shop', async () => {});
  throw new TypeError('cart.items is undefined');
});
