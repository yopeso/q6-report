import {
  attemptGrid,
  CATEGORIES,
  categoryDescription,
  CATEGORY_ORDER,
  type CategoryKey,
  changesOf,
  type Cluster,
  clustersOf,
  failingStretch,
  flakyTests,
  type Lane,
  median,
  type Model,
  type Result,
  type Run,
  slowerTests,
  type TestInfo,
  verdictOf,
} from '../analysis.ts';
import type { BrandImage } from '../brand.ts';
import { safeFolderName } from '../model.ts';
import { chartBox, durationBars, historyBars, laneLines, type Series, sparkline, stackedBars, strip } from './charts.ts';
import { h, icon } from './dom.ts';
import { failingChip, fmtDate, fmtDateTime, fmtTime, pct, plural, shortSha } from './format.ts';

/** A run with nothing passed or failed has no pass rate, rather than a perfect one. */
const rateOf = (run: { passed: number; failed: number; rate: number }): string => (run.passed + run.failed ? pct(run.rate) : '-');

export interface Ui {
  model: Model;
  period: number;
  runFilter: 'all' | 'failed';
  runsQuery: string;
  runStatus: 'all' | 'failed' | 'passed' | 'skipped';
  runLane: string;
  runQuery: string;
  testsQuery: string;
  testLane: string;
  rerender: () => void;
  toggleTheme: () => void;
  isDark: () => boolean;
}

const CATEGORY_COLOR: Record<CategoryKey, string> = {
  known: 'var(--c-known)',
  wrong: 'var(--c-wrong)',
  missing: 'var(--c-missing)',
  timeout: 'var(--c-timeout)',
  env: 'var(--c-env)',
  code: 'var(--c-code)',
  flaky: 'var(--c-flaky)',
  unsorted: 'var(--c-unsorted)',
};

export const currentPath = (): string => location.hash.slice(1).split('?')[0] || '/';
export const go = (hash: string): void => {
  location.hash = hash;
};
export const runHash = (run: Run): string => `#/${run.isDebug ? 'debug' : 'runs'}/${run.n}`;
export const resultHash = (result: Result): string =>
  `#${currentPath()}?r=${result.run.isDebug ? 'd' : ''}${result.run.n}:${encodeURIComponent(result.lane)}:${encodeURIComponent(result.test)}`;
export const testHash = (id: string): string => `#/tests/${encodeURIComponent(id)}`;
const openRun = (run: Run): void => go(runHash(run));

const imageUri = ({ type, base64 }: { type: string; base64: string }): string => `data:${type};base64,${base64}`;

/** An image a result carries, when the page still holds it. */
export const shotUri = (model: Model, result: Result): string | undefined => {
  const base64 = result.image && model.shots[result.image.path];
  return result.image && base64 ? imageUri({ type: result.image.type, base64 }) : undefined;
};

/**
 * A logo comes from a suite's config, so it is drawn as an image, where an SVG cannot run anything, and never as markup.
 * A one-colour logo is a mask over the text colour instead; the image stays invisible and gives the mask its size.
 */
const logoSpan = (logo: BrandImage | undefined): HTMLElement | null => {
  if (!logo) return null;
  const uri = imageUri(logo);
  const image = h('img', { src: uri, alt: '' });
  return logo.isOneColour
    ? h('span', { cls: 'logo is-one-colour', style: `-webkit-mask-image:url("${uri}");mask-image:url("${uri}")` }, [image])
    : h('span', { cls: 'logo' }, [image]);
};

export function badge(status: Result['status']): HTMLElement {
  const map = { passed: ['check', 'Passed'], failed: ['x', 'Failed'], skipped: ['minus', 'Skipped'] } as const;
  return h('span', { cls: `badge b-${status}` }, [icon(map[status][0]), map[status][1]]);
}

export const catLabel = (category: CategoryKey): HTMLElement =>
  h('span', { cls: 'cat' }, [h('i', { cls: 'sw', style: `background:${CATEGORY_COLOR[category]}` }), CATEGORIES[category].label]);

const sectionHead = (title: string, note?: string): HTMLElement =>
  h('div', { cls: 'sec' }, [h('h2', { text: title }), note ? h('span', { cls: 'note', text: note }) : null]);

function panel(
  title: string,
  meta: string | null,
  body: Node | Node[],
  options: { side?: Node; flush?: boolean; cls?: string } = {},
): HTMLElement {
  return h('section', { cls: `panel${options.cls ? ` ${options.cls}` : ''}` }, [
    h('div', { cls: 'panel-h' }, [h('div', {}, [h('h3', { text: title }), meta ? h('p', { text: meta }) : null]), options.side ?? null]),
    h('div', { cls: `panel-b${options.flush ? ' is-flush' : ''}` }, Array.isArray(body) ? body : [body]),
  ]);
}

function stat(key: string, value: string, foot: string | null, options: { spark?: number[]; tone?: string } = {}): HTMLElement {
  return h('div', { cls: 'stat' }, [
    h('div', { cls: 'k' }, [h('span', { text: key }), options.spark ? sparkline(options.spark) : null]),
    h('div', { cls: `v ${options.tone ?? ''}`, text: value }),
    foot ? h('div', { cls: 'f', text: foot }) : null,
  ]);
}

const statStrip = (tiles: HTMLElement[]): HTMLElement => h('div', { cls: 'stats', style: `--n:${tiles.length}` }, tiles);

function resultBar(run: Run): HTMLElement {
  const segment = (count: number, color: string) =>
    count ? h('i', { style: `width:${(count / run.total) * 100}%;background:${color}` }) : null;
  return h('div', { cls: 'rbar', role: 'img', 'aria-label': `${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped` }, [
    segment(run.passed, 'var(--pass-bar)'),
    segment(run.failed, 'var(--fail)'),
    segment(run.skipped, 'var(--skip)'),
  ]);
}

const legendOf = (series: Series[]): HTMLElement =>
  h(
    'div',
    { cls: 'legend' },
    series.map((item) => h('span', {}, [h('i', { cls: 'sw', style: `background:${item.color}` }), item.label])),
  );

export function chrome(ui: Ui, active: string): HTMLElement {
  const { model } = ui;
  const tab = (href: string, label: string, key: string) =>
    h('a', { href, cls: active === key ? 'is-on' : '', text: label, 'aria-current': active === key ? 'page' : null });
  const others = model.projects.filter((name) => name !== safeFolderName(model.project));
  return h('header', { cls: 'top' }, [
    h('div', { cls: 'top-in' }, [
      h('a', { cls: 'brand', href: '#/', 'aria-label': `${model.brand.name}, overview` }, [
        logoSpan(model.brand.logo),
        h('span', { cls: 'product', text: model.brand.name }),
      ]),
      h('nav', { cls: 'nav', 'aria-label': 'Report' }, [
        tab('#/', 'Overview', 'overview'),
        model.isDebug ? tab('#/debug', 'Trial runs', 'debug') : null,
        model.isDebug ? null : tab('#/runs', 'Runs', 'runs'),
        model.isDebug ? null : tab('#/tests', 'Tests', 'tests'),
        model.trialReport ? tab(`./${encodeURIComponent(model.trialReport)}#/debug`, 'Trial runs', 'trial') : null,
      ]),
      h('div', { cls: 'top-right' }, [
        others.length
          ? h('details', { cls: 'menu' }, [
              h('summary', { cls: 'project' }, [h('span', { cls: 'dim', text: 'Project' }), model.project, icon('chevron')]),
              h(
                'div',
                { cls: 'menu-list' },
                others.map((name) => h('a', { href: `./${encodeURIComponent(name)}.html`, text: name })),
              ),
            ])
          : h('div', { cls: 'project' }, [h('span', { cls: 'dim', text: 'Project' }), model.project]),
        h('button', { cls: 'theme', 'aria-label': 'Switch between light and dark', onclick: ui.toggleTheme }, [
          icon(ui.isDark() ? 'sun' : 'moon'),
        ]),
      ]),
    ]),
  ]);
}

