import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';

import { buildModel, categoryDescription, verdictOf } from '../src/analysis.ts';
import { accentCss, type Brand, checkBrand, DEFAULT_ACCENT, DEFAULT_BRAND } from '../src/brand.ts';
import { DEFAULT_COPY } from '../src/copy.ts';
import { recordRun } from '../src/finish.ts';
import { appendRun, historyFile, imageTypeOf, keepImages, parseHistory, readShot } from '../src/history.ts';
import { HISTORY_VERSION, type ReportData, type ResultRecord, type RunRecord, safeFolderName } from '../src/model.ts';
import { writeReport } from '../src/render.ts';
import { shellQuote } from '../src/shell-quote.ts';

const tempDir = () => realpathSync(mkdtempSync(path.join(os.tmpdir(), 'q6-report-')));

const pageData = (html: string): ReportData =>
  JSON.parse(
    gunzipSync(Buffer.from(/<script id="report-data" type="text\/plain">([^<]*)<\/script>/.exec(html)![1]!, 'base64')).toString('utf8'),
  ) as ReportData;

const BYTES = {
  png: Buffer.from('\x89PNG\r\n\x1a\nrest', 'latin1'),
  jpeg: Buffer.from('\xff\xd8\xff\xe0rest', 'latin1'),
  gif: Buffer.from('GIF89arest', 'latin1'),
  webp: Buffer.from('RIFF\x10\x00\x00\x00WEBPrest', 'latin1'),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
};

const aResult = (name: string, overrides: Partial<ResultRecord> = {}): ResultRecord => ({
  test: name,
  name,
  group: '',
  tags: [],
  status: 'passed',
  ms: 1,
  steps: [],
  ...overrides,
});

const aRun = (id: string, results: ResultRecord[] = [aResult('a')], overrides: Partial<RunRecord> = {}): RunRecord => ({
  v: HISTORY_VERSION,
  id,
  runNumber: 0,
  batch: id,
  project: 'p',
  lane: 'chrome',
  laneLabel: 'chrome',
  isFull: true,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  trigger: 'Local',
  notStarted: 0,
  results,
  ...overrides,
});

test('A line of any other history version is skipped by name, and a version 2 line is kept as it is', () => {
  const skipped: string[] = [];
  const lines = [aRun('a'), { ...aRun('b'), v: 3 }, { ...aRun('c'), v: 1 }, { ...aRun('d'), v: undefined }];
  const kept = parseHistory(lines.map((line) => JSON.stringify(line)).join('\n'), (_, why) => skipped.push(why));
  assert.deepEqual(
    kept.map((run) => run.id),
    ['a'],
  );
  assert.deepEqual(skipped, [
    'it was written by a newer version of this report, history version 3',
    'it is history version 1, which this report does not read',
    'it is history version undefined, which this report does not read',
  ]);
  assert.equal(kept[0]!.results[0]!.rerun, undefined);
});

test('A run on a history of another version starts it again, from run 1', () => {
  const historyDir = tempDir();
  const file = historyFile(historyDir, 'p');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, gzipSync(`${JSON.stringify({ ...aRun('old'), v: 1, runNumber: 31 })}\n`));
  const skipped: string[] = [];
  appendRun(historyDir, aRun('new'), (_, why) => skipped.push(why));
  const lines = gunzipSync(readFileSync(file))
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as RunRecord);
  assert.deepEqual(
    lines.map((line) => [line.id, line.v, line.runNumber]),
    [['new', HISTORY_VERSION, 1]],
  );
  assert.deepEqual(skipped, ['it is history version 1, which this report does not read']);
});

function keeping(place: (reportsDir: string) => string): { warned: string[]; result: ResultRecord; historyDir: string } {
  const reportsDir = path.join(tempDir(), 'reports');
  mkdirSync(reportsDir);
  const given = place(reportsDir);
  const record = aRun('r', [aResult('a', { image: { path: given, type: 'image/png' } })]);
  const historyDir = path.join(path.dirname(reportsDir), 'history');
  const warned: string[] = [];
  keepImages(record, historyDir, reportsDir, (message) => warned.push(message));
  return { warned, result: record.results[0]!, historyDir };
}

