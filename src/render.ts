import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { buildModel, type Model, verdictOf } from './analysis.ts';
import { type Brand, checkBrand, DEFAULT_BRAND } from './brand.ts';
import { buildClient } from './build-client.ts';
import type { Copy } from './copy.ts';
import {
  attachmentsDir,
  DEBUG_SHOT_RUNS,
  listProjects,
  moveOldScreenshots,
  newestRuns,
  readAttachmentText,
  readDebugHistory,
  readHistory,
  readShot,
  SHOT_RUNS,
} from './history.ts';
import { attachmentsFolderOf, type ReportData, type RunRecord, safeFolderName } from './model.ts';

/** A cap on what screenshots add to the page, which barely compress; the newest win when failures run high. */
const MAX_SHOT_BYTES = 30 * 1024 * 1024;
/** A debug run of a whole suite can fail everywhere, and a page for one session stays far lighter than a report. */
const MAX_DEBUG_SHOT_BYTES = 5 * 1024 * 1024;
/** About a thousand lines: a longer text attachment is read from its file, as a page is no place for a whole log. */
const MAX_TEXT_BYTES = 64 * 1024;
/** A cap on what text attachments add to the page, so a suite attaching a log to every test still gets a page that opens quickly. */
const MAX_TEXTS_BYTES = 5 * 1024 * 1024;

/**
 * The full runs a debug page carries: only the tests debugged, for their history, and no screenshots. The project's
 * report has the rest, so a page about one test never weighs what the whole suite does.
 */
export function debugScope(records: RunRecord[], debugRecords: RunRecord[]): RunRecord[] {
  const tests = new Set(debugRecords.flatMap((record) => record.results.map((result) => result.test)));
  return records
    .map((record) => ({ ...record, results: record.results.filter((result) => tests.has(result.test)) }))
    .filter((record) => record.results.length);
}

/** The short text attachments of the runs given, newest first, so a cap on the page's size drops the oldest. */
function textsOf(runs: RunRecord[], readText: (stored: string) => string | undefined): Record<string, string> {
  const texts: Record<string, string> = {};
  let bytes = 0;
  runs.forEach((record) =>
    record.results.forEach((result) =>
      result.attachments?.forEach(({ stored }) => {
        if (!stored || stored in texts) return;
        const text = readText(stored);
        if (text === undefined || bytes + Buffer.byteLength(text) > MAX_TEXTS_BYTES) return;
        texts[stored] = text;
        bytes += Buffer.byteLength(text);
      }),
    ),
  );
  return texts;
}

/** The page's data, with the screenshots and short texts of the newest runs, by whole batch so one run's lanes never differ. */
export function reportData(
  records: RunRecord[],
  project: string,
  projects: string[],
  readShotFile: (shot: string) => string | undefined,
  debugRecords?: RunRecord[],
  readText: (stored: string) => string | undefined = () => undefined,
): ReportData {
  const shots: Record<string, string> = {};
  let shotBytes = 0;
  // Newest first, so a cap on the page's size drops the oldest screenshots.
  const withShots = debugRecords ? newestRuns(debugRecords, DEBUG_SHOT_RUNS).reverse() : newestRuns(records, SHOT_RUNS).reverse();
  const limit = debugRecords ? MAX_DEBUG_SHOT_BYTES : MAX_SHOT_BYTES;
  withShots.forEach((record) => {
    record.results.forEach((result) => {
      if (!result.image || shots[result.image.path]) return;
      const base64 = readShotFile(result.image.path);
      if (!base64 || shotBytes + base64.length > limit) return;
      shots[result.image.path] = base64;
      shotBytes += base64.length;
    });
  });
  const texts = textsOf(withShots, readText);
  return {
    project,
    projects,
    records,
    shots,
    shotRuns: SHOT_RUNS,
    ...(debugRecords ? { debugRecords, debugShotRuns: DEBUG_SHOT_RUNS } : {}),
    ...(Object.keys(texts).length ? { texts } : {}),
  };
}

/**
 * Mirrors the attachments the history keeps into the folder beside the page, which is what its links open. A run's
 * files never change once kept, so a run already there is left alone, and one the history no longer keeps goes.
 */