export const footer = (ui: Ui): HTMLElement =>
  h('footer', { cls: 'foot' }, [logoSpan(ui.model.brand.footer.logo), h('span', { text: ui.model.brand.footer.text })]);

const laneOf = (model: Model, id: string): Lane => model.lanes.find((lane) => lane.id === id) ?? { id, short: id, long: id };
const laneNames = (model: Model, ids: string[]): string => ids.map((id) => laneOf(model, id).short).join(', ');

function runLine(model: Model, run: Run): string {
  const where = [run.branch ? `on ${run.branch}` : null, shortSha(run.commit) ? `at ${shortSha(run.commit)!}` : null]
    .filter(Boolean)
    .join(' ');
  return `${run.trigger}${where ? ` ${where}` : ''}, ${fmtDateTime(run.at)}${run.lanes.length ? `, on ${laneNames(model, run.lanes)}` : ''}`;
}

function clusterRow(model: Model, cluster: Cluster, hasThumbs: boolean): HTMLElement {
  const freshCount = cluster.results.filter((result) => result.prev?.status !== 'failed').length;
  const longest = cluster.results.map(failingStretch).reduce((best, stretch) => (stretch.runs > best.runs ? stretch : best));
  const first = model.tests.find((test) => test.id === cluster.tests[0]);
  const isOnlyHere = cluster.lanes.length === 1 && (first?.lanes.length ?? 0) > 1;
  const withShot = cluster.results.find((result) => shotUri(model, result));
  const pick = withShot ?? cluster.results[0]!;
  return h('button', { cls: hasThumbs ? 'triage' : 'triage is-plain', onclick: () => go(resultHash(pick)) }, [
    hasThumbs
      ? h('div', { cls: 'thumb' }, [
          withShot
            ? h('img', { src: shotUri(model, withShot)!, alt: `The screen when "${withShot.name}" failed` })
            : h('span', { cls: 'thumb-empty' }, [icon('image'), 'No screenshot']),
        ])
      : null,
    h('div', { style: 'min-width:0' }, [
      h('div', { cls: 'err mono', text: cluster.error.split('\n')[0] ?? '' }),
      h('div', {
        cls: 'who',
        text: cluster.tests.length === 1 ? cluster.results[0]!.name : `${cluster.results[0]!.name}, and ${cluster.tests.length - 1} more`,
      }),
      h('div', { cls: 'tags' }, [
        freshCount && freshCount < cluster.count
          ? h('span', { cls: 'chip is-still', text: `${freshCount} new, ${cluster.count - freshCount} still failing` })
          : freshCount
            ? h('span', { cls: 'chip is-new', text: 'New in this run' })
            : h('span', { cls: 'chip is-still', text: failingChip(longest) }),
        model.lanes.length > 1
          ? isOnlyHere
            ? h('span', { cls: 'chip is-only', text: `Only on ${laneOf(model, cluster.lanes[0]!).short}` })
            : h('span', { cls: 'chip', text: laneNames(model, cluster.lanes) })
          : null,
        catLabel(cluster.category),
        cluster.bug ? h('span', { cls: 'chip' }, [icon('bug'), cluster.bug]) : null,
      ]),
    ]),
    h('div', { cls: 'n' }, [h('b', { text: cluster.count }), h('span', { text: cluster.count === 1 ? 'result' : 'results' })]),
  ]);
}

function triagePanel(model: Model, run: Run): HTMLElement {
  if (!run.total)
    return panel(
      'What needs you',
      null,
      h('p', {
        cls: 'empty',
        text: `${plural(run.notStarted, model.copy.startUnit, model.copy.startUnits)} ${model.copy.notStarted}`,
      }),
    );
  const causes = clustersOf([run]).sort((a, b) => {
    const fresh = (cluster: Cluster) => (cluster.results.some((result) => result.prev?.status !== 'failed') ? 1 : 0);
    return fresh(b) - fresh(a) || b.count - a.count;
  });
  if (!causes.length) {
    const lastBad = [...(model.isDebug ? model.debugRuns : model.runs)].reverse().find((candidate) => candidate.failed > 0);
    return panel(
      'What needs you',
      null,
      h('p', { cls: 'empty' }, [
        'Nothing failed in this run.',
        lastBad ? ' Last failure: ' : null,
        lastBad
          ? h('a', {
              cls: 'link',
              href: runHash(lastBad),
              text: `${lastBad.isDebug ? 'attempt' : 'run'} #${lastBad.n}, ${fmtDate(lastBad.at)}`,
            })
          : null,
      ]),
    );
  }
  return panel(
    'What needs you',
    `${plural(causes.length, 'cause')} behind ${plural(run.failed, 'failed result')}, new ones first`,
    h(
      'div',
      {},
      // One panel keeps one layout, so a project with a screen on any lane keeps the tile on all of its causes here.
      causes.map((cluster) =>
        clusterRow(
          model,
          cluster,
          causes.some(({ lanes }) => lanes.some((lane) => model.lanesWithImages.has(lane))),
        ),
      ),
    ),
    { flush: true },
  );
}

function lanesPanel(model: Model, run: Run): HTMLElement {
  return panel(
    'Lanes',
    'This run',
    h(
      'div',
      { cls: 'plat-list' },
      run.lanes.map((id) => {
        const lane = laneOf(model, id);
        const stats = run.byLane[id]!;
        const onlyHere = model.tests.filter((test) => {
          const here = run.results.find((result) => result.test === test.id && result.lane === id);
          if (here?.status !== 'failed') return false;
          return !run.results.some((result) => result.test === test.id && result.lane !== id && result.status === 'failed');
        });
        const segment = (count: number, color: string) =>
          count ? h('i', { style: `width:${(count / Math.max(1, stats.total)) * 100}%;background:${color}` }) : null;
        return h('div', { cls: 'plat' }, [
          h('div', { cls: 'plat-h' }, [
            h('span', {}, [
              h('b', { text: lane.short }),
              h('span', { text: `  ${lane.long === lane.short ? '' : `${lane.long}, `}${fmtTime(stats.ms)}` }),
            ]),
            h('span', { cls: 'plat-n', text: `${stats.passed} of ${stats.total}` }),
          ]),
          h('div', { cls: 'track' }, [
            segment(stats.passed, 'var(--pass-bar)'),
            segment(stats.failed, 'var(--fail)'),
            segment(stats.skipped, 'var(--skip)'),
          ]),
          h('div', {
            cls: 'why',
            text: onlyHere.length
              ? `${plural(onlyHere.length, 'test')} failing only here: ${onlyHere[0]!.name}`
              : stats.failed
                ? 'Every failure here also fails elsewhere'
                : 'All passing',
          }),
        ]);
      }),
    ),
    { flush: true, cls: 'is-fill' },
  );
}

