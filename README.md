# q6-report

A test report that keeps a project's history in one HTML file, with no server and no network.
A recorder inside a test suite writes each test's result as it runs, and the `q6-report` command adds the run to the project's history and writes the page again.
The page opens from the file in a browser, so it can be mailed or kept as a CI artifact as it is.

Recorders for behave and JUnit 5 are here, and a suite on any other framework writes the same lines itself.
The `q6-report` command installs from npm and the behave recorder from PyPI; the JUnit 5 recorder is not on Maven Central yet, so it installs from what this repository builds, as below.
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
| npm `q6-report` | the report, the `q6-report` command and its types, with the page already bundled, so it installs with no dependency | `pnpm pack`, which runs `build.ts` first | a `.tgz` |
| PyPI `q6-report` | the behave recorder, standard library only | `python3 -m pip wheel --no-deps` on `recorders/python` | a `.whl` |
| Maven Central `io.github.yopeso:q6-report-junit5` | the JUnit 5 recorder, which is also the agent behind `@Step`, with Byte Buddy packed inside, and its sources and javadoc | `publishAllPublicationsToBuildRepository` in `recorders/junit5` | `recorders/junit5/build/repo` |

All three carry one version, the last release's, which [Releasing](#releasing) sets.
`recorders/python/LICENSE` is a copy of `LICENSE`, because a wheel can only carry a file from its own folder, and the recorder test fails if the wheel's copy differs.
Maven Central verified the group `io.github.yopeso` to Yopeso through its GitHub organisation.

## Recorders

A recorder runs inside a suite and writes one line of JSON per test, and the report reads only those lines.
A recording that breaks never decides a test: the suite's exit code stays its own, and the recorder says what went wrong.

| Framework | Language it is written in | Where |
|---|---|---|
| behave | Python, standard library only | `recorders/python/q6_report/behave_recorder.py` |
| JUnit 5, from Kotlin or Java | Java 11, with no dependency at run time | `recorders/junit5/` |
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

Adding the dependency turns the recorder on, through `META-INF/services`.
Until it is on Maven Central, a Gradle suite takes it from the folder it is published into.

```text
$ recorders/junit5/gradlew -p recorders/junit5 publishAllPublicationsToBuildRepository
> Task :generatePomFileForRecorderPublication
> Task :publishRecorderPublicationToBuildRepository
> Task :publishAllPublicationsToBuildRepository

BUILD SUCCESSFUL in 3s
```

```kotlin
// build.gradle.kts
repositories {
  maven { url = uri("<this repository>/recorders/junit5/build/repo") }
  mavenCentral()
}

dependencies {
  testImplementation("io.github.yopeso:q6-report-junit5:0.0.0")
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

### Settings

Every recorder reads the same ones, and none is needed.

| Setting | What it does | Without it |
|---|---|---|
| `Q6_REPORT_DIR` | the folder a run's records, history and page go in | `q6-report` in the folder the suite runs from |
| `Q6_REPORT_LANE` | names the lane, e.g: `chrome` | the framework's name |
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

### The line

One JSON object per line, in any file ending `.jsonl` under `<dir>/.run/<lane>/`, with a file per process so parallel workers never share one.
`src/result-line.ts` reads it, and it is where the report stops trusting a recorder: a field it cannot use is dropped, and a line it cannot read is skipped with a warning.

```json
{"v":2,"finishedAt":"2026-11-01T07:16:00Z","test":"Shop::Totals a line","name":"Totals a line","group":"Shop","file":"features/shop.feature","tags":[],"status":"failed","ms":12,"attempts":1,"steps":[{"keyword":"Then","text":"the cart holds 8","status":"failed","ms":1}],"failedAt":0,"error":"Expected 8 items but got 7","stack":"...","at":"features/steps/shop_steps.py:31","kind":"check"}
```

`test`, and a `status` of `passed`, `failed` or `skipped`, are all a line must hold.
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
ok: 83 files name nothing but q6-report, with the private names checked
```

### The recorder test

`pnpm check:recorders` runs a small suite with known outcomes per recorder, on the real framework, and a recorder cannot ship until it passes.
It installs behave and setuptools into `node_modules/.cache` and takes Gradle from the wrapper, so its first run needs a network; it needs Python 3, a JDK and Chrome, and says which is missing.
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
  ok: the page draws 18 causes, the ones expected
  ok: the page holds all 15 kept images
  ok: the page links to all 4 attachments in the folder beside it, and holds the ones that are text
  ok: a pull request's run writes the trial page, and leaves the history and the report byte for byte
  ok: the next full run joins the history as run 2
  ok: with a folder that cannot be written, the exit code stays 1 on a failing run and 0 on a passing one
  ok: without its agent, a suite that uses @Step is told that no such step is recorded
2 recorders passed
```

Each suite's `expected.json` holds the exact records it must produce, with what changes between machines left out.
A new recorder adds a suite under `recorder-test/` and a line in `recorder-test/run.ts`.
`--write-expected` writes the file from a run, and every line of it is then read against the suite by a person, because a record copied from a wrong recorder proves nothing.

## Releasing

A release is a tag, `v` and the version, and the version is three numbers, e.g: `0.1.0`, as npm and PyPI spell a pre-release differently.
`pnpm set-version` writes it into the four places that carry it, and that change reaches `main` through a pull request like any other:

```bash
version=0.1.1
git switch --create "release-$version"
pnpm set-version "$version"
git commit --message "Release $version" -- package.json recorders/python/pyproject.toml recorders/junit5/build.gradle.kts recorder-test/junit5/build.gradle.kts
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
| `build` | fails unless all four places carry the tag's version, then builds the npm package and the wheel |
| `npm`, `pypi` | wait for a maintainer to approve the `release` environment, then publish through trusted publishing, so no token is kept; npm skips a version it already has |
| `installed` | installs the command from npm and the behave recorder from PyPI, as a team does, and runs the recorder test on them, trying again for a few minutes while a registry catches up |

A published version is never replaced: PyPI refuses a file name once used, and npm unpublishes a new package only within 72 hours, so a fault is fixed by the next version.
The JUnit 5 recorder joins once Maven Central's Portal token and signing key are kept as secrets of the `release` environment; until then it is built from this repository.

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

npm's trusted publisher is created on the day of the next release, and not before, as one that has not published within 2 days expires.
It allows `npm publish` only when told to, and `npm trust` needs npm 11.15.0 or newer:

```bash
npm trust github q6-report --repository yopeso/q6-report --file release.yml --environment release --allow-publish
```