test('An image path that leaves the run folder is dropped with a warning, however it is spelled', () => {
  const secretBeside = (reportsDir: string, name: string) => {
    writeFileSync(path.join(path.dirname(reportsDir), name), BYTES.png);
    return path.join(path.dirname(reportsDir), name);
  };
  const escapes: Record<string, (reportsDir: string) => string> = {
    'up and out': (dir) => {
      secretBeside(dir, 'secret.png');
      return '../secret.png';
    },
    'an absolute path': (dir) => secretBeside(dir, 'secret.png'),
    'a file that does not exist out there': () => '../never-written.png',
    'a folder whose name starts the same': (dir) => {
      mkdirSync(`${dir}-evil`);
      writeFileSync(`${dir}-evil/secret.png`, BYTES.png);
      return '../reports-evil/secret.png';
    },
    'in and back out': (dir) => {
      secretBeside(dir, 'secret.png');
      mkdirSync(path.join(dir, 'sub'));
      return 'sub/../../secret.png';
    },
    'a link pointing out': (dir) => {
      symlinkSync(secretBeside(dir, 'secret.png'), path.join(dir, 'link.png'));
      return 'link.png';
    },
    'a link to a folder pointing out': (dir) => {
      secretBeside(dir, 'secret.png');
      symlinkSync(path.dirname(dir), path.join(dir, 'up'));
      return 'up/secret.png';
    },
  };
  for (const [what, place] of Object.entries(escapes)) {
    const { warned, result, historyDir } = keeping(place);
    assert.equal(result.image, undefined, what);
    assert.equal(warned.length, 1, what);
    assert.ok(warned[0]!.startsWith('Dropping the image of "a"'), `${what}: ${warned[0]}`);
    assert.ok(!existsSync(path.join(historyDir, 'p', 'screenshots')), `${what} copied nothing`);
  }
});

test('An image inside the run folder is kept, including one whose name starts with two dots', () => {
  const inside = keeping((dir) => {
    writeFileSync(path.join(dir, '..shot.png'), BYTES.png);
    return '..shot.png';
  });
  assert.deepEqual(inside.warned, []);
  assert.deepEqual(inside.result.image, { path: 'r/1.png', type: 'image/png' });
  const nested = keeping((dir) => {
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'shot.png'), BYTES.png);
    return 'sub/../sub/shot.png';
  });
  assert.deepEqual(nested.result.image, { path: 'r/1.png', type: 'image/png' });
});

test('A folder where an image should be, or the run folder itself, is not an image and breaks nothing', () => {
  const folder = keeping((dir) => {
    mkdirSync(path.join(dir, 'shot.png'));
    return 'shot.png';
  });
  assert.equal(folder.result.image, undefined);
  assert.equal(keeping(() => '.').result.image, undefined, 'The run folder is not inside itself');
});

test('An image is typed by its own bytes, whatever the recorder said and whatever its name says', () => {
  for (const [bytes, type, extension] of [
    [BYTES.png, 'image/png', 'png'],
    [BYTES.jpeg, 'image/jpeg', 'jpg'],
    [BYTES.gif, 'image/gif', 'gif'],
    [BYTES.webp, 'image/webp', 'webp'],
  ] as const) {
    const { result, warned } = keeping((dir) => {
      writeFileSync(path.join(dir, 'shot.png'), bytes);
      return 'shot.png';
    });
    assert.deepEqual(result.image, { path: `r/1.${extension}`, type }, type);
    assert.deepEqual(warned, []);
  }
  assert.equal(imageTypeOf(Buffer.from('RIFF\x10\x00\x00\x00WAVErest', 'latin1')), undefined, 'RIFF alone is not WebP');
  assert.equal(imageTypeOf(Buffer.from('GIF8')), undefined, 'A file cut short is nothing');
  assert.equal(imageTypeOf(Buffer.alloc(0)), undefined);
});

