// One release is one version in every place that carries it: the npm package, the wheel, the Maven publication and the
// suite that installs that publication. `set` writes it everywhere; `check` fails where a place says another one.
import { readFileSync, writeFileSync } from 'node:fs';

const PLACES = [
  { file: 'package.json', pattern: /^ {2}"version": "([^"]+)",$/m, line: (version) => `  "version": "${version}",` },
  { file: 'recorders/python/pyproject.toml', pattern: /^version = "([^"]+)"$/m, line: (version) => `version = "${version}"` },
  { file: 'recorders/junit5/build.gradle.kts', pattern: /^version = "([^"]+)"$/m, line: (version) => `version = "${version}"` },
  {
    file: 'recorder-test/junit5/build.gradle.kts',
    pattern: /^ {2}testImplementation\("io\.github\.yopeso:q6-report-junit5:([^"]+)"\)$/m,
    line: (version) => `  testImplementation("io.github.yopeso:q6-report-junit5:${version}")`,
  },
];
// Three numbers only, e.g: 0.1.0, as npm and PyPI spell a pre-release differently and one spelling has to fit all three.
const VERSION = /^\d+\.\d+\.\d+$/;

const [command, version] = process.argv.slice(2);
if (!['set', 'check'].includes(command) || !VERSION.test(version ?? '')) {
  console.error('Usage: node scripts/version.mjs set|check <version>, with a version of three numbers, e.g: 0.1.0');
  process.exit(2);
}

const differing = [];
for (const place of PLACES) {
  const text = readFileSync(place.file, 'utf8');
  const found = place.pattern.exec(text);
  if (!found) throw new Error(`${place.file} no longer carries its version on the line this script reads; update PLACES here.`);
  if (command === 'set') writeFileSync(place.file, text.replace(place.pattern, place.line(version)));
  else if (found[1] !== version) differing.push(`${place.file} says ${found[1]}`);
}
if (differing.length) {
  console.error(`The version is ${version}, and ${differing.join(', ')}. Run node scripts/version.mjs set ${version} and commit it.`);
  process.exit(1);
}
console.log(command === 'set' ? `set ${version} in ${PLACES.length} places` : `ok: all ${PLACES.length} places say ${version}`);
