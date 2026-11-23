// pnpm check:report opens a generated report in headless Chrome, from a file as a person does, and walks every
// page. A chart or a route that breaks is invisible to the unit tests, which stop at the numbers behind the page.
// Pass --keep <dir> to leave the report there and look at it. A script because no shell line drives a browser.
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { remote } from 'webdriverio';

import { DEFAULT_BRAND } from '../src/brand.ts';
import type { Copy } from '../src/copy.ts';
import { appendDebugRun, appendRun } from '../src/history.ts';
import { HISTORY_VERSION, type ResultRecord, type RunRecord } from '../src/model.ts';
import { reportUrl, writeReport } from '../src/render.ts';
import { sampleHistory } from '../tests/report-fixture.ts';

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

/** A plain PNG of a page with a bar across its top, which is enough for a screenshot's place in the layout. */
function samplePng(width = 640, height = 360): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const isBar = y < 34;
      rows[start + 1 + x * 3] = isBar ? 41 : 240;
      rows[start + 2 + x * 3] = isBar ? 41 : 240;
      rows[start + 3 + x * 3] = isBar ? 41 : 238;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const HOSTILE = '</script><img src=x onerror="window.pwned=1">"; window.pwned=1; //';

/**
 * What a suite on another framework records: lanes named only once, tests with no group, no step, no file and no command
 * to run them again, and an error of several lines. Its page takes no brand and no copy.
 */
function plainHistory(day: number, lane: string): RunRecord {
  const at = Date.UTC(2026, 9, 1 + day);
  return {
    v: HISTORY_VERSION,
    id: `plain-${day}-${lane}`,
    runNumber: day + 1,
    batch: `plain-${day}`,
    project: 'plain',
    lane,
    laneLabel: lane,
    isFull: true,
    startedAt: new Date(at).toISOString(),
    finishedAt: new Date(at + 1000).toISOString(),
    trigger: 'Local',
    notStarted: 0,
    results: [
      {
        test: 'adds two numbers',
        name: 'adds two numbers',
        group: '',
        tags: [],
        status: 'failed',
        ms: 12,
        steps: [],
        error: 'expect(received).toBe(expected)\n\nExpected: 4\nReceived: 5',
        attachments: [
          { name: 'trace.mp4', path: 'artifacts/trace.mp4' },
          ...(lane === 'chrome' ? [{ name: 'run.log', path: 'artifacts/run.log', stored: `plain-${day}-${lane}/1-run.log` }] : []),
        ],
        ...(lane === 'firefox' ? { image: { path: 'firefox/1.gif', type: 'image/gif' as const } } : {}),
      },
      { test: 'keeps its total', name: 'keeps its total', group: '', tags: [], status: 'passed', ms: 9, steps: [] },
      { test: 'is not ready', name: 'is not ready', group: '', tags: [], status: 'skipped', ms: 0, steps: [] },
    ],
  };
}

/** A suite with no screen, whose recorder sorts its failures from the error object, and one test that passed on a retry. */
function noScreenHistory(): RunRecord {
  const failed = (name: string, kind: ResultRecord['kind'], at: string, error: string): ResultRecord => ({
    test: name,
    name,
    group: 'unit',
    at,
    ...(kind ? { kind } : {}),
    tags: [],
    status: 'failed',
    ms: 4,
    steps: [],
    attempts: 1,
    error,
  });
  return {
    v: HISTORY_VERSION,
    id: 'noscreen-1',
    runNumber: 0,
    batch: 'noscreen-1',
    project: 'noscreen',
    lane: 'jest',
    laneLabel: 'jest',
    isFull: true,
    startedAt: '2026-02-01T00:00:00.000Z',
    finishedAt: '2026-02-01T00:00:10.000Z',
    trigger: 'Local',
    notStarted: 0,
    results: [
      failed('one', 'check', 'a.test.js:3', 'expected 1 to be 2'),
      failed('two', 'check', 'a.test.js:3', 'expected 30 to be 40'),
      // Its check runs in the test's own code after its steps, as a JUnit test with steps on its page objects does.
      {
        ...failed('after its steps', 'check', 'a.test.js:3', 'expected 5 to be 6'),
        steps: [{ keyword: '', text: 'open the cart', status: 'passed', ms: 3 }],
      },
      failed('slow', 'timeout', 'a.test.js:9', 'Test timed out in 5000ms.'),
      failed('thrown', 'error', 'a.test.js:12', 'TypeError: x is not a function'),
      failed('outage one', 'env', 'a.test.js:15', 'connect ECONNREFUSED 127.0.0.1:1'),
      failed('outage two', 'env', 'b.test.js:20', 'connect ECONNREFUSED 127.0.0.1:2'),
      failed('odd', undefined, 'c.test.js:1', 'the frobnicator is sad'),
      { test: 'retried', name: 'retried', group: 'unit', tags: [], status: 'passed', ms: 4, steps: [], attempts: 2 },
      { test: 'fine', name: 'fine', group: 'unit', tags: [], status: 'passed', ms: 4, steps: [], attempts: 1 },
    ],
  };
}

// A Cucumber suite's own name, logo, favicon and words, passed the way a team passes its own, so each is seen to reach the page.
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SHOP_COPY: Partial<Copy> = {
  test: 'scenario',
  tests: 'scenarios',
  group: 'feature',
  startUnit: 'spec file',
  startUnits: 'spec files',
  notStarted: "failed before any scenario began, usually a session that could not start. The run's output says why.",
  skippedFoot: 'an earlier failure stopped them',
  skippedResult: 'This scenario did not run. An earlier failure in its feature usually stops it.',
  noScreenshot: 'This failure has no screenshot: it happened outside a step, or the session had already ended.',
  historyHome:
    "Each run adds to its project's history. A local run keeps it under reports/history, and a CI run keeps it when the pipeline restores that folder.",
  knownBug: 'Its scenario carries a @bug- tag',
};
const shopLook = {
  brand: {
    name: 'Shop tests',
    footer: DEFAULT_BRAND.footer,
    logo: DEFAULT_BRAND.footer.logo,
    favicon: { type: 'image/png' as const, base64: ONE_PIXEL_PNG },
  },
  copy: SHOP_COPY,
};

