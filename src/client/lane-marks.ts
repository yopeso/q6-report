// Each lane's logo, drawn in the text's colour from Bootstrap Icons in lane-marks/, and the trademark notice for the
// marks the page shows. The package README says where every file came from.
import type { Lane, LaneMark } from '../analysis.ts';
import { h, s } from './dom.ts';
import android from './lane-marks/android.svg';
import apple from './lane-marks/apple.svg';
import chrome from './lane-marks/chrome.svg';
import edge from './lane-marks/edge.svg';
import firefox from './lane-marks/firefox.svg';
import safari from './lane-marks/safari.svg';

const GOOGLE = 'Google LLC';
const APPLE = 'Apple Inc., registered in the U.S. and other countries and regions';

interface Mark {
  /** The icon's SVG markup. */
  icon: string;
  /** The trademarks a lane with this mark shows, in its name and its logo. */
  names: string[];
  owner: string;
}

// No icon set draws WebKit's own logo, so a WebKit lane takes Safari's, and its name beside it still says WebKit.
const MARKS: Record<LaneMark, Mark> = {
  chrome: { icon: chrome, names: ['Chrome'], owner: GOOGLE },
  edge: { icon: edge, names: ['Microsoft Edge'], owner: 'the Microsoft group of companies' },
  firefox: { icon: firefox, names: ['Firefox', 'the Firefox logo'], owner: 'Mozilla.org in the U.S. and other countries' },
  safari: { icon: safari, names: ['Safari'], owner: APPLE },
  webkit: { icon: safari, names: ['WebKit', 'Safari'], owner: APPLE },
  android: { icon: android, names: ['Android'], owner: GOOGLE },
  ios: { icon: apple, names: ['Apple', 'the Apple logo'], owner: APPLE },
};

/** Google's terms for the robot ask for this line, word for word, wherever it is drawn or modified. */
const ANDROID_ROBOT =
  'The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the Creative Commons 3.0 Attribution License.';

interface Shape {
  viewBox: string;
  /** Each path's outline and the fill rule that decides where it has holes, as Chrome's ring does. */
  paths: { d: string; fillRule: string | null }[];
}

/** An icon's frame and paths, read once with the page's own SVG parser; only paths are drawn, so nothing in a file can run. */
const shapes = new Map<string, Shape>();
function shapeOf(markup: string): Shape {
  const known = shapes.get(markup);
  if (known) return known;
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  const viewBox = svg.getAttribute('viewBox');
  const elements = [...svg.children];
  const paths = elements.map((path) => ({ d: path.getAttribute('d') ?? '', fillRule: path.getAttribute('fill-rule') }));
  // A shape other than a path would be left out of the drawing, so an icon holding one is refused rather than drawn in part.
  if (!viewBox || !elements.length || elements.some((element) => element.localName !== 'path') || paths.some((path) => !path.d))
    throw new Error('A lane logo has to be a viewBox and paths only');
  const shape = { viewBox, paths };
  shapes.set(markup, shape);
  return shape;
}

function drawnPaths(shape: Shape): SVGElement[] {
  return shape.paths.map(({ d, fillRule }) => s('path', fillRule ? { d, 'fill-rule': fillRule } : { d }));
}

/** The lane's logo, or nothing for a lane without one. Its name always stands beside it, so readers of the page skip it. */
export function laneMark(lane: Lane): Element | null {
  if (!lane.mark) return null;
  const shape = shapeOf(MARKS[lane.mark].icon);
  return s(
    'svg',
    { cls: 'lane-mark', viewBox: shape.viewBox, fill: 'currentColor', 'aria-hidden': 'true', 'data-mark': lane.mark },
    drawnPaths(shape),
  );
}

/** A lane's short name with its logo before it. */
export function laneTag(lane: Lane): HTMLElement {
  return h('span', { cls: 'lane-name' }, [laneMark(lane), lane.short]);
}

/** The lane's logo inside a chart, at the given box, or nothing for a lane without one. */
export function laneMarkInChart(lane: Lane, x: number, y: number, size: number): SVGElement | null {
  if (!lane.mark) return null;
  const shape = shapeOf(MARKS[lane.mark].icon);
  return s(
    'svg',
    { x, y, width: size, height: size, viewBox: shape.viewBox, fill: 'currentColor', 'data-mark': lane.mark },
    drawnPaths(shape),
  );
}

const listed = (names: string[]): string => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]!);

/** The notice for the marks these lanes show and no other, one line per owner. */
export function trademarkNotice(lanes: Lane[]): string[] {
  const drawn = new Set(lanes.map((lane) => lane.mark));
  const byOwner = new Map<string, Set<string>>();
  for (const [key, mark] of Object.entries(MARKS) as [LaneMark, Mark][]) {
    if (!drawn.has(key)) continue;
    const names = byOwner.get(mark.owner) ?? new Set<string>();
    for (const name of mark.names) names.add(name);
    byOwner.set(mark.owner, names);
  }
  const lines = [...byOwner].map(
    ([owner, names]) => `${listed([...names])} ${names.size > 1 ? 'are trademarks' : 'is a trademark'} of ${owner}.`,
  );
  return drawn.has('android') ? [...lines, ANDROID_ROBOT] : lines;
}
