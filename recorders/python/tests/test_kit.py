import contextlib
import io
import os
import socket
import tempfile
import unittest

from q6_report import kit


def raised(error):
    try:
        raise error
    except Exception as caught:
        return caught


class TimeoutException(Exception):
    """Named as Selenium names its own, so no Selenium is needed to test the rule."""


class NoSuchElementException(Exception):
    pass


class WebDriverException(Exception):
    pass


class KindTest(unittest.TestCase):
    def test_an_error_is_sorted_by_its_type(self):
        for error, kind in [
            (AssertionError("x"), "check"),
            (TimeoutError("x"), "timeout"),
            (socket.timeout("x"), "timeout"),
            (TimeoutException("x"), "timeout"),
            (LookupError("Object not found"), "missing"),
            (NoSuchElementException("x"), "missing"),
            (ConnectionRefusedError("x"), "env"),
            (socket.gaierror("x"), "env"),
            (WebDriverException("unknown error: net::ERR_CONNECTION_REFUSED"), "env"),
            (ValueError("x"), "error"),
        ]:
            self.assertEqual(kit.kind_of(error), kind, repr(error))

    def test_a_suites_own_bug_does_not_read_as_something_else(self):
        # Each of these is a subclass of something a rule above catches, or words that could fool a reader of messages.
        for error in [
            KeyError("x"),
            IndexError("x"),
            FileNotFoundError("x"),
            PermissionError("x"),
            WebDriverException("stale"),
            ValueError("session timed out, assert failed, net::ERR"),
        ]:
            self.assertEqual(kit.kind_of(error), "error", repr(error))


class MessageTest(unittest.TestCase):
    def test_a_thrown_type_is_named_and_an_assertion_is_not(self):
        self.assertEqual(kit.message_of(ValueError("bad")), "ValueError: bad")
        self.assertEqual(kit.message_of(AssertionError("Expected 1")), "Expected 1")

    def test_an_error_with_no_words_still_says_something(self):
        self.assertEqual(kit.message_of(AssertionError()), "AssertionError")
        self.assertEqual(kit.message_of(ValueError()), "ValueError")

    def test_colour_codes_are_removed(self):
        self.assertEqual(kit.message_of(AssertionError("\x1b[31mred\x1b[0m")), "red")


class AtTest(unittest.TestCase):
    def test_it_is_this_file_from_its_root(self):
        at = kit.at_of(raised(ValueError("x")), root=os.path.dirname(__file__))
        self.assertRegex(at, r"^test_kit\.py:\d+$")

    def test_a_file_outside_the_root_is_no_place_in_the_suite(self):
        self.assertIsNone(kit.at_of(raised(ValueError("x")), root=tempfile.gettempdir()))

    def test_a_folder_that_only_starts_like_the_root_is_outside_it(self):
        here = os.path.dirname(os.path.abspath(__file__))
        self.assertIsNone(kit.at_of(raised(ValueError("x")), root=here[:-1]))


class KnownBugTest(unittest.TestCase):
    def test_both_ways_of_marking_a_bug_count_with_no_option(self):
        self.assertEqual(kit.known_bug_of(["@smoke", "@bug:SHOP-1"], {}), "bug:SHOP-1")
        self.assertIsNone(kit.known_bug_of(["@BL-030"], {}))
        self.assertEqual(kit.known_bug_of(["@BL-030"], {"Q6_REPORT_BUG_TAG": "^@((?:bug|BL)[-:].+)$"}), "BL-030")

    def test_a_tag_that_only_contains_the_word_does_not(self):
        self.assertIsNone(kit.known_bug_of(["@debugging", "@bug", "@ladybug-1"], {}))

    def test_a_pattern_takes_its_first_group_or_its_whole_match(self):
        self.assertEqual(kit.known_bug_of(["@JIRA-7"], {"Q6_REPORT_BUG_TAG": "^@JIRA-(.+)$"}), "7")
        self.assertEqual(kit.known_bug_of(["@JIRA-7"], {"Q6_REPORT_BUG_TAG": "JIRA-\\d+"}), "JIRA-7")

    def test_a_broken_pattern_marks_nothing_and_raises_nothing(self):
        self.assertIsNone(kit.known_bug_of(["@bug:1"], {"Q6_REPORT_BUG_TAG": "("}))