function slowestPanel(run: Run): HTMLElement {
  const slowest = [...run.results].sort((a, b) => b.ms - a.ms).slice(0, 5);
  const top = Math.max(1, ...slowest.map((result) => result.ms));
  return panel(
    'Slowest in this run',
    `Of ${plural(run.total, 'result')}, ${fmtTime(run.ms)} in all`,
    h(
      'div',
      { cls: 'bars-list' },
      slowest.map((result) =>
        h('div', { cls: 'row' }, [
          h('div', { cls: 'row-h' }, [
            h('b', { text: result.name, style: 'font-size:13.5px' }),
            h('span', { cls: 'val', text: fmtTime(result.ms) }),
          ]),
          h('div', { cls: 'track' }, [h('i', { style: `width:${(result.ms / top) * 100}%;background:var(--c-duration)` })]),
        ]),
      ),
    ),
  );
}

const PERIODS: [number, string][] = [
  [14, '2W'],
  [30, '1M'],
  [0, 'All'],
];

function periodRuns(ui: Ui): Run[] {
  const { trendRuns } = ui.model;
  const newest = trendRuns.at(-1);
  if (!ui.period || !newest) return trendRuns;
  return trendRuns.filter((run) => newest.at - run.at <= ui.period * 86400000);
}

export function viewOverview(ui: Ui): Node[] {
  const { model } = ui;
  const run = (model.isDebug ? model.debugRuns : model.runs).at(-1)!;
  const changes = changesOf(run);
  // A debug run is a few tests, so against a full run its totals would say nothing.
  const previous = run.isFull ? model.trendRuns.filter((candidate) => candidate.n < run.n).at(-1) : undefined;
  const runs = periodRuns(ui);
  const recent = model.trendRuns.slice(-20);
  const { line, small } = verdictOf(run, model.copy);
  const executions = runs.flatMap((candidate) => candidate.results);
  const failures = executions.filter((result) => result.status === 'failed');
  // A pass on a retry counts too, so this reads from every result and agrees with the sparkline under it.
  const automation = executions.filter((result) => result.category === 'env' || result.category === 'flaky').length;
  const stability = executions.length ? 1 - automation / executions.length : 1;
  const compared = (value: string, isSame = false) =>
    !run.isFull
      ? 'Narrowed, so not compared'
      : !previous
        ? 'First run recorded'
        : isSame
          ? 'Same as the run before'
          : `${value} vs the run before`;
  const rateDelta = previous ? (run.rate - previous.rate) * 100 : 0;
  const timeDelta = previous ? run.ms - previous.ms : 0;

  const tiles = statStrip([
    stat('Pass rate', rateOf(run), compared(`${rateDelta > 0 ? '+' : ''}${rateDelta.toFixed(1)} pts`, Math.abs(rateDelta) < 0.05), {
      spark: recent.map((candidate) => candidate.rate),
      tone: run.rate < 0.9 ? 't-fail' : '',
    }),
    stat('New failures', String(changes.fresh.length), 'did not fail the time before', { tone: changes.fresh.length ? 't-fail' : '' }),
    stat('Still failing', String(changes.still.length), changes.still.length ? 'failed the time before too' : 'nothing carried over', {
      tone: changes.still.length ? 't-flaky' : '',
    }),
    stat('Fixed', String(changes.fixed.length), 'failed the time before', { tone: changes.fixed.length ? 't-pass' : '' }),
    ...(run.isDebug
      ? []
      : [
          stat('Stability', pct(stability, 1), `${plural(automation, 'automation failure')} in ${plural(executions.length, 'result')}`, {
            spark: recent.map((candidate) => 1 - (candidate.cats.env + candidate.cats.flaky) / Math.max(1, candidate.total)),
          }),
        ]),
    stat(
      'Results',
      String(run.total),
      `${plural(new Set(run.results.map((result) => result.test)).size, model.copy.test, model.copy.tests)} on ${plural(run.lanes.length, 'lane')}`,
    ),
    stat('Duration', fmtTime(run.ms), compared(`${timeDelta >= 0 ? '+' : '-'}${fmtTime(Math.abs(timeDelta))}`), {
      spark: recent.map((candidate) => candidate.ms),
    }),
  ]);

  const debugNote = model.isDebug
    ? h('p', { cls: 'debug-note' }, [
        h('b', { text: 'Trial run. ' }),
        `${whatRan(run)}. It stays out of the project's history, and this page keeps your last ${model.debugRuns.length === 1 ? 'attempt' : `${model.debugRuns.length} attempts`}, up to 10. `,
        model.mainReport
          ? h('a', { cls: 'link', href: `./${encodeURIComponent(model.mainReport)}`, text: 'Open the report of full runs' })
          : 'This project has no full run yet.',
      ])
    : null;

  const hero = h('div', { cls: 'hero' }, [
    h('div', { cls: 'hero-row' }, [
      h('div', {}, [
        h('h1', { text: model.project }),
        h('p', { cls: 'sub' }, [
          `${run.isDebug ? 'Trial run' : 'Run'} #${run.n}, ${runLine(model, run)}`,
          run.url ? ' ' : null,
          run.url ? h('a', { cls: 'link', href: run.url, target: '_blank', rel: 'noopener', text: 'Open in CI' }) : null,
        ]),
      ]),
      h('div', { cls: 'verdict' }, [line, h('small', { text: small })]),
    ]),
  ]);

  const periodSeg = h(
    'div',
    { cls: 'seg', role: 'group', 'aria-label': 'Period' },
    PERIODS.map(([days, label]) =>
      h('button', {
        cls: ui.period === days ? 'is-on' : '',
        text: label,
        'aria-pressed': String(ui.period === days),
        onclick: () => {
          ui.period = days;
          ui.rerender();
        },
      }),
    ),
  );

  const resultSeries: Series[] = [
    { key: 'passed', label: 'Passed', color: 'var(--pass-bar)' },
    { key: 'failed', label: 'Failed', color: 'var(--fail)' },
    { key: 'skipped', label: 'Skipped', color: 'var(--skip)' },
  ];
  const usedCategories = CATEGORY_ORDER.filter((key) => runs.some((candidate) => candidate.cats[key]));
  const categorySeries: Series[] = usedCategories.map((key) => ({ key, label: CATEGORIES[key].label, color: CATEGORY_COLOR[key] }));

  const trendSection: Node[] =
    model.trendRuns.length < 2
      ? [
          sectionHead('trend'),
          panel(
            'Trends start with the next run',
            null,
            h('p', {
              cls: 'empty',
              text: model.isDebug ? 'Trends come from full runs, and a trial run is not one.' : model.copy.historyHome,
            }),
          ),
        ]
      : [
          h('div', { cls: 'sec' }, [h('h2', { text: 'trend' }), periodSeg]),
          h('div', { cls: 'grid g-7-5' }, [
            panel(
              'Results per run',
              `${plural(runs.length, 'run')}. Click a bar to open the run.`,
              chartBox(
                250,
                stackedBars(runs, resultSeries, {
                  label: 'Results per run',
                  value: (candidate, key) => candidate[key as 'passed' | 'failed' | 'skipped'],
                  tip: (candidate) => ({
                    title: `Run #${candidate.n}, ${fmtDate(candidate.at)}`,
                    rows: [
                      ['Passed', candidate.passed, 'var(--pass-bar)'],
                      ['Failed', candidate.failed, 'var(--fail)'],
                      ['Skipped', candidate.skipped, 'var(--skip)'],
                      ['Pass rate', rateOf(candidate)],
                    ],
                  }),
                  open: openRun,
                }),
              ),
              { side: legendOf(resultSeries) },
            ),
            panel(
              model.lanes.length > 1 ? 'Pass rate per lane' : 'Pass rate',
              'Over the 7 runs up to each point',
              chartBox(250, laneLines(runs, model.lanes)),
            ),
          ]),
          h('div', { cls: 'grid g-5-7', style: 'margin-top:14px' }, [
            panel('Run duration', 'Start to finish, every lane of the run', chartBox(220, durationBars(runs, model.lanes, openRun))),
            panel(
              'Failures per run, by cause',
              failures.length ? 'Click a bar to open the run' : 'No failures in this period',
              chartBox(
                220,
                stackedBars(runs, categorySeries, {
                  label: 'Failures per run by cause',
                  value: (candidate, key) => candidate.cats[key as CategoryKey],
                  tip: (candidate) => ({
                    title: `Run #${candidate.n}, ${fmtDate(candidate.at)}`,
                    rows: candidate.failed
                      ? categorySeries
                          .filter((item) => candidate.cats[item.key as CategoryKey])
                          .map((item) => [item.label, candidate.cats[item.key as CategoryKey], item.color])
                      : [['No failures', '']],
                  }),
                  open: openRun,
                }),
              ),
              { side: legendOf(categorySeries) },
            ),
          ]),
        ];

  const analysisSection: Node[] = [];
  if (failures.length) {
    const categoryCounts = Object.fromEntries(
      CATEGORY_ORDER.map((key) => [key, failures.filter((result) => result.category === key).length]),
    ) as Record<CategoryKey, number>;
    const whyRows = h(
      'div',
      { cls: 'bars-list' },
      CATEGORY_ORDER.filter((key) => categoryCounts[key]).map((key) =>
        h('div', { cls: 'row' }, [
          h('div', { cls: 'row-h' }, [
            h('b', { text: CATEGORIES[key].label }),
            h('span', { cls: 'val', text: `${categoryCounts[key]}, ${pct(categoryCounts[key] / failures.length, 1)}` }),
          ]),
          h('div', { cls: 'track' }, [
            h('i', { style: `width:${(categoryCounts[key] / failures.length) * 100}%;background:${CATEGORY_COLOR[key]}` }),
          ]),
          h('div', { cls: 'desc', text: categoryDescription(key, model.copy) }),
        ]),
      ),
    );
    const clusterList = h(
      'div',
      { cls: 'list' },
      clustersOf(runs)
        .slice(0, 6)
        .map((cluster) =>
          h('button', { style: 'grid-template-columns:minmax(0,1fr) 150px 56px', onclick: () => go(resultHash(cluster.results.at(-1)!)) }, [
            h('div', { style: 'min-width:0' }, [
              h('div', { cls: 'name mono', style: 'font-weight:500', text: cluster.error.split('\n')[0] ?? '' }),
              h('div', { style: 'margin-top:4px;display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, [
                catLabel(cluster.category),
                h('span', {
                  cls: 'meta',
                  text: `${plural(cluster.tests.length, 'test')}, ${laneNames(model, cluster.lanes)}, last seen ${fmtDate(cluster.last.at)}`,
                }),
              ]),
            ]),
            h(
              'div',
              { cls: 'strip', style: 'height:18px', 'aria-hidden': 'true' },
              // Forty slots however few runs there are, so one failure in a young history is a tick and not a wall.
              [
                ...Array.from({ length: Math.max(0, 40 - runs.length) }, () => h('i', { cls: 'is-none' })),
                ...runs
                  .slice(-40)
                  .map((candidate) =>
                    cluster.runIds.has(candidate.n) ? h('i', { cls: 'is-failed', style: 'height:18px' }) : h('i', { cls: 'is-none' }),
                  ),
              ],
            ),
            h('div', { cls: 'r', style: 'font-weight:700;font-size:15px', text: cluster.count }),
          ]),
        ),
    );
    analysisSection.push(
      sectionHead('failure analysis', `${plural(failures.length, 'failure')} in this period`),
      h('div', { cls: 'grid g-5-7' }, [
        panel('Why tests failed', `${plural(failures.length, 'failure')}, ${plural(runs.length, 'run')}`, whyRows),
        panel('Top failure causes', 'Grouped by error, each tick is a run it appeared in', clusterList, { flush: true }),
      ]),
    );
  }

  const stabilitySection: Node[] = [];
  if (model.trendRuns.length >= 2) {
    const flaky = flakyTests(model.tests, runs).slice(0, 6);
    const slower = slowerTests(model.tests, runs).slice(0, 6);
    const flakyList = flaky.length
      ? h(
          'div',
          { cls: 'list' },
          flaky.map((entry) =>
            h('a', { href: testHash(entry.test.id), style: 'grid-template-columns:minmax(0,1fr) 170px 48px' }, [
              h('div', { style: 'min-width:0' }, [
                h('div', { cls: 'name', text: entry.test.name }),
                h('div', {
                  cls: 'meta',
                  text: `${plural(entry.count, 'unexplained failure')}: ${entry.perLane.map((item) => `${laneOf(model, item.lane).short} ${item.count}`).join(', ')}`,
                }),
              ]),
              strip(entry.test.history[entry.perLane[0]!.lane] ?? []),
              h('div', { cls: 'r', style: 'font-weight:600', text: pct(entry.rate) }),
            ]),
          ),
        )
      : h('p', { cls: 'empty', text: 'No flaky tests in this period.' });
    const slowerList = slower.length
      ? h(
          'div',
          { cls: 'list' },
          slower.map((entry) =>
            h('a', { href: testHash(entry.test.id), style: 'grid-template-columns:minmax(0,1fr) auto auto' }, [
              h('div', { style: 'min-width:0' }, [
                h('div', { cls: 'name', text: entry.test.name }),
                h('div', {
                  cls: 'meta',
                  text: entry.perLane.map((item) => `${laneOf(model, item.lane).short} +${fmtTime(item.up)}`).join(', '),
                }),
              ]),
              h('div', { cls: 'r', style: 'color:var(--ink3)', text: `${fmtTime(entry.worst.before)} to ${fmtTime(entry.worst.recent)}` }),
              h('div', { cls: 'r up', text: `+${fmtTime(entry.worst.up)}` }),
            ]),
          ),
        )
      : h('p', { cls: 'empty', text: 'Nothing got slower in this period.' });
    stabilitySection.push(
      sectionHead('stability', 'Is the suite itself to be trusted?'),
      h('div', { cls: 'grid g-2' }, [
        panel('Flaky tests', 'Fail and recover with nothing marking them as a bug', flakyList, { flush: true }),
        panel('Getting slower', 'Median of the last 5 passes against the passes before', slowerList, { flush: true }),
      ]),
    );
  }

  const acrossSection: Node[] = [];
  if (model.lanes.length > 1) {
    const isFailing = (test: TestInfo) => run.results.some((result) => result.test === test.id && result.status === 'failed');
    const rows = [...model.tests]
      .filter((test) => test.last.n >= run.n - 30)
      .sort((a, b) => Number(isFailing(b)) - Number(isFailing(a)))
      .map((test) => {
        const failingLanes = run.results
          .filter((result) => result.test === test.id && result.status === 'failed')
          .map((result) => result.lane);
        return h('tr', { cls: 'is-link', onclick: () => go(testHash(test.id)) }, [
          h('td', { style: 'min-width:300px' }, [
            h('a', { cls: 't', href: testHash(test.id), text: test.name, onclick: (event: Event) => event.stopPropagation() }),
            test.group ? h('div', { cls: 's', text: test.group }) : null,
          ]),
          ...model.lanes.map((lane) => {
            const current = run.results.find((result) => result.test === test.id && result.lane === lane.id);
            const history = test.history[lane.id];
            if (!history)
              return h('td', { style: 'width:22%;min-width:190px' }, [
                h('span', { cls: 't-mute', style: 'font-size:12.5px', text: 'Not run here' }),
              ]);
            const word = current?.status ?? 'not in this run';
            const tone = word === 'failed' ? 't-fail' : word === 'passed' ? 't-pass' : 't-mute';
            return h('td', { style: 'width:22%;min-width:190px' }, [
              h('div', { style: 'display:flex;gap:10px;align-items:center' }, [
                h('div', { style: 'flex:1;min-width:0' }, [strip(history)]),
                h('span', {
                  cls: tone,
                  style: 'width:70px;text-align:right;flex:none;font-size:12.5px;font-weight:500;text-transform:capitalize',
                  text: word,
                }),
              ]),
            ]);
          }),
          h('td', { style: 'width:120px' }, [
            failingLanes.length === 1 && test.lanes.length > 1
              ? h('span', { cls: 'chip is-only', text: `Only ${laneOf(model, failingLanes[0]!).short}` })
              : null,
            failingLanes.length > 1 && failingLanes.length === test.lanes.length
              ? h('span', { cls: 'chip is-still', text: 'Everywhere' })
              : null,
          ]),
        ]);
      });
    acrossSection.push(
      sectionHead('across lanes', 'The same test, side by side'),
      h('div', { cls: 'panel' }, [
        h('div', { cls: 'table-wrap' }, [
          h('table', {}, [
            h('thead', {}, [
              h('tr', {}, [
                h('th', { text: 'Test' }),
                ...model.lanes.map((lane) => h('th', { text: `${lane.short}, last 30 results` })),
                h('th'),
              ]),
            ]),
            h('tbody', {}, rows),
          ]),
        ]),
      ]),
    );
  }

  if (model.isDebug) {
    return [
      chrome(ui, 'overview'),
      ...(debugNote ? [debugNote] : []),
      hero,
      h('main', { cls: 'page' }, [
        tiles,
        h('div', { cls: 'grid g-8-4', style: 'margin-top:14px' }, [triagePanel(model, run), run.total ? slowestPanel(run) : null]),
        attemptsSection(model),
      ]),
      footer(ui),
    ];
  }

  return [
    chrome(ui, 'overview'),
    hero,
    h('main', { cls: 'page' }, [
      tiles,
      h('div', { cls: `grid ${model.lanes.length > 1 || run.total ? 'g-8-4' : ''}`, style: 'margin-top:14px' }, [
        triagePanel(model, run),
        run.lanes.length > 1 ? lanesPanel(model, run) : run.total ? slowestPanel(run) : null,
      ]),
      ...trendSection,
      ...analysisSection,
      ...stabilitySection,
      ...acrossSection,
    ]),
    footer(ui),
  ];
}

