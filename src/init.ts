// q6-report init sets a suite's repository up once, so nobody adds the recorder by hand: the dependency with the project's
// own tool, the recorder in behave.ini, the screenshots folder when the repository shows one, and q6-report/ in .gitignore.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RECORDER = 'q6_report.behave_recorder:Recorder';
const SECTION = /^\s*\[([^\]]+)\]\s*$/;

/** The lines of an INI file, and the line ending it uses, so a file written on Windows stays as it was written. */
function linesOf(text: string): { lines: string[]; eol: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return { lines, eol };
}

const joined = ({ lines, eol }: { lines: string[]; eol: string }) => lines.join(eol) + eol;

/** Where a section's lines are: its header's index, and the index after its last line. */
function sectionOf(lines: string[], name: string): { header: number; end: number } | undefined {
  const header = lines.findIndex((line) => SECTION.exec(line)?.[1]!.trim().toLowerCase() === name);
  if (header === -1) return undefined;
  const next = lines.findIndex((line, index) => index > header && SECTION.test(line));
  return { header, end: next === -1 ? lines.length : next };
}

/** Where a key's value ends, its continuation lines included, as configparser reads one: indented lines below it. */
function valueEnd(lines: string[], keyLine: number, end: number): number {
  let last = keyLine;
  while (last + 1 < end && /^\s+\S/.test(lines[last + 1]!)) last++;
  return last + 1;
}

/** The recorder as one more formatter of [behave], after the first, which keeps its place and its outfiles. */
export function addRecorderFormat(text: string): string {
  const file = linesOf(text);
  const { lines } = file;
  if (lines.some((line) => line.includes(RECORDER))) return text;
  const section = sectionOf(lines, 'behave');
  if (!section) {
    if (lines.length) lines.push('');
    lines.push('[behave]', 'format = pretty', `    ${RECORDER}`);
    return joined(file);
  }
  const keyLine = lines.findIndex((line, index) => index > section.header && index < section.end && /^format\s*[=:]/i.test(line));
  if (keyLine === -1) {
    // With no format, behave prints as pretty, which stays first.
    lines.splice(section.header + 1, 0, 'format = pretty', `    ${RECORDER}`);
    return joined(file);
  }
  const after = valueEnd(lines, keyLine, section.end);
  const indent = after - 1 > keyLine ? /^\s+/.exec(lines[after - 1]!)![0] : '    ';
  lines.splice(after, 0, `${indent}${RECORDER}`);
  return joined(file);
}

/** A key of [behave.userdata], which behave hands to the recorder; a key already there keeps its value. */
export function addUserdata(text: string, key: string, value: string): string {
  const file = linesOf(text);
  const { lines } = file;
  const section = sectionOf(lines, 'behave.userdata');
  if (!section) {
    if (lines.length) lines.push('');
    lines.push('[behave.userdata]', `${key} = ${value}`);
    return joined(file);
  }
  const has = lines.some(
    (line, index) => index > section.header && index < section.end && line.split(/[=:]/)[0]!.trim().toLowerCase() === key,
  );
  if (has) return text;
  lines.splice(section.header + 1, 0, `${key} = ${value}`);
  return joined(file);
}

/** The line that keeps a run's records, history and page out of git. */
export function addIgnore(text: string): string {
  const { lines } = linesOf(text);
  if (lines.some((line) => /^\/?q6-report\/?\s*$/.test(line))) return text;
  return joined({
    lines: [...lines, '# What q6-report writes: each run, the history and the page.', 'q6-report/'],
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  });
}

export interface InitOptions {
  dir: string;
  version: string;
  /** The folder the suite saves its screenshots into; without it, a screenshots folder .gitignore lists or that exists. */
  screenshots?: string;
  /** Runs the project's own tool, e.g: poetry, and says whether it could start it. */
  run?: (command: string, args: string[], cwd: string) => boolean;
}

const runTool = (command: string, args: string[], cwd: string): boolean => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  return !result.error && result.status === 0;
};

