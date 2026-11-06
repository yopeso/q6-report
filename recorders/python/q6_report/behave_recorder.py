"""The behave recorder, turned on by one format line: q6_report.behave_recorder:Recorder.

It is a formatter, which sits beside any other formatter and sees what they see, in the order behave tells them.
"""

from behave.formatter.base import Formatter

from . import kit

_FAILED = {"failed", "error", "hook_error", "cleanup_error", "undefined", "pending"}
_FRAMEWORK = "behave"


def _step_status(step):
    name = step.status.name
    if name == "passed" or name == "pending_warn":
        return "passed"
    return "failed" if name in _FAILED else "notRun"


def _scenario_status(scenario):
    name = scenario.status.name
    if name in _FAILED:
        return "failed"
    return "passed" if name in ("passed", "pending_warn") else "skipped"


def _exception_of(failed_step, scenario):
    # A hook's failure sits on the scenario, as it happened outside any step.
    return getattr(failed_step, "exception", None) or getattr(scenario, "exception", None)


def _failure_of(failed_step, scenario):
    error = _exception_of(failed_step, scenario)
    if error is not None:
        return kit.failure_of(error)
    if failed_step is not None and failed_step.status.name == "undefined":
        return {"error": "This step has no code: {}".format(failed_step.name), "kind": "error"}
    message = getattr(failed_step, "error_message", None) or getattr(scenario, "error_message", None)
    return {"error": (message or "It failed with no error").split("\n")[0][: kit.MAX_MESSAGE]}


def _tags_of(scenario):
    # In the order they were written, as effective_tags is a set, whose order changes from one run to the next.
    written = list(scenario.feature.tags) + list(scenario.tags)
    inherited = sorted(set(scenario.effective_tags) - set(written))
    return list(dict.fromkeys("@" + tag for tag in written + inherited))


def result_of(scenario, attempts, image, attachments=None):
    steps = list(scenario.all_steps)
    rows = [
        {"keyword": step.keyword, "text": step.name, "status": _step_status(step), "ms": round((step.duration or 0) * 1000)}
        for step in steps
    ]
    tags = _tags_of(scenario)
    status = _scenario_status(scenario)
    filename = scenario.location.filename
    # An outline row's generated name ends in a space.
    name = scenario.name.strip()
    result = {
        "test": "{}::{}".format(scenario.feature.name, name),
        "name": name,
        "group": scenario.feature.name,
        "file": filename,
        "tags": tags,
        "status": status,
        "ms": round((scenario.duration or 0) * 1000),
        "attempts": attempts,
        "steps": rows,
        "knownBug": kit.known_bug_of(tags),
        "rerun": kit.rerun_of(name, filename),
        "attachments": attachments,
    }
    if status == "failed":
        failed_at = next((index for index, row in enumerate(rows) if row["status"] == "failed"), None)
        result["failedAt"] = failed_at
        result.update(_failure_of(steps[failed_at] if failed_at is not None else None, scenario))
        result["image"] = image
    return result


class Recorder(Formatter):
    name = "q6-report"
    description = "Writes one line per scenario for q6-report"

    def __init__(self, stream_opener, config):
        super().__init__(stream_opener, config)
        self.folder = kit.lane_folder(_FRAMEWORK)
        self.file = kit.worker_file(self.folder, _FRAMEWORK)
        self.current = None
        self.attempts = 0
        self.this_feature = None
        self.recorded = set()
        kit.collect_attachments(self.folder)

    def feature(self, feature):
        self.this_feature = feature

    def scenario(self, scenario):
        # A rerun runs the same scenario object again, and the last attempt is the one that decides it. Every attempt's
        # files stay, as the files of a failed attempt are what tells why a pass on a retry is flaky.
        if scenario is self.current:
            self.attempts += 1
            kit.forget_images()
            kit.start_attempt(self.attempts)
            return
        self._finish()
        # Behave says a scenario started before its before_scenario hook, so only a feature's own hooks get here.
        kit.drop_attachments()
        self.current = scenario
        self.attempts = 1
        kit.forget_images()
        kit.start_attempt(1)

    def eof(self):
        # Behave says a feature ended after its after_feature hook, so a file attached there is its last scenario's.
        self._finish()
        self._record_unannounced()
        self.this_feature = None

    def close(self):
        self._finish()
        kit.drop_attachments()

    def _record_unannounced(self):
        # With show_skipped off, behave tells a formatter nothing about a skipped scenario, and it would vanish from the report.
        if self.this_feature is None:
            return
        for scenario in self.this_feature.walk_scenarios():
            if id(scenario) not in self.recorded:
                self._write(scenario, 1, None)

    def _finish(self):
        scenario, self.current = self.current, None
        if scenario is not None:
            self._write(scenario, self.attempts, kit.keep_images(self.folder), kit.take_attachments(self.attempts))

    def _write(self, scenario, attempts, image, attachments=None):
        self.recorded.add(id(scenario))
        try:
            kit.write_result(self.file, result_of(scenario, attempts, image, attachments))
        except Exception as error:
            kit.warn('The report could not record "{}": {}'.format(scenario.name, error))
