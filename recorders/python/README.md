# q6-report for behave

The behave recorder of [q6-report](https://github.com/yopeso/q6-report), a test report that keeps a project's history in one HTML file, with no server and no network.
The recorder writes each scenario's result while behave runs, and the `q6-report` command from npm adds the run to the history and writes the page.

## Install

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

## Write the page

The `q6-report` command from npm writes the page from that folder, so this step needs Node 22 or newer, on any machine that has the folder:

```text
npx --yes q6-report finish --project <project name>
```

Screenshots, attachments, settings and the CI setups are in the [README](https://github.com/yopeso/q6-report#readme).
