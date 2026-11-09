import unittest
from types import SimpleNamespace

from q6_report import behave_recorder


def step(status, exception=None):
    return SimpleNamespace(status=SimpleNamespace(name=status), exception=exception, keyword="Given", name="a step", duration=0.1)


def scenario(steps, status):
    return SimpleNamespace(
        all_steps=steps,
        status=SimpleNamespace(name=status),
        exception=None,
        error_message=None,
        feature=SimpleNamespace(name="Shop", tags=[]),
        tags=[],
        effective_tags=[],
        location=SimpleNamespace(filename="features/shop.feature"),
        name="Pays by card",
        duration=1.0,
    )


class CancelTest(unittest.TestCase):
    def test_the_scenario_a_person_stopped_ran_no_further_and_did_not_fail(self):
        stopped = scenario([step("passed"), step("error", KeyboardInterrupt()), step("untested")], "error")
        result = behave_recorder.result_of(stopped, 1, None)
        self.assertEqual(result["status"], "skipped")
        self.assertEqual([row["status"] for row in result["steps"]], ["passed", "notRun", "notRun"])
        self.assertNotIn("error", result)

    def test_a_scenario_that_failed_on_its_own_still_fails(self):
        failed = scenario([step("passed"), step("failed", AssertionError("the card was refused")), step("skipped")], "failed")
        result = behave_recorder.result_of(failed, 1, None)
        self.assertEqual(result["status"], "failed")
        self.assertEqual([row["status"] for row in result["steps"]], ["passed", "failed", "notRun"])
        self.assertIn("the card was refused", result["error"])
