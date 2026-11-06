// Every value a run produced reaches the page through text nodes and attributes, never as markup,
// so an error holding "</script>" or "<img onerror>" is only ever text.
type Kid = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(element: Element, props: Props, kids: Kid[]): void {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') element.textContent = String(value);
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value as EventListener);
    else element.setAttribute(key === 'cls' ? 'class' : key, String(value));
  }
  for (const kid of kids) {
    if (kid !== null && kid !== undefined && kid !== false) element.append(kid instanceof Node ? kid : String(kid));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, kids: Kid[] = []): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  apply(element, props, kids);
  return element;
}

export function s(tag: string, props: Props = {}, kids: Kid[] = []): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  apply(element, props, kids);
  return element;
}

const ICONS: Record<string, string[]> = {
  check: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'm8.5 12.2 2.4 2.4 4.6-5'],
  x: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'm9 9 6 6m0-6-6 6'],
  minus: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M8.5 12h7'],
  close: ['M6 6l12 12M18 6 6 18'],
  search: ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'm20 20-4.2-4.2'],
  left: ['m14.5 6-6 6 6 6'],
  right: ['m9.5 6 6 6-6 6'],
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'],
  bug: [
    'M12 8a4 4 0 0 0-4 4v3a4 4 0 0 0 8 0v-3a4 4 0 0 0-4-4Z',
    'M12 8V5M9 5l1.5 2M15 5l-1.5 2M8 12H4m16 0h-4M8 16l-3 2m14-2-3 2M8 9 5 7m14 0-3 2',
  ],
  image: [
    'M5.5 5h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
    'M9 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z',
    'm5 18 5-5 3 3 2.5-2.5L20 18',
  ],
  chevron: ['m7 10 5 5 5-5'],
};

export function icon(name: keyof typeof ICONS, cls?: string): HTMLElement {
  const paths = (ICONS[name] ?? []).map((d) => s('path', { d }));
  return h('span', { cls, style: 'display:inline-flex' }, [s('svg', { cls: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, paths)]);
}

let tipElement: HTMLElement | undefined;

function tip(): HTMLElement {
  tipElement ??= document.getElementById('tip') ?? undefined;
  if (!tipElement) throw new Error('The page has no tooltip element');
  return tipElement;
}

export function moveTip(event: MouseEvent): void {
  const element = tip();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  let x = event.clientX + 14;
  let y = event.clientY + 14;
  if (x + width > innerWidth - 8) x = event.clientX - width - 14;
  if (y + height > innerHeight - 8) y = event.clientY - height - 14;
  element.style.left = `${Math.max(8, x)}px`;
  element.style.top = `${Math.max(8, y)}px`;
}

export function showTip(content: Node, event: MouseEvent): void {
  const element = tip();
  element.replaceChildren(content);
  element.style.display = 'block';
  moveTip(event);
}

export function hideTip(): void {
  tip().style.display = 'none';
}

export type TipRow = [label: string, value: string | number, color?: string];

export function tipRows(title: string, rows: TipRow[], hint?: string): HTMLElement {
  return h('div', {}, [
    h('b', { text: title }),
    ...rows.map(([label, value, color]) =>
      h('div', { cls: 'tr' }, [
        h('span', { cls: 'tl' }, [color ? h('i', { cls: 'sw', style: `background:${color}` }) : null, label]),
        h('span', { text: String(value) }),
      ]),
    ),
    hint ? h('div', { cls: 'hint', text: hint }) : null,
  ]);
}
