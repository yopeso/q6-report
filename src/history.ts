import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { constants as zlib, gunzipSync, gzipSync } from 'node:zlib';

import { HISTORY_VERSION, type ImageType, type RunRecord, safeFolderName } from './model.ts';

/** Two months of nightly runs, and twice the 30 results flaky detection looks at, so a test always has a before to compare with. */
export const RUN_LIMIT = 60;
/** Screenshots and attachments barely compress, so they are kept for far fewer runs than results are. */
export const SHOT_RUNS = 10;

/** Enough to look back over a debugging session; narrowed runs are small, and say nothing about the project. */
export const DEBUG_RUN_LIMIT = 10;
/** Debugging is about the attempt in front of you, and a screenshot outweighs everything else a debug run keeps. */
export const DEBUG_SHOT_RUNS = 3;

export const historyFile = (historyDir: string, project: string): string =>
  path.join(historyDir, safeFolderName(project), 'history.jsonl.gz');
export const debugHistoryFile = (historyDir: string, project: string): string =>
  path.join(historyDir, safeFolderName(project), 'debug-history.jsonl.gz');
export const screenshotsDir = (historyDir: string, project: string): string =>
  path.join(historyDir, safeFolderName(project), 'screenshots');
export const attachmentsDir = (historyDir: string, project: string): string =>
  path.join(historyDir, safeFolderName(project), 'attachments');

/**
 * Moves the screenshots of a history kept under the folder's old name, shots, into screenshots, run by run, so a history
 * restored from a CI cache keeps every one. A run already under the new name stays as it is. It can go once no kept
 * history can still have a shots folder, which is once 10 runs have been recorded since by every CI that keeps one.
 */
export function moveOldScreenshots(historyDir: string, project: string): void {
  const old = path.join(historyDir, safeFolderName(project), 'shots');
  if (!existsSync(old)) return;
  const dir = screenshotsDir(historyDir, project);
  mkdirSync(dir, { recursive: true });
  for (const run of readdirSync(old)) {
    if (!existsSync(path.join(dir, run))) renameSync(path.join(old, run), path.join(dir, run));
  }
  rmSync(old, { recursive: true, force: true });
}

/** A line cut short by a cache restored mid-write, or of a history version other than this one, costs that one run and not the whole history. */
export function parseHistory(text: string, onSkip: (line: number, why: string) => void = () => {}): RunRecord[] {
  const records: RunRecord[] = [];
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const record = JSON.parse(line) as RunRecord;
      if (record.v > HISTORY_VERSION) onSkip(index + 1, `it was written by a newer version of this report, history version ${record.v}`);
      else if (record.v !== HISTORY_VERSION)
        onSkip(index + 1, `it is history version ${String(record.v)}, which this report does not read`);
      else if (!Array.isArray(record.results) || !record.batch) onSkip(index + 1, 'it is not a run');
      else records.push(record);
    } catch {
      onSkip(index + 1, 'it is not valid JSON');
    }
  });
  return records;
}

function readRuns(file: string, onSkip?: (line: number, why: string) => void): RunRecord[] {
  if (!existsSync(file)) return [];
  try {
    // Sync flush gives back what came before a cut, so a cache restored mid-write costs its last runs and not all of them.
    return parseHistory(gunzipSync(readFileSync(file), { finishFlush: zlib.Z_SYNC_FLUSH }).toString('utf8'), onSkip);
  } catch (error) {
    throw new Error(`The history at ${file} cannot be read: ${String(error)}. Move it away and the next run starts a new one.`, {
      cause: error,
    });
  }
}

export const readHistory = (historyDir: string, project: string, onSkip?: (line: number, why: string) => void): RunRecord[] =>
  readRuns(historyFile(historyDir, project), onSkip);

export const readDebugHistory = (historyDir: string, project: string, onSkip?: (line: number, why: string) => void): RunRecord[] =>
  readRuns(debugHistoryFile(historyDir, project), onSkip);

function projectsWith(historyDir: string, fileOf: (historyDir: string, project: string) => string): string[] {
  if (!existsSync(historyDir)) return [];
  return readdirSync(historyDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(fileOf(historyDir, entry.name)))
    .map((entry) => entry.name)
    .sort();
}

