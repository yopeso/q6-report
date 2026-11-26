#!/usr/bin/env node
// q6-report finish turns what recorders left into the report, for a suite with no Node inside its tests, q6-report merge
// brings runs recorded on other machines into one history, and q6-report init sets a suite's repository up for its recorder once.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { finishLanes } from './finish.ts';
import { initRepository } from './init.ts';
import { reportFolder } from './kit.ts';
import { mergeRuns } from './merge.ts';

const USAGE = `Usage: q6-report finish [--dir <folder>] [--project <name>]
       q6-report merge [--dir <folder>] <reports folder>...
       q6-report init [--screenshots <folder>]

finish adds what the suite's recorders wrote to the project's history, and writes its report.
  --dir          where the recorders wrote; Q6_REPORT_DIR, or q6-report here, without it
  --project      the project's name; Q6_REPORT_PROJECT, or this folder's name, without it
merge adds the runs other reports folders hold, e.g: one per shard of a CI run, to this one's history, and writes its reports.
  --dir          the reports folder they join, whose history is Q6_HISTORY_DIR when it is set; Q6_REPORT_DIR, or q6-report here, without it
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
  if (positionals[0] === 'merge') {
    const dir = path.resolve(values.dir ?? reportFolder());
    const merged = await mergeRuns({
      from: positionals.slice(1).map((folder) => path.resolve(folder)),
      historyDir: process.env.Q6_HISTORY_DIR ? path.resolve(process.env.Q6_HISTORY_DIR) : path.join(dir, 'history'),
      outDir: path.join(dir, 'report'),
      warn: console.warn,
    });
    console.log(merged.summary);
    for (const page of merged.pages) console.log(`Report: ${page}`);
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
