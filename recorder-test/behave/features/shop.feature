Feature: Shop

  Background:
    Given the shop is open

  Scenario: Adds an item
    When I add 1 item
    Then the cart holds 1

  Scenario: Totals a line
    When I add 7 item
    Then the cart holds 8
    And nothing else runs after it

  Scenario: Totals by helper one
    Then the helper sees 1 and 2

  Scenario: Totals by helper two
    Then the helper sees 30 and 40

  Scenario: Finds a missing object
    Then the object "Refund" is there

  Scenario: Raises a value error
    Then a value error is raised

  Scenario: Reads a missing key
    Then a missing key is read

  Scenario: Calls the service
    Then the service answers

  Scenario: Calls the other service
    Then the other service answers

  Scenario: Waits too long
    Then the wait times out

  Scenario: Has an undefined step
    Then this step has no code

  @hook_fails
  Scenario: Fails in its hook
    Then the cart holds 0

  @skip
  Scenario: Is not ready
    Then the cart holds 0

  @shot
  Scenario: Fails with a screenshot
    Then the cart holds 9

  @retry @log_each_attempt
  Scenario: Passes on its second attempt
    Then it passes the second time

  @video
  Scenario: Keeps what it attached
    When I add 1 item
    Then the order log is attached

  @retry @shot
  Scenario: Fails on every attempt
    Then the cart holds 9

  @retry @shot_once
  Scenario: Has a screenshot on its first attempt only
    Then the cart holds 9

  Scenario: Says "it's done" in café
    Then the error has two lines

  @bug:SHOP-1
  Scenario Outline: Doubles <a>
    Then doubling <a> gives <b>

    Examples:
      | a | b |
      | 1 | 2 |
      | 3 | 7 |