/** The projects with a history of full runs, which are the ones a report page exists for. */
export const listProjects = (historyDir: string): string[] => projectsWith(historyDir, historyFile);

/** The projects with debug runs kept, including one that has never had a full run. */
export const listDebugProjects = (historyDir: string): string[] => projectsWith(historyDir, debugHistoryFile);

/** Carries each test's first-seen date forward onto a new run, so it survives the run it was first seen in. */
export function stampFirstSeen(record: RunRecord, known: RunRecord[]): void {
  const seen = new Map<string, string>();
  known.forEach((run) =>
    run.results.forEach((result) => {
      const key = `${result.test}|${run.lane}`;
      if (!seen.has(key)) seen.set(key, result.firstSeen ?? run.startedAt);
    }),
  );
  record.results.forEach((result) => {
    result.firstSeen = seen.get(`${result.test}|${record.lane}`) ?? record.startedAt;
  });
}

/** The records of the newest runs, counting a run once however many lanes it covers. */
export function newestRuns(records: RunRecord[], limit: number): RunRecord[] {
  const kept = new Set([...new Set(records.map((record) => record.batch))].slice(-limit));
  return records.filter((record) => kept.has(record.batch));
}

/**
 * Adds a run, drops what falls past RUN_LIMIT, and returns what is left. It numbers the run here because numbers have to
 * carry on once older runs are gone. The rename means a process killed mid-write leaves the previous history whole; two
 * runs of one project finishing at the same moment on one folder can still lose the earlier one's line.
 */
function addRun(file: string, record: RunRecord, known: RunRecord[], limit: number): RunRecord[] {
  record.runNumber =
    known.find((other) => other.batch === record.batch)?.runNumber ?? Math.max(0, ...known.map((other) => other.runNumber)) + 1;
  const kept = newestRuns([...known, record], limit);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, gzipSync(kept.map((run) => JSON.stringify(run)).join('\n') + '\n'));
  renameSync(temporary, file);
  return kept;
}

export function appendRun(historyDir: string, record: RunRecord, onSkip?: (line: number, why: string) => void): RunRecord[] {
  const known = readHistory(historyDir, record.project, onSkip);
  stampFirstSeen(record, known);
  return addRun(historyFile(historyDir, record.project), record, known, RUN_LIMIT);
}

/** The same for a narrowed run, in its own file with its own numbers, so it cannot touch what full runs compare against. */
export function appendDebugRun(historyDir: string, record: RunRecord, onSkip?: (line: number, why: string) => void): RunRecord[] {
  stampFirstSeen(record, readHistory(historyDir, record.project, onSkip));
  return addRun(
    debugHistoryFile(historyDir, record.project),
    record,
    readDebugHistory(historyDir, record.project, onSkip),
    DEBUG_RUN_LIMIT,
  );
}

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  // A file may be called "..shot.png", so only a whole ".." segment leaves the folder.
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/** Where a path from a record really lands, or nothing when that is outside root, through a link or otherwise. */
function resolveInside(root: string, relative: string): string | undefined {
  if (!existsSync(root)) return undefined;
  const base = realpathSync(path.resolve(root));
  const target = path.resolve(base, relative);
  if (!isWithin(base, target)) return undefined;
  if (!existsSync(target)) return target;
  const real = realpathSync(target);
  return isWithin(base, real) ? real : undefined;
}

/** What the file's own bytes say it is, as a recorder's word on it is not what the page should trust. */
export function imageTypeOf(bytes: Buffer): { type: ImageType; extension: string } | undefined {
  const starts = (text: string, offset = 0) => bytes.subarray(offset, offset + text.length).toString('latin1') === text;
  if (starts('\x89PNG\r\n\x1a\n')) return { type: 'image/png', extension: 'png' };
  if (starts('\xff\xd8\xff')) return { type: 'image/jpeg', extension: 'jpg' };
  if (starts('GIF87a') || starts('GIF89a')) return { type: 'image/gif', extension: 'gif' };
  if (starts('RIFF') && starts('WEBP', 8)) return { type: 'image/webp', extension: 'webp' };
  return undefined;
}

