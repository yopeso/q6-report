import { buildModel } from '../analysis.ts';
import { accentCss } from '../brand.ts';
import type { ReportData } from '../model.ts';
import { drawCharts } from './charts.ts';
import { h, hideTip, moveTip, showTip } from './dom.ts';
import font from './Archivo.woff2';
import { renderSheet } from './sheet.ts';
import styles from './styles.css';
import { currentPath, go, type Ui, viewDebugRuns, viewMissing, viewOverview, viewRun, viewRuns, viewTest, viewTests } from './views.ts';

const THEME_KEY = 'report-theme';

function readTheme(): string {
  try {
    return localStorage.getItem(THEME_KEY) ?? 'light';
  } catch {
    // A page opened from a file can have its storage blocked, and then simply starts light.
    return 'light';
  }
}

async function readData(): Promise<ReportData> {
  const base64 = document.getElementById('report-data')?.textContent;
  if (!base64) throw new Error('This report holds no data');
  const bytes = Uint8Array.from(atob(base64.trim()), (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as ReportData;
}

async function boot(): Promise<void> {
  const model = buildModel(await readData());
  const app = document.getElementById('app');
  if (!app) throw new Error('This report has no place to draw');

  document.documentElement.dataset.theme = readTheme();
  const { accent, favicon } = model.brand;
  document.head.append(
    h('style', {
      text: `@font-face{font-family:"Archivo";src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:100 900;font-stretch:62% 125%;font-display:swap}\n${styles}\n${accentCss(accent)}`,
    }),
  );
  if (favicon) document.head.append(h('link', { rel: 'icon', type: favicon.type, href: `data:${favicon.type};base64,${favicon.base64}` }));
  document.body.append(
    h('div', { cls: 'tip', id: 'tip', role: 'tooltip' }),
    h('dialog', { id: 'zoom', onclick: (event: Event) => (event.currentTarget as HTMLDialogElement).close() }, [
      h('img', { id: 'zoom-img', alt: 'The screen when the step failed' }),
    ]),
  );

  const ui: Ui = {
    model,
    period: 0,
    runFilter: 'all',
    runsQuery: '',
    runStatus: 'failed',
    runLane: 'all',
    runQuery: '',
    testsQuery: '',
    testLane: 'all',
    rerender: () => render(),
    toggleTheme: () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // The choice then lasts this page only.
      }
      render();
    },
    isDark: () => document.documentElement.dataset.theme === 'dark',
  };

  function route(): Node[] {
    const path = currentPath();
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'debug' && parts[1]) return viewRun(ui, parts[1], true);
    if (parts[0] === 'debug' && model.isDebug) return viewDebugRuns(ui);
    if (model.isDebug && (parts[0] === 'runs' || parts[0] === 'tests')) {
      return model.mainReport
        ? viewMissing(
            ui,
            "Full runs are in the project's report.",
            `./${encodeURIComponent(model.mainReport)}`,
            'Open the report of full runs',
          )
        : viewMissing(ui, 'This project has no full run yet.', '#/', 'Back to the trial run');
    }
    if (parts[0] === 'runs' && parts[1]) return viewRun(ui, parts[1]);
    if (parts[0] === 'runs') return viewRuns(ui);
    if (parts[0] === 'tests' && parts[1]) return viewTest(ui, decodeURIComponent(parts[1]));
    if (parts[0] === 'tests') return viewTests(ui);
    if (!parts.length) return viewOverview(ui);
    return viewMissing(ui, 'There is no such page in this report.', '#/', 'Back to the overview');
  }

  let lastPath: string | null = null;
  function render(): void {
    const y = window.scrollY;
    const isSamePage = lastPath === currentPath();
    hideTip();
    app!.replaceChildren(...route());
    drawCharts();
    window.scrollTo(0, isSamePage ? y : 0);
    lastPath = currentPath();
  }

  document.addEventListener('mouseover', (event) => {
    const element = (event.target as Element).closest?.<HTMLElement>('[data-tip]');
    if (!element?.dataset.tip) return;
    showTip(h('div', { text: element.dataset.tip }), event);
    element.addEventListener('mouseleave', hideTip, { once: true });
  });
  document.addEventListener('mousemove', (event) => {
    if (document.getElementById('tip')?.style.display === 'block') moveTip(event);
  });
  document.addEventListener('keydown', (event) => {
    const zoom = document.getElementById('zoom') as HTMLDialogElement;
    if (event.key === 'Escape' && document.getElementById('sheet-root') && !zoom.open) go(`#${currentPath()}`);
  });
  window.addEventListener('hashchange', () => {
    if (currentPath() !== lastPath) render();
    renderSheet(model);
  });
  let resizeTimer: ReturnType<typeof setTimeout>;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });

  render();
  renderSheet(model);
  // Chart labels are measured against the bundled font, so they redraw once it has loaded.
  void document.fonts?.ready.then(render);
}

boot().catch((error: unknown) => {
  // Nothing else can speak by now: the page drew nothing, and DecompressionStream is what an old browser lacks.
  const app = document.getElementById('app');
  if (app) app.textContent = `This report could not open, and needs Chrome 80, Firefox 113 or Safari 16.4 or newer. ${String(error)}`;
});