test('An SVG named and claimed as a PNG is listed as an attachment and never reaches the page', () => {
  const { result, warned, historyDir } = keeping((dir) => {
    writeFileSync(path.join(dir, 'shot.png'), BYTES.svg);
    return 'shot.png';
  });
  assert.equal(result.image, undefined);
  assert.deepEqual(result.attachments, [{ name: 'shot.png', path: 'shot.png' }]);
  assert.equal(warned.length, 1);
  assert.ok(!existsSync(path.join(historyDir, 'p', 'screenshots')));
});

test('A shot path read back from a history cannot leave the shots folder', () => {
  const historyDir = tempDir();
  mkdirSync(path.join(historyDir, 'p', 'screenshots', 'r'), { recursive: true });
  writeFileSync(path.join(historyDir, 'p', 'screenshots', 'r', '1.png'), BYTES.png);
  writeFileSync(path.join(historyDir, 'p', 'history.jsonl.gz'), 'secret');
  assert.equal(readShot(historyDir, 'p', 'r/1.png'), BYTES.png.toString('base64'));
  assert.equal(readShot(historyDir, 'p', '../history.jsonl.gz'), undefined);
  assert.equal(readShot(historyDir, 'p', '/etc/hosts'), undefined);
  assert.equal(readShot(historyDir, 'p', 'r/gone.png'), undefined);
  assert.equal(readShot(historyDir, 'p', '.'), undefined, 'The folder itself is no shot');
  assert.equal(readShot(historyDir, 'none', 'r/1.png'), undefined, 'A project with no shots folder');
});

test('A project name becomes one folder that stays where it is put', () => {
  assert.equal(safeFolderName('myshop'), 'myshop', 'A plain name does not change');
  assert.equal(safeFolderName('shop_2.web-eu'), 'shop_2.web-eu');
  assert.equal(safeFolderName('my shop'), 'my-shop');
  assert.equal(safeFolderName('a/b\\c'), 'a-b-c');
  assert.equal(safeFolderName('../../etc'), 'etc');
  assert.equal(safeFolderName('.hidden'), 'hidden');
  for (const empty of ['', '..', '.', '/', '---', '   '])
    assert.throws(() => safeFolderName(empty), /cannot name a folder/, JSON.stringify(empty));

  // Nested, so a name that did escape lands in this test's own folder and not in the machine's temp folder.
  const root = tempDir();
  const historyDir = path.join(root, 'a', 'b', 'history');
  appendRun(historyDir, aRun('a', [aResult('a')], { project: '../../escaped' }));
  assert.deepEqual(readdirSync(historyDir), ['escaped']);
  assert.ok(!existsSync(path.join(root, 'a', 'escaped')));
});

test('A page for a project with an awkward name is written under its folder name, and still shows its own name', async () => {
  const root = tempDir();
  const historyDir = path.join(root, 'history');
  appendRun(historyDir, aRun('a', [aResult('a')], { project: 'my shop' }));
  const written = await writeReport({ historyDir, outDir: path.join(root, 'report'), project: 'my shop' });
  assert.equal(path.basename(written.html), 'my-shop.html');
  const data = pageData(readFileSync(written.html, 'utf8'));
  assert.equal(data.project, 'my shop');
  assert.deepEqual(data.projects, ['my-shop']);
});

test('A run id that could not name a folder is refused before it moves anything', async () => {
  const root = tempDir();
  await assert.rejects(
    recordRun({
      record: aRun('../../escaped'),
      historyDir: path.join(root, 'history'),
      outDir: path.join(root, 'report'),
      reportsDir: root,
      staging: path.join(root, 'staging'),
      warn: () => {},
    }),
    /cannot name a folder/,
  );
  assert.ok(!existsSync(path.join(root, 'history')));
});

