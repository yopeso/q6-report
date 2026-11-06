import { laneRate, type Lane, median, type Result, type Run } from '../analysis.ts';
import { h, hideTip, s, showTip, tipRows, type TipRow } from './dom.ts';
import { fmtDate, fmtTime, pct } from './format.ts';

export interface Axis {
  top: number;
  ticks: number[];
}

/** Whole-number ticks that end at or just above the data, so a chart never leaves its top half empty. */
export function axis(max: number): Axis {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const rough = max / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const ratio = rough / power;
  const step = Math.max(1, Math.ceil((ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 2.5 ? 2.5 : ratio <= 5 ? 5 : 10) * power));
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return { top, ticks };
}

type Draw = (width: number, height: number) => SVGElement;
const pending: (() => void)[] = [];

/** A chart measures the space it was given, which it only has once the page holds it. */
export function chartBox(height: number, draw: Draw): HTMLElement {
  const box = h('div', { cls: 'chart', style: `height:${height}px` });
  pending.push(() => box.replaceChildren(draw(Math.max(120, box.clientWidth), height)));
  return box;
}

export function drawCharts(): void {
  pending.splice(0).forEach((draw) => draw());
}

export function sparkline(values: number[], width = 58, height = 18): SVGElement | null {
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const points = values.map(
    (value, i) => [(i / (values.length - 1)) * (width - 3) + 1, height - 2 - ((value - low) / span) * (height - 4)] as const,
  );
  const last = points.at(-1)!;
  return s('svg', { cls: 'spark', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' }, [
    s('path', { d: `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}` }),
    s('circle', { cx: last[0], cy: last[1], r: 2 }),
  ]);
}

/** A strip of a test's newest results on one lane: a tall red bar is a failure, and the oldest slots stay empty until it has that many. */
export function strip(results: Result[], slots = 30): HTMLElement {
  const shown = results.slice(-slots);
  const empty = Array.from({ length: slots - shown.length }, () => h('i', { cls: 'is-none' }));
  const cells = shown.map((result) =>
    h('i', {
      cls: `is-${result.status}`,
      'data-tip': `${result.run.isDebug ? 'Attempt' : 'Run'} #${result.run.n}, ${fmtDate(result.run.at)}: ${result.status}${result.error ? `. ${result.error.split('\n')[0]!}` : ''}`,
    }),
  );
  return h('div', { cls: 'strip', 'aria-hidden': 'true' }, [...empty, ...cells]);
}

/** Under an axis of runs from one or two days, a date repeats and says nothing, so the run's number takes its place. */
function axisLabel(run: Run, runs: Run[]): string {
  const span = (runs.at(-1)?.at ?? 0) - (runs[0]?.at ?? 0);
  return span < 2 * 86400000 ? `#${run.n}` : fmtDate(run.at);
}

interface XAxis {
  every: number;
  step: number;
  width: number;
}

function dateLabels(group: SVGElement, runs: Run[], x: XAxis, y: number): void {
  runs.forEach((run, i) => {
    const isLast = i === runs.length - 1;
    if ((i % x.every === 0 && runs.length - 1 - i >= x.every) || isLast) {
      group.append(
        s('text', {
          x: isLast ? x.width : i * x.step + x.step / 2,
          y,
          'text-anchor': isLast ? 'end' : 'middle',
          text: axisLabel(run, runs),
        }),
      );
    }
  });
}

export interface Series {
  key: string;
  label: string;
  color: string;
}

export interface BarOptions {
  label: string;
  value: (run: Run, key: string) => number;
  tip: (run: Run) => { title: string; rows: TipRow[] };
  open: (run: Run) => void;
}