function searchBox(ui: Ui, placeholder: string, value: string, set: (text: string) => void): HTMLElement {
  return h('label', { cls: 'search' }, [
    icon('search'),
    h('input', {
      type: 'search',
      id: 'q',
      placeholder,
      'aria-label': placeholder,
      value,
      oninput: (event: Event) => {
        const input = event.target as HTMLInputElement;
        const position = input.selectionStart ?? input.value.length;
        set(input.value);
        ui.rerender();
        // The list below it was rebuilt, and the box with it; typing carries on where it was.
        const next = document.getElementById('q') as HTMLInputElement | null;
        next?.focus();
        next?.setSelectionRange(position, position);
      },
    }),
  ]);
}

const whatRan = (run: Run): string => (run.narrowedTo ? `Narrowed to ${run.narrowedTo}` : 'The whole suite, as a trial run');

function attemptsPanel(model: Model): HTMLElement {
  const rows = [...model.debugRuns].reverse().map((run) =>
    h('tr', { cls: 'is-link', onclick: () => openRun(run) }, [
      h('td', {}, [h('a', { cls: 'link', href: runHash(run), text: `#${run.n}`, onclick: (event: Event) => event.stopPropagation() })]),
      h('td', { text: fmtDateTime(run.at), style: 'white-space:nowrap' }),
      h('td', { text: run.narrowedTo || 'The whole suite' }),
      h('td', { text: laneNames(model, run.lanes) }),
      h('td', {}, [run.total ? resultBar(run) : h('span', { cls: 't-fail', text: 'Could not start' })]),
      h('td', {
        cls: `num${run.failed ? ' t-fail' : run.total ? ' t-pass' : ''}`,
        style: 'font-weight:600',
        text: run.total ? `${run.passed} of ${run.total}` : '-',
      }),
      h('td', { cls: 'num', text: fmtTime(run.ms), style: 'white-space:nowrap' }),
    ]),
  );
  return h('div', { cls: 'panel' }, [
    h('div', { cls: 'table-wrap' }, [
      h('table', {}, [
        h('thead', {}, [
          h('tr', {}, [
            ...['Attempt', 'Started', 'Ran', 'Lane', 'Results'].map((text) => h('th', { text })),
            ...['Passed', 'Time'].map((text) => h('th', { cls: 'num', text })),
          ]),
        ]),
        h('tbody', {}, rows),
      ]),
    ]),
  ]);
}

