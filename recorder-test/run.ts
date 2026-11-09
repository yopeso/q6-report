// pnpm check:recorders holds each recorder to the exact records a suite with known outcomes must produce, then carries
// those records to the page. A script because it drives other languages' test runners and compares what they leave behind.
import assert from 'node:assert/strict';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { relativeTsPaths } from '../declaration-paths.ts';
import { buildModel, clustersOf, type Result } from '../src/analysis.ts';
import type { ReportData } from '../src/model.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.dirname(here);
const PROJECT = 'shop';
const PNG_START = Buffer.from('\x89PNG', 'latin1');

interface ExpectedResult {
  test: string;
  category?: string;
  [field: string]: unknown;
}

interface Expected {
  /** How many worker files a run must leave. */
  workers: number;
  /** What a run on the suite's only known exit must return. */
  exitCode: number;
  results: ExpectedResult[];
  /** Each cause the page must draw, as its tests' names. */
  causes: string[][];
}

interface Suite {
  name: string;
  dir: string;
  /** What the suite installs its recorder from, which is what a registry would serve. */
  builtAs: string;
  /** Installs what the suite runs on, its recorder built and installed, and refuses with the fix when it cannot. */
  prepare(): void;
  command(selection: 'all' | 'passing'): { file: string; args: string[]; env: NodeJS.ProcessEnv };
  /** Where a person finds what the recorder said during a run, beyond the run's own output. */
  recorderSaid(output: string): string;
}

// A run must look like a laptop's whatever machine this check is on, or a pull request's CI would change what it proves.
function plainEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (/^(GITHUB_|GITLAB_|CI_|Q6_|BUILD_|GIT_)/.test(name) || ['CI', 'JENKINS_URL', 'CHANGE_ID', 'TEST_SUITE'].includes(name))
      delete env[name];
  return { ...env, ...extra };
}

