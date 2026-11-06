import {
  type Attachment,
  FAILURE_KINDS,
  type FailureKind,
  HISTORY_VERSION,
  type ResultRecord,
  type ResultStatus,
  type StepRecord,
  type StepStatus,
} from './model.ts';

const RESULT_STATUSES: readonly ResultStatus[] = ['passed', 'failed', 'skipped'];
const STEP_STATUSES: readonly StepStatus[] = ['passed', 'failed', 'notRun'];

export type ParsedLine = { result: ResultRecord; finishedAt?: string } | { why: string };

const isText = (value: unknown): value is string => typeof value === 'string';
const optionalText = <K extends string>(key: K, value: unknown): Partial<Record<K, string>> =>
  isText(value) && value ? ({ [key]: value } as Record<K, string>) : {};

function stepOf(value: unknown): StepRecord | undefined {
  const step = value as Partial<StepRecord> | null;
  if (!step || !isText(step.text) || !STEP_STATUSES.includes(step.status as StepStatus)) return undefined;
  return {
    keyword: isText(step.keyword) ? step.keyword : '',
    text: step.text,
    status: step.status as StepStatus,
    ms: Number.isFinite(step.ms) ? Math.max(0, step.ms!) : 0,
  };
}

// Where the report keeps a file is the report's to say, so a stored path in a line is never taken.
const attachmentsOf = (value: unknown): Attachment[] =>
  Array.isArray(value)
    ? (value as Partial<Attachment>[]).flatMap((file) =>
        file && isText(file.name) && isText(file.path)
          ? [
              {
                name: file.name,
                path: file.path,
                ...(Number.isInteger(file.attempt) && file.attempt! > 0 ? { attempt: file.attempt! } : {}),
              },
            ]
          : [],
      )
    : [];

/**
 * One line a recorder wrote, as the record the report keeps. Any language can write these, so this is where the report
 * stops trusting them: only the fields it knows come through, and one it cannot use is dropped rather than drawn.
 */
export function parseResultLine(line: string): ParsedLine {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { why: 'it is not valid JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { why: 'it is not a result' };
  if (typeof raw.v === 'number' && raw.v > HISTORY_VERSION) return { why: `a newer recorder wrote it, record version ${raw.v}` };
  if (!isText(raw.test) || !raw.test) return { why: 'it has no test' };
  if (!RESULT_STATUSES.includes(raw.status as ResultStatus)) return { why: `its status is ${JSON.stringify(raw.status)}` };
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).flatMap((step) => stepOf(step) ?? []);
  const attachments = attachmentsOf(raw.attachments);
  const image = raw.image as { path?: unknown } | null | undefined;
  const result: ResultRecord = {
    test: raw.test,
    name: isText(raw.name) && raw.name ? raw.name : raw.test,
    group: isText(raw.group) ? raw.group : '',
    ...optionalText('file', raw.file),
    ...optionalText('at', raw.at),
    tags: Array.isArray(raw.tags) ? raw.tags.filter(isText) : [],
    status: raw.status as ResultStatus,
    ms: Number.isFinite(raw.ms) ? Math.max(0, raw.ms as number) : 0,
    steps,
    ...(Number.isInteger(raw.failedAt) && (raw.failedAt as number) >= 0 && (raw.failedAt as number) < steps.length
      ? { failedAt: raw.failedAt as number }
      : {}),
    ...optionalText('error', raw.error),
    ...optionalText('stack', raw.stack),
    ...(FAILURE_KINDS.includes(raw.kind as FailureKind) ? { kind: raw.kind as FailureKind } : {}),
    ...(Number.isInteger(raw.attempts) && (raw.attempts as number) > 0 ? { attempts: raw.attempts as number } : {}),
    ...optionalText('knownBug', raw.knownBug),
    // Its type is read from its bytes when the run is recorded, whatever the recorder said.
    ...(image && isText(image.path) && image.path ? { image: { path: image.path, type: 'image/png' as const } } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...optionalText('rerun', raw.rerun),
    ...(isText(raw.rerunScope) ? { rerunScope: raw.rerunScope } : {}),
  };
  return { result, ...(isText(raw.finishedAt) && !Number.isNaN(Date.parse(raw.finishedAt)) ? { finishedAt: raw.finishedAt } : {}) };
}