class RerunTest(unittest.TestCase):
    def test_a_name_reaches_the_shell_quoted(self):
        command = kit.rerun_of("it's; rm -rf /", env={"Q6_REPORT_RERUN": "behave --name {name}"})
        self.assertEqual(command, "behave --name 'it'\"'\"'s; rm -rf /'")

    def test_no_template_means_no_command(self):
        self.assertIsNone(kit.rerun_of("x", env={}))


class FolderTest(unittest.TestCase):
    def test_a_lane_stays_one_folder(self):
        self.assertEqual(kit.lane_folder("behave", {"Q6_REPORT_DIR": "r", "Q6_REPORT_LANE": "../../etc"}), os.path.join("r", ".run", "etc"))

    def test_the_framework_names_the_lane_without_an_option(self):
        self.assertEqual(kit.lane_folder("behave", {}), os.path.join("q6-report", ".run", "behave"))


class WriteTest(unittest.TestCase):
    def test_a_folder_that_cannot_be_written_raises_nothing(self):
        with tempfile.NamedTemporaryFile() as blocker:
            kit.write_result(os.path.join(blocker.name, "x", "y.jsonl"), {"name": "a test"})


class AttachTest(unittest.TestCase):
    def setUp(self):
        self.lane = tempfile.mkdtemp()
        self.addCleanup(kit.collect_attachments, None)
        self.addCleanup(kit.take_attachments, 1)

    def written(self, name, content=b"started\n"):
        path = os.path.join(tempfile.mkdtemp(), name)
        with open(path, "wb") as stream:
            stream.write(content)
        return path

    def test_with_no_recorder_running_nothing_is_kept(self):
        kit.collect_attachments(None)
        kit.attach(self.written("run.log"))
        self.assertIsNone(kit.take_attachments(1))

    def test_a_file_is_copied_as_it_is_when_attached(self):
        kit.collect_attachments(self.lane)
        path = self.written("run.log")
        kit.attach(path, "Run log")
        with open(path, "wb") as stream:
            stream.write(b"changed afterwards")
        os.remove(path)
        [file] = kit.take_attachments(1)
        self.assertEqual(file["name"], "Run log")
        with open(os.path.join(self.lane, file["path"]), "rb") as stream:
            self.assertEqual(stream.read(), b"started\n")

    def test_a_file_goes_by_its_own_name_without_one_given(self):
        kit.collect_attachments(self.lane)
        kit.attach(self.written("run.log"))
        self.assertEqual([file["name"] for file in kit.take_attachments(1)], ["run.log"])

    def test_two_files_of_one_name_stay_two_files(self):
        kit.collect_attachments(self.lane)
        kit.attach(self.written("run.log", b"one"))
        kit.attach(self.written("run.log", b"two"))
        paths = [file["path"] for file in kit.take_attachments(1)]
        self.assertEqual(len(set(paths)), 2)

    def test_each_file_says_its_attempt_only_when_there_was_more_than_one(self):
        kit.collect_attachments(self.lane)
        kit.start_attempt(1)
        kit.attach(self.written("first.log"))
        kit.start_attempt(2)
        kit.attach(self.written("second.log"))
        self.assertEqual([file["attempt"] for file in kit.take_attachments(2)], [1, 2])
        kit.start_attempt(1)
        kit.attach(self.written("only.log"))
        self.assertNotIn("attempt", kit.take_attachments(1)[0])

    def test_a_missing_file_is_told_about_and_raises_nothing(self):
        kit.collect_attachments(self.lane)
        said = io.StringIO()
        with contextlib.redirect_stderr(said):
            kit.attach(os.path.join(self.lane, "never-written.log"))
        self.assertIn("could not keep the attachment", said.getvalue())
        self.assertIsNone(kit.take_attachments(1))

    def test_a_file_no_test_holds_is_told_about_and_removed(self):
        kit.collect_attachments(self.lane)
        kit.attach(self.written("between.log"))
        self.assertEqual(len(os.listdir(os.path.join(self.lane, "attachments"))), 1)
        said = io.StringIO()
        with contextlib.redirect_stderr(said):
            kit.drop_attachments()
        self.assertIn('"between.log" was attached while no test was running', said.getvalue())
        self.assertEqual(os.listdir(os.path.join(self.lane, "attachments")), [])
        self.assertIsNone(kit.take_attachments(1))


if __name__ == "__main__":
    unittest.main()