/** One mark, by shape as well as colour, so a row reads without relying on red and green. */
function gridCell(result: Result | undefined): HTMLElement {
  if (!result) return h('td', { cls: 'cell is-none', title: 'Not in this attempt', text: '-' });
  const name = result.status === 'failed' ? 'x' : result.status === 'passed' ? 'check' : 'minus';
  const tone = result.status === 'failed' ? 't-fail' : result.status === 'passed' ? 't-pass' : 't-mute';
  return h(
    'td',
    {
      cls: 'cell',
      'data-tip': `${result.status[0]!.toUpperCase()}${result.status.slice(1)}${result.error ? `. ${result.error.split('\n')[0]!}` : ''}`,
    },
    [h('a', { href: resultHash(result), 'aria-label': result.status }, [icon(name, tone)])],
  );
}

function gridPanel(model: Model): HTMLElement | null {
  const { rows, alwaysPassed } = attemptGrid(model);
  if (!rows.length && !alwaysPassed) return null;
  const showLane = model.lanes.length > 1;
  return h('div', { cls: 'panel attempt-grid' }, [
    rows.length
      ? h('div', { cls: 'table-wrap' }, [
          h('table', {}, [
            h('thead', {}, [
              h('tr', {}, [
                h('th', { text: 'Test' }),
                showLane ? h('th', { text: 'Lane' }) : null,
                h('th', { cls: 'cell', text: 'Last full run' }),
                ...model.debugRuns.map((run) =>
                  h('th', { cls: 'cell' }, [h('a', { href: runHash(run), title: run.narrowedTo || 'The whole suite', text: `#${run.n}` })]),
                ),
              ]),
            ]),
            h(
              'tbody',
              {},
              rows.map((row) =>
                h('tr', {}, [
                  h('td', { cls: 'grid-name', text: row.name }),
                  showLane ? h('td', { text: laneOf(model, row.lane).short }) : null,
                  gridCell(row.lastFull),
                  ...row.cells.map(gridCell),
                ]),
              ),
            ),
          ]),
        ])
      : null,
    alwaysPassed
      ? h('p', {
          cls: 'grid-note',
          text: `${plural(alwaysPassed, 'more test')} passed in every attempt that ran ${alwaysPassed === 1 ? 'it' : 'them'}.`,
        })
      : null,
  ]);
}

