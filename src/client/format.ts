import type { FailingStretch } from '../analysis.ts';

export const fmtDate = (at: number): string => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export const fmtDateTime = (at: number): string =>
  `${fmtDate(at)}, ${new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

export function fmtTime(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 1) return `${Math.round(ms)}ms`;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.round((seconds % 3600) / 60)).padStart(2, '0')}m`;
}

export const pct = (value: number, digits = 0): string => `${(value * 100).toFixed(digits)}%`;

export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

export const shortSha = (commit: string | undefined): string | undefined => commit?.slice(0, 7);

export const failingChip = ({ runs, since, isCut }: FailingStretch): string =>
  isCut ? `Failing ${runs}+ runs` : `Failing ${plural(runs, 'run')}, since ${fmtDate(since.run.at)}`;