function run(file: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): { code: number; output: string } {
  const result = spawnSync(file, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

function need(ok: boolean, what: string, fix: string): void {
  if (!ok) throw new Error(`${what} ${fix}`);
}

const cacheDir = path.join(packageDir, 'node_modules', '.cache', 'q6-report-recorders');
const venvPython = path.join(cacheDir, 'behave-venv', 'bin', 'python');
const recordersPython = path.join(packageDir, 'recorders', 'python');
const recordersJunit5 = path.join(packageDir, 'recorders', 'junit5');
const gradlew = path.join(recordersJunit5, 'gradlew');
const licence = readFileSync(path.join(packageDir, 'LICENSE'));
// A release's version, which the release workflow sets so each part comes from its registry, as a team installs it.
const published = process.env.Q6_REPORT_FROM_REGISTRY;

/** Tries an install again while it fails, as a registry can take minutes to serve a version it has just taken. */
function installWithRetries(what: string, install: () => { code: number; output: string }): void {
  for (let attempt = 1; ; attempt++) {
    const got = install();
    if (got.code === 0) return;
    assert.ok(attempt < 10, `${what} never installed:\n${got.output}`);
    spawnSync('sleep', ['30']);
  }
}

// Compiled files would sit beside the recorder, and Python trusts one whose source has the same size and second.
const NO_BYTECODE = { PYTHONDONTWRITEBYTECODE: '1' };

const behave: Suite = {
  name: 'behave',
  dir: path.join(here, 'behave'),
  builtAs: published ? 'release on PyPI' : 'wheel',
  prepare() {
    need(spawnSync('python3', ['--version']).status === 0, 'python3 is missing, and the behave recorder runs on it.', 'Install Python 3.');
    if (!existsSync(venvPython)) {
      mkdirSync(cacheDir, { recursive: true });
      const made = run('python3', ['-m', 'venv', path.dirname(path.dirname(venvPython))], process.env, packageDir);
      need(made.code === 0, `Could not make a virtual environment: ${made.output}`, 'Install the venv module of Python 3.');
    }
    const installed = run(venvPython, ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt'], process.env, this.dir);
    need(installed.code === 0, `Could not install behave: ${installed.output}`, 'It comes from PyPI, so this needs a network.');
    const kit = run(
      venvPython,
      ['-m', 'unittest', 'tests.test_kit'],
      { ...process.env, ...NO_BYTECODE, PYTHONPATH: recordersPython },
      recordersPython,
    );
    assert.equal(kit.code, 0, `The Python kit's own tests failed:\n${kit.output}`);
    if (published) {
      installWithRetries(`q6-report ${published} from PyPI`, () =>
        run(
          venvPython,
          ['-m', 'pip', 'install', '--quiet', '--no-deps', '--force-reinstall', '--no-cache-dir', `q6-report==${published}`],
          process.env,
          packageDir,
        ),
      );
      return;
    }

    // Without build isolation, so the setuptools pinned in requirements.txt builds it, with no network after the first run.
    const wheels = path.join(cacheDir, 'wheel');
    rmSync(wheels, { recursive: true, force: true });
    const wheel = run(
      venvPython,
      ['-m', 'pip', 'wheel', '--quiet', '--no-deps', '--no-build-isolation', '-w', wheels, recordersPython],
      process.env,
      packageDir,
    );
    assert.equal(wheel.code, 0, `Building the wheel failed:\n${wheel.output}`);
    const [built] = readdirSync(wheels).filter((file) => file.endsWith('.whl'));
    assert.ok(built, `pip wrote no wheel:\n${wheel.output}`);
    // A wheel is named <name>-<version>-<tags>.whl, and its metadata sits in <name>-<version>.dist-info.
    const distInfo = `${built.split('-').slice(0, 2).join('-')}.dist-info`;
    const shipped = run(
      venvPython,
      [
        '-c',
        'import sys, zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',
        path.join(wheels, built),
        `${distInfo}/licenses/LICENSE`,
      ],
      process.env,
      packageDir,
    );
    assert.equal(shipped.code, 0, `The wheel carries no licence:\n${shipped.output}`);
    assert.ok(Buffer.from(shipped.output).equals(licence), "The wheel's licence is the package's licence");
    // PyPI's page shows the description and links the wheel carries, and says the author provided none when they are missing.
    // METADATA is in the email header format, so Python's email parser reads it.
    const metadata = run(
      venvPython,
      [
        '-c',
        'import email, json, sys, zipfile; m = email.message_from_bytes(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2])); ' +
          'print(json.dumps({"type": m["Description-Content-Type"], "links": m.get_all("Project-URL") or [], "description": m.get_payload()}))',
        path.join(wheels, built),
        `${distInfo}/METADATA`,
      ],
      process.env,
      packageDir,
    );
    assert.equal(metadata.code, 0, `The wheel's metadata could not be read:\n${metadata.output}`);
    const { type, links, description } = JSON.parse(metadata.output) as { type: string | null; links: string[]; description: string };
    assert.equal(type, 'text/markdown', "The wheel's description is Markdown, as PyPI renders it");
    assert.equal(
      description,
      readFileSync(path.join(recordersPython, 'README.md'), 'utf8'),
      "The wheel's description is the recorder's README",
    );
    assert.ok(links.includes('Source, https://github.com/yopeso/q6-report'), `The wheel links to its source:\n${links.join('\n')}`);
    const reinstalled = run(
      venvPython,
      ['-m', 'pip', 'install', '--quiet', '--no-deps', '--force-reinstall', path.join(wheels, built)],
      process.env,
      packageDir,
    );
    assert.equal(reinstalled.code, 0, `Installing the wheel failed:\n${reinstalled.output}`);
  },
  command(selection) {
    return {
      file: venvPython,
      args: ['-m', 'behave', '--tags=not @skip', ...(selection === 'passing' ? ['--name', 'Adds an item'] : [])],
      env: NO_BYTECODE,
    };
  },
  recorderSaid: (output) => output,
};

const junit5: Suite = {
  name: 'junit5',
  dir: path.join(here, 'junit5'),
  builtAs: 'Maven publication',
  prepare() {
    const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
    need(java.status === 0 && !java.error, 'A JDK is missing, and the JUnit 5 recorder runs on one.', 'Install JDK 21.');
    // A publication left from an earlier run must never stand in for this one.
    rmSync(path.join(recordersJunit5, 'build', 'repo'), { recursive: true, force: true });
    const published = run(gradlew, ['publishAllPublicationsToBuildRepository', '--no-daemon', '--quiet'], process.env, recordersJunit5);
    assert.equal(published.code, 0, `Publishing the recorder failed:\n${published.output}`);
  },
  command(selection) {
    return {
      file: gradlew,
      args: ['test', '--rerun', '--no-daemon', '--quiet', ...(selection === 'passing' ? ['--tests', 'CartTest.adds an item'] : [])],
      env: {},
    };
  },
  // Gradle keeps what a test process prints in its test results, and not on its own output.
  recorderSaid() {
    const results = path.join(this.dir, 'build', 'test-results', 'test');
    return readdirSync(results)
      .filter((file) => file.endsWith('.xml'))
      .map((file) => readFileSync(path.join(results, file), 'utf8'))
      .join('\n');
  },
};

const SUITES = [behave, junit5];

function runSuite(suite: Suite, reportDir: string, selection: 'all' | 'passing' = 'all'): { code: number; output: string } {
  const { file, args, env } = suite.command(selection);
  return run(file, args, plainEnv({ ...env, Q6_REPORT_DIR: reportDir, Q6_REPORT_RERUN: 'rerun {name}' }), suite.dir);
}

/**
 * Installs the npm package, packed from here or in a release taken from npm, into an empty folder outside this workspace,
 * as a team's CI would, and returns its q6-report command. The folder has a package.json of its own, or npm would climb
 * to the nearest one and install there.
 */
function installReport(folder: string): string {
  const installed = path.join(folder, 'installed');
  mkdirSync(installed, { recursive: true });
  writeFileSync(path.join(installed, 'package.json'), '{ "private": true, "type": "module" }\n');
  // pnpm's own settings, passed down as npm_ variables, would change how npm installs.
  const npmEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^npm_/i.test(name)));
  const npmInstall = ['install', '--no-package-lock', '--no-audit', '--no-fund'];
  if (published) {
    // npm keeps a package's list of versions for minutes once fetched, so each try asks the registry again.
    const fromNpm = [...npmInstall, '--prefer-online', `q6-report@${published}`];
    installWithRetries(`q6-report ${published} from npm`, () => run('npm', fromNpm, npmEnv, installed));
  } else {
    const packed = path.join(folder, 'packed');
    const pack = run('pnpm', ['pack', '--pack-destination', packed], process.env, packageDir);
    assert.equal(pack.code, 0, `Packing the npm package failed:\n${pack.output}`);
    const [tarball] = readdirSync(packed).filter((file) => file.endsWith('.tgz'));
    assert.ok(tarball, `pnpm pack wrote no tarball:\n${pack.output}`);
    // Publishing corrects a manifest an install takes as it is, e.g: it drops a bin path written with a leading ./. It does
    // so only from a package's folder, as a publish from the folder does, and never for a tarball handed to it, so the
    // tarball is unpacked and published from there, as a dry run, to a registry that does not exist and is never retried.
    const unpacked = path.join(folder, 'unpacked');
    mkdirSync(unpacked, { recursive: true });
    const untar = run('tar', ['-xzf', path.join(packed, tarball), '-C', unpacked], process.env, folder);
    assert.equal(untar.code, 0, `Unpacking the tarball failed:\n${untar.output}`);
    const dryRun = ['publish', '--dry-run', '--registry', 'http://127.0.0.1:9', '--fetch-retries', '0', '--fetch-timeout', '2000'];
    const publish = run('npm', dryRun, npmEnv, path.join(unpacked, 'package'));
    assert.doesNotMatch(
      publish.output,
      /auto-corrected|errors corrected|invalid and removed/,
      `Publishing would change the manifest:\n${publish.output}`,
    );
    const install = run('npm', [...npmInstall, path.join(packed, tarball)], npmEnv, installed);
    assert.equal(install.code, 0, `Installing the tarball failed:\n${install.output}`);
  }
  assert.ok(!existsSync(path.join(installed, 'node_modules', 'esbuild')), 'The package installs with no esbuild');
  checkTypesAsInstalled(installed);
  return path.join(installed, 'node_modules', '.bin', 'q6-report');
}

/**
 * Type-checks a project that imports the installed package, and one line it must refuse, so the types are not any.
 * The shipped declarations must also name their siblings as .js, as TypeScript before 5.0 refuses a .ts path there.
 */
function checkTypesAsInstalled(installed: string): void {
  const dist = path.join(installed, 'node_modules', 'q6-report', 'dist');
  const tsPaths = readdirSync(dist)
    .filter((file) => file.endsWith('.d.ts'))
    .flatMap((file) => relativeTsPaths(file, readFileSync(path.join(dist, file), 'utf8')).map((literal) => `${file}: ${literal.text}`));
  assert.deepEqual(tsPaths, [], 'The shipped declarations name their siblings by a .ts path');
  const typeCheck = (lines: string[]) => {
    writeFileSync(
      path.join(installed, 'consumer.ts'),
      [`import { finishLanes, writeReport, type ResultRecord } from 'q6-report';`, ...lines].join('\n') + '\n',
    );
    const options = { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', strict: true, noEmit: true, types: ['node'] };
    // The workspace's Node types, as a consumer's own project has them.
    const config = {
      compilerOptions: { ...options, typeRoots: [path.join(packageDir, 'node_modules', '@types')] },
      files: ['consumer.ts'],
    };
    writeFileSync(path.join(installed, 'tsconfig.json'), JSON.stringify(config));
    return run(process.execPath, [path.join(packageDir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', '.'], process.env, installed);
  };
  const right = typeCheck([
    `const result: ResultRecord = { test: 't', name: 't', group: '', tags: [], status: 'passed', ms: 1, steps: [] };`,
    'void finishLanes; void writeReport; void result;',
  ]);
  assert.equal(right.code, 0, `A project using the installed package does not type-check:\n${right.output}`);
  const wrong = typeCheck([`const result: ResultRecord = { test: 1 };`, 'void result;']);
  assert.match(wrong.output, /TS2322/, `The installed types let a wrong record through:\n${wrong.output}`);
}

let reportCommand = '';

function finish(reportDir: string, extra: NodeJS.ProcessEnv = {}): string {
  const { code, output } = run(reportCommand, ['finish', '--dir', reportDir, '--project', PROJECT], plainEnv(extra), packageDir);
  assert.equal(code, 0, `q6-report finish failed:\n${output}`);
  const url = /^Report: (file:\S+)$/m.exec(output)?.[1];
  assert.ok(url, `q6-report finish printed no report:\n${output}`);
  return fileURLToPath(url);
}

const linesOf = (folder: string): Record<string, unknown>[] =>
  readdirSync(folder)
    .filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) => readFileSync(path.join(folder, file), 'utf8').split('\n').filter(Boolean))
    .map((line) => JSON.parse(line) as Record<string, unknown>);

// What a browser or an operating system adds to a message changes per machine, and says nothing about the recorder.
const stableError = (error: string): string =>
  (error.split(/\n\s*(?:\(Session info|For documentation|Build info|System info|Driver info)/)[0] ?? '')
    .replace(/\[Errno \d+\]/, '[Errno #]')
    .trim();

/** A line as the expected records hold it: only what must not change between two runs on two machines. */
function stable(line: Record<string, unknown>, laneDir: string): ExpectedResult {
  const { v, finishedAt, ms, stack, steps, image, error, attachments, ...rest } = line;
  assert.equal(v, 2, `A line carries its record version: ${String(line.test)}`);
  assert.ok(!Number.isNaN(Date.parse(String(finishedAt))), `A line says when it finished: ${String(line.test)}`);
  assert.ok(typeof ms === 'number' && ms >= 0, `A line says how long it took: ${String(line.test)}`);
  const imagePath = (image as { path?: string } | undefined)?.path;
  if (imagePath)
    assert.ok(readFileSync(path.join(laneDir, imagePath)).subarray(0, 4).equals(PNG_START), `A kept image is a PNG: ${imagePath}`);
  if (line.status === 'failed' && line.kind && line.at)
    assert.ok(typeof stack === 'string' && stack.length > 0, `A failure keeps its stack: ${String(line.test)}`);
  return {
    ...(rest as ExpectedResult),
    ...(typeof error === 'string' ? { error: stableError(error) } : {}),
    steps: (steps as { keyword: string; text: string; status: string }[]).map(({ keyword, text, status }) => ({ keyword, text, status })),
    ...(imagePath ? { image: true } : {}),
    ...(attachments ? { attachments: keptFiles(attachments as LineAttachment[], laneDir) } : {}),
  };
}

interface LineAttachment {
  name: string;
  path: string;
  attempt?: number;
}

/** Each attached file as what it holds, as its name in the lane's folder carries a process id; a binary one by its size. */
const keptFiles = (files: LineAttachment[], laneDir: string) =>
  files.map(({ path: file, ...rest }) => {
    assert.match(file, /^attachments\//, `An attachment is kept inside its lane's folder: ${file}`);
    const bytes = readFileSync(path.join(laneDir, file));
    return { ...rest, content: bytes.includes(0) ? `${bytes.length} bytes` : bytes.toString('utf8') };
  });

const byTest = <T extends { test: string }>(results: T[]): T[] => [...results].sort((a, b) => a.test.localeCompare(b.test));

function pageData(file: string): ReportData {
  const base64 = /<script id="report-data" type="text\/plain">([^<]*)<\/script>/.exec(readFileSync(file, 'utf8'))?.[1];
  assert.ok(base64, `${file} holds its data`);
  return JSON.parse(gunzipSync(Buffer.from(base64, 'base64')).toString('utf8')) as ReportData;
}

const checksum = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Holds each attachment the page lists to the file its recorder kept, in the folder beside the page; returns how many. */
function linkedAttachments(page: string, data: ReportData, saved: string): number {
  const folder = path.join(path.dirname(page), `${PROJECT}-attachments`);
  let count = 0;
  for (const record of data.records) {
    for (const result of record.results) {
      for (const file of result.attachments ?? []) {
        assert.ok(file.stored, `"${file.name}" of "${result.name}" is kept`);
        const kept = readFileSync(path.join(folder, file.stored));
        assert.ok(
          kept.equals(readFileSync(path.join(saved, record.lane, file.path))),
          `The page's copy of "${file.name}" is the file kept`,
        );
        const text = kept.includes(0) ? undefined : kept.toString('utf8');
        assert.equal(data.texts?.[file.stored], text, `"${file.name}" is in the page exactly when it is text`);
        count++;
      }
    }
  }
  return count;
}

function waitFor(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function check(suite: Suite, shouldPrint: boolean): Promise<void> {
  const say = (what: string) => console.log(`  ok: ${what}`);
  const expectedFile = path.join(suite.dir, 'expected.json');
  suite.prepare();
  say(`its tools are here, and its recorder is installed from its ${suite.builtAs}`);

  const root = mkdtempSync(path.join(os.tmpdir(), `q6-report-recorder-${suite.name}-`));
  try {
    const reportDir = path.join(root, 'report');
    const first = runSuite(suite, reportDir);
    const laneDir = path.join(reportDir, '.run', suite.name);
    assert.ok(existsSync(laneDir), `The suite wrote no records:\n${first.output}`);
    const actual = byTest(linesOf(laneDir).map((line) => stable(line, laneDir)));
    const saved = path.join(root, 'saved');
    cpSync(path.join(reportDir, '.run'), saved, { recursive: true });

    const page = finish(reportDir);
    const data = pageData(page);
    const model = buildModel(data);
    const results = model.runs.at(-1)!.results;
    const categoryOf = (test: string): Result | undefined => results.find((result) => result.test === test);
    const withCategory = actual.map((line) => {
      const category = categoryOf(line.test)?.category;
      return { ...line, ...(category ? { category } : {}) };
    });
    const causes = clustersOf([model.runs.at(-1)!])
      .map((cluster) => cluster.results.map((result) => result.name).sort())
      .sort((a, b) => a[0]!.localeCompare(b[0]!));
    const files = readdirSync(saved, { withFileTypes: true }).flatMap((lane) =>
      readdirSync(path.join(saved, lane.name)).filter((file) => file.endsWith('.jsonl')),
    );

    if (shouldPrint) {
      writeFileSync(
        expectedFile,
        `${JSON.stringify({ workers: files.length, exitCode: first.code, results: withCategory, causes }, null, 2)}\n`,
      );
      console.log(`  wrote ${expectedFile}; read every line of it against the suite before keeping it`);
      return;
    }
    const expected = JSON.parse(readFileSync(expectedFile, 'utf8')) as Expected;
    assert.equal(first.code, expected.exitCode, `The suite's own exit code:\n${first.output}`);
    assert.deepEqual(withCategory, expected.results);
    say(`${actual.length} results are exactly the ones expected, each sorted as expected`);
    assert.equal(files.length, expected.workers, 'Each worker writes a file of its own');
    say(`${files.length} ${files.length === 1 ? 'worker wrote its file' : 'workers wrote their own files'}`);
    assert.deepEqual(causes, expected.causes);
    say(`the page draws ${causes.length} causes, the ones expected`);
    const images = actual.filter((line) => line.image).length;
    assert.equal(
      results.filter((result) => result.image && data.shots[result.image.path]).length,
      images,
      'The page holds each kept image',
    );
    say(`the page holds all ${images} kept images`);
    const linked = linkedAttachments(page, data, saved);
    const attached = actual.reduce((count, line) => count + ((line.attachments as unknown[] | undefined)?.length ?? 0), 0);
    assert.equal(linked, attached, 'Every attached file reaches the folder the page links to');
    say(`the page links to all ${attached} attachments in the folder beside it, and holds the ones that are text`);

    // The steps of a pull request's run, in the order a project really goes through them.
    const history = path.join(reportDir, 'history', PROJECT, 'history.jsonl.gz');
    const before = { history: checksum(history), page: checksum(page) };
    const restore = () => cpSync(saved, path.join(reportDir, '.run'), { recursive: true });
    restore();
    const trial = finish(reportDir, {
      GITHUB_ACTIONS: 'true',
      GITHUB_BASE_REF: 'main',
      GITHUB_HEAD_REF: 'fix-it',
      GITHUB_REF_NAME: '12/merge',
      Q6_RUN_SCOPE: 'full',
    });
    assert.equal(path.basename(trial), `${PROJECT}-debug.html`, 'A pull request writes the trial page, even with Q6_RUN_SCOPE=full');
    assert.deepEqual(
      { history: checksum(history), page: checksum(page) },
      before,
      "A pull request's run leaves the history and the report as they were",
    );
    const trialModel = buildModel(pageData(trial));
    assert.equal(trialModel.debugRuns.at(-1)!.branch, 'fix-it', 'It names the branch a person named');
    say("a pull request's run writes the trial page, and leaves the history and the report byte for byte");
    restore();
    finish(reportDir);
    assert.equal(buildModel(pageData(page)).runs.length, 2, 'The next full run joins the history');
    say('the next full run joins the history as run 2');

    const blocked = path.join(root, 'a-file');
    writeFileSync(blocked, '');
    const unwritable = path.join(blocked, 'report');
    assert.equal(runSuite(suite, unwritable).code, expected.exitCode, 'A folder that cannot be written does not change a failing run');
    const passing = runSuite(suite, unwritable, 'passing');
    assert.equal(passing.code, 0, `A folder that cannot be written must not fail a passing run:\n${passing.output}`);
    assert.match(suite.recorderSaid(passing.output), /could not record/, 'It says the recording failed');
    say(`with a folder that cannot be written, the exit code stays ${expected.exitCode} on a failing run and 0 on a passing one`);

    if (suite === junit5) {
      const withoutAgent = /marks steps with @Step, and the test JVM was started without the recorder's jar/;
      assert.doesNotMatch(suite.recorderSaid(passing.output), withoutAgent, 'With its agent, the recorder says nothing about it');
      const { file, args, env } = suite.command('passing');
      const bare = run(file, [...args, '-PwithoutStepAgent'], plainEnv({ ...env, Q6_REPORT_DIR: path.join(root, 'bare') }), suite.dir);
      assert.equal(bare.code, 0, `A run without the agent still passes:\n${bare.output}`);
      assert.match(suite.recorderSaid(bare.output), withoutAgent, 'Without its agent, the recorder says @Step records nothing');
      say('without its agent, a suite that uses @Step is told that no such step is recorded');
    }

    if (suite === behave) {
      const parallelDir = path.join(root, 'parallel');
      const { file, args, env } = suite.command('all');
      const children = [1, 2].map(() =>
        spawn(file, args, { cwd: suite.dir, env: plainEnv({ ...env, Q6_REPORT_DIR: parallelDir }), stdio: 'ignore' }),
      );
      await Promise.all(children.map(waitFor));
      const folder = path.join(parallelDir, '.run', suite.name);
      assert.equal(readdirSync(folder).filter((name) => name.endsWith('.jsonl')).length, 2, 'Two processes write two files');
      assert.equal(linesOf(folder).length, actual.length * 2, 'Neither loses a line');
      say('two processes at once keep every line, in a file each');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const shouldPrint = args.includes('--write-expected');
  const names = args.filter((arg) => !arg.startsWith('--'));
  const chosen = names.length ? SUITES.filter((suite) => names.includes(suite.name)) : SUITES;
  if (names.some((name) => !SUITES.some((suite) => suite.name === name))) {
    console.error(`Recorders: ${SUITES.map((suite) => suite.name).join(', ')}`);
    return 2;
  }
  if (published !== undefined && !/^\d+\.\d+\.\d+$/.test(published)) {
    console.error(`Q6_REPORT_FROM_REGISTRY is "${published}", and it has to be a published version of three numbers, e.g: 0.1.0.`);
    return 2;
  }
  const npmFolder = mkdtempSync(path.join(os.tmpdir(), 'q6-report-npm-'));
  try {
    console.log('npm package');
    try {
      reportCommand = installReport(npmFolder);
      if (published) {
        console.log(
          `  ok: q6-report ${published}, installed from npm with no esbuild; every page below is written by its q6-report command`,
        );
        console.log('  ok: a project importing it type-checks against its types');
      } else {
        console.log('  ok: packed, and installed from its tarball with no esbuild; every page below is written by its q6-report command');
        console.log('  ok: publishing would change nothing in its manifest, and a project importing it type-checks against its types');
      }
    } catch (error) {
      console.error(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    let failed = 0;
    for (const suite of chosen) {
      console.log(suite.name);
      try {
        await check(suite, shouldPrint);
      } catch (error) {
        failed++;
        console.error(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(failed ? `${failed} of ${chosen.length} recorders failed` : `${chosen.length} recorders passed`);
    return failed ? 1 : 0;
  } finally {
    rmSync(npmFolder, { recursive: true, force: true });
  }
}

process.exit(await main());
