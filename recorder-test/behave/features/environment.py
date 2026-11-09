import base64
import os
import tempfile
import time

import q6_report

# The smallest real PNG, as what a suite's screenshot helper would have written.
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
ATTEMPTS = 2
shot_once_taken = set()


def rerun_failures(scenario):
    """How a suite repeats a failed scenario inside one behave run: calling its run again."""
    original = scenario.run

    def run_with_reruns(runner):
        for attempt in range(ATTEMPTS):
            failed = original(runner)
            if not failed:
                break
        return failed

    scenario.run = run_with_reruns


def before_feature(context, feature):
    for scenario in feature.walk_scenarios():
        if "retry" in scenario.effective_tags:
            rerun_failures(scenario)


def before_scenario(context, scenario):
    if "hook_fails" in scenario.effective_tags:
        raise RuntimeError("the fixture would not start")


def after_step(context, step):
    if step.status.name not in ("failed", "error"):
        return
    scenario = context.scenario
    tags = scenario.effective_tags
    if "shot" in tags and "retry" not in tags:
        # Handed over, as a suite's screenshot helper does.
        handle, path = tempfile.mkstemp(suffix=".png")
        with os.fdopen(handle, "wb") as stream:
            stream.write(PNG)
        q6_report.attach_image(path)
    elif "shot" in tags or ("shot_once" in tags and scenario.name not in shot_once_taken):
        # Only saved into the folder behave.ini names, as a suite that never calls the recorder does, by the scenarios that
        # rerun: each attempt's result is the image its own attempt saved, and a last attempt that saved none shows none.
        shot_once_taken.add(scenario.name)
        os.makedirs("screenshots", exist_ok=True)
        with open(os.path.join("screenshots", "{}.png".format(time.time_ns())), "wb") as stream:
            stream.write(PNG)


def attach_written(name, file_name, content):
    """Attaches a file the way a suite's teardown does, and deletes it straight after, as a suite may."""
    path = os.path.join(tempfile.mkdtemp(), file_name)
    with open(path, "wb") as stream:
        stream.write(content)
    q6_report.attach(path, name)
    os.remove(path)


def after_scenario(context, scenario):
    if "video" in scenario.effective_tags:
        # Bytes a page cannot show as text, as a video's are.
        attach_written("Execution video", "run.mp4", b"\x00\x00\x00\x18ftypmp42")
    if "log_each_attempt" in scenario.effective_tags:
        attach_written("Attempt log", "attempt.log", "ended {}\n".format(scenario.status.name).encode())
