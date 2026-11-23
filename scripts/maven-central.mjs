// Maven Central's Publisher API as the release uses it, from https://central.sonatype.org/publish/publish-portal-api/.
// `upload` has Central check a signed bundle without publishing it and prints the deployment's id, `publish` publishes a
// checked deployment, and `drop` deletes one that a release stopped before publishing. The Portal's user token comes from
// MAVEN_CENTRAL_TOKEN, as its username and password joined by a colon.
// A script, as the waits read JSON states until one of them comes; it uses Node's own fetch, so it installs nothing.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const API = 'https://central.sonatype.com/api/v1/publisher';
const POLL_SECONDS = 10;
// The states a deployment passes through on its way to each awaited one; FAILED, or any other, ends the wait.
const ON_THE_WAY = { VALIDATED: ['PENDING', 'VALIDATING'], PUBLISHED: ['VALIDATED', 'PUBLISHING'] };
const DEPLOYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function authorization() {
  const token = process.env.MAVEN_CENTRAL_TOKEN ?? '';
  if (!token.includes(':'))
    fail(
      `MAVEN_CENTRAL_TOKEN is ${token ? 'not a username and a password joined by a colon' : 'empty'}: a user token from ` +
        'https://central.sonatype.com/usertoken, kept as a secret of the release environment, as README.md says under Releasing.',
    );
  return `Bearer ${Buffer.from(token).toString('base64')}`;
}

async function call(method, route, body) {
  const response = await fetch(`${API}/${route}`, { method, headers: { Authorization: authorization() }, body });
  const text = await response.text();
  if (!response.ok) fail(`Maven Central answered ${response.status} to ${method} ${route}: ${text}`);
  return text;
}

async function status(id) {
  return JSON.parse(await call('POST', `status?id=${id}`));
}

async function waitFor(id, wanted, minutes) {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    const { deploymentState: state, errors } = await status(id);
    if (state === wanted) return;
    if (state === 'FAILED') fail(`Maven Central refused deployment ${id}:\n${JSON.stringify(errors, null, 2)}`);
    if (!ON_THE_WAY[wanted].includes(state)) fail(`Deployment ${id} is ${state}, which never leads to ${wanted}.`);
    if (Date.now() > deadline) fail(`Deployment ${id} is still ${state} after ${minutes} minutes; the Portal's Deployments tab shows it.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  }
}

function deploymentId(id) {
  if (!DEPLOYMENT_ID.test(id ?? '')) fail(`"${id}" is not a deployment id, which Maven Central gives as a UUID.`);
  return id;
}

async function upload(bundle, name) {
  if (!bundle || !name) fail('Usage: node scripts/maven-central.mjs upload <bundle.zip> <name>');
  const form = new FormData();
  form.append('bundle', new Blob([readFileSync(bundle)], { type: 'application/octet-stream' }), path.basename(bundle));
  // USER_MANAGED stops at VALIDATED, so nothing is public until `publish`.
  const id = deploymentId((await call('POST', `upload?publishingType=USER_MANAGED&name=${encodeURIComponent(name)}`, form)).trim());
  console.error(`Maven Central took ${name} as deployment ${id}, and is checking it`);
  await waitFor(id, 'VALIDATED', 30);
  console.error(`Maven Central checked deployment ${id}, which waits to be published`);
  console.log(id);
}

async function publish(id) {
  await call('POST', `deployment/${deploymentId(id)}`);
  console.error(`Maven Central is publishing deployment ${id}`);
  await waitFor(id, 'PUBLISHED', 60);
  console.log(`Maven Central published deployment ${id}`);
}

async function drop(id) {
  const { deploymentState: state } = await status(deploymentId(id));
  // A FAILED deployment stays, as Central's support asks to see one, and a published one can no longer be dropped.
  if (state !== 'VALIDATED') {
    console.log(`Deployment ${id} is ${state}, so it stays`);
    return;
  }
  await call('DELETE', `deployment/${id}`);
  console.log(`Dropped deployment ${id}, which was checked and never published`);
}

const COMMANDS = { upload, publish, drop };
const [command, ...args] = process.argv.slice(2);
if (!Object.hasOwn(COMMANDS, command)) fail('Usage: node scripts/maven-central.mjs upload|publish|drop ...');
await COMMANDS[command](...args);