/** One stacked bar per run, at the same x position in every chart that draws these runs. */
export function stackedBars(runs: Run[], series: Series[], options: BarOptions): Draw {
  return (width, height) => {
    const margin = { top: 8, right: 6, bottom: 22, left: 38 };
    const innerWidth_ = width - margin.left - margin.right;
    const innerHeight_ = height - margin.top - margin.bottom;
    const { top, ticks } = axis(Math.max(1, ...runs.map((run) => series.reduce((sum, item) => sum + options.value(run, item.key), 0))));
    const y = (value: number) => innerHeight_ - (value / top) * innerHeight_;
    const step = innerWidth_ / Math.max(1, runs.length);
    const barWidth = Math.max(1.5, Math.min(step - 1.5, 26));
    const group = s('g', { transform: `translate(${margin.left},${margin.top})` });
    ticks.forEach((value) => {
      group.append(
        s('line', { cls: value === 0 ? 'ax' : 'gl', x1: 0, x2: innerWidth_, y1: y(value), y2: y(value) }),
        s('text', { x: -8, y: y(value) + 4, 'text-anchor': 'end', text: value }),
      );
    });
    const every = Math.ceil(runs.length / Math.max(2, Math.floor(innerWidth_ / 72)));
    dateLabels(group, runs, { every, step, width: innerWidth_ }, innerHeight_ + 16);
    runs.forEach((run, i) => {
      const x = i * step + (step - barWidth) / 2;
      let stacked = 0;
      series.forEach((item) => {
        const value = options.value(run, item.key);
        if (!value) return;
        group.append(
          s('rect', {
            x,
            y: y(stacked + value),
            width: barWidth,
            height: Math.max(1, (value / top) * innerHeight_ - (stacked ? 1 : 0)),
            fill: item.color,
            rx: Math.min(1.5, barWidth / 3),
          }),
        );
        stacked += value;
      });
      group.append(
        s('rect', {
          cls: 'hit',
          x: i * step,
          y: 0,
          width: step,
          height: innerHeight_,
          onmousemove: (event: MouseEvent) => {
            const { title, rows } = options.tip(run);
            showTip(tipRows(title, rows, 'Click to open the run'), event);
          },
          onmouseleave: hideTip,
          onclick: () => {
            hideTip();
            options.open(run);
          },
        }),
      );
    });
    return s('svg', { width, height, role: 'img', 'aria-label': options.label }, [group]);
  };
}

export function durationBars(runs: Run[], lanes: Lane[], open: (run: Run) => void): Draw {
  return (width, height) => {
    const margin = { top: 8, right: 6, bottom: 22, left: 46 };
    const innerWidth_ = width - margin.left - margin.right;
    const innerHeight_ = height - margin.top - margin.bottom;
    const minutes = runs.map((run) => run.ms / 60000);
    const { top, ticks } = axis(Math.max(...minutes, 0.1));
    const y = (value: number) => innerHeight_ - (value / top) * innerHeight_;
    const step = innerWidth_ / Math.max(1, runs.length);
    const barWidth = Math.max(1.5, Math.min(step - 1.5, 26));
    const typical = median(minutes);
    const group = s('g', { transform: `translate(${margin.left},${margin.top})` });
    ticks.forEach((value) => {
      group.append(
        s('line', { cls: value === 0 ? 'ax' : 'gl', x1: 0, x2: innerWidth_, y1: y(value), y2: y(value) }),
        s('text', { x: -8, y: y(value) + 4, 'text-anchor': 'end', text: value ? `${value} min` : '0' }),
      );
    });
    const every = Math.ceil(runs.length / Math.max(2, Math.floor(innerWidth_ / 72)));
    dateLabels(group, runs, { every, step, width: innerWidth_ }, innerHeight_ + 16);
    runs.forEach((run, i) => {
      const isLast = i === runs.length - 1;
      group.append(
        s('rect', {
          x: i * step + (step - barWidth) / 2,
          y: y(minutes[i]!),
          width: barWidth,
          height: Math.max(1, innerHeight_ - y(minutes[i]!)),
          fill: isLast ? 'var(--brand)' : 'var(--c-duration)',
          opacity: isLast ? 1 : 0.78,
          rx: Math.min(1.5, barWidth / 3),
        }),
        s('rect', {
          cls: 'hit',
          x: i * step,
          y: 0,
          width: step,
          height: innerHeight_,
          onmousemove: (event: MouseEvent) =>
            showTip(
              tipRows(
                `Run #${run.n}, ${fmtDate(run.at)}`,
                [
                  ['Took', fmtTime(run.ms)],
                  ...lanes.filter((lane) => run.byLane[lane.id]).map((lane): TipRow => [lane.short, fmtTime(run.byLane[lane.id]!.ms)]),
                ],
                'Click to open the run',
              ),
              event,
            ),
          onmouseleave: hideTip,
          onclick: () => {
            hideTip();
            open(run);
          },
        }),
      );
    });
    group.append(
      s('line', {
        x1: 0,
        x2: innerWidth_,
        y1: y(typical),
        y2: y(typical),
        stroke: 'var(--brand-deep)',
        'stroke-width': 1.5,
        'stroke-dasharray': '4 3',
        'pointer-events': 'none',
      }),
      s('text', {
        x: 4,
        y: y(typical) - 5,
        cls: 'endl',
        style: 'fill:var(--brand-deep)',
        'pointer-events': 'none',
        text: `Median ${fmtTime(typical * 60000)}`,
      }),
    );
    return s('svg', { width, height, role: 'img', 'aria-label': 'Run duration per run' }, [group]);
  };
}

