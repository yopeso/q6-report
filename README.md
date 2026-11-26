# q6-report

A test report that keeps a project's history in one HTML file, with no server and no network.
A recorder inside a test suite writes each test's result as it runs, and the `q6-report` command adds the run to the project's history and writes the page again.
The page opens from the file in a browser, so it can be mailed or kept as a CI artifact as it is.

Recorders for behave, JUnit 5, Playwright Test and Mocha are here, and a suite on any other framework writes the same lines itself.
The `q6-report` command, the Playwright Test reporter and the Mocha recorder install from npm, the behave recorder from PyPI and the JUnit 5 recorder from Maven Central.
It is licensed under Apache-2.0, in `LICENSE`, and written by Leo Mustatea, Yopeso.

## What the page shows

| Page | Holds |
|---|---|
| Overview | the verdict and the numbers against the run before, what needs attention grouped by cause with its screenshot, the trends, why tests failed, flaky and slower tests, and each test side by side across lanes |
| Runs | every run, narrowed by whether it failed or by a search, and each run's results by status, lane or text |
| Tests | every test with its last 30 results, and each one's history on each lane |
| A result | the error, the screenshot, every step with its time, the stack, the files the test attached and the command that runs it again |

A link to any page or result is its address, so it can be shared with the file.
A run narrowed to some tests is a trial run, with a page and a history of its own, so it never changes what the full runs compare against.
The report links to that page as Trial runs once a full run is written after one.

| Number | Means |
|---|---|
| Result | one test on one lane, so one test on three browsers is three results |
| Lane | one way a suite runs, e.g: one browser or one device |
| New failure | it failed, and the same test on the same lane did not fail the time before |
| Pass rate | passed out of passed and failed; a skipped test counts for neither |

The page opens in Chrome 80, Firefox 113, Safari 16.4 or newer, and says so on an older browser.
The history and the page keep the newest 60 runs, and screenshots and attachments the newest 10.

## The packages

It ships as three packages on one version, one per registry a suite installs from: `q6-report` on npm and PyPI, and `q6-report-junit5` on Maven Central.
Each builds into what its registry serves, and `pnpm check:recorders` installs every one from what it built.

| Package | Holds | Built by | Lands in |
|---|---|---|---|
| npm `q6-report` | the report, the `q6-report` command, the Playwright Test reporter `q6-report/playwright`, the Mocha recorder `q6-report/mocha` and their types, with the page already bundled, so it installs with no dependency | `pnpm pack`, which runs `build.ts` first | a `.tgz` |
| PyPI `q6-report` | the behave recorder, standard library only | `python3 -m pip wheel --no-deps` on `recorders/python` | a `.whl` |
| Maven Central `io.github.qa-automation-q6:q6-report-junit5` | the JUnit 5 recorder, which is also the agent behind `@Step`, with Byte Buddy packed inside, and its sources and javadoc | `publishAllPublicationsToBuildRepository` in `recorders/junit5` | `recorders/junit5/build/repo` |

