import type { Brand } from './brand.ts';
import type { Copy } from './copy.ts';

// What a run records. One RunRecord is one line of a project's history.jsonl.gz, so a field added here is read
// back from every older line that lacks it: new fields stay optional, and a change of meaning raises HISTORY_VERSION.
export const HISTORY_VERSION = 2;

export type ResultStatus = 'passed' | 'failed' | 'skipped';
export type StepStatus = 'passed' | 'failed' | 'notRun';
/** What the error object says went wrong, read by the recorder from its type and code rather than from its wording. */
export const FAILURE_KINDS = ['check', 'error', 'timeout', 'env', 'missing'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];
export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface StepRecord {
  keyword: string;
  text: string;
  status: StepStatus;
  ms: number;
}

export interface ImageRecord {
  /** A path under the project's history folder, or under the run's folder until the run is finished. */
  path: string;
  type: ImageType;
}

/** A file a test attached, e.g: a video or a log, which the page links to, and also shows when it is short text. */
export interface Attachment {
  name: string;
  /** Where the recorder put it, inside the folder its results are in. */
  path: string;
  /** Which attempt attached it, on a test that ran more than once, as a pass on a retry is told by its failed attempt's files. */
  attempt?: number;
  /** Its path under the attachments folder beside the page, once the run is recorded; unset on a run recorded before this existed. */
  stored?: string;
}

export interface ResultRecord {
  /** Stays the same between runs, and is how a result finds its own history. */
  test: string;
  name: string;
  /** A describe, a class or a feature; empty when the test has none. */
  group: string;
  /** Not every framework has one. */
  file?: string;
  /** Where it failed, as file:line. */
  at?: string;
  tags: string[];
  status: ResultStatus;
  ms: number;
  /** Index into steps of the step that failed; unset when it failed outside any step, e.g: in a hook or between steps. */
  failedAt?: number;
  /** The error's message, without its stack. */
  error?: string;
  stack?: string;
  kind?: FailureKind;
  /** How many times it ran; a pass on a retry counts as flaky in that run. */
  attempts?: number;
  /** The bug a person marked this test with, in whichever way its framework marks one. */
  knownBug?: string;
  image?: ImageRecord;
  attachments?: Attachment[];
  /** A shell command that runs this test again. */
  rerun?: string;
  /** What else that command runs: the tag it selects by, or empty for the whole lane. Unset when it runs only this test. */
  rerunScope?: string;
  steps: StepRecord[];
  /** When this test first ran on this lane, kept on every result because the run it first ran in falls out of the history. */
  firstSeen?: string;
}

export interface RunRecord {
  v: number;
  id: string;
  /** The number a person sees, shared by a batch's lanes; it carries on once older runs fall out of the history. */
  runNumber: number;
  /** Runs sharing a batch are one run of the report, e.g: every lane of one pipeline. */
  batch: string;
  project: string;
  /** One place a suite runs, e.g: Chrome or iOS. */
  lane: string;
  laneLabel: string;
  /** The lane's name where space is short; the lane's own name is used without it. */
  laneShort?: string;
  /** What a debug run was narrowed to, in the words it was typed; empty when it ran the whole suite as a debug run. */
  narrowedTo?: string;
  /** False when someone narrowed the run to a tag or a file, which trends leave out. */
  isFull: boolean;
  startedAt: string;
  finishedAt: string;
  commit?: string;
  branch?: string;
  trigger: string;
  url?: string;
  /** Files of tests that failed before any test in them began, e.g: a session that could not start. */
  notStarted: number;
  results: ResultRecord[];
}

export interface ReportData {
  project: string;
  /** Every project with a report beside this one, by its folder name, for the project menu. */
  projects: string[];
  records: RunRecord[];
  /** The newest narrowed runs, on the debug page only; full runs never read them. */
  debugRecords?: RunRecord[];
  /** Base64 images by the path a result's image names. */
  shots: Record<string, string>;
  /** How many of the newest runs keep their screenshots in this file. */
  shotRuns: number;
  /** How many of the newest debug runs keep theirs. */
  debugShotRuns?: number;
  /** Short text attachments by their stored path, read on the page even when it travels without its attachments folder. */
  texts?: Record<string, string>;
  /** Set on the debug page: its newest run was narrowed, and is on this page only. */
  isDebug?: boolean;
  /** The file name of the project's report of full runs, beside a debug page, when it has one. */
  mainReport?: string;
  /** The file name of the project's page of trial runs, beside its report, when it has one. */
  trialReport?: string;
  brand?: Partial<Brand>;
  copy?: Partial<Copy>;
}

/** A name from a suite, as one folder or file name that stays where it is put. */
export function safeFolderName(name: string): string {
  const safe = name.replace(/[^\w.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  if (!safe) throw new Error(`"${name}" cannot name a folder, because it has no letter or digit. Give it a name that has one.`);
  return safe;
}

/** The folder beside a project's pages that holds its attachments, which its report and its debug page both link to. */
export const attachmentsFolderOf = (project: string): string => `${safeFolderName(project)}-attachments`;