const LANE_COLORS = ['var(--c-lane-1)', 'var(--c-lane-2)', 'var(--c-lane-3)', 'var(--c-lane-4)'];
export const laneColor = (index: number): string => LANE_COLORS[index % LANE_COLORS.length]!;

/** Pass rate per lane, smoothed over the last 7 runs. */
export function laneLines(runs: Run[], lanes: Lane[]): Draw {
  return (width, height) => {
    const margin = { top: 10, right: 92, bottom: 22, left: 38 };
    const innerWidth_ = width - margin.left - margin.right;
    const innerHeight_ = height - margin.top - margin.bottom;
    const series = lanes.map((lane, index) => ({ lane, color: laneColor(index), values: runs.map((_, i) => laneRate(lane.id, runs, i)) }));
    const lowest = Math.min(...series.flatMap((item) => item.values), 1);
    // Rounds down to a tenth, and shows at least 50% to 100% so a small dip is not drawn as a collapse.
    const low = Math.min(0.5, Math.max(0, Math.floor(lowest * 10 - 0.5) / 10));
    const x = (i: number) => (i / Math.max(1, runs.length - 1)) * innerWidth_;
    const y = (value: number) => innerHeight_ - ((value - low) / (1 - low)) * innerHeight_;
    const group = s('g', { transform: `translate(${margin.left},${margin.top})` });
    [0, 0.5, 1].forEach((fraction) => {
      const value = low + (1 - low) * fraction;
      group.append(
        s('line', { cls: fraction === 0 ? 'ax' : 'gl', x1: 0, x2: innerWidth_, y1: y(value), y2: y(value) }),
        s('text', { x: -8, y: y(value) + 4, 'text-anchor': 'end', text: pct(value) }),
      );
    });
    const every = Math.ceil(runs.length / Math.max(2, Math.floor(innerWidth_ / 72)));
    runs.forEach((run, i) => {
      const isLast = i === runs.length - 1;
      if ((i % every === 0 && runs.length - 1 - i >= every) || isLast)
        group.append(s('text', { x: x(i), y: innerHeight_ + 16, 'text-anchor': isLast ? 'end' : 'middle', text: axisLabel(run, runs) }));
    });
    series.forEach((item) => {
      group.append(
        s('path', {
          d: `M${item.values.map((value, i) => `${x(i).toFixed(1)} ${y(value).toFixed(1)}`).join('L')}`,
          fill: 'none',
          stroke: item.color,
          'stroke-width': 2,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        }),
      );
    });
    const ends = series
      .map((item) => ({ label: item.lane.short, value: item.values.at(-1) ?? 1, y: y(item.values.at(-1) ?? 1) }))
      .sort((a, b) => a.y - b.y);
    ends.forEach((end, i) => {
      if (i && end.y - ends[i - 1]!.y < 15) end.y = ends[i - 1]!.y + 15;
      group.append(s('text', { cls: 'endl', x: innerWidth_ + 8, y: end.y + 4, text: `${end.label} ${pct(end.value)}` }));
    });
    const cursor = s('line', { y1: 0, y2: innerHeight_, stroke: 'var(--ink4)', 'stroke-width': 1, opacity: 0 });
    group.append(
      cursor,
      s('rect', {
        cls: 'hit',
        style: 'cursor:crosshair',
        x: 0,
        y: 0,
        width: innerWidth_,
        height: innerHeight_,
        onmousemove: (event: MouseEvent) => {
          const box = (event.currentTarget as Element).getBoundingClientRect();
          const i = Math.min(runs.length - 1, Math.max(0, Math.round(((event.clientX - box.left) / box.width) * (runs.length - 1))));
          cursor.setAttribute('x1', String(x(i)));
          cursor.setAttribute('x2', String(x(i)));
          cursor.setAttribute('opacity', '1');
          showTip(
            tipRows(
              `Run #${runs[i]!.n}, ${fmtDate(runs[i]!.at)}`,
              series.map((item): TipRow => [item.lane.short, pct(item.values[i]!, 1), item.color]),
              'Pass rate over the 7 runs up to this one',
            ),
            event,
          );
        },
        onmouseleave: () => {
          cursor.setAttribute('opacity', '0');
          hideTip();
        },
      }),
    );
    return s('svg', { width, height, role: 'img', 'aria-label': 'Pass rate per lane' }, [group]);
  };
}