/** A lane in each browser and on each phone the page has a logo for. Their labels name no browser, so any other text that does is a lane named without its logo. */
const MARKED_LANES = [
  { lane: 'shop-web', short: 'Web', browser: 'chrome', platform: 'web', mark: 'chrome' },
  { lane: 'shop-web-chromium', short: 'Chromium', browser: 'chromium', platform: 'web', mark: 'chromium' },
  { lane: 'shop-web-edge', short: 'Edge', browser: 'edge', platform: 'web', mark: 'edge' },
  { lane: 'shop-web-firefox', short: 'Firefox', browser: 'firefox', platform: 'web', mark: 'firefox' },
  { lane: 'shop-web-safari', short: 'Safari', browser: 'safari', platform: 'web', mark: 'safari' },
  { lane: 'shop-web-webkit', short: 'WebKit', browser: 'webkit', platform: 'web', mark: 'webkit' },
  { lane: 'shop-android', short: 'Android', platform: 'android', mark: 'android' },
  { lane: 'shop-ios', short: 'iOS', platform: 'ios', mark: 'ios' },
] as const;
/** The Bootstrap Icons file each mark is drawn from; Chromium and WebKit have none of their own, so they take Chrome's and Safari's. */
const MARK_FILES: Record<string, string> = {
  chrome: 'chrome.svg',
  chromium: 'chrome.svg',
  edge: 'edge.svg',
  firefox: 'firefox.svg',
  safari: 'safari.svg',
  webkit: 'safari.svg',
  android: 'android.svg',
  ios: 'apple.svg',
};

/** Each mark's file as the package keeps it, so a page drawing a swapped or edited icon is caught. */
const markFiles = Object.fromEntries(
  Object.entries(MARK_FILES).map(([mark, file]) => [
    mark,
    readFileSync(path.join(import.meta.dirname, '..', 'src', 'client', 'lane-marks', file), 'utf8'),
  ]),
);

/** Two nights on every marked lane: a failure on one lane only, one everywhere, and one that recovers, so chips, causes, the flaky list and the filters all name lanes. */
function markedHistory(day: number, entry: (typeof MARKED_LANES)[number], index: number): RunRecord {
  const at = Date.UTC(2026, 10, 20 + day, 2, index);
  const result = (name: string, isFailed: boolean, error = `Expected "${name}" to hold its total`): ResultRecord => ({
    test: name,
    name,
    group: 'Checkout',
    tags: ['@e2e'],
    status: isFailed ? 'failed' : 'passed',
    ms: 1200 + index * 90,
    steps: [],
    ...(isFailed ? { error, kind: 'check' as const, at: 'checkout.feature:4' } : {}),
  });
  return {
    v: HISTORY_VERSION,
    id: `marked-${day}-${entry.lane}`,
    runNumber: day + 1,
    batch: `marked-${day}`,
    project: 'lanes',
    lane: entry.lane,
    laneLabel: `Shop, lane ${index + 1}`,
    laneShort: entry.short,
    ...('browser' in entry ? { browser: entry.browser } : {}),
    platform: entry.platform,
    isFull: true,
    startedAt: new Date(at).toISOString(),
    finishedAt: new Date(at + 60000).toISOString(),
    trigger: 'Local',
    notStarted: 0,
    results: [
      result('signs in', false),
      result('pays by card', day === 1 && entry.mark === 'firefox'),
      result('lists the basket', day === 1, 'Expected "Basket" to list 2 items'),
      result('keeps the address', day === 0 && entry.mark === 'android'),
    ],
  };
}

