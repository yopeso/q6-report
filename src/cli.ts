#!/usr/bin/env node
// q6-report finish turns what recorders left into the report, for a suite with no Node inside its tests.
import { parseArgs } from 'node:util';

import { finishLanes } from './finish.ts';

const USAGE = `Usage: q6-report finish [--dir <folder>] [--project <name>]

Adds what the suite's recorders wrote to the project's history, and writes its report.
  --dir      where the recorders wrote; Q6_REPORT_DIR, or q6-report here, without it
  --project  the project's name; Q6_REPORT_PROJECT, or this folder's name, without it`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { dir: { type: 'string' }, project: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals[0] !== 'finish' || positionals.length > 1) {
    console.error(USAGE);
    return 2;
  }
  const url = await finishLanes({
    ...(values.dir ? { dir: values.dir } : {}),
    ...(values.project ? { project: values.project } : {}),
  });
  console.log(`Report: ${url}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