test('A quoted value reaches a real shell as exactly itself, and runs nothing', () => {
  const dir = tempDir();
  const proof = path.join(dir, 'ran');
  const values = [
    '@TC-0017',
    '@smoke',
    'a test with spaces',
    `it's a "test"`,
    `$(touch ${proof})`,
    `\`touch ${proof}\``,
    `; touch ${proof}`,
    `'; touch ${proof}; '`,
    'wow!important',
    'back\\slash',
    'line\nbreak',
    '*',
    '',
  ];
  for (const shell of ['sh', 'bash', 'zsh']) {
    for (const value of values) {
      const ran = spawnSync(shell, ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf8' });
      assert.ok(!ran.error, `${shell} is missing, and a copied command has to run in it: ${String(ran.error)}`);
      assert.equal(ran.stdout, value, `${shell}: ${shellQuote(value)}`);
    }
  }
  assert.ok(!existsSync(proof), 'A value ran as a command');
  assert.equal(shellQuote('@TC-0017'), '"@TC-0017"', 'A plain tag reads as it always did');
  // Only an interactive shell expands !, which a test cannot be, so this one is read rather than run.
  assert.equal(shellQuote('wow!important'), "'wow!important'");
});

test('A brand is held to what the page can safely take', () => {
  const refused: [Partial<Brand>, RegExp][] = [
    [{ accent: 'red' }, /#rrggbb/],
    [{ accent: '#fff' }, /#rrggbb/],
    [{ accent: '#ffa80' }, /#rrggbb/],
    [{ accent: '#ffa800;}body{display:none' }, /#rrggbb/],
    [{ accent: '#ffa800\n' }, /#rrggbb/],
    [{ accent: '' }, /#rrggbb/],
    [{ logo: { type: 'text/html' as 'image/png', base64: 'AAAA' } }, /has to be SVG/],
    [{ logo: { type: 'image/png', base64: 'AAAA");}body{display:none' } }, /not base64/],
    [{ logo: { type: 'image/png', base64: '' } }, /not base64/],
    [{ favicon: { type: 'image/png', base64: 'AA AA' } }, /favicon is not base64/],
    [{ footer: { text: 'x', logo: { type: 'text/html' as 'image/png', base64: 'AAAA' } } }, /footer logo is text\/html/],
    [{ footer: 'Made by Acme' as unknown as Brand['footer'] }, /pass it as \{ text, logo \}/],
  ];
  for (const [brand, message] of refused) assert.throws(() => checkBrand(brand), message, JSON.stringify(brand));
  for (const brand of [
    {},
    { accent: '#ABCDEF' },
    { logo: { type: 'image/svg+xml', base64: 'PHN2Zz4=' } },
    { footer: { text: 'Made by Acme' } },
  ] as Partial<Brand>[])
    assert.doesNotThrow(() => checkBrand(brand), JSON.stringify(brand));
});

test('A bad brand stops the page being written and says what to fix', async () => {
  const root = tempDir();
  const historyDir = path.join(root, 'history');
  appendRun(historyDir, aRun('a'));
  await assert.rejects(writeReport({ historyDir, outDir: path.join(root, 'report'), project: 'p', brand: { accent: 'red' } }), /#rrggbb/);
  assert.ok(!existsSync(path.join(root, 'report')));
});

test('The default accent keeps the stylesheet tuned tones, and any other derives its own on both themes', () => {
  assert.equal(accentCss(undefined), '');
  assert.equal(accentCss(DEFAULT_ACCENT), '');
  assert.equal(accentCss(DEFAULT_ACCENT.toUpperCase()), '');
  const navy = accentCss('#102a6b');
  assert.ok(navy.includes('--brand:#102a6b'));
  assert.ok(navy.includes('--on-brand:#ffffff'), 'Light text on a dark accent');
  assert.ok(accentCss('#ffee00').includes('--on-brand:#292929'), 'Dark text on a light accent');
  const dark = navy.slice(navy.indexOf(':root[data-theme="dark"]'));
  assert.ok(!dark.includes('--brand:#102a6b'), 'A dark accent is lifted on the dark theme');
  assert.ok(dark.includes('--on-brand:#292929'), 'Which then takes dark text');
  assert.ok(
    accentCss('#ffee00').slice(accentCss('#ffee00').indexOf(':root[data-theme="dark"]')).includes('--brand:#ffee00'),
    'A light accent is left as it is',
  );
  for (const match of navy.matchAll(/#[0-9a-z]+/g)) assert.equal(match[0].length, 7, match[0]);
});

test('A page with no brand and no copy uses the package defaults, and names no suite in its data', async () => {
  const root = tempDir();
  const historyDir = path.join(root, 'history');
  appendRun(historyDir, aRun('a'));
  const written = await writeReport({ historyDir, outDir: path.join(root, 'report'), project: 'p' });
  const html = readFileSync(written.html, 'utf8');
  assert.ok(html.includes(`<title>p - ${DEFAULT_BRAND.name}</title>`));
  assert.equal(pageData(html).brand, undefined);
  assert.deepEqual(written.model.brand, DEFAULT_BRAND);
  assert.deepEqual(written.model.copy, DEFAULT_COPY);
});

test("A suite's own footer replaces the default's words and logo together", async () => {
  const root = tempDir();
  const historyDir = path.join(root, 'history');
  appendRun(historyDir, aRun('a'));
  const written = await writeReport({
    historyDir,
    outDir: path.join(root, 'report'),
    project: 'p',
    brand: { footer: { text: 'Made by Acme' } },
  });
  assert.deepEqual(written.model.brand.footer, { text: 'Made by Acme' });
  assert.equal(written.model.brand.logo, undefined);
});

test('A brand and copy a suite passes reach the page, with the rest left at their defaults', async () => {
  const root = tempDir();
  const historyDir = path.join(root, 'history');
  appendRun(historyDir, aRun('a', [], { notStarted: 2 }));
  const written = await writeReport({
    historyDir,
    outDir: path.join(root, 'report'),
    project: 'p',
    brand: { name: '<b>Acme</b>' },
    copy: { test: 'case', startUnit: 'class', startUnits: 'classes' },
  });
  const html = readFileSync(written.html, 'utf8');
  assert.ok(html.includes('<title>p - &#60;b&#62;Acme&#60;/b&#62;</title>'), 'A brand name cannot become markup');
  assert.deepEqual(written.model.brand.footer, DEFAULT_BRAND.footer);
  assert.equal(written.model.copy.group, DEFAULT_COPY.group);
  assert.equal(verdictOf(written.model.runs[0]!, written.model.copy).small, '2 classes failed before any case began.');
  assert.ok(readFileSync(written.summary, 'utf8').includes('before any case began'), 'The CI summary uses the same words');
});

test('A known bug is described by the copy, and every other cause by the page', () => {
  assert.equal(categoryDescription('known', { ...DEFAULT_COPY, knownBug: 'Marked with @fixme' }), 'Marked with @fixme');
  assert.equal(categoryDescription('known', DEFAULT_COPY), DEFAULT_COPY.knownBug);
  assert.notEqual(categoryDescription('env', { ...DEFAULT_COPY, knownBug: 'x' }), 'x');
});

const modelOf = (records: RunRecord[]) => buildModel({ project: 'p', projects: ['p'], records, shots: {}, shotRuns: 10 });

test('A lane goes by its short name, its own name without one, and its own name when two share a short one', () => {
  const lanes = (...runs: Partial<RunRecord>[]) =>
    modelOf(runs.map((run, i) => aRun(`r${i}`, [aResult('a')], { batch: 'b', ...run }))).lanes.map((lane) => lane.short);
  assert.deepEqual(lanes({ lane: 'chrome' }), ['chrome']);
  assert.deepEqual(lanes({ lane: 'p-ios', laneShort: 'iOS' }), ['iOS']);
  assert.deepEqual(lanes({ lane: 'staging', laneShort: 'Web' }, { lane: 'production', laneShort: 'Web' }), ['staging', 'production']);
  assert.deepEqual(lanes({ lane: 'web', laneShort: 'iOS' }, { lane: 'iOS' }), ['web', 'iOS'], 'A short name can match another lane');
});