/** Sets the repository at `dir` up, and returns what it did and what is left to a person, one line each. */
export function initRepository({ dir, version, screenshots, run = runTool }: InitOptions): string[] {
  const said: string[] = [];
  const file = (name: string) => path.join(dir, name);
  const read = (name: string) => (existsSync(file(name)) ? readFileSync(file(name), 'utf8') : undefined);
  const change = (name: string, before: string | undefined, after: string, what: string) => {
    if (after === (before ?? '')) return;
    writeFileSync(file(name), after);
    said.push(`${name}: ${what}`);
  };
  const config = ['behave.ini', '.behaverc'].find((name) => existsSync(file(name)));
  const gradle = ['build.gradle.kts', 'build.gradle'].find((name) => existsSync(file(name)));
  if (!config && !gradle)
    throw new Error(`No behave.ini, .behaverc or Gradle build in ${dir}. Run q6-report init from the root of a behave or JUnit 5 suite.`);

  if (config) {
    const pin = `q6-report==${version}`;
    // As Poetry before 2 writes it, `q6-report = ...`, as Poetry 2 and uv do, `"q6-report (==1.2.3)"`, and as [project] does.
    const pyproject = read('pyproject.toml') ?? '';
    const requirements = ['requirements-dev.txt', 'requirements.txt'].find((name) => existsSync(file(name)));
    if (/^\s*"?q6-report\b/m.test(pyproject) || (requirements && /^q6-report\b/m.test(read(requirements)!))) {
      said.push('q6-report is already a dependency');
    } else if (existsSync(file('poetry.lock')) || /^\[tool\.poetry\]/m.test(pyproject)) {
      const args = ['add', '--group', 'dev', pin];
      said.push(
        run('poetry', args, dir)
          ? `ran: poetry ${args.join(' ')}`
          : `left to you: poetry ${args.join(' ')}, which failed or would not start here`,
      );
    } else if (existsSync(file('uv.lock'))) {
      const args = ['add', '--dev', pin];
      said.push(
        run('uv', args, dir) ? `ran: uv ${args.join(' ')}` : `left to you: uv ${args.join(' ')}, which failed or would not start here`,
      );
    } else if (requirements) {
      const before = read(requirements)!;
      change(
        requirements,
        before,
        joined({ lines: [...linesOf(before).lines, pin], eol: before.includes('\r\n') ? '\r\n' : '\n' }),
        `added ${pin}; pip install -r ${requirements} installs it`,
      );
    } else {
      said.push(`left to you: ${pin} where the project lists its dependencies, as it has no Poetry, uv or requirements file`);
    }

    const ini = read(config)!;
    let edited = addRecorderFormat(ini);
    if (edited !== ini) said.push(`${config}: the recorder, as a formatter after the first`);
    const ignored = read('.gitignore') ?? '';
    const folder = screenshots ?? (/^\/?screenshots\/?\s*$/m.test(ignored) || existsSync(file('screenshots')) ? 'screenshots' : undefined);
    if (folder) {
      const withFolder = addUserdata(edited, 'q6_report.screenshots', folder);
      if (withFolder !== edited)
        said.push(`${config}: q6_report.screenshots = ${folder}, so a failed scenario shows the screenshot saved there`);
      edited = withFolder;
    } else {
      said.push(
        `left to you: q6_report.screenshots = <folder> under [behave.userdata] in ${config}, if the suite saves screenshots into a folder`,
      );
    }
    if (edited !== ini) writeFileSync(file(config), edited);
  }

  if (gradle) {
    said.push(
      `left to you, in ${gradle}: testImplementation("io.github.yopeso:q6-report-junit5:${version}") and the agent line, as https://github.com/yopeso/q6-report#junit-5 says`,
    );
  }

  const ignore = read('.gitignore');
  change('.gitignore', ignore, addIgnore(ignore ?? ''), 'q6-report/');
  said.push(`left to your CI: keep q6-report/ from each test job, and once after them all run npx --yes q6-report@${version} finish`);
  return said;
}