All three carry one version, the last release's, which [Releasing](#releasing) sets.
`recorders/python/LICENSE` is a copy of `LICENSE`, because a wheel can only carry a file from its own folder, and the recorder test fails if the wheel's copy differs.
The group `io.github.qa-automation-q6` is the namespace of the GitHub account `qa-automation-q6`, verified on the Maven Central account that signs in with it, as [Releasing](#releasing) describes.

## Recorders

A recorder runs inside a suite and writes one line of JSON per test, and the report reads only those lines.
A recording that breaks never decides a test: the suite's exit code stays its own, and the recorder says what went wrong.

| Framework | Language it is written in | Where |
|---|---|---|
| behave | Python, standard library only | `recorders/python/q6_report/behave_recorder.py` |
| JUnit 5, from Kotlin or Java | Java 11, with no dependency at run time | `recorders/junit5/` |
| Playwright Test | TypeScript, with no dependency: it declares the shapes it reads from Playwright | `src/playwright.ts` |
| Mocha, WebdriverIO's Mocha framework included | TypeScript, with no dependency: it declares the shapes it reads from Mocha | `src/mocha.ts` |
| Any other | the suite's own | it writes [the line](#the-line); a suite on Node uses `writeResult`, `laneFolder` and `keepImage` from the npm package |

### Setting a suite up

`npx --yes q6-report init`, run once from the root of a behave suite, makes every change the suite needs, says each one, and says what it left to a person.
Running it again changes nothing, and the changes are committed, so nobody else on the team sets anything up.

| It finds | It does |
|---|---|
| Poetry: a `poetry.lock` or `[tool.poetry]` | `poetry add --group dev q6-report==<its own version>` |
| uv: a `uv.lock` | `uv add --dev q6-report==<its own version>` |
| a `requirements-dev.txt` or `requirements.txt` | adds `q6-report==<its own version>` to it |
| `behave.ini` or `.behaverc` | adds the recorder as a formatter after the first, which keeps its place and its outfiles |
| a `screenshots` folder, or one `.gitignore` lists | names it as the folder the recorder takes screenshots from; `--screenshots <folder>` names another |
| `.gitignore` | adds `q6-report/` |
| a Gradle build | says the JUnit 5 lines below, as a build script is the team's to change |

A behave configuration in `setup.cfg`, `tox.ini` or `pyproject.toml`, and the CI, stay the team's to change, and it says what they need.
On a suite on Poetry whose `.gitignore` lists `screenshots/`, besides the dependency Poetry adds, it changed:

```diff
--- a/.gitignore
+++ b/.gitignore
@@ -1 +1,3 @@
 screenshots/
+# What q6-report writes: each run, the history and the page.
+q6-report/
--- a/behave.ini
+++ b/behave.ini
@@ -1,3 +1,7 @@
 [behave]
 format = pretty
+    q6_report.behave_recorder:Recorder
 paths = features
+
+[behave.userdata]
+q6_report.screenshots = screenshots
```

### behave

A suite installs the recorder from PyPI, beside behave, and one line in `behave.ini` turns it on; [`init`](#setting-a-suite-up) does both.

```text
$ pip install q6-report==0.1.0
Collecting q6-report==0.1.0
  Downloading q6_report-0.1.0-py3-none-any.whl.metadata (348 bytes)
Downloading q6_report-0.1.0-py3-none-any.whl (11 kB)
Installing collected packages: q6-report
Successfully installed q6-report-0.1.0
```

pip installs it into the active environment only, so a project on pip also lists `q6-report` in its requirements file.
A project on Poetry adds it with `poetry add --group dev q6-report`, which writes it into `pyproject.toml` and `poetry.lock`.

It sits beside any other formatter.
When behave ends on a person's machine, the recorder writes the page with `npx --yes q6-report@<its own version> finish` and behave prints where it is, which needs Node 22 or newer; without Node, it says what writes the page instead.
A CI finishes once, after every job, as [Finishing a run](#finishing-a-run) says, so there the recorder leaves it.
A run stopped with Ctrl+C goes to the trial page: the scenario that was running counts as not run, and the ones never started are left out.
The first formatter has to stay on the `format` line, because behave reads an empty first line as an empty formatter, and `outfiles` pairs with formatters by position, so a formatter that writes a file stays first.

```ini
[behave]
format = pretty
    q6_report.behave_recorder:Recorder
```

A rerun of a scenario inside one behave run is one result with its count of attempts, however the suite repeats it, because the recorder counts the times `scenario.run` starts.
A suite that saves its screenshots as files into one folder names that folder once, and changes no code.
For each attempt of a scenario, the recorder takes the newest image saved there, in that folder or below it, while the attempt ran:

```ini
[behave.userdata]
q6_report.screenshots = screenshots
```

One behave process at a time saves into that folder, or a scenario could take another process's image.
A suite with no such folder hands its file over from its screenshot helper instead, and it goes with that attempt:

```python
import q6_report

q6_report.attach_image(path)
```

Any other file, e.g: a video or a log, is attached from a step or a hook, under a name of the suite's own or its file name, and is copied at that moment, so the suite may delete it straight after:

```python
q6_report.attach(video_path, "Execution video")
```

A rerun keeps every attempt's files, each marked with its attempt, as a failed attempt's files are what tells why a pass on a retry is flaky.
A file attached in `before_feature` or `after_all` belongs to no scenario, and is dropped with a warning.
One attached in `after_feature` counts as that feature's last scenario's, because behave says a feature ended only after that hook.

### JUnit 5

Adding the dependency from Maven Central turns the recorder on, through `META-INF/services`.

```kotlin
// build.gradle.kts
repositories {
  mavenCentral()
}

dependencies {
  testImplementation("io.github.qa-automation-q6:q6-report-junit5:0.4.0")
}
```

A suite that hands over its driver from its own main source set takes it with `implementation` instead.

Steps, attachments and screenshots are optional, and a suite with none of them is still recorded.
A step is marked either around its code with `Report.step`, or on its method with `@Step`, below.
The driver is usually closed by the time JUnit reports a test finished, so a screenshot is taken at the moment of failure, by the extension and one line that hands it a driver:

```kotlin
@ExtendWith(ReportExtension::class)
class ShopTest {
  @BeforeEach
  fun open() {
    driver = ChromeDriver()
    Report.screenshots { (driver as TakesScreenshot).getScreenshotAs(OutputType.BYTES) }
  }

  @Test
  fun `totals the order`() {
    Report.step("open the page") { driver.get(PAGE) }
  }
}
```

A step run inside another step is part of that one, e.g: a page object's action that calls another action, so a test lists the steps it took itself, and its error says what failed inside one.

A method can be marked as a step instead, which leaves its body as it is:

```kotlin
import q6report.Step

@Step("Add {0} items to the basket")
fun add(count: Int) {
  addButton.click()
}
```

`{0}` is the method's first argument, and `{count}` the one called so when the class keeps its parameter names, which Kotlin does with `-java-parameters`.
A `@Step` with no text takes the method's name.
`@Step` works through the recorder's own jar as a Java agent, which adds the opening and closing of a step around each marked method as its class loads, and changes nothing else.
The test task gives it:

```kotlin
tasks.test {
  jvmArgumentProviders.add(CommandLineArgumentProvider {
    listOf("-javaagent:" + configurations.testRuntimeClasspath.get().single { it.name.startsWith("q6-report-junit5") })
  })
}
```

Without it, no step marked with `@Step` is recorded, and the recorder says so in the first test's output.
The agent is built on Byte Buddy, packed inside the recorder's jar under q6-report's own package, so a suite's own Byte Buddy, e.g: through Mockito, keeps its version.

A file is attached on the test's own thread, from the test, an `@AfterEach` or an extension, and is copied at that moment:

```kotlin
Report.attach("Execution video", videoPath) // a java.nio.file.Path
Report.attach(logPath) // under its file name
```

A retried test keeps every attempt's files, each marked with its attempt.

Gradle keeps what a test process prints in its test results and not on its own output, so a recording that failed is said under `build/test-results`.

### Playwright Test

The reporter ships in the npm package as `q6-report/playwright`, and a suite names it in its config.
Playwright still adds its own printing reporter, because this one prints nothing.

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [['q6-report/playwright']],
  use: {
    screenshot: 'only-on-failure',
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true },
  },
});
```

Both options are optional: `folder` is where results, images and attachments go, the lane's folder `<dir>/.run/playwright-test/` without it, and `file` is the results file, `playwright-test-<pid>.jsonl` in that folder without it.
`Q6_REPORT_LANE` renames the lane, e.g: one per Playwright project.
Each test's browser comes from its project, as Playwright picks it: `browserName`, else its device's, else Chromium, with a `chrome` or `msedge` channel making it Chrome or Edge; a lane whose tests all ran in one browser shows its icon.

A test is recorded once, at the attempt that decides it, with `attempts` set to the retries it took.
Its `test` is the spec's path under the config's `rootDir`, then its describes and title joined with ` > `, and a Playwright project that has a name puts it in front, so two browsers running one spec keep two histories.
Its `steps` are the top-level `test.step` calls, which is all a suite names itself, and `failedAt` is the first of them that failed; an `expect` outside every step has none.
Playwright hands a reporter an error's text and place and not its type, so `kind` is read from the words: a failed `expect(...)` is `check`, "Test timeout of N ms exceeded" and "Timeout N ms exceeded" are `timeout`, a browser that cannot reach the app is `env`, and anything else is `error`.
The failure screenshot is the result's image, and every other attachment is kept under its own name, with the attempt that made it, so the failed attempt's trace of a test that passed on its retry stays.
Playwright's `trace` attachment is kept as "Playwright trace".
An attachment that has only a body, e.g: `testInfo.attach('notes', { body })`, has no file, so the reporter writes the body to a file of its own, keeps it like any other and removes it.
`tags` are what Playwright gives, `@` included, whether the test names them in its `tag` option or in its title, and `@bug-42` marks a known bug.

A framework built on Playwright Test extends the class and overrides `keep(file, what, name)`, the one place a file is copied, to keep files somewhere else.

```text
$ Q6_REPORT_DIR=q6-report npx playwright test
$ cat q6-report/.run/playwright-test/playwright-test-*.jsonl
{"v":2,"finishedAt":"2026-11-21T09:18:41.559Z","test":"shop.spec.ts::Cart > totals the cart","name":"totals the cart","group":"Cart","file":"tests/shop.spec.ts","tags":[],"status":"failed","ms":662,"steps":[{"keyword":"","text":"open the shop","status":"passed","ms":1},{"keyword":"","text":"read the cart","status":"failed","ms":506}],"failedAt":1,"error":"expect(received).toBe(expected) // Object.is equality\n\nExpected: \"8 items\"\nReceived: \"1 item\"","at":"tests/shop.spec.ts:16","kind":"check","attempts":2,"image":{"path":"images/80727-1795252721558-test-failed-1.png","type":"image/png"},"attachments":[{"name":"screenshot",...}]}
```

The line is cut at its attachments here; the real one lists them all.

### Mocha

The recorder ships in the npm package as `q6-report/mocha`, a root hook plugin, and a suite requires it, on the command line or in its `.mocharc`.
A test may mark its steps, attach files and say how to take a screenshot; none is needed for it to be recorded.

```js
// npx mocha --require q6-report/mocha
import { attach, screenshots, step } from 'q6-report/mocha';