function attemptsSection(model: Model): HTMLElement {
  const grid = gridPanel(model);
  return h('div', {}, [
    grid ? sectionHead('test by test', 'What each attempt did to each test') : null,
    grid,
    sectionHead('your attempts', 'Newest first, up to 10'),
    attemptsPanel(model),
  ]);
}

export function viewDebugRuns(ui: Ui): Node[] {
  const { model } = ui;
  return [
    chrome(ui, 'debug'),
    h('main', { cls: 'page is-plain' }, [
      h('div', { cls: 'title-row' }, [
        h('div', {}, [
          h('h1', { text: 'trial runs' }),
          h('p', { cls: 'sub', text: `Your last ${plural(model.debugRuns.length, 'attempt')}, kept apart from the project's history` }),
        ]),
      ]),
      gridPanel(model),
      h('div', { style: 'height:14px' }),
      attemptsPanel(model),
    ]),
    footer(ui),
  ];
}

export function viewRuns(ui: Ui): Node[] {
  const { model } = ui;
  const query = ui.runsQuery.toLowerCase();
  const list = [...model.runs]
    .reverse()
    .filter((run) => ui.runFilter === 'all' || run.failed > 0 || run.notStarted > 0)
    .filter(
      (run) =>
        !query ||
        `${run.n} ${run.commit ?? ''} ${run.trigger} ${run.branch ?? ''} ${run.narrowedTo} ${[...new Set(run.results.flatMap((result) => result.tags))].join(' ')}`
          .toLowerCase()
          .includes(query),
    );
  const rows = list.slice(0, 60).map((run) => {
    const changes = changesOf(run);
    return h('tr', { cls: 'is-link', onclick: () => openRun(run) }, [
      h('td', {}, [
        h('a', { cls: 'link', href: `#/runs/${run.n}`, text: `#${run.n}`, onclick: (event: Event) => event.stopPropagation() }),
      ]),
      h('td', { text: fmtDateTime(run.at), style: 'white-space:nowrap' }),
      h('td', { text: run.trigger }),
      h('td', { cls: 'mono', text: [run.branch, shortSha(run.commit)].filter(Boolean).join(' @ ') || '-' }),
      h('td', {}, [run.total ? resultBar(run) : h('span', { cls: 't-fail', text: 'Could not start' })]),
      h('td', { cls: `num${run.failed ? ' t-fail' : ''}`, style: 'font-weight:600', text: rateOf(run) }),
      h('td', { cls: 'num', text: `${run.passed} of ${run.total}` }),
      h('td', { cls: 'num', text: changes.fresh.length }),
      h('td', { cls: 'num', text: changes.fixed.length }),
      h('td', { cls: 'num', text: fmtTime(run.ms), style: 'white-space:nowrap' }),
    ]);
  });
  const segment = h(
    'div',
    { cls: 'seg', role: 'group', 'aria-label': 'Filter runs' },
    (
      [
        ['all', 'All'],
        ['failed', 'With failures'],
      ] as const
    ).map(([key, label]) =>
      h('button', {
        cls: ui.runFilter === key ? 'is-on' : '',
        text: label,
        onclick: () => {
          ui.runFilter = key;
          ui.rerender();
        },
      }),
    ),
  );
  return [
    chrome(ui, 'runs'),
    h('main', { cls: 'page is-plain' }, [
      h('div', { cls: 'title-row' }, [
        h('div', {}, [h('h1', { text: 'runs' }), h('p', { cls: 'sub', text: `${plural(model.runs.length, 'run')} in this report` })]),
      ]),
      h('div', { cls: 'controls' }, [
        segment,
        searchBox(ui, 'Run, commit, branch or tag', ui.runsQuery, (text) => {
          ui.runsQuery = text;
        }),
      ]),
      h('div', { cls: 'panel' }, [
        h('div', { cls: 'table-wrap' }, [
          rows.length
            ? h('table', {}, [
                h('thead', {}, [
                  h('tr', {}, [
                    ...['Run', 'Started', 'Trigger', 'Commit', 'Results'].map((text) => h('th', { text })),
                    ...['Pass rate', 'Passed', 'New', 'Fixed', 'Time'].map((text) => h('th', { cls: 'num', text })),
                  ]),
                ]),
                h('tbody', {}, rows),
              ])
            : h('p', {
                cls: 'empty',
                text: query
                  ? `No run matches "${ui.runsQuery}". Clear the search to see all ${model.runs.length}.`
                  : 'No run matches this filter.',
              }),
        ]),
      ]),
      list.length > 60 ? h('p', { cls: 'note', text: `Showing the newest 60 of ${list.length}.` }) : null,
    ]),
    footer(ui),
  ];
}