export function publishAttachments(historyDir: string, project: string, outDir: string): void {
  const source = attachmentsDir(historyDir, project);
  const target = path.join(outDir, attachmentsFolderOf(project));
  const runs = existsSync(source) ? readdirSync(source) : [];
  if (!runs.length) {
    rmSync(target, { recursive: true, force: true });
    return;
  }
  mkdirSync(target, { recursive: true });
  for (const run of readdirSync(target)) {
    if (!runs.includes(run)) rmSync(path.join(target, run), { recursive: true, force: true });
  }
  for (const run of runs) {
    if (existsSync(path.join(target, run))) continue;
    // Copied under another name and then renamed, so a copy cut short is never taken for a whole run.
    const partial = path.join(target, `.${run}.${process.pid}.tmp`);
    cpSync(path.join(source, run), partial, { recursive: true });
    renameSync(partial, path.join(target, run));
  }
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function reportHtml(data: ReportData, client: string): string {
  // The data is base64, which cannot close its script tag, and the page is built with text nodes only,
  // so a value from a run reaches it as data and never as markup. Gzip because results repeat their names and steps.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.project)} - ${escapeHtml(data.brand?.name ?? DEFAULT_BRAND.name)}</title>
</head>
<body>
<div id="app"></div>
<script id="report-data" type="text/plain">${gzipSync(JSON.stringify(data), { level: 9 }).toString('base64')}</script>
<script>${client.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
}

const percent = (value: number): string => `${Math.round(value * 100)}%`;

/** The same run as Markdown, for the summary a CI shows on its run page. */
export function reportSummary(model: Model): string {
  const run = (model.isDebug ? model.debugRuns : model.runs).at(-1);
  if (!run) throw new Error(`No run of ${model.project} to summarise`);
  const { line, small } = verdictOf(run, model.copy);
  const lines = [
    `## ${model.project}${model.isDebug ? ', trial run' : ''}: ${line}`,
    '',
    small,
    '',
    `Pass rate ${percent(run.rate)}, ${run.passed} of ${run.total}, on ${run.lanes.join(', ')}.`,
  ];
  const failures = run.results.filter((result) => result.status === 'failed');
  if (failures.length) {
    lines.push('', '| Test | Lane | Error |', '|---|---|---|');
    // A pipe or a newline in an error would split the row.
    failures.forEach((result) =>
      lines.push(
        `| ${result.name.replace(/\|/g, '\\|')} | ${result.lane} | ${(result.error ?? '').split('\n')[0]!.replace(/\|/g, '\\|')} |`,
      ),
    );
  }
  return lines.join('\n') + '\n';
}

export interface WrittenReport {
  html: string;
  json: string;
  summary: string;
  model: Model;
  bytes: number;
}

/**
 * Writes a project's page, its newest run as JSON for tools, a Markdown summary and the attachments its links open, from
 * its history. The debug page goes beside them under its own names, and leaves the project's report as it is.
 */
export async function writeReport(options: {
  historyDir: string;
  outDir: string;
  project: string;
  isDebug?: boolean;
  onSkip?: (line: number, why: string) => void;
  /** Overrides the package's own look: its name, footer, accent, logo and favicon. */
  brand?: Partial<Brand>;
  /** Overrides the words that depend on what the suite is built on. */
  copy?: Partial<Copy>;
}): Promise<WrittenReport> {
  const { historyDir, outDir, project, isDebug, brand, copy } = options;
  if (brand) checkBrand(brand);
  // Every recorded run ends here, as does pnpm report, so this is the one place a history under the old folder name moves.
  moveOldScreenshots(historyDir, project);
  const records = readHistory(historyDir, project, options.onSkip);
  const debugRecords = isDebug ? readDebugHistory(historyDir, project, options.onSkip) : undefined;
  if (!(debugRecords ?? records).length) throw new Error(`No runs of ${project} under ${historyDir}. A finished run writes them.`);
  const data = reportData(
    debugRecords ? debugScope(records, debugRecords) : records,
    project,
    listProjects(historyDir),
    (shot) => readShot(historyDir, project, shot),
    debugRecords,
    (stored) => readAttachmentText(historyDir, project, stored, MAX_TEXT_BYTES),
  );
  if (brand) data.brand = brand;
  if (copy) data.copy = copy;
  const folder = safeFolderName(project);
  const name = isDebug ? `${folder}-debug` : folder;
  if (isDebug) {
    data.isDebug = true;
    if (records.length) data.mainReport = `${folder}.html`;
  } else if (readDebugHistory(historyDir, project).length) {
    // A trial run leaves this page as it is, so the tab shows once the next full run writes it.
    data.trialReport = `${folder}-debug.html`;
  }
  const html = path.join(outDir, `${name}.html`);
  const json = path.join(outDir, `${name}.json`);
  const summary = path.join(outDir, `${name}.md`);
  mkdirSync(outDir, { recursive: true });
  // Before the page, so its links open from the moment it exists.
  publishAttachments(historyDir, project, outDir);
  writeFileSync(html, reportHtml(data, await buildClient()));
  const model = buildModel(data);
  const newest = (isDebug ? model.debugRuns : model.runs).at(-1)!;
  writeFileSync(
    json,
    JSON.stringify(
      (debugRecords ?? records).filter((record) => record.batch === newest.id),
      null,
      2,
    ) + '\n',
  );
  writeFileSync(summary, reportSummary(model));
  return { html, json, summary, model, bytes: statSync(html).size };
}

export const reportUrl = (file: string): string => pathToFileURL(path.resolve(file)).href;