before(() => screenshots(async () => Buffer.from(await browser.takeScreenshot(), 'base64')));

it('totals the cart', async () => {
  await step('open the shop', () => browser.url('/'));
  await step('read the cart', async () => assert.equal(await cartText(), '8 items'));
  attach('cart log', 'logs/cart.txt');
});
```

A test's `steps` are its top-level `step()` calls, a step run inside another being part of it, and `failedAt` is the first that failed.
`screenshots(take)` hands over a function that returns image bytes; the recorder calls it when the first step fails, while the test still holds its browser or device, or after the test when it failed outside every step.
`attach(name, file)` keeps the file as it is at that moment, with the attempt that kept it.
Mocha hands a failed test's error to its reporters only, so the recorder wraps each test's function as the test starts and keeps what it throws, rejects with or hands `done`.
`kind` is read from the words first, then from the error itself: a failed `expect` or `node:assert` is `check`, a network error is `env`, and a test Mocha's timer ended reads "Timeout of N ms exceeded." and is `timeout`.
`tags` are the `@word`s of the test's title and its suites' titles, as `--grep` finds them, and `@bug-42` marks a known bug.
A test skipped by `it.skip` or `this.skip()` is skipped, and one Mocha never ran, e.g: under a `before` hook that failed, is a failure that says so, as Mocha reports the hook and not the test.
A test is recorded once, at the attempt that decides it, with `attempts` set to the tries it took, and the screenshot of an attempt it retried stays one of its files.
Its `test` is the spec file's path from the folder Mocha runs in, then its suites and title joined with ` > `.

WebdriverIO's Mocha framework silences every Mocha reporter and runs root hooks from `mochaOpts.require`, which it resolves from its config's folder, so a WebdriverIO suite names the module's file: `require: [fileURLToPath(import.meta.resolve('q6-report/mocha'))]`.
A framework built on Mocha extends `MochaRecorder`, whose options are `folder`, `file` and `rootDir`, the folder a test's path is read from; it exports the instance's `hooks()` as its own plugin's `mochaHooks`, and overrides `tagsOf(test)` to add tags it takes elsewhere and `keep(file, what, name)` to keep files somewhere else.
The module has no default export, because Mocha takes a required module's default in place of the module, which would hide `mochaHooks`.

```text
$ Q6_REPORT_DIR=q6-report npx mocha --require q6-report/mocha tests/shop.spec.mjs
$ grep '"totals the cart"' q6-report/.run/mocha/mocha-*.jsonl
{"v":2,"finishedAt":"2026-11-25T14:33:44.928Z","test":"tests/shop.spec.mjs::Cart > totals the cart","name":"totals the cart","group":"Cart","file":"tests/shop.spec.mjs","tags":[],"status":"failed","ms":80,"steps":[{"keyword":"","text":"open the shop","status":"passed","ms":36},{"keyword":"","text":"read the cart","status":"failed","ms":43}],"failedAt":1,"error":"Expected values to be strictly equal:\n+ actual - expected\n\n+ '1 item'\n- '8 items'","stack":...,"at":"tests/shop.spec.mjs:44","kind":"check","attempts":1,"image":{"path":"images/91607-1795617224927-screenshot.png","type":"image/png"}}
```

The line is cut at its stack here, which names the folder the suite ran in.

### Settings

Every recorder reads the same ones, and none is needed.

| Setting | What it does | Without it |
|---|---|---|
| `Q6_REPORT_DIR` | the folder a run's records, history and page go in | `q6-report` in the folder the suite runs from |
| `Q6_REPORT_LANE` | names the lane, e.g: `chrome` | the framework's name |
| `Q6_REPORT_BROWSER` | the browser the lane runs in, one of `chrome`, `chromium`, `edge`, `firefox`, `safari` or `webkit`, which the page draws as its icon | the Playwright Test reporter reads it from the project, and the others leave it unset |
| `Q6_REPORT_PLATFORM` | what the lane runs on, `web`, `android` or `ios`, e.g: `android` for an Appium suite on an Android phone | `web` beside a browser the Playwright Test reporter read, and unset otherwise |
| `Q6_REPORT_BUG_TAG` | a pattern for the tag marking a known bug; its first group is the bug, or the whole match | a tag starting `@bug-` or `@bug:` |
| `Q6_REPORT_RERUN` | the command that runs a test again, with `{name}` and `{file}` filled in and quoted | the page shows no command |
| `Q6_REPORT_FINISH` | `off` leaves writing the page to `q6-report finish`, e.g: for a suite that runs several behave processes at once | the behave recorder writes the page when behave ends, except in a CI |

### Finishing a run

The page is built by Node, so a suite in another language finishes in a second command, `q6-report finish`, from the npm package.
The folder can travel first, e.g: as a CI artifact from a machine with no Node, and each lane's folder under it joins one run.
The behave recorder does this itself on a person's machine, as [behave](#behave) says; any other suite installs it from npm, and finishes in its own folder after a run:

```text
$ npm install q6-report@0.1.0