export function viewRun(ui: Ui, id: string, isDebugRun = false): Node[] {
  const { model } = ui;
  const sequence = isDebugRun ? model.debugRuns : model.runs;
  const index = sequence.findIndex((candidate) => candidate.n === Number(id));
  const run = sequence[index];
  if (!run) return viewMissing(ui, `Run #${id} is not in this report.`, '#/runs', 'See all runs');
  const changes = changesOf(run);
  const arrow = (target: Run | undefined, name: 'left' | 'right', label: string) =>
    target
      ? h('a', { cls: 'btn', href: runHash(target), 'aria-label': label }, [icon(name)])
      : h('button', { cls: 'btn', disabled: 'disabled', 'aria-label': label }, [icon(name)]);
  // A pass on a retry is in run.cats and did not fail, so this panel counts only what did.
  const failedIn = (key: CategoryKey) => run.results.filter((result) => result.status === 'failed' && result.category === key).length;
  const used = CATEGORY_ORDER.filter((key) => failedIn(key));
  const causes = clustersOf([run]);
  const why = run.failed
    ? panel('Why it failed', `${plural(run.failed, 'failure')}, ${plural(causes.length, 'cause')}`, [
        h(
          'div',
          { cls: 'track', style: 'height:10px;margin-top:0' },
          used.map((key) =>
            h('i', {
              style: `width:${(failedIn(key) / run.failed) * 100}%;background:${CATEGORY_COLOR[key]}`,
              'data-tip': `${CATEGORIES[key].label}: ${failedIn(key)}`,
            }),
          ),
        ),
        h(
          'div',
          { cls: 'legend', style: 'justify-content:flex-start;margin-top:9px' },
          used.map((key) =>
            h('span', {}, [h('i', { cls: 'sw', style: `background:${CATEGORY_COLOR[key]}` }), `${CATEGORIES[key].label} ${failedIn(key)}`]),
          ),
        ),
      ])
    : null;
  const count = (key: Ui['runStatus']) => run.results.filter((result) => key === 'all' || result.status === key).length;
  // A run with no failures opens on everything, or the page would greet it with an empty table.
  const status = ui.runStatus === 'failed' && !run.failed ? 'all' : ui.runStatus;
  const query = ui.runQuery.toLowerCase();
  const list = run.results
    .filter((result) => (status === 'all' || result.status === status) && (ui.runLane === 'all' || result.lane === ui.runLane))
    .filter(
      (result) => !query || `${result.name} ${result.group} ${result.tags.join(' ')} ${result.error ?? ''}`.toLowerCase().includes(query),
    )
    .sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'));
  const statusSeg = h(
    'div',
    { cls: 'seg' },
    (
      [
        ['all', 'All'],
        ['failed', 'Failing'],
        ['passed', 'Passed'],
        ['skipped', 'Skipped'],
      ] as const
    ).map(([key, label]) =>
      h('button', {
        cls: status === key ? 'is-on' : '',
        text: `${label} ${count(key)}`,
        onclick: () => {
          ui.runStatus = key;
          ui.rerender();
        },
      }),
    ),
  );
  const laneSeg =
    run.lanes.length > 1
      ? h(
          'div',
          { cls: 'seg' },
          [['all', 'All lanes'] as const, ...run.lanes.map((lane) => [lane, laneOf(model, lane).short] as const)].map(([key, label]) =>
            h('button', {
              cls: ui.runLane === key ? 'is-on' : '',
              text: label,
              onclick: () => {
                ui.runLane = key;
                ui.rerender();
              },
            }),
          ),
        )
      : null;
  const rows = list.map((result) =>
    h('tr', { cls: 'is-link', onclick: () => go(resultHash(result)) }, [
      h('td', { style: 'width:96px' }, [badge(result.status)]),
      h('td', {}, [
        h('div', { cls: 't', text: result.name }),
        result.error
          ? h('div', { cls: 'fail-text', text: result.error.split('\n')[0] ?? '' })
          : result.group
            ? h('div', { cls: 's', text: result.group })
            : null,
      ]),
      run.lanes.length > 1 ? h('td', { text: laneOf(model, result.lane).short, style: 'width:90px' }) : null,
      h('td', { style: 'width:150px' }, result.category ? [catLabel(result.category)] : []),
      h('td', { cls: 'num', text: result.status === 'skipped' ? '-' : fmtTime(result.ms), style: 'width:80px' }),
    ]),
  );
  return [
    chrome(ui, isDebugRun ? 'debug' : 'runs'),
    h('main', { cls: 'page is-plain' }, [
      h('a', { cls: 'crumb', href: isDebugRun ? '#/debug' : '#/runs' }, [icon('left'), isDebugRun ? 'All trial runs' : 'All runs']),
      h('div', { cls: 'title-row' }, [
        h('div', {}, [
          h('h1', { text: `${isDebugRun ? 'trial run' : 'run'} #${run.n}` }),
          h('p', { cls: 'sub' }, [
            runLine(model, run),
            isDebugRun ? `. ${whatRan(run)}` : null,
            run.url ? ' ' : null,
            run.url ? h('a', { cls: 'link', href: run.url, target: '_blank', rel: 'noopener', text: 'Open in CI' }) : null,
          ]),
        ]),
        h('div', { style: 'display:flex;gap:8px' }, [
          arrow(sequence[index - 1], 'left', 'Earlier run'),
          arrow(sequence[index + 1], 'right', 'Later run'),
        ]),
      ]),
      statStrip([
        stat('Pass rate', rateOf(run), run.total ? `${run.passed} of ${run.passed + run.failed} executed` : 'nothing ran', {
          tone: run.rate < 0.9 ? 't-fail' : '',
        }),
        stat('Failed', String(run.failed), `${changes.fresh.length} new, ${changes.still.length} still failing`, {
          tone: run.failed ? 't-fail' : '',
        }),
        stat('Fixed', String(changes.fixed.length), 'failed the time before', { tone: changes.fixed.length ? 't-pass' : '' }),
        stat('Skipped', String(run.skipped), run.skipped ? model.copy.skippedFoot : 'none'),
        stat('Duration', fmtTime(run.ms), `started ${fmtDateTime(run.at)}`),
      ]),
      run.notStarted
        ? h('p', {
            cls: 'placeholder',
            text: `${plural(run.notStarted, model.copy.startUnit, model.copy.startUnits)} ${model.copy.notStarted}`,
          })
        : null,
      why ? h('div', { style: 'margin-top:14px' }, [why]) : null,
      run.total
        ? h('div', { cls: 'controls', style: 'margin-top:20px' }, [
            statusSeg,
            laneSeg,
            searchBox(ui, 'Test, tag or error', ui.runQuery, (text) => {
              ui.runQuery = text;
            }),
          ])
        : null,
      run.total
        ? h('div', { cls: 'panel' }, [
            h('div', { cls: 'table-wrap' }, [
              rows.length
                ? h('table', {}, [
                    h('thead', {}, [
                      h('tr', {}, [
                        h('th', { text: 'Status' }),
                        h('th', { text: 'Test' }),
                        run.lanes.length > 1 ? h('th', { text: 'Lane' }) : null,
                        h('th', { text: 'Cause' }),
                        h('th', { cls: 'num', text: 'Time' }),
                      ]),
                    ]),
                    h('tbody', {}, rows),
                  ])
                : h('p', { cls: 'empty', text: ui.runQuery ? `No result matches "${ui.runQuery}".` : 'No results in this filter.' }),
            ]),
          ])
        : null,
    ]),
    footer(ui),
  ];
}

export function viewTests(ui: Ui): Node[] {
  const { model } = ui;
  const newest = model.runs.at(-1)!;
  const query = ui.testsQuery.toLowerCase();
  const list = model.tests.filter((test) => !query || `${test.name} ${test.group} ${test.tags.join(' ')}`.toLowerCase().includes(query));
  const rows = list.map((test) => {
    const results = test.lanes.flatMap((lane) => test.history[lane] ?? []).filter((result) => result.status !== 'skipped');
    const rate = results.filter((result) => result.status === 'passed').length / Math.max(1, results.length);
    const isFailing = test.lanes.some((lane) => test.history[lane]?.at(-1)?.status === 'failed');
    const times = results
      .filter((result) => result.status === 'passed')
      .slice(-14)
      .map((result) => result.ms);
    return h('tr', { cls: 'is-link', onclick: () => go(testHash(test.id)) }, [
      h('td', { style: 'width:96px' }, [badge(isFailing ? 'failed' : 'passed')]),
      h('td', {}, [
        h('a', { cls: 't', href: testHash(test.id), text: test.name, onclick: (event: Event) => event.stopPropagation() }),
        h('div', { cls: 's', text: [test.group, test.tags.join(' ')].filter(Boolean).join(', ') }),
      ]),
      h('td', { text: laneNames(model, test.lanes), style: 'white-space:nowrap' }),
      h('td', { style: 'width:190px' }, [strip(test.history[test.lanes[0]!] ?? [])]),
      h('td', { cls: `num${rate < 0.9 ? ' t-fail' : ''}`, style: 'font-weight:600', text: pct(rate) }),
      h('td', { cls: 'num', text: times.length ? fmtTime(median(times)) : '-' }),
      h('td', { cls: 'num', text: test.last.n === newest.n ? 'this run' : `run #${test.last.n}`, style: 'white-space:nowrap' }),
    ]);
  });
  return [
    chrome(ui, 'tests'),
    h('main', { cls: 'page is-plain' }, [
      h('div', { cls: 'title-row' }, [
        h('div', {}, [
          h('h1', { text: 'tests' }),
          h('p', {
            cls: 'sub',
            text: `${plural(model.tests.length, model.copy.test, model.copy.tests)} on ${plural(model.lanes.length, 'lane')}`,
          }),
        ]),
      ]),
      h('div', { cls: 'controls' }, [
        searchBox(ui, `Test, ${model.copy.group} or tag`, ui.testsQuery, (text) => {
          ui.testsQuery = text;
        }),
      ]),
      h('div', { cls: 'panel' }, [
        h('div', { cls: 'table-wrap' }, [
          rows.length
            ? h('table', {}, [
                h('thead', {}, [
                  h('tr', {}, [
                    h('th', { text: 'Latest' }),
                    h('th', { text: 'Test' }),
                    h('th', { text: model.lanes.length > 1 ? 'Lanes' : 'Lane' }),
                    h('th', { text: 'Last 30 results' }),
                    h('th', { cls: 'num', text: 'Pass rate' }),
                    h('th', { cls: 'num', text: 'Typical time' }),
                    h('th', { cls: 'num', text: 'Last ran' }),
                  ]),
                ]),
                h('tbody', {}, rows),
              ])
            : h('p', { cls: 'empty', text: `No test matches "${ui.testsQuery}". Clear the search to see all ${model.tests.length}.` }),
        ]),
      ]),
    ]),
    footer(ui),
  ];
}

