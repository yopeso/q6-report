"""What every Python recorder shares, so a recorder holds only the mapping from its framework's events to a result.

Nothing here may raise into a test: a recording that breaks is told about, and the test carries on.
"""

import contextlib
import json
import os
import re
import shlex
import shutil
import socket
import sys
import time
import traceback
from datetime import datetime, timezone

RECORD_VERSION = 2
MAX_MESSAGE = 2000
MAX_STACK = 4000
DEFAULT_DIR = "q6-report"
DEFAULT_BUG_TAG = r"^@(bug[-:].+)$"

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_LIBRARY = re.compile(r"[\\/](site-packages|dist-packages|\.venv|venv|lib[\\/]python[^\\/]*)[\\/]")
# Other libraries' errors are told apart by class name, so a suite without them needs nothing installed.
_TIMEOUT_NAMES = {"TimeoutException", "TimeoutError", "ConditionTimeoutError"}
_MISSING_NAMES = {"NoSuchElementException", "ElementNotVisibleException"}
_ENV_NAMES = {"SessionNotCreatedException", "InvalidSessionIdException", "NoSuchWindowException", "MaxRetryError"}

_pending_images = []


class _Attached:
    """The files attached to the test running now, copied into its lane's folder the moment each is attached."""

    def __init__(self):
        self.folder = None
        self.attempt = 1
        self.files = []
        self.count = 0


_attached = _Attached()


def warn(message):
    print("q6-report: " + message, file=sys.stderr)


def _safe_folder_name(name):
    safe = re.sub(r"[^\w.-]+", "-", name).strip(".-")
    if not safe:
        raise ValueError('"{}" cannot name a folder, because it has no letter or digit.'.format(name))
    return safe


def lane_folder(framework, env=os.environ):
    """Where a recorder writes its lane's results; the lane is the framework's name unless a suite names it."""
    base = env.get("Q6_REPORT_DIR") or DEFAULT_DIR
    return os.path.join(base, ".run", _safe_folder_name(env.get("Q6_REPORT_LANE") or framework))


def worker_file(folder, framework):
    """A worker's own file, so parallel workers never share one."""
    return os.path.join(folder, "{}-{}.jsonl".format(framework, os.getpid()))


def write_result(path, result):
    """Adds one line. None is left out, as a field a framework cannot fill stays unset."""
    try:
        line = {"v": RECORD_VERSION, "finishedAt": datetime.now(timezone.utc).isoformat()}
        line.update((key, value) for key, value in result.items() if value is not None)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(json.dumps(line, ensure_ascii=False) + "\n")
    except Exception as error:
        warn('The report could not record "{}": {}'.format(result.get("name"), error))


def attach_image(path):
    """For a suite's screenshot helper: the image of the attempt running now."""
    _pending_images.append(path)


def forget_images():
    del _pending_images[:]


def attach(path, name=None):
    """For a suite's own code: a file of the test running now, e.g: a video or a log, kept as it is at this moment."""
    if _attached.folder is None:
        # No recorder is running, so no result could hold it.
        return
    try:
        _attached.count += 1
        stored = "{}-{}-{}".format(os.getpid(), _attached.count, os.path.basename(path))
        os.makedirs(os.path.join(_attached.folder, "attachments"), exist_ok=True)
        shutil.copyfile(path, os.path.join(_attached.folder, "attachments", stored))
        _attached.files.append(
            {"name": str(name or os.path.basename(path)), "path": "attachments/" + stored, "attempt": _attached.attempt}
        )
    except Exception as error:
        warn("The report could not keep the attachment {}: {}".format(path, error))


def collect_attachments(folder):
    """Called by a recorder as it starts, so a file attached from then on is copied into its lane's folder."""
    _attached.folder = folder


def start_attempt(number):
    """A test starts, or runs again: what it attaches from now on is that attempt's."""
    _attached.attempt = number


def take_attachments(attempts):
    """The files a test attached, for its result; which attempt each came from is said only when it ran more than once."""
    files, _attached.files = _attached.files, []
    if attempts == 1:
        for file in files:
            file.pop("attempt", None)
    return files or None


