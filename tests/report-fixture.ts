// A made-up shop's history, shaped like what a run records, for the report's tests and for looking at the page.
// Every failure a report must show has a place here: new, still failing, flaky, on one lane, on every lane, and a run that never started.
import { HISTORY_VERSION, type ResultRecord, type RunRecord } from '../src/model.ts';

interface Scenario {
  name: string;
  feature: string;
  tags: string[];
  steps: string[];
  from: number;
  lanes: string[];
}

const LANES = {
  web: { label: 'Shop on staging in Chrome', short: 'Web' },
  android: { label: 'Shop on an Android emulator', short: 'Android' },
  ios: { label: 'Shop on an iOS simulator', short: 'iOS' },
} as const;
type LaneId = keyof typeof LANES;
const EVERYWHERE: LaneId[] = ['web', 'android', 'ios'];

const SCENARIOS: Scenario[] = [
  {
    name: 'A voucher takes ten percent off the basket',
    feature: 'Vouchers',
    tags: ['@TC-0101', '@e2e'],
    from: 15,
    lanes: EVERYWHERE,
    steps: [
      'Given a signed-in customer with a full basket',
      'When they apply the voucher "TEN"',
      'Then the basket total reads "$90.00"',
      'And the order summary shows the discount',
    ],
  },
  {
    name: 'An expired voucher is refused and changes nothing',
    feature: 'Vouchers',
    tags: ['@TC-0102', '@e2e'],
    from: 25,
    lanes: ['web', 'ios'],
    steps: [
      'Given a signed-in customer with a full basket',
      'When they apply the voucher "OLD"',
      'Then the voucher error is displayed',
      'And the basket total is unchanged',
    ],
  },
  {
    name: 'Checkout refuses a card with no security code',
    feature: 'Checkout',
    tags: ['@TC-0110'],
    from: 40,
    lanes: EVERYWHERE,
    steps: [
      'Given a signed-in customer at checkout',
      'When they pay without a security code',
      'Then the card error reads "Enter the security code"',
      'And no order is created',
    ],
  },
  {
    name: 'A guest sees delivery times for their postcode',
    feature: 'Delivery',
    tags: ['@regression', '@network'],
    from: 0,
    lanes: EVERYWHERE,
    steps: ['Given the home page is open', 'When the guest enters the postcode "10115"', 'Then delivery times are displayed'],
  },
  {
    name: 'An order placed on the site reaches the backend',
    feature: 'Checkout',
    tags: ['@e2e'],
    from: 8,
    lanes: ['web', 'ios'],
    steps: [
      'Given a signed-in customer with a full basket',
      'When they place the order',
      'Then the confirmation page is displayed',
      'And the backend holds the order',
    ],
  },
  {
    name: 'A customer signs in and reaches their account',
    feature: 'Account',
    tags: ['@smoke'],
    from: 0,
    lanes: EVERYWHERE,
    steps: ['Given the sign-in page is open', 'When the customer signs in', 'Then their account page is displayed'],
  },
  {
    name: 'The menu lists every category',
    feature: 'Menu',
    tags: ['@smoke'],
    from: 0,
    lanes: EVERYWHERE,
    steps: ['Given the home page is open', 'Then the menu lists every category'],
  },
  {
    name: 'A saved address fills in the checkout form',
    feature: 'Account',
    tags: ['@regression'],
    from: 0,
    lanes: ['web', 'ios'],
    steps: ['Given a customer with a saved address', 'When they open checkout', 'Then the address form holds the saved address'],
  },
];