/**
 * Copies a run's images under its history folder and points each result at its copy. A file that is not an image the page
 * can hold, an SVG included since it can carry a script, becomes an attachment instead, and a path that leaves the run's
 * folder is dropped, so a record can never pull another file into the page.
 */
export function keepImages(record: RunRecord, historyDir: string, reportsDir: string, warn: (message: string) => void): void {
  const dir = path.join(screenshotsDir(historyDir, record.project), record.id);
  let count = 0;
  record.results.forEach((result) => {
    if (!result.image) return;
    const given = result.image.path;
    delete result.image;
    const source = resolveInside(reportsDir, given);
    if (!source) {
      warn(`Dropping the image of "${result.name}": ${given} is outside ${reportsDir}`);
      return;
    }
    if (!existsSync(source) || !statSync(source).isFile()) return;
    const found = imageTypeOf(readFileSync(source));
    if (!found) {
      warn(`The image of "${result.name}" is not PNG, JPEG, WebP or GIF, so the page lists it as an attachment: ${given}`);
      (result.attachments ??= []).push({ name: path.basename(given), path: given });
      return;
    }
    mkdirSync(dir, { recursive: true });
    const name = `${++count}.${found.extension}`;
    // A copy: the file stays where a person running one test looks for it.
    copyFileSync(source, path.join(dir, name));
    result.image = { path: `${record.id}/${name}`, type: found.type };
  });
}

// The file's own name, so a browser opening its copy knows what it is by its extension.
const storedName = (file: string): string => (/[a-z\d]/i.test(path.basename(file)) ? safeFolderName(path.basename(file)) : 'file');

/**
 * Copies a run's attachments under its history folder, as the run's own folder is gone once it is recorded, and points
 * each at its copy. One whose path leaves the run's folder is dropped, as an image is, and so is one that is not there.
 */
export function keepAttachments(record: RunRecord, historyDir: string, reportsDir: string, warn: (message: string) => void): void {
  const dir = path.join(attachmentsDir(historyDir, record.project), record.id);
  let count = 0;
  record.results.forEach((result) => {
    if (!result.attachments) return;
    const kept = result.attachments.flatMap((file) => {
      const source = resolveInside(reportsDir, file.path);
      if (!source) {
        warn(`Dropping the attachment "${file.name}" of "${result.name}": ${file.path} is outside ${reportsDir}`);
        return [];
      }
      if (!existsSync(source) || !statSync(source).isFile()) {
        warn(`Dropping the attachment "${file.name}" of "${result.name}": there is no file at ${file.path}`);
        return [];
      }
      mkdirSync(dir, { recursive: true });
      const name = `${++count}-${storedName(source)}`;
      copyFileSync(source, path.join(dir, name));
      return [{ ...file, stored: `${record.id}/${name}` }];
    });
    if (kept.length) result.attachments = kept;
    else delete result.attachments;
  });
}

/** Keeps the screenshots and attachments of the newest runs and of any run named, e.g: the debug run on its own page. */
export function pruneRunFiles(historyDir: string, project: string, records: RunRecord[], alsoKeep: string[] = []): void {
  const keep = new Set([...newestRuns(records, SHOT_RUNS).map((record) => record.id), ...alsoKeep]);
  for (const dir of [screenshotsDir(historyDir, project), attachmentsDir(historyDir, project)]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!keep.has(entry)) rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  }
}

export function readShot(historyDir: string, project: string, shot: string): string | undefined {
  const file = resolveInside(screenshotsDir(historyDir, project), shot);
  return file && existsSync(file) ? readFileSync(file).toString('base64') : undefined;
}

/** A kept attachment as text, when it is UTF-8 text of at most maxBytes; nothing for a video, an image or a long log. */
export function readAttachmentText(historyDir: string, project: string, stored: string, maxBytes: number): string | undefined {
  const file = resolveInside(attachmentsDir(historyDir, project), stored);
  if (!file || !existsSync(file) || !statSync(file).isFile() || statSync(file).size > maxBytes) return undefined;
  const bytes = readFileSync(file);
  // A zero byte is binary, or text in UTF-16, which a page shows only as noise.
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