def drop_attachments():
    """Removes files attached while no test was running, e.g: in a feature's hook, as no result holds them."""
    for file in _attached.files:
        warn('"{}" was attached while no test was running, so no result holds it'.format(file["name"]))
        with contextlib.suppress(OSError):
            os.remove(os.path.join(_attached.folder, file["path"]))
    _attached.files = []


def keep_images(folder):
    """Copies the attempt's newest image into the lane's folder, which travels with its results, and returns its path there."""
    if not _pending_images:
        return None
    source = _pending_images[-1]
    forget_images()
    try:
        name = "{}-{}-{}".format(os.getpid(), int(time.time() * 1000), os.path.basename(source))
        os.makedirs(os.path.join(folder, "images"), exist_ok=True)
        shutil.copyfile(source, os.path.join(folder, "images", name))
        return {"path": "images/" + name}
    except Exception as error:
        warn("The report could not keep the image {}: {}".format(source, error))
        return None


def _names_of(error):
    return {cls.__name__ for cls in type(error).__mro__}


def kind_of(error):
    """What the error object says it is, from its type and never from its wording."""
    names = _names_of(error)
    if isinstance(error, AssertionError):
        return "check"
    # A timeout is an OSError too, so it is asked about first.
    if isinstance(error, (TimeoutError, socket.timeout)) or names & _TIMEOUT_NAMES:
        return "timeout"
    # Exactly LookupError, which is what Squish raises for an object it cannot find; KeyError and IndexError are a suite's own bugs.
    if type(error) is LookupError or names & _MISSING_NAMES:
        return "missing"
    if isinstance(error, (ConnectionError, socket.gaierror, socket.herror)) or names & _ENV_NAMES:
        return "env"
    if "WebDriverException" in names and "net::ERR" in str(error):
        return "env"
    return "error"


def message_of(error):
    """A thrown type says something an assertion's own message does not need, so only an assertion goes without it."""
    text = _ANSI.sub("", str(error)).strip()
    if isinstance(error, AssertionError):
        return (text or "AssertionError")[:MAX_MESSAGE]
    name = type(error).__name__
    return (name + ": " + text if text else name)[:MAX_MESSAGE]


def at_of(error, root=None):
    """Where it failed: the deepest frame in the suite's own code, as file:line from its root."""
    root = os.path.abspath(root or os.getcwd())
    frames = traceback.extract_tb(error.__traceback__)
    for frame in reversed(frames):
        path = os.path.abspath(frame.filename)
        if _LIBRARY.search(path) or not path.startswith(root + os.sep):
            continue
        return "{}:{}".format(os.path.relpath(path, root).replace(os.sep, "/"), frame.lineno)
    return None


def failure_of(error):
    """The fields a result takes from an error."""
    stack = "".join(traceback.format_exception(type(error), error, error.__traceback__))
    return {
        "error": message_of(error),
        "stack": _ANSI.sub("", stack)[:MAX_STACK],
        "at": at_of(error),
        "kind": kind_of(error),
    }


def known_bug_of(tags, env=os.environ):
    """The known bug a test's tags mark, by the pattern Q6_REPORT_BUG_TAG gives; its first group is the bug, or the whole match."""
    try:
        pattern = re.compile(env.get("Q6_REPORT_BUG_TAG") or DEFAULT_BUG_TAG, re.IGNORECASE)
    except re.error as error:
        warn("Q6_REPORT_BUG_TAG is not a pattern, so no test is marked as a known bug: {}".format(error))
        return None
    for tag in tags:
        found = pattern.search(tag)
        if found:
            return found.group(1) if pattern.groups else found.group(0)
    return None


def rerun_of(name, path=None, env=os.environ):
    """The command that runs a test again, from the template in Q6_REPORT_RERUN; a name reaches the shell quoted."""
    template = env.get("Q6_REPORT_RERUN")
    if not template:
        return None
    return template.replace("{name}", shlex.quote(name)).replace("{file}", shlex.quote(path or ""))