added 1 package in 507ms
$ npx q6-report finish --project shop
Report: file:///Users/someone/shop/q6-report/report/shop.html
```

| Setting | What it does | Without it |
|---|---|---|
| `--dir` | where the recorders wrote | `Q6_REPORT_DIR`, or `q6-report` |
| `--project` | the project's name | `Q6_REPORT_PROJECT`, or the folder's name |
| `Q6_HISTORY_DIR` | keeps the history elsewhere, for a CI that caches it | `history` under that folder |
| `Q6_BATCH` | groups lanes finished apart into one run | the CI's run id, or a new one |
| `Q6_RUN_SCOPE`, `Q6_RUN_NARROWED` | say a run is a trial run, and what it was narrowed to | a full run, unless it is a pull request's |

Each attachment is copied under the history, and the page links to its copy in `report/<project>-attachments/`, so that folder goes wherever the page goes.
Attachments stay for the newest 10 runs, as screenshots do.
A UTF-8 text of at most 64 KB is also held in the page, up to 5 MB of them per page, newest run first, so it still reads when the page travels alone.

It exits 1 and says where it looked when no recorder left anything, and 0 otherwise, whatever the tests did: the suite's own command carries their verdict.
Finishing clears the lanes it recorded, so a suite run twice with no finish between is one run holding both, with the second's tests numbered `#2`.
A `.run` folder left by a run cut short has the same effect on the next one.

### Merging the runs of several machines