const WORDS_OF_ANOTHER_SUITE = /scenario|spec file|platform|reports\/history|Shop tests|TEST_SUITE|pnpm test|session had already/i;

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { keep: { type: 'string' } } });
  const dir = values.keep ? path.resolve(values.keep) : mkdtempSync(path.join(os.tmpdir(), 'q6-report-check-'));
  const historyDir = path.join(dir, 'history');
  rmSync(historyDir, { recursive: true, force: true });
  const records = sampleHistory();
  const newest = records.slice(-3);
  // A value from a run that tries to become markup, on the newest run so every page shows it.
  const victim = newest.flatMap((record) => record.results).find((result) => result.status === 'failed')!;
  victim.error = `Expected "Basket total" to read ${HOSTILE}`;
  for (const record of records) {
    appendRun(historyDir, record);
    for (const result of record.results) {
      if (!result.image) continue;
      const file = path.join(historyDir, record.project, 'screenshots', result.image.path);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, samplePng());
    }
  }
  // A session on several tests: one fails then recovers, one keeps failing, one passes throughout, and a later attempt adds a test.
  const newestWeb = records.filter((record) => record.lane === 'web').at(-1)!;
  const failing = newestWeb.results.find((result) => result.status === 'failed')!;
  const passing = newestWeb.results.filter((result) => result.status === 'passed');
  const attempts = [
    [failing, passing[0]!],
    [{ ...failing, test: `${failing.test} again`, name: `${failing.name} again` }, failing, passing[0]!],
    [
      failing,
      {
        ...failing,
        status: 'passed' as const,
        error: undefined,
        failedAt: undefined,
        test: `${failing.test} again`,
        name: `${failing.name} again`,
      },
      passing[0]!,
      passing[1]!,
    ],
  ];
  attempts.forEach((results, attempt) => {
    appendDebugRun(historyDir, {
      ...newestWeb,
      id: `debug-${attempt}`,
      batch: `debug-${attempt}`,
      isFull: false,
      narrowedTo: '@checkout-page-tests',
      results,
    });
  });
  // After the trial runs, so the report carries its Trial runs tab at every width checked below.
  const written = await writeReport({ historyDir, outDir: path.join(dir, 'report'), project: 'shop', ...shopLook });
  console.info(`${written.model.runs.length} runs, ${Math.round(written.bytes / 1024)} KB: ${reportUrl(written.html)}`);
  const debug = await writeReport({ historyDir, outDir: path.join(dir, 'report'), project: 'shop', isDebug: true, ...shopLook });

  for (const day of [0, 1]) for (const lane of ['chrome', 'firefox']) appendRun(historyDir, plainHistory(day, lane));
  // What a run's kept attachment leaves under the history: a log that tries to become markup, which the page shows as text.
  for (const day of [0, 1]) {
    const log = path.join(historyDir, 'plain', 'attachments', `plain-${day}-chrome`, '1-run.log');
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(log, HOSTILE);
  }
  // A real one-pixel GIF, as a page has to hold more than the PNGs most suites take. It is under the folder's old name,
  // shots, as a history kept from before it was renamed is, so the page showing it proves such a history keeps it.
  mkdirSync(path.join(historyDir, 'plain', 'shots', 'firefox'), { recursive: true });
  writeFileSync(
    path.join(historyDir, 'plain', 'shots', 'firefox', '1.gif'),
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  );
  const plain = await writeReport({ historyDir, outDir: path.join(dir, 'report'), project: 'plain' });
  // A logo that tries to run something, and an accent, on a page of their own.
  const hostileLogo = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" onload="window.pwned=1"><script>window.pwned=1</script><rect width="40" height="20" fill="#0a0"/></svg>',
  ).toString('base64');
  appendRun(historyDir, noScreenHistory());
  const noScreen = await writeReport({ historyDir, outDir: path.join(dir, 'report'), project: 'noscreen' });
  for (const day of [0, 1]) MARKED_LANES.forEach((entry, index) => appendRun(historyDir, markedHistory(day, entry, index)));
  const marked = await writeReport({ historyDir, outDir: path.join(dir, 'report'), project: 'lanes' });
  const branded = await writeReport({
    historyDir,
    outDir: path.join(dir, 'branded'),
    project: 'plain',
    brand: {
      name: 'Acme tests',
      footer: { text: 'Made by Acme', logo: { type: 'image/svg+xml', base64: hostileLogo } },
      accent: '#102a6b',
      logo: { type: 'image/svg+xml', base64: hostileLogo },
    },
  });

  const browser = await remote({
    logLevel: 'error',
    capabilities: {
      browserName: 'chrome',
      'goog:chromeOptions': { args: ['--headless=new', '--window-size=1440,1000', '--no-sandbox', '--disable-gpu'] },
    },
  });
  const problems: string[] = [];
  const check = (isOk: boolean, what: string) => {
    if (!isOk) problems.push(what);
  };
  const newestRun = written.model.runs.at(-1)!;
  const test = written.model.tests[0]!;
  const failed = newestRun.results.find((result) => result.status === 'failed')!;
  const routes = [
    '#/',
    '#/runs',
    `#/runs/${newestRun.n}`,
    `#/runs/${written.model.runs[0]!.n}`,
    '#/tests',
    `#/tests/${encodeURIComponent(test.id)}`,
    `#/runs/${newestRun.n}?r=${newestRun.n}:${encodeURIComponent(failed.lane)}:${encodeURIComponent(failed.test)}`,
    '#/runs/99999',
    '#/tests/nope',
    '#/nowhere',
    '#/?r=99999:nope:nope',
  ];
  try {
    await browser.url(reportUrl(written.html));
    await browser.waitUntil(async () => browser.execute(() => Boolean(document.querySelector('.stats'))), {
      timeout: 10000,
      timeoutMsg: 'The overview never drew',
    });
    const trialTab = await browser.execute(
      () => [...document.querySelectorAll('.nav a')].find((link) => link.textContent === 'Trial runs')?.getAttribute('href') ?? null,
    );
    check(trialTab === './shop-debug.html#/debug', `The report's Trial runs tab opens ${trialTab}`);
    for (const theme of ['light', 'dark']) {
      await browser.execute((name: string) => {
        document.documentElement.dataset.theme = name;
      }, theme);
      for (const width of [1440, 390]) {
        await browser.setWindowSize(width, 1000);
        for (const route of routes) {
          await browser.execute((hash: string) => {
            location.hash = hash;
          }, route);
          await browser.pause(120);
          const page = await browser.execute(() => ({
            text: document.body.innerText,
            hasContent: Boolean(document.querySelector('#app main')),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            bad: [...document.querySelectorAll('svg *')].filter((node) =>
              /NaN|undefined|Infinity/.test(
                node
                  .getAttributeNames()
                  .map((name) => node.getAttribute(name))
                  .join(' '),
              ),
            ).length,
          }));
          const where = `${route} at ${width}px in ${theme}`;
          check(page.hasContent, `${where} drew nothing`);
          check(!/\b(undefined|NaN|\[object)/.test(page.text), `${where} shows a broken value`);
          check(page.bad === 0, `${where} drew ${page.bad} chart marks with a broken value`);
          check(page.overflow <= 0, `${where} scrolls sideways by ${page.overflow}px`);
        }
      }
    }
    await browser.setWindowSize(1440, 1000);
    await browser.execute(() => {
      location.hash = '#/';
    });
    await browser.pause(150);

    await browser.url(reportUrl(debug.html));
    await browser.waitUntil(async () => browser.execute(() => Boolean(document.querySelector('.stats'))), {
      timeout: 10000,
      timeoutMsg: 'The debug page never drew',
    });
    const debugPage = await browser.execute(() => ({
      note: document.querySelector('.debug-note')?.textContent ?? '',
      link: document.querySelector<HTMLAnchorElement>('.debug-note a')?.getAttribute('href'),
      text: document.body.innerText,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    check(debugPage.note.includes('@checkout-page-tests'), `The debug page does not say what it was narrowed to: ${debugPage.note}`);
    const grid = await browser.execute(() => ({
      rows: document.querySelectorAll('.attempt-grid tbody tr').length,
      columns: document.querySelectorAll('.attempt-grid thead th').length,
      note: document.querySelector('.grid-note')?.textContent ?? '',
      tabs: [...document.querySelectorAll('.nav a')].map((tab) => tab.textContent),
    }));
    check(grid.rows === 2, `The attempt grid shows ${grid.rows} tests, not the 2 that ever failed`);
    check(grid.note.startsWith('2 more tests passed'), `The attempt grid does not fold what always passed: ${grid.note}`);
    check(
      !grid.tabs.includes('Runs') && !grid.tabs.includes('Tests') && grid.tabs.includes('Trial runs'),
      `The debug page's tabs are ${grid.tabs.join(', ')}`,
    );
    check(debugPage.link === './shop.html', `The debug page links to ${debugPage.link}, not the report of full runs`);
    check(!/\b(undefined|NaN|\[object)/.test(debugPage.text), 'The debug page shows a broken value');
    check(debugPage.overflow <= 0, `The debug page scrolls sideways by ${debugPage.overflow}px`);
    for (const route of ['#/debug', '#/debug/3', '#/debug/99', '#/runs', '#/tests']) {
      await browser.execute((hash: string) => {
        location.hash = hash;
      }, route);
      await browser.pause(120);
      const page = await browser.execute(() => ({
        text: document.body.innerText,
        hasContent: Boolean(document.querySelector('#app main')),
      }));
      check(page.hasContent && !/\b(undefined|NaN|\[object)/.test(page.text), `The debug page's ${route} is broken`);
    }
    await browser.execute(() => {
      location.hash = '#/debug/3';
    });
    await browser.pause(120);
    const opened2 = await browser.execute(() => {
      document.querySelector<HTMLElement>('tbody tr.is-link')?.click();
      return location.hash;
    });
    await browser.pause(120);
    check(
      /r=d3:/.test(opened2) && (await browser.execute(() => Boolean(document.querySelector('.sheet')))),
      `A debug result opened ${opened2}, with no sheet`,
    );
    await browser.url(reportUrl(plain.html));
    await browser.waitUntil(async () => browser.execute(() => Boolean(document.querySelector('.stats'))), {
      timeout: 10000,
      timeoutMsg: 'The plain suite page never drew',
    });
    const plainRun = plain.model.runs.at(-1)!;
    for (const route of [
      '#/',
      '#/runs',
      `#/runs/${plainRun.n}`,
      '#/tests',
      `#/tests/${encodeURIComponent('adds two numbers')}`,
      `#/runs/${plainRun.n}?r=${plainRun.n}:chrome:${encodeURIComponent('adds two numbers')}`,
      `#/runs/${plainRun.n}?r=${plainRun.n}:chrome:${encodeURIComponent('is not ready')}`,
    ]) {
      await browser.execute((hash: string) => {
        location.hash = hash;
      }, route);
      await browser.pause(120);
      const page = await browser.execute(() => ({
        text: document.body.innerText,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      check(!/\b(undefined|NaN|\[object)/.test(page.text), `The plain suite's ${route} shows a broken value`);
      check(
        !WORDS_OF_ANOTHER_SUITE.test(page.text),
        `The plain suite's ${route} uses another suite's words: ${WORDS_OF_ANOTHER_SUITE.exec(page.text)?.[0]}`,
      );
      check(page.overflow <= 0, `The plain suite's ${route} scrolls sideways by ${page.overflow}px`);
    }
    await browser.execute(
      (hash: string) => {
        location.hash = hash;
      },
      `#/runs/${plainRun.n}?r=${plainRun.n}:chrome:${encodeURIComponent('adds two numbers')}`,
    );
    await browser.pause(150);
    const plainSheet = await browser.execute(() => {
      const code = document.querySelector<HTMLElement>('.fail-box code')!;
      const headings = [...document.querySelectorAll('.sheet .h4')].map((heading) => heading.textContent);
      return {
        sub: document.querySelector('.sheet .sub')?.textContent ?? '',
        headings,
        whiteSpace: getComputedStyle(code).whiteSpace,
        lines: Math.round(code.getBoundingClientRect().height / parseFloat(getComputedStyle(code).lineHeight)),
        hasSteps: Boolean(document.querySelector('.sheet .steps')),
      };
    });
    check(!plainSheet.sub.startsWith(','), `The line under a result with no group starts with a comma: "${plainSheet.sub}"`);
    check(!plainSheet.headings.includes('Steps') && !plainSheet.hasSteps, 'A result with no steps still shows a Steps section');
    check(!plainSheet.headings.includes('Run it again'), 'A result with no command still offers to run it again');
    check(plainSheet.lines >= 4, `An error of four lines draws as ${plainSheet.lines}, in white-space ${plainSheet.whiteSpace}`);
    const attachment = await browser.execute(() => document.querySelector('.sheet .attachments li')?.textContent ?? '');
    check(attachment === 'trace.mp4artifacts/trace.mp4', `An attachment reads "${attachment}", not its name and path`);
    const kept = await browser.execute(() => {
      const row = document.querySelectorAll('.sheet .attachments li')[1];
      row?.querySelector('details')?.setAttribute('open', '');
      return {
        href: row?.querySelector('a')?.getAttribute('href') ?? '',
        text: row?.querySelector('pre')?.textContent,
        markup: row?.querySelectorAll('img, script').length,
        pwned: (window as unknown as { pwned?: number }).pwned,
      };
    });
    check(
      kept.href === './plain-attachments/plain-1-chrome/1-run.log' && existsSync(path.join(path.dirname(plain.html), kept.href)),
      `A kept attachment links to "${kept.href}", which is not its file beside the page`,
    );
    check(kept.text === HOSTILE && kept.markup === 0 && kept.pwned === undefined, 'A text attachment did not show as exactly its text');
    await browser.execute(
      (hash: string) => {
        location.hash = hash;
      },
      `#/runs/${plainRun.n}?r=${plainRun.n}:firefox:${encodeURIComponent('adds two numbers')}`,
    );
    await browser.pause(200);
    const gif = await browser.execute(() => {
      const image = document.querySelector<HTMLImageElement>('.sheet .shot img');
      return { src: image?.src.slice(0, 21), width: image?.naturalWidth };
    });
    check(gif.src === 'data:image/gif;base64' && gif.width === 1, `A GIF draws from ${gif.src} at ${gif.width}px`);
    await browser.keys('Escape');
    await browser.execute(() => {
      location.hash = '#/';
    });
    await browser.pause(150);
    const plainTop = await browser.execute(() => ({
      marks: document.querySelectorAll('[data-mark], .marks-notice').length,
      lanes: [...document.querySelectorAll('.plat-h span')].map((span) => span.textContent ?? ''),
      headLogos: document.querySelectorAll('.brand .logo').length,
      footLogos: document.querySelectorAll('.foot .logo').length,
      favicon: Boolean(document.querySelector('link[rel="icon"]')),
      divider: getComputedStyle(document.querySelector('.brand .product')!).borderLeftStyle,
      product: document.querySelector('.brand .product')?.textContent,
      foot: document.querySelector('.foot')?.textContent ?? '',
      title: document.title,
    }));
    check(
      !plainTop.lanes.some((text) => /chrome\s+chrome/.test(text)),
      `A lane whose label is its name reads twice: ${plainTop.lanes.join(' | ')}`,
    );
    check(plainTop.marks === 0, `Lanes named chrome and firefox that record no browser draw ${plainTop.marks} logos or notices`);
    check(
      plainTop.headLogos === 0 && plainTop.footLogos === 1 && !plainTop.favicon,
      `A page with no brand draws ${plainTop.headLogos} logos in its header, ${plainTop.footLogos} in its footer, and ${plainTop.favicon ? 'a' : 'no'} favicon`,
    );
    check(plainTop.divider === 'none', 'The product name keeps the divider of a logo that is not there');
    check(
      plainTop.product === 'q6-report' && plainTop.foot === 'Generated by q6',
      `The default brand reads "${plainTop.product}" and "${plainTop.foot}"`,
    );

    await browser.url(reportUrl(branded.html));
    await browser.waitUntil(async () => browser.execute(() => Boolean(document.querySelector('.stats'))), {
      timeout: 10000,
      timeoutMsg: 'The branded page never drew',
    });
    await browser.pause(300);
    const brandedTop = await browser.execute(() => ({
      pwned: (window as unknown as { pwned?: number }).pwned,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
      width: document.querySelector('.brand .logo img')?.getBoundingClientRect().width,
      product: document.querySelector('.brand .product')?.textContent,
      foot: document.querySelector('.foot')?.textContent ?? '',
      title: document.title,
      inlineSvgs: document.querySelectorAll('.brand svg, .foot svg').length,
    }));
    // A custom accent has to stay readable on both themes, and has to reach everything the default one colours.
    for (const theme of ['light', 'dark']) {
      await browser.execute((name: string) => {
        document.documentElement.dataset.theme = name;
      }, theme);
      await browser.pause(120);
      const tones = await browser.execute(() => {
        const luminance = (color: string) => {
          const [r, g, b] = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map((value) => {
              const channel = Number(value) / 255;
              return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            }) as [number, number, number];
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const contrast = (a: string, b: string) => {
          const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
          return (high + 0.05) / (low + 0.05);
        };
        const active = getComputedStyle(document.querySelector('.seg .is-on')!);
        const tab = getComputedStyle(document.querySelector('.nav a.is-on')!);
        const top = getComputedStyle(document.querySelector('header.top')!);
        return {
          label: contrast(active.color, active.backgroundColor),
          tab: contrast(tab.borderBottomColor, top.backgroundColor),
          bar: top.borderImageSource,
        };
      });
      check(
        tones.label >= 4.5,
        `An active filter's label on the accent in ${theme} has a contrast of ${tones.label.toFixed(2)}, under 4.5`,
      );
      check(tones.tab >= 3, `The active tab's mark on the accent in ${theme} has a contrast of ${tones.tab.toFixed(2)}, under 3`);
      check(!/255, 168, 0|ffa800/i.test(tones.bar), `The top bar in ${theme} keeps the default orange: ${tones.bar}`);
    }
    await browser.execute(() => {
      document.documentElement.dataset.theme = 'light';
    });
    check(brandedTop.pwned === undefined, 'A logo ran as a script');
    check(brandedTop.inlineSvgs === 0, 'A logo reached the page as markup');
    check(brandedTop.accent === '#102a6b', `The accent reads ${brandedTop.accent}`);
    check(brandedTop.width === 36, `A 40x20 logo at 18px high is ${brandedTop.width}px wide`);
    check(
      brandedTop.product === 'Acme tests' && brandedTop.foot === 'Made by Acme' && brandedTop.title === 'plain - Acme tests',
      `The brand reads "${brandedTop.product}", "${brandedTop.foot}", "${brandedTop.title}"`,
    );

    await browser.url(reportUrl(written.html));
    await browser.waitUntil(async () => browser.execute(() => Boolean(document.querySelector('.stats'))), {
      timeout: 10000,
      timeoutMsg: 'The overview never drew again',
    });
    const shopTop = await browser.execute(() => {
      const logo = document.querySelector<HTMLElement>('.brand .logo')!;
      const style = getComputedStyle(logo);
      return {
        hasMask: (style.maskImage || style.webkitMaskImage).startsWith('url('),
        size: [logo.getBoundingClientRect().width, logo.getBoundingClientRect().height],
        favicon: document.querySelector('link[rel="icon"]')?.getAttribute('type'),
        title: document.title,
      };
    });
    check(
      shopTop.hasMask && Math.round(shopTop.size[0]!) === 89 && shopTop.size[1] === 18,
      `The suite's logo is ${shopTop.size.join('x')}, masked: ${shopTop.hasMask}`,
    );
    check(
      shopTop.favicon === 'image/png' && shopTop.title === 'shop - Shop tests',
      `The suite's favicon is ${shopTop.favicon} and its title "${shopTop.title}"`,
    );
    // The command selects by a tag other tests carry, whatever their own commands are, so the count comes from the tag.
    const shared = written.model.runs.at(-1)!.results.find((result) => result.tags.includes('@e2e') && result.rerunScope === '@e2e')!;
    await browser.execute(
      (hash: string) => {
        location.hash = hash;
      },
      `#/runs/${newestRun.n}?r=${newestRun.n}:${encodeURIComponent(shared.lane)}:${encodeURIComponent(shared.test)}`,
    );
    await browser.pause(150);
    const note = await browser.execute(() => document.querySelector('.sheet .note')?.textContent ?? '');
    const carrying = written.model.tests.filter((candidate) => candidate.tags.includes('@e2e')).length;
    check(
      note === `This test has no tag of its own, so this runs all ${carrying} scenarios tagged @e2e.`,
      `The note on a shared command reads "${note}"`,
    );
    await browser.keys('Escape');
    await browser.pause(100);
    check(await browser.execute(() => !document.querySelector('.debug-note')), 'The report of full runs says it is a debug run');

    // Hover rules can outrank an active state, leaving a label the same colour as its background.
    for (const theme of ['light', 'dark']) {
      await browser.execute((name: string) => {
        document.documentElement.dataset.theme = name;
        location.hash = '#/runs';
      }, theme);
      await browser.pause(150);
      await browser.$('.seg button.is-on').moveTo();
      await browser.pause(100);
      const active = await browser.execute(() => {
        const style = getComputedStyle(document.querySelector('.seg button.is-on')!);
        return { color: style.color, background: style.backgroundColor };
      });
      check(
        active.color !== active.background,
        `An active filter under the mouse in ${theme} has its text the colour of its background, ${active.color}`,
      );
    }
    await browser.execute(() => {
      document.documentElement.dataset.theme = 'light';
      location.hash = '#/';
    });
    await browser.pause(150);

    const hostile = await browser.execute(() => ({
      pwned: (window as unknown as { pwned?: number }).pwned,
      images: document.querySelectorAll('img[src="x"]').length,
      shown: document.body.innerText.includes('onerror'),
    }));
    check(hostile.pwned === undefined && hostile.images === 0, 'A value from a run ran as markup');
    check(hostile.shown, 'A value from a run did not show as text');

    const opened = await browser.execute(() => {
      document.querySelector<SVGElement>('.chart .hit')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return location.hash;
    });
    check(/^#\/runs\/\d+$/.test(opened), `A chart bar opened ${opened}, not a run`);

    await browser.execute((hash: string) => {
      location.hash = hash;
    }, routes[6]!);
    await browser.pause(120);
    const sheet = await browser.execute(() => Boolean(document.querySelector('.sheet')));
    check(sheet, 'A result link opened no sheet');
    await browser.keys('Escape');
    await browser.pause(120);
    const closed = await browser.execute(() => !document.querySelector('.sheet'));
    check(closed, 'Escape did not close the sheet');

    await browser.execute(() => {
      location.hash = '#/runs';
    });
    await browser.pause(120);
    await browser.execute((text: string) => {
      const input = document.getElementById('q') as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 'no-such-run');
    const searched = await browser.execute(() => ({
      empty: document.querySelector('.empty')?.textContent ?? '',
      focused: document.activeElement?.id,
    }));
    check(searched.empty.includes('no-such-run'), 'A search with no match said nothing');
    check(searched.focused === 'q', 'Typing in the search lost the focus');
    // A full run says nothing about its tag but what its tests carry, and the search box promises to find it.
    const tagged = await browser.execute((text: string) => {
      const input = document.getElementById('q') as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return document.querySelectorAll('tbody tr').length;
    }, '@smoke');
    check(tagged > 0, 'Searching the runs for a tag their tests carry found none');

    await browser.url(reportUrl(noScreen.html));
    await browser.waitUntil(async () => browser.execute(() => Boolean(document.querySelector('.stats'))), {
      timeout: 10000,
      timeoutMsg: 'The report of a suite with no screen never drew',
    });
    await browser.pause(150);
    const noScreenPage = await browser.execute(() => ({
      text: document.body.innerText,
      thumbs: document.querySelectorAll('.thumb').length,
      rows: document.querySelectorAll('.triage').length,
      firstRowColumns: getComputedStyle(document.querySelector('.triage')!).gridTemplateColumns.split(' ').length,
    }));
    check(
      !noScreenPage.text.includes('No screenshot') && noScreenPage.thumbs === 0,
      'A suite with no screen still shows a screenshot tile',
    );
    check(noScreenPage.firstRowColumns === 2, `A cause with no tile keeps ${noScreenPage.firstRowColumns} columns, which leaves a hole`);
    check(
      noScreenPage.rows === 5,
      `The causes are ${noScreenPage.rows}, not 5: one helper, one timeout, one thrown, one outage, one not sorted`,
    );
    for (const label of ['Wrong result', 'Timed out', 'Error thrown', 'Environment', 'Not sorted'])
      check(noScreenPage.text.includes(label), `The report of a suite with no screen does not say ${label}`);
    const stability = await browser.execute(
      () => [...document.querySelectorAll('.stat')].find((tile) => tile.textContent?.startsWith('Stability'))?.textContent ?? '',
    );
    check(stability.includes('3 automation failures'), `Stability counts two outages and a pass on a retry as three: ${stability}`);
    await browser.execute(() => {
      location.hash = '#/runs/1?r=1:jest:one';
    });
    await browser.pause(150);
    const failureSheet = await browser.execute(() => document.querySelector('.sheet')?.textContent ?? '');
    check(
      failureSheet.includes('expected 1 to be 2') && !failureSheet.includes('screenshot'),
      `A failure with no screen talks about a screenshot: ${failureSheet.slice(0, 160)}`,
    );
    await browser.execute(() => {
      location.hash = `#/runs/1?r=1:jest:${encodeURIComponent('after its steps')}`;
    });
    await browser.pause(150);
    const afterSteps = await browser.execute(() => document.querySelector('.sheet .fail-box .at')?.textContent ?? '');
    check(afterSteps === 'Failed outside any step, at a.test.js:3', `A failure between steps reads "${afterSteps}", not where it failed`);
    const stepList = await browser.execute(() =>
      [...document.querySelectorAll('.sheet .steps li')].map((row) => `${row.className}: ${row.textContent?.trim() ?? ''}`),
    );
    check(
      stepList.length === 2 && stepList[1] === 'is-failed: Failed here, outside any step, at a.test.js:3',
      `A test that failed after its steps lists them all green: ${stepList.join(' | ')}`,
    );
    await browser.execute(() => {
      location.hash = '#/runs/1?r=1:jest:retried';
    });
    await browser.pause(150);
    const retriedSheet = await browser.execute(() => document.querySelector('.sheet')?.textContent ?? '');
    check(
      retriedSheet.includes('ran 2 times') && retriedSheet.includes('Why it counts as flaky') && !retriedSheet.includes('Why it failed'),
      `A pass on a retry reads: ${retriedSheet.slice(0, 200)}`,
    );
    await browser.keys('Escape');
    const panel = await browser.execute(() => {
      location.hash = '#/runs/1';
      return true;
    });
    await browser.pause(150);
    const why = await browser.execute(() =>
      [...document.querySelectorAll('.track i')].reduce((sum, bar) => sum + parseFloat((bar as HTMLElement).style.width), 0),
    );
    check(panel && Math.round(why) === 100, `A pass on a retry stretches the failure bar to ${why}%`);

    // Every place that names a lane draws its logo before the name: its file's paths, at the size of the text, in the text's colour in both themes.
    await browser.url(reportUrl(marked.html));
    await browser.waitUntil(async () => browser.execute(() => Boolean(document.querySelector('.stats'))), {
      timeout: 10000,
      timeoutMsg: 'The page of a lane in each browser never drew',
    });
    // Each file's paths as the page's own SVG parser reads them, with the fill rule that decides where a shape has holes.
    const filePaths = await browser.execute(
      (files: Record<string, string>) =>
        Object.fromEntries(
          Object.entries(files).map(([mark, markup]) => [
            mark,
            [...new DOMParser().parseFromString(markup, 'image/svg+xml').querySelectorAll('path')].map(
              (path) => `${path.getAttribute('fill-rule') ?? 'nonzero'} ${path.getAttribute('d')}`,
            ),
          ]),
        ),
      markFiles,
    );
    const isFromFile = (mark: string, paths: string[]) => paths.length > 0 && JSON.stringify(paths) === JSON.stringify(filePaths[mark]);
    const markedRun = marked.model.runs.at(-1)!;
    const onlyHere = markedRun.results.find(
      (result) => result.status === 'failed' && result.lane === 'shop-web-firefox' && result.test === 'pays by card',
    )!;
    const shorts = MARKED_LANES.map((entry) => entry.short).filter((short) => short !== 'Web');
    const markedRoutes = [
      '#/',
      '#/runs',
      `#/runs/${markedRun.n}`,
      '#/tests',
      `#/tests/${encodeURIComponent('keeps the address')}`,
      `#/runs/${markedRun.n}?r=${markedRun.n}:${encodeURIComponent(onlyHere.lane)}:${encodeURIComponent(onlyHere.test)}`,
    ];
    for (const [theme, width] of [
      ['light', 1440],
      ['dark', 1440],
      ['light', 390],
    ] as const) {
      await browser.setWindowSize(width, 1000);
      for (const route of markedRoutes) {
        await browser.execute(
          (name: string, hash: string) => {
            document.documentElement.dataset.theme = name;
            location.hash = hash;
          },
          theme,
          route,
        );
        await browser.pause(150);
        const page = await browser.execute((names: string[]) => {
          const lanes = [...document.querySelectorAll('.lane-name')];
          const marks = [...document.querySelectorAll('.lane-name > .lane-mark, .sheet .chip > .lane-mark')].map((mark) => {
            const box = mark.getBoundingClientRect();
            const style = getComputedStyle(mark);
            const paths = [...mark.querySelectorAll('path')].map(
              (path) => `${path.getAttribute('fill-rule') ?? 'nonzero'} ${path.getAttribute('d')}`,
            );
            return {
              mark: mark.getAttribute('data-mark') ?? '',
              paths,
              width: box.width,
              height: box.height,
              fill: style.fill,
              color: style.color,
            };
          });
          // A lane's name in any other text, outside the footer's notice, is a place that names a lane without its logo; a chart's label sits after its logo.
          const bare: string[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (
              !parent ||
              parent.closest('.lane-name, .foot, #tip, script, style') ||
              parent.previousElementSibling?.hasAttribute('data-mark')
            )
              continue;
            if (parent.closest('.sheet .chip') && parent.closest('.sheet .chip')!.querySelector('.lane-mark')) continue;
            for (const name of names)
              if (new RegExp(`(^|[^\\w])${name}([^\\w]|$)`).test(node.textContent ?? ''))
                bare.push(`${name} in "${(node.textContent ?? '').trim().slice(0, 60)}"`);
          }
          const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          return {
            lanes: lanes.length,
            unmarked: lanes.filter((lane) => !lane.querySelector('.lane-mark')).map((lane) => lane.textContent ?? ''),
            marks,
            bare,
            overflow,
          };
        }, shorts);
        const where = `The page of a lane in each browser, ${route} at ${width}px in ${theme}`;
        check(page.overflow <= 0, `${where} scrolls sideways by ${page.overflow}px`);
        // The list of runs counts each run's lanes and names none.
        check(
          (route === '#/runs' || page.lanes > 0) && page.unmarked.length === 0,
          `${where} names ${page.lanes} lanes, ${page.unmarked.length} without a logo: ${page.unmarked.join(', ')}`,
        );
        check(page.bare.length === 0, `${where} names a lane without its logo: ${page.bare.join(' | ')}`);
        for (const mark of page.marks) {
          check(isFromFile(mark.mark, mark.paths), `${where} draws ${mark.mark} with paths other than its file's`);
          check(
            mark.fill === mark.color && (theme === 'light' || mark.color !== 'rgb(0, 0, 0)'),
            `${where} draws ${mark.mark} in ${mark.fill}, on text in ${mark.color}`,
          );
          check(
            mark.width >= 10 && mark.width <= 20 && Math.abs(mark.width - mark.height) < 0.5,
            `${where} draws ${mark.mark} at ${mark.width}x${mark.height}`,
          );
        }
      }
    }
    await browser.setWindowSize(1440, 1000);
    await browser.execute(() => {
      document.documentElement.dataset.theme = 'light';
      location.hash = '#/';
    });
    await browser.pause(150);
    const overview = await browser.execute(() => {
      const ends = [...document.querySelectorAll('svg[aria-label="Pass rate per lane"] [data-mark]')].map((mark) => ({
        mark: mark.getAttribute('data-mark') ?? '',
        paths: [...mark.querySelectorAll('path')].map((path) => `${path.getAttribute('fill-rule') ?? 'nonzero'} ${path.getAttribute('d')}`),
      }));
      const bar = document.querySelector('svg[aria-label="Run duration per run"] .hit')!;
      const box = bar.getBoundingClientRect();
      bar.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: box.left + 2, clientY: box.top + 2 }));
      const tip = [...document.querySelectorAll('#tip .lane-name .lane-mark')].map((mark) => mark.getAttribute('data-mark') ?? '');
      bar.dispatchEvent(new MouseEvent('mouseleave'));
      return { ends, tip, notice: document.querySelector('.foot .marks-notice')?.textContent ?? '' };
    });
    const everyMark = MARKED_LANES.map((entry) => entry.mark as string).sort();
    check(
      JSON.stringify(overview.ends.map((end) => end.mark).sort()) === JSON.stringify(everyMark),
      `The pass rate chart ends its lines with ${overview.ends.map((end) => end.mark).join(', ')}`,
    );
    check(
      overview.ends.every((end) => isFromFile(end.mark, end.paths)),
      'A logo at the end of a chart line is not its file',
    );
    check(
      JSON.stringify([...overview.tip].sort()) === JSON.stringify(everyMark),
      `A run's tooltip names its lanes with ${overview.tip.join(', ')}`,
    );
    check(
      overview.notice ===
        'Chrome and Android are trademarks of Google LLC. Microsoft Edge is a trademark of the Microsoft group of companies. Firefox and the Firefox logo are trademarks of Mozilla.org in the U.S. and other countries. Safari, WebKit, Apple and the Apple logo are trademarks of Apple Inc., registered in the U.S. and other countries and regions. The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the Creative Commons 3.0 Attribution License.',
      `The footer's notice reads "${overview.notice}"`,
    );
  } finally {
    await browser.deleteSession();
    if (!values.keep) rmSync(dir, { recursive: true, force: true });
  }
  if (problems.length) {
    console.error(`The report page has ${problems.length} problems:`);
    problems.forEach((problem) => console.error(`  - ${problem}`));
    process.exit(1);
  }
  console.info(
    `The report page holds up: ${routes.length} routes, 2 themes, 2 widths, the trial page, a suite on another framework, a suite with no screen, a brand with a hostile logo, a hostile value, a lane in each browser and on each phone with its logo, and the sheet, chart and search interactions.`,
  );
}

await main();