function rnd(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function hash(text: string): number {
  let h = 7;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return h;
}

interface Outcome {
  failedAt?: number;
  error?: string;
  isSkipped?: boolean;
  screenshot?: string;
}

function outcome(scenario: Scenario, lane: LaneId, day: number, lastDay: number): Outcome {
  if (lane === 'web' && day === lastDay - 52)
    return { failedAt: 0, error: 'Could not start a session: the Chrome driver download stopped early' };
  if (lane === 'android' && day === lastDay - 28) return { failedAt: 0, error: 'Device "emulator-5554" did not boot within 180000ms' };
  if (lane === 'ios' && (day === lastDay - 45 || day === lastDay - 44))
    return { failedAt: 0, error: 'connect ECONNREFUSED 127.0.0.1:4723' };
  if (scenario.name.startsWith('An order placed') && lane === 'ios' && day >= lastDay - 39 && day <= lastDay - 32)
    return { failedAt: 1, error: '"Place order button" was not found within 30000ms' };
  if (scenario.name.startsWith('A saved address') && day >= lastDay - 18 && day <= lastDay - 16)
    return { failedAt: 2, error: '"Address form" was not found within 30000ms' };
  if (scenario.name.startsWith('A customer signs in') && lane === 'web' && day >= lastDay - 48 && day <= lastDay - 46)
    return { failedAt: 2, error: 'Expected "Account heading" to read "Your account" but it read "Sign in"' };
  if (scenario.name.startsWith('A voucher') && day >= lastDay - 2)
    return { failedAt: 2, error: 'Expected "Basket total" to read "$90.00" but it read "$100.00"', screenshot: 'shot' };
  if (scenario.name.startsWith('An expired') && day >= lastDay - 2)
    return { failedAt: 3, error: 'Expected "Basket total" to read "$100.00" but it read "$90.00"' };
  if (scenario.name.startsWith('Checkout refuses') && lane === 'android' && day === lastDay)
    return { failedAt: 2, error: 'Expected "Card error" to read "Enter the security code" but it read ""' };
  if (scenario.name.startsWith('A guest') && ((lane === 'ios' && day === lastDay) || (day < lastDay - 1 && rnd(day, hash(lane)) < 0.13)))
    return { failedAt: 2, error: '"Delivery times" was not found within 30000ms' };
  if (scenario.name.startsWith('The menu') && lane === 'android' && rnd(day, 7) < 0.09 && day < lastDay - 1)
    return { failedAt: 1, error: 'Expected "Menu" to contain "Drinks" but it read "Burgers"' };
  return {};
}

function resultOf(scenario: Scenario, lane: LaneId, day: number, lastDay: number, shot: (day: number) => string | undefined): ResultRecord {
  const tag = scenario.tags.find((name) => name.startsWith('@TC-')) ?? scenario.tags[0];
  const found = outcome(scenario, lane, day, lastDay);
  const pace = lane === 'web' ? 1 : lane === 'android' ? 1.55 : 1.35;
  const slowdown = scenario.name.startsWith('An order placed') && day > lastDay - 30 ? 1 + (day - (lastDay - 30)) * 0.02 : 1;
  const steps = scenario.steps.map((line, index) => {
    const space = line.indexOf(' ');
    const isFailed = found.failedAt === index;
    const isUnrun = found.failedAt !== undefined && index > found.failedAt;
    const waits = found.error?.includes('30000ms') && isFailed ? 30000 : 0;
    const base = (400 + rnd(hash(scenario.name), index + 1) ** 2 * 7000) * pace * slowdown * (0.94 + rnd(day, index) * 0.12);
    return {
      keyword: line.slice(0, space),
      text: line.slice(space + 1),
      status: isFailed ? ('failed' as const) : isUnrun ? ('notRun' as const) : ('passed' as const),
      ms: isUnrun ? 0 : Math.round(waits || (isFailed ? 1400 : base)),
    };
  });
  const screenshot = found.screenshot ? shot(day) : undefined;
  return {
    test: `${scenario.feature}::${scenario.name}`,
    name: scenario.name,
    group: scenario.feature,
    file: `features/${scenario.feature.toLowerCase()}.feature`,
    tags: scenario.tags,
    rerun: `TEST_SUITE="${tag}" pnpm test shop-${lane}`,
    ...(tag ? { rerunScope: tag } : {}),
    status: found.error ? 'failed' : 'passed',
    ms: steps.reduce((sum, step) => sum + step.ms, 0),
    steps,
    ...(found.failedAt === undefined ? {} : { failedAt: found.failedAt }),
    ...(found.error ? { error: found.error, stack: '    at Wait.untilExists (wait.ts:37:13)' } : {}),
    ...(screenshot ? { image: { path: screenshot, type: 'image/png' as const } } : {}),
  };
}

/** A nightly run per day over `days` days, each on all three lanes; the newest run holds two causes that failed before and two new ones. */
export function sampleHistory(days = 60, options: { project?: string; laneIds?: LaneId[] } = {}): RunRecord[] {
  const start = Date.UTC(2026, 6, 31);
  const lastDay = days - 1;
  const laneIds = options.laneIds ?? EVERYWHERE;
  return Array.from({ length: days }, (_, day) =>
    laneIds.map((lane, index): RunRecord => {
      const at = start + day * 86400000 + index * 400000;
      const id = `day-${day}-${lane}`;
      const results = SCENARIOS.filter((scenario) => scenario.from <= day && scenario.lanes.includes(lane)).map((scenario) =>
        resultOf(scenario, lane, day, lastDay, (d) => (d >= lastDay - 2 ? `${id}/1.png` : undefined)),
      );
      return {
        v: HISTORY_VERSION,
        id,
        runNumber: day + 1,
        batch: `night-${day}`,
        project: options.project ?? 'shop',
        lane,
        laneLabel: LANES[lane].label,
        laneShort: LANES[lane].short,
        isFull: true,
        startedAt: new Date(at).toISOString(),
        finishedAt: new Date(at + results.reduce((sum, result) => sum + result.ms, 0) + 40000).toISOString(),
        commit: (hash(`c${day}`) * 7919).toString(16).padStart(7, '0').slice(0, 7) + '0000000',
        branch: 'main',
        trigger: 'GitHub Actions',
        url: 'https://example.com/ci/run',
        notStarted: 0,
        results,
      };
    }),
  ).flat();
}