A run split across machines, e.g: the four shards of a CI matrix, leaves a run in each machine's folder, and a CI saves its cached history once, so one job merges them.
Each shard's job finishes its own folder with no history restored, and uploads it; the report job restores the history, downloads the folders and merges them, then saves the history:

```text
$ npx q6-report finish --dir shard-1 --project shop
Report: file:///Users/someone/shop/shard-1/report/shop.html
$ npx q6-report finish --dir shard-2 --project shop
Report: file:///Users/someone/shop/shard-2/report/shop.html
$ npx q6-report merge --dir report-job shard-1 shard-2
Merged 2 recorded runs, which the report shows as 1 run.
Report: file:///Users/someone/shop/report-job/report/shop.html
```

| Setting | What it does | Without it |
|---|---|---|
| `--dir` | the folder the runs join, whose page is written again | `Q6_REPORT_DIR`, or `q6-report` |
| `Q6_HISTORY_DIR` | the history they join, for a CI that caches it | `history` under that folder |

The shards are one run of the report when they share a batch, which the CI's run id gives every job of one pipeline; one lane in several batches is merged with a warning naming them, and shows as that many runs.
Each run the history lacks is added with its screenshots and attachments, full runs to the history and trial runs to the debug history, so merging the same folders again adds nothing.
A shard that had no test of its own records a run with none, so its own page says so, and the merge knows it ran.
A part that left no run at all stopped before its first test, e.g: on a value it refused; the merge writes which parts its lane's runs are missing, prints a sentence naming them to stderr and exits 1, and the page says the run is missing them and never reads it as a pass.
A later merge of that part, e.g: from its job run again, makes the run whole.
A folder with no history is passed over with a note, and folders whose runs tested nothing are refused, since then nothing was tested.
A run's time on the page is the time its lanes' records cover together, so four shards of 5 minutes side by side took 5 minutes, and lanes one after another take as long as they all did.
`mergeRuns` does the same from code, with the suite's brand and copy.

### The line

One JSON object per line, in any file ending `.jsonl` under `<dir>/.run/<lane>/`, with a file per process so parallel workers never share one.
`src/result-line.ts` reads it, and it is where the report stops trusting a recorder: a field it cannot use is dropped, and a line it cannot read is skipped with a warning.

```json
{"v":2,"finishedAt":"2026-11-01T07:16:00Z","test":"Shop::Totals a line","name":"Totals a line","group":"Shop","file":"features/shop.feature","tags":[],"status":"failed","ms":12,"attempts":1,"steps":[{"keyword":"Then","text":"the cart holds 8","status":"failed","ms":1}],"failedAt":0,"error":"Expected 8 items but got 7","stack":"...","at":"features/steps/shop_steps.py:31","kind":"check"}
```

`test`, and a `status` of `passed`, `failed` or `skipped`, are all a line must hold.
`browser` and `platform` say what the lane ran in and on, and a lane takes the ones every one of its lines gives, so a lane that ran in two browsers has no icon.
`finishedAt` less `ms` is how a run knows when it ran, once its folder has travelled.
An image or attachment path is relative to the lane's folder, and one that leaves it is dropped with a warning.
A `stored` path in a line is never taken, as where the report keeps a file is the report's to say.

### How a failure is sorted

| Asked in order | Says |
|---|---|
| A person marked it | Known bug |
| `kind` is `env` | Environment |
| It keeps turning between passing and failing | Flaky |
| `kind` | `check` is Wrong result, `missing` is Not found, `timeout` is Timed out, `error` is Error thrown |
| No `kind`, the wording table in `src/wording.ts` | what the words of drivers, network errors and assertions say, for a line with no kind |
| Nothing recognises it | Not sorted, which claims nothing |

A recorder reads an error's type and not its words, so Python's `KeyError` is an `error` although it is a `LookupError`, and Java's `java.util.NoSuchElementException` is an `error` although it shares a name with Selenium's.

A cause is `at` plus the error's words with their values masked.
On one small suite per framework, that gave 9 causes from Jest's 10 failures, 9 from Vitest's 10, 8 from Mocha's 8 and 9 from pytest's 10, each merging only two tests that fail on one line of one helper.

A lane that never kept an image has no screen, so its failures say nothing about a screenshot, and a project with no such image anywhere draws its causes with no tile.

### What a recorder cannot see

| What | Why | What shows |
|---|---|---|
| A behave feature skipped as a whole, with `show_skipped` off | behave tells a formatter nothing about it, so no formatter can record it | no result; a scenario skipped inside a running feature is recorded |
| A JUnit retry from anything but JUnit Pioneer's `@RetryingTest` | the recorder knows that annotation by name, on a test or on a suite's own annotation, and no other retry library was tried | each attempt as its own result |
| Tests in a JUnit class whose `@BeforeAll` failed | JUnit never starts them | one failed result, named for the class |
| A Selenium wait that hides its cause | `visibilityOfElementLocated` ends in a plain timeout | Timed out, and Not found only when the wait's cause is the missing element |
| A suite's own timeout type | a recorder knows the common ones by name | Error thrown |
| A file a JUnit test attaches from a thread of its own | the recorder knows a test by the thread it runs on | nothing, and a warning |
| A suite on JUnit 6 | the JUnit recorder was written against JUnit 5.9 and has never run on 6 | not known |
| A `@Step` on a Kotlin `inline` function | its body is copied into each caller, so there is no call for the agent to mark | no step |