/** A test's history on one lane: bar height is how long it took, colour is the result. */
export function historyBars(results: Result[], label: string, open: (result: Result) => void): Draw {
  return (width, height) => {
    const innerHeight_ = height - 8;
    const top = Math.max(1, ...results.map((result) => result.ms));
    const step = width / Math.max(30, results.length);
    const barWidth = Math.max(1.5, Math.min(step - 1.5, 12));
    const offset = width - results.length * step;
    const group = s('g', { transform: 'translate(0,6)' });
    group.append(s('line', { cls: 'ax', x1: 0, x2: width, y1: innerHeight_, y2: innerHeight_ }));
    results.forEach((result, i) => {
      // A failure stops early, so its time alone would draw it as a dash; the bar stays readable and the tooltip has the time.
      const bar = Math.max(result.status === 'failed' ? innerHeight_ * 0.35 : 3, (result.ms / top) * innerHeight_);
      const color = result.status === 'failed' ? 'var(--fail)' : result.status === 'skipped' ? 'var(--skip)' : 'var(--pass-bar)';
      group.append(
        s('rect', {
          x: offset + i * step + (step - barWidth) / 2,
          y: innerHeight_ - bar,
          width: barWidth,
          height: bar,
          rx: 1,
          fill: color,
        }),
        s('rect', {
          cls: 'hit',
          x: offset + i * step,
          y: 0,
          width: step,
          height: innerHeight_,
          onmousemove: (event: MouseEvent) =>
            showTip(
              tipRows(
                `Run #${result.run.n}, ${fmtDate(result.run.at)}`,
                [[result.status[0]!.toUpperCase() + result.status.slice(1), result.status === 'skipped' ? '' : fmtTime(result.ms)]],
                result.error?.split('\n')[0] ?? 'Click to open this result',
              ),
              event,
            ),
          onmouseleave: hideTip,
          onclick: () => {
            hideTip();
            open(result);
          },
        }),
      );
    });
    return s('svg', { width, height, role: 'img', 'aria-label': `History on ${label}` }, [group]);
  };
}
