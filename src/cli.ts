#!/usr/bin/env node
// q6-report finish turns what recorders left into the report, for a suite with no Node inside its tests, and q6-report init
// sets a suite's repository up for its recorder once.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { finishLanes } from './finish.ts';
import { initRepository } from './init.ts';

const USAGE = `Usage: q6-report finish [--dir <folder>] [--project <name>]
       q6-report init [--screenshots <folder>]

finish adds what the suite's recorders wrote to the project's history, and writes its report.
  --dir          where the recorders wrote; Q6_REPORT_DIR, or q6-report here, without it
  --project      the project's name; Q6_REPORT_PROJECT, or this folder's name, without it
init sets up the suite in this folder: its dependency, its behave.ini and its .gitignore.
  --screenshots  the folder the suite saves screenshots into; a screenshots folder here, without it`;

// The version this command is, which init pins, so the recorder and the command that finishes its runs are one release.
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { dir: { type: 'string' }, project: { type: 'string' }, screenshots: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals[0] === 'init' && positionals.length === 1) {
    const dir = process.cwd();
    console.log(`q6-report ${VERSION} in ${dir}:`);
    for (const line of initRepository({ dir, version: VERSION, ...(values.screenshots ? { screenshots: values.screenshots } : {}) }))
      console.log(`  ${line}`);
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