## The record

`src/model.ts` is the contract: one `RunRecord` per lane of a run, holding one `ResultRecord` per test.
Fields a framework cannot fill stay unset, and the page hides what depends on them, e.g: a result with no `steps` has no Steps section, and one with no `rerun` has no command to copy.

| Field | What it means |
|---|---|
| `group` | a `describe`, a class or a feature, empty when the test has none |
| `file`, `at` | where the test lives, and where it failed as `file:line` |
| `kind` | `check`, `error`, `timeout`, `env` or `missing`, read from the error object |
| `attempts` | how many times it ran |
| `knownBug` | the bug a person marked it with, in whichever way its framework marks one |
| `image` | a screenshot; its type is read from its bytes, and PNG, JPEG, WebP and GIF are held in the page |
| `attachments` | files a test attached, each with its `name`, the `path` its recorder kept it at, the `attempt` that attached it on a test that ran more than once, and once the run is recorded, where the report keeps it as `stored` |
| `rerun`, `rerunScope` | the command that runs it again, and what else that command runs: a tag, or empty for the whole lane |
| `laneShort` | the lane's name where space is short, on the run |
| `shard`, `missingShards` | which part of a run split across machines the lane's record is, e.g: `{"current":2,"total":4}`, written by the suite that split it; and the parts a merge found had left no run, written by the merge, since a shard's own history never holds its siblings |
| `browser`, `platform` | the browser the lane ran in, `chrome`, `chromium`, `edge`, `firefox`, `safari` or `webkit`, and what it ran on, `web`, `android` or `ios`, on the run; the page draws the browser's logo before the lane's name, or the phone's when it names no browser, and the lane's newest run decides; any other value is kept, drawn with no logo and warned about |

A recorder that knows its run was not the whole suite writes what it was instead into `narrowed.txt` in its lane's folder, e.g: the behave recorder after a cancel, and `q6-report finish` records that lane as a trial run unless `Q6_RUN_NARROWED` says otherwise.

A history is at version 2, and a line of any other version is skipped with a warning, costing that run and not the history; the next run writes the file again without it, so a history of only such lines starts again from run 1.

An image or attachment path has to stay inside the folder given as `reportsDir`, or it is dropped with a warning, and so is an attachment that is not there.
A value from a suite reaches the page as text, and a project name becomes one safe folder name.

## Brand and copy

`writeReport` and `recordRun` take two options, so a suite's report carries its own name and words; `scripts/check-report.ts` passes both as `shopLook`.

| Option | What it sets | Without it |
|---|---|---|
| `brand` | `name`, `footer` as `{ text, logo }`, `accent` as `#rrggbb`, and `logo` for the header and `favicon` as base64 images | the package's own name with no logo in the header, a footer reading "Generated by q6" beside Yopeso's logo, no favicon and the orange accent |
| `copy` | the words in `src/copy.ts` that depend on what a suite is built on, e.g: `test` and `tests` | the words a suite on any framework can read |

A logo is drawn as an image, so an SVG cannot run anything, and `isOneColour` draws it in the text colour so it reads on both themes.
A brand that sets `footer` replaces its words and its logo together, so a suite's own words never sit beside Yopeso's logo.

## Lane logos