export function viewTest(ui: Ui, id: string): Node[] {
  const { model } = ui;
  const test = model.tests.find((candidate) => candidate.id === id);
  if (!test) return viewMissing(ui, 'This test is not in this report.', '#/tests', 'See all tests');
  const executions = test.lanes.flatMap((lane) => test.history[lane] ?? []);
  const latest = test.lanes.map((lane) => test.history[lane]?.at(-1)).filter((result): result is Result => Boolean(result));
  const failing = latest.filter((result) => result.status === 'failed');
  const judged = executions.filter((result) => result.status !== 'skipped');
  const rate = judged.filter((result) => result.status === 'passed').length / Math.max(1, judged.length);
  const stretch = failing.length ? failing.map(failingStretch).reduce((best, item) => (item.runs > best.runs ? item : best)) : null;
  const typical = median(executions.filter((result) => result.status === 'passed').map((result) => result.ms));
  const newest = latest.reduce((best, result) => (result.run.n > best.run.n ? result : best), latest[0]!);
  const shown = executions
    .filter((result) => ui.testLane === 'all' || result.lane === ui.testLane)
    .sort((a, b) => b.run.n - a.run.n)
    .slice(0, 20);
  const laneSeg =
    test.lanes.length > 1
      ? h(
          'div',
          { cls: 'seg' },
          [['all', 'All lanes'] as const, ...test.lanes.map((lane) => [lane, laneOf(model, lane).short] as const)].map(([key, label]) =>
            h('button', {
              cls: ui.testLane === key ? 'is-on' : '',
              text: label,
              onclick: () => {
                ui.testLane = key;
                ui.rerender();
              },
            }),
          ),
        )
      : null;
  const legend = h(
    'div',
    { cls: 'legend' },
    (
      [
        ['Passed', 'var(--pass-bar)'],
        ['Failed', 'var(--fail)'],
        ['Skipped', 'var(--skip)'],
      ] as const
    ).map(([label, color]) => h('span', {}, [h('i', { cls: 'sw', style: `background:${color}` }), label])),
  );
  return [
    chrome(ui, 'tests'),
    h('main', { cls: 'page is-plain' }, [
      h('a', { cls: 'crumb', href: '#/tests' }, [icon('left'), 'All tests']),
      h('div', { cls: 'title-row is-content' }, [
        h('div', {}, [
          h('h1', { text: test.name }),
          h('p', { cls: 'sub', text: [test.group, test.tags.join(' ')].filter(Boolean).join(', ') }),
        ]),
      ]),
      statStrip([
        stat(
          'Latest',
          failing.length ? 'Failed' : 'Passed',
          `${fmtDateTime(newest.run.at)}${
            test.lanes.length > 1
              ? `, ${
                  failing.length
                    ? `on ${laneNames(
                        model,
                        failing.map((result) => result.lane),
                      )}`
                    : `on ${plural(test.lanes.length, 'lane')}`
                }`
              : ''
          }`,
          { tone: failing.length ? 't-fail' : 't-pass' },
        ),
        stat(
          'Failing for',
          !stretch ? '-' : stretch.isCut ? `${stretch.runs}+ runs` : plural(stretch.runs, 'run'),
          !stretch ? 'not failing now' : stretch.isCut ? 'as far back as the history goes' : `since ${fmtDate(stretch.since.run.at)}`,
          { tone: failing.length ? 't-fail' : '' },
        ),
        stat('Pass rate', pct(rate), `over ${plural(judged.length, 'result')}`),
        stat('Typical time', typical ? fmtTime(typical) : '-', 'median of passing results'),
        stat(
          'Known since',
          fmtDate(test.firstSeen),
          `${plural(new Set(executions.map((result) => result.run.n)).size, 'run')} in this report`,
        ),
      ]),
      h('div', { style: 'margin-top:14px' }, [
        panel(
          test.lanes.length > 1 ? 'History on each lane' : 'History',
          'Bar height is how long it took, colour is the result. Click a bar to open it.',
          test.lanes.map((lane) =>
            h('div', { cls: 'hist-row' }, [
              h('b', { style: 'font-weight:600', text: laneOf(model, lane).short }),
              chartBox(
                56,
                historyBars((test.history[lane] ?? []).slice(-90), laneOf(model, lane).short, (result) => go(resultHash(result))),
              ),
            ]),
          ),
          { side: legend },
        ),
      ]),
      h('div', { cls: 'controls', style: 'margin-top:20px' }, [laneSeg]),
      h('div', { cls: 'panel' }, [
        h('div', { cls: 'table-wrap' }, [
          h('table', {}, [
            h('thead', {}, [
              h('tr', {}, [
                h('th', { text: 'Started' }),
                h('th', { text: 'Run' }),
                test.lanes.length > 1 ? h('th', { text: 'Lane' }) : null,
                h('th', { text: 'Result' }),
                h('th', { text: 'Failure' }),
                h('th', { cls: 'num', text: 'Time' }),
              ]),
            ]),
            h(
              'tbody',
              {},
              shown.map((result) =>
                h('tr', { cls: 'is-link', onclick: () => go(resultHash(result)) }, [
                  h('td', { text: fmtDateTime(result.run.at), style: 'white-space:nowrap' }),
                  h('td', {}, [
                    h('a', {
                      cls: 'link',
                      href: `#/runs/${result.run.n}`,
                      text: `#${result.run.n}`,
                      onclick: (event: Event) => event.stopPropagation(),
                    }),
                  ]),
                  test.lanes.length > 1 ? h('td', { text: laneOf(model, result.lane).short }) : null,
                  h('td', {}, [badge(result.status)]),
                  h(
                    'td',
                    {},
                    result.error
                      ? [
                          result.category ? catLabel(result.category) : null,
                          h('div', { cls: 'fail-text', text: result.error.split('\n')[0] ?? '' }),
                        ]
                      : [],
                  ),
                  h('td', { cls: 'num', text: result.status === 'skipped' ? '-' : fmtTime(result.ms) }),
                ]),
              ),
            ),
          ]),
        ]),
      ]),
    ]),
    footer(ui),
  ];
}

export function viewMissing(ui: Ui, message: string, href: string, label: string): Node[] {
  return [
    chrome(ui, ''),
    h('main', { cls: 'page is-plain' }, [
      h('div', { cls: 'panel' }, [h('p', { cls: 'empty' }, [`${message} `, h('a', { cls: 'link', href, text: label })])]),
    ]),
    footer(ui),
  ];
}
