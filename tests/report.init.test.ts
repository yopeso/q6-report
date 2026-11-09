import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { addIgnore, addRecorderFormat, addUserdata, initRepository, RECORDER } from '../src/init.ts';

const tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'q6-report-init-'));

/** What behave reads from the file: it reads behave.ini with Python's configparser. */
function asBehaveReadsIt(text: string): { format: string[]; outfiles: string[]; userdata: Record<string, string> } {
  const script = [
    'import configparser, json, sys',
    'c = configparser.ConfigParser()',
    'c.read_string(sys.stdin.read())',
    'b = c["behave"] if c.has_section("behave") else {}',
    'split = lambda v: [x for x in v.split() if x]',
    'u = dict(c["behave.userdata"]) if c.has_section("behave.userdata") else {}',
    'print(json.dumps({"format": split(b.get("format", "")), "outfiles": split(b.get("outfiles", "")), "userdata": u}))',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script], { input: text, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { format: string[]; outfiles: string[]; userdata: Record<string, string> };
}

const LIKE_A_SUITE = [
  '[behave]',
  'format = json',
  'outfiles = reports/run.json',
  'paths = features',
  '',
  '[behave.userdata]',
  'Shop.issue_pattern = https://example.com/browse/{}',
  '',
].join('\n');

test("The recorder joins behave.ini's formatters after the first, which keeps its outfiles", () => {
  const read = asBehaveReadsIt(addRecorderFormat(LIKE_A_SUITE));
  assert.deepEqual(read.format, ['json', RECORDER]);
  assert.deepEqual(read.outfiles, ['reports/run.json']);
});

test('Formatters already on several lines get the recorder on one more, indented as they are', () => {
  const text = '[behave]\nformat =\n  pretty\n  progress\nshow_skipped = false\n';
  const edited = addRecorderFormat(text);
  assert.match(edited, new RegExp(`\n  progress\n  ${RECORDER}\nshow_skipped`));
  assert.deepEqual(asBehaveReadsIt(edited).format, ['pretty', 'progress', RECORDER]);
});

test('With no formatter set, pretty stays first, as behave prints without one', () => {
  assert.deepEqual(asBehaveReadsIt(addRecorderFormat('[behave]\npaths = features\n')).format, ['pretty', RECORDER]);
  assert.deepEqual(asBehaveReadsIt(addRecorderFormat('')).format, ['pretty', RECORDER]);
});

test('Running it again changes nothing', () => {
  const once = addUserdata(addRecorderFormat(LIKE_A_SUITE), 'q6_report.screenshots', 'screenshots');
  assert.equal(addUserdata(addRecorderFormat(once), 'q6_report.screenshots', 'shots'), once);
  assert.equal(addIgnore(addIgnore('node_modules/\n')), addIgnore('node_modules/\n'));
});

test("A file written on Windows keeps Windows' line endings", () => {
  const edited = addRecorderFormat(LIKE_A_SUITE.replaceAll('\n', '\r\n'));
  assert.equal(edited.split('\r\n').length - 1, edited.split('\n').length - 1, 'Every line ends in \\r\\n');
  assert.deepEqual(asBehaveReadsIt(edited).format, ['json', RECORDER]);
});

test('The screenshots folder goes under [behave.userdata], beside what is already there', () => {
  const read = asBehaveReadsIt(addUserdata(LIKE_A_SUITE, 'q6_report.screenshots', 'screenshots'));
  assert.equal(read.userdata['q6_report.screenshots'], 'screenshots');
  assert.equal(read.userdata['shop.issue_pattern'], 'https://example.com/browse/{}');
  assert.equal(asBehaveReadsIt(addUserdata('[behave]\n', 'q6_report.screenshots', 'shots')).userdata['q6_report.screenshots'], 'shots');
});

test('A behave suite on Poetry is set up by one command, with its screenshots folder found in .gitignore', () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, 'behave.ini'), LIKE_A_SUITE);
  writeFileSync(path.join(dir, 'pyproject.toml'), '[tool.poetry]\npackage-mode = false\n');
  writeFileSync(path.join(dir, '.gitignore'), 'reports/\nscreenshots/\n');
  const ran: string[] = [];
  const said = initRepository({ dir, version: '1.2.3', run: (command, args) => (ran.push([command, ...args].join(' ')), true) });
  assert.deepEqual(ran, ['poetry add --group dev q6-report==1.2.3']);
  const read = asBehaveReadsIt(readFileSync(path.join(dir, 'behave.ini'), 'utf8'));
  assert.deepEqual(read.format, ['json', RECORDER]);
  assert.equal(read.userdata['q6_report.screenshots'], 'screenshots');
  assert.match(readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^q6-report\/$/m);
  assert.ok(
    said.some((line) => line.startsWith('left to your CI:')),
    said.join('\n'),
  );
});

test('A dependency Poetry 2 wrote, in [dependency-groups], is one already there', () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, 'behave.ini'), '[behave]\n');
  writeFileSync(path.join(dir, 'poetry.lock'), '');
  writeFileSync(path.join(dir, 'pyproject.toml'), '[dependency-groups]\ndev = [\n    "q6-report (==1.2.3)"\n]\n');
  const said = initRepository({ dir, version: '1.2.3', run: () => assert.fail('nothing to add') });
  assert.ok(said.includes('q6-report is already a dependency'), said.join('\n'));
});

test('A suite on pip gets the pin in its requirements file, and one with no screenshots folder is told the line', () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, 'behave.ini'), '[behave]\n');
  writeFileSync(path.join(dir, 'requirements.txt'), 'behave==1.3.3\n');
  const said = initRepository({ dir, version: '1.2.3', run: () => assert.fail('pip suites run no tool') });
  assert.equal(readFileSync(path.join(dir, 'requirements.txt'), 'utf8'), 'behave==1.3.3\nq6-report==1.2.3\n');
  assert.ok(
    said.some((line) => line.includes('q6_report.screenshots = <folder>')),
    said.join('\n'),
  );
  assert.equal(asBehaveReadsIt(readFileSync(path.join(dir, 'behave.ini'), 'utf8')).userdata['q6_report.screenshots'], undefined);
});

test('A tool that will not start leaves its command to the person, and a folder with no suite is refused', () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, 'behave.ini'), '[behave]\n');
  writeFileSync(path.join(dir, 'poetry.lock'), '');
  const said = initRepository({ dir, version: '1.2.3', run: () => false });
  assert.ok(said.includes('left to you: poetry add --group dev q6-report==1.2.3, which failed or would not start here'), said.join('\n'));
  const empty = tempDir();
  mkdirSync(path.join(empty, 'features'));
  assert.throws(() => initRepository({ dir: empty, version: '1.2.3' }), /No behave\.ini, \.behaverc or Gradle build/);
});