Wherever the page names a lane, it draws the logo of the browser the lane ran in, or of Android or Apple for a phone, from the record's `browser` and `platform`.
Each logo is an icon from [Bootstrap Icons](https://icons.getbootstrap.com/) 1.13.2, kept unchanged in `src/client/lane-marks/` and bundled into the page, and `pnpm check:report` compares every logo it draws with its file there.
Each is one colour and takes the text's, so it reads on both themes.

| Logo | File | Bootstrap icon |
|---|---|---|
| Chrome, and Chromium | `chrome.svg` | `browser-chrome` |
| Edge | `edge.svg` | `browser-edge` |
| Firefox | `firefox.svg` | `browser-firefox` |
| Safari, and WebKit | `safari.svg` | `browser-safari` |
| Android | `android.svg` | `android2` |
| Apple, for iOS | `apple.svg` | `apple` |

No icon set draws Chromium's or WebKit's own logo, so their lanes take Chrome's and Safari's, and each lane's name says which it is.
Bootstrap Icons is under the MIT licence, whose text is `src/client/lane-marks/Bootstrap-Icons-MIT.txt` and travels with every copy of the package in `dist`.
The logos stay their owners' trademarks, so the page's footer names each one the page draws, and carries the line Google asks for wherever the Android robot is drawn.

## Working on it

It needs Node 22 or newer, pnpm, Python 3, a JDK and Chrome; the commands run from the repository's root.

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs, in order, each of these, which also run alone:

| Command | Checks |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | the code, the tests and the scripts |
| `pnpm test` | the unit tests |
| `pnpm check:names` | that no file names anything but q6-report, below |
| `pnpm check:report` | a written page, opened from its file in headless Chrome, on every page and result |
| `pnpm check:recorders` | each recorder, below |

### The names check

`pnpm check:names` fails on any file that names a project or team that tried the report, another report, or code of the suite it came from.
Those names are private, so they come in as a pattern through `Q6_REPORT_PRIVATE_NAMES`, kept as the repository secret of the same name; on a machine without it, the check says so and checks the rest.
In CI the secret has to be set, and a pull request from a fork, which receives no secret, fails it and says why.

```text
ok: 103 files name nothing but q6-report, with the private names checked
```

### The recorder test

`pnpm check:recorders` runs a small suite with known outcomes per recorder, on the real framework, and a recorder cannot ship until it passes.
It installs behave and setuptools into `node_modules/.cache` and takes Gradle from the wrapper, so its first run needs a network; it needs Python 3, a JDK and Chrome, and says which is missing.
The Playwright suite runs the repository's Playwright on the installed Google Chrome and downloads no browser, and the Mocha suite runs the repository's Mocha 10, the major WebdriverIO 9's Mocha framework runs, taking its screenshots in a headless Chrome through WebdriverIO.
Each suite takes its recorder from the package that recorder builds into, and every page is written by the `q6-report` command of the npm package, installed from its tarball into an empty folder outside the repository.
The npm package is also published as a dry run, from its unpacked tarball, and fails on any correction npm would make to its manifest, as npm drops a bin path it finds invalid; its shipped declarations must name their siblings as `.js`, which TypeScript before 5.0 needs, and a project importing the installed package must type-check.

```text
npm package
  ok: packed, and installed from its tarball with no esbuild; every page below is written by its q6-report command
  ok: publishing would change nothing in its manifest, and a project importing it type-checks against its types
behave
  ok: its tools are here, and its recorder is installed from its wheel
  ok: 21 results are exactly the ones expected, each sorted as expected
  ok: 1 worker wrote its file
  ok: its lane is recorded as android, which the page draws as its icon
  ok: the page draws 11 causes, the ones expected
  ok: the page holds all 2 kept images
  ok: the page links to all 4 attachments in the folder beside it, and holds the ones that are text
  ok: a pull request's run writes the trial page, and leaves the history and the report byte for byte
  ok: the next full run joins the history as run 2
  ok: with a folder that cannot be written, the exit code stays 1 on a failing run and 0 on a passing one
  ok: two processes at once keep every line, in a file each
junit5
  ok: its tools are here, and its recorder is installed from its Maven publication
  ok: 33 results are exactly the ones expected, each sorted as expected
  ok: 2 workers wrote their own files
  ok: its lane is recorded as chrome on web, which the page draws as its icon
  ok: the page draws 18 causes, the ones expected
  ok: the page holds all 15 kept images
  ok: the page links to all 4 attachments in the folder beside it, and holds the ones that are text
  ok: a pull request's run writes the trial page, and leaves the history and the report byte for byte
  ok: the next full run joins the history as run 2
  ok: with a folder that cannot be written, the exit code stays 1 on a failing run and 0 on a passing one
  ok: without its agent, a suite that uses @Step is told that no such step is recorded
playwright-test
  ok: its tools are here, and its recorder is installed from its npm package
  ok: 9 results are exactly the ones expected, each sorted as expected
  ok: 1 worker wrote its file
  ok: its lane is recorded as chrome on web, which the page draws as its icon
  ok: the page draws 4 causes, the ones expected
  ok: the page holds all 1 kept images
  ok: the page links to all 21 attachments in the folder beside it, and holds the ones that are text
  ok: a pull request's run writes the trial page, and leaves the history and the report byte for byte
  ok: the next full run joins the history as run 2
  ok: with a folder that cannot be written, the exit code stays 1 on a failing run and 0 on a passing one
mocha
  ok: its tools are here, and its recorder is installed from its npm package
  ok: 13 results are exactly the ones expected, each sorted as expected
  ok: 1 worker wrote its file
  ok: its lane is recorded as chrome on web, which the page draws as its icon
  ok: the page draws 5 causes, the ones expected
  ok: the page holds all 4 kept images
  ok: the page links to all 2 attachments in the folder beside it, and holds the ones that are text
  ok: a pull request's run writes the trial page, and leaves the history and the report byte for byte
  ok: the next full run joins the history as run 2
  ok: with a folder that cannot be written, the exit code stays 5 on a failing run and 0 on a passing one
4 recorders passed
```

Each suite's `expected.json` holds the exact records it must produce, with what changes between machines left out.
A new recorder adds a suite under `recorder-test/` and a line in `recorder-test/run.ts`.
`--write-expected` writes the file from a run, and every line of it is then read against the suite by a person, because a record copied from a wrong recorder proves nothing.

## Releasing

A release is a tag, `v` and the version, and the version is three numbers, e.g: `0.1.0`, as npm and PyPI spell a pre-release differently.
`pnpm set-version` writes it into the five places that carry it, and that change reaches `main` through a pull request like any other:

```bash
version=0.1.2
git switch --create "release-$version"
pnpm set-version "$version"
git commit --message "Release $version" -- package.json recorders/python/pyproject.toml recorders/junit5/build.gradle.kts recorder-test/junit5/build.gradle.kts README.md
git push --set-upstream origin "release-$version"
gh pr create --fill
```

Only once that pull request is merged, the tag goes on `main` as it is on GitHub, and the version it carries is read before it is pushed:

```bash
git fetch origin
git tag "v$version" origin/main
git show "v$version:package.json" | grep '"version"'
git push origin "v$version"
```

A tag on a commit that carries another version fails the `build` job, before anything is published, and is deleted with `git push origin --delete "refs/tags/v$version"` and `git tag --delete "v$version"`.

The tag starts `.github/workflows/release.yml`:

| Job | Does |
|---|---|
| `checks` | every check, as on a push |
| `build` | fails unless all five places carry the tag's version, then builds the npm package, the wheel and the JUnit 5 recorder's Maven files, unsigned |
| `publish` | waits for a maintainer to approve the `release` environment, then signs the Maven files and has Maven Central check them without publishing them, publishes to npm and to PyPI, and has Maven Central publish what it checked; npm and Maven Central skip a version they already have |
| `installed` | installs the command and the Playwright Test reporter from npm, the behave recorder from PyPI and the JUnit 5 recorder from Maven Central, as a team does, and runs the recorder test on them, trying again for a few minutes while a registry catches up |

Maven Central goes first: it checks the bundle and holds it unpublished until npm and PyPI have published.
A bundle it refuses fails `publish` before anything is published anywhere, so the tag is deleted as above and the same version is tagged again on the fix.
When a later step of `publish` fails while Central still holds the bundle unpublished, the bundle is dropped, so running the job again uploads it anew.
npm and PyPI publish through trusted publishing, so no token of theirs is kept; Maven Central's [token page](https://central.sonatype.org/publish/generate-portal-token/) says "You must use a user token to publish artifacts", so its token and signing key are secrets of the `release` environment.
A published version is never replaced: PyPI refuses a file name once used, npm unpublishes a new package only within 72 hours, and Maven Central never alters a released component, so a fault is fixed by the next version.

A release is approved on its run's page, under the banner saying `release` requires an approval, or, where that dialog offers no approval, through GitHub's API, with the run's id and the environment's id that `gh api repos/yopeso/q6-report/actions/runs/<run>/pending_deployments` lists:

```bash
gh api --method POST repos/yopeso/q6-report/actions/runs/<run>/pending_deployments -F 'environment_ids[]=<environment id>' -f state=approved
```

What a release relies on, set up once:

| Where | What |
|---|---|
| This repository's settings, Environments | the environment `release`, deployable from tags matching `v*` only, with the maintainers who approve a release as its required reviewers |
| pypi.org, the project's Publishing | the trusted publisher: owner `yopeso`, repository `q6-report`, workflow `release.yml`, environment `release` |
| npmjs.com | 0.1.0, published by hand from the tarball its release run built, as npm takes a trusted publisher only for a package it already has; publishing needs two-factor on the account, as npm refuses an upload without it |
| central.sonatype.com | the account that signs in with the GitHub account `qa-automation-q6`, with the namespace `io.github.qa-automation-q6` verified on it, and a user token, kept as the environment's secret `MAVEN_CENTRAL_TOKEN` |
| keyserver.ubuntu.com | the public half of the signing key, whose private half is the environment's secret `MAVEN_SIGNING_KEY` |

Maven Central is set up once, at https://central.sonatype.com:

1. Sign in with GitHub as `qa-automation-q6`; in the account menu, View Namespaces lists `io.github.qa-automation-q6` as Verified.
   If it ever has to be verified again, Add Namespace shows a Verification Key: create an empty public repository named after that key in the `qa-automation-q6` account, click Verify Namespace and Confirm, and delete the repository once the namespace says Verified.
2. Generate a user token at https://central.sonatype.com/usertoken, and keep its username and password joined by a colon, as `<username>:<password>`, which `gh secret set` asks for:

   ```bash
   gh secret set MAVEN_CENTRAL_TOKEN --env release --repo yopeso/q6-report
   ```

The token's expiry is the day releases start failing at Maven Central's check, with a 401 and nothing published, and a new token replaces it.

The signing key is made once, in a folder deleted afterwards, so the secret holds its only private copy.
Maven Central's GPG page says it verifies only against a primary key, and `rsa4096 sign` makes one primary key that signs, with no subkey.
It has no passphrase, as one would be kept in the same secrets beside it, and it never expires; a lost or leaked key is replaced by running these lines again:

```bash
export GNUPGHOME="$(mktemp -d /tmp/q6-report-key.XXXXXX)"
gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "q6-report releases, Yopeso <the address the key shows>" rsa4096 sign never
fingerprint="$(gpg --list-secret-keys --with-colons | awk -F: '$1 == "fpr" { print $10; exit }')"
gpg --keyserver hkps://keyserver.ubuntu.com --send-keys "$fingerprint"
gpg --export-secret-keys --armor "$fingerprint" | gh secret set MAVEN_SIGNING_KEY --env release --repo yopeso/q6-report
gpgconf --kill gpg-agent
rm -rf "$GNUPGHOME"
unset GNUPGHOME
```

npm's trusted publisher is created on the day of the next release, and not before, as one that has not published within 2 days expires.
It allows `npm publish` only when told to, and `npm trust` needs npm 11.15.0 or newer:

```bash
npm trust github q6-report --repository yopeso/q6-report --file release.yml --environment release --allow-publish
```

