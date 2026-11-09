# q6-report for behave

The behave recorder of [q6-report](https://github.com/yopeso/q6-report), a test report that keeps a project's history in one HTML file, with no server and no network.
The recorder writes each scenario's result while behave runs, and the `q6-report` command from npm adds the run to the history and writes the page.

## Install

From the suite's root, `npx --yes q6-report init` does everything below once, with the tool the project uses, and says what it changed.
By hand:

Add it beside behave with the tool that keeps your project's dependencies, e.g: Poetry, which writes it into `pyproject.toml`:

```text
poetry add --group dev q6-report
```

`pip install q6-report` installs it into the active environment only, so a project on pip also lists `q6-report` in its requirements file.

Turn it on in `behave.ini`, as a formatter under the first one, which stays on the `format` line:

```ini
[behave]
format = pretty
    q6_report.behave_recorder:Recorder
```

The recorder writes into a `q6-report` folder in the folder behave runs from, or into the folder `Q6_REPORT_DIR` names.

A failed scenario shows its screenshot when the suite saves its screenshots as files into one folder, named once in `behave.ini`; for each attempt, the recorder takes the newest image saved there while it ran:

```ini
[behave.userdata]
q6_report.screenshots = screenshots
```

A suite with no such folder hands each file over with `q6_report.attach_image(path)` from its screenshot code.

## The page

When behave ends, the recorder writes the page with the `q6-report` command from npm, of its own version, and behave prints where the page is.
That needs Node 22 or newer on the machine; without it, the recorder says what to run on a machine that has it, beside the folder.
In a CI, the page is written once, after every job, by `npx --yes q6-report finish`, so there the recorder leaves it.

A run stopped with Ctrl+C goes to a page of trial runs, which the report links to, and leaves the report's history as it was.

Screenshots, attachments, settings and the CI setups are in the [README](https://github.com/yopeso/q6-report#readme).
