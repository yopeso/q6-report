import socket

from behave import given, then, when

passed_before = set()


def check_total(actual, want):
    assert actual == want, f"Expected {want} but got {actual}"


def refused_port():
    """A port nothing listens on, so the connection is really refused."""
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


@given("the shop is open")
def shop_is_open(context):
    context.cart = 0


@when("I add {count:d} item")
def add_items(context, count):
    context.cart += count


@then("the cart holds {count:d}")
def cart_holds(context, count):
    assert context.cart == count, f"Expected {count} items but got {context.cart}"


@then("nothing else runs after it")
def nothing_else(context):
    pass


@then("the helper sees {first:d} and {second:d}")
def helper_sees(context, first, second):
    check_total(first, second)


@then('the object "{name}" is there')
def object_is_there(context, name):
    # What Squish raises for an object it cannot find.
    raise LookupError(f"Object not found: {name}")


@then("a value error is raised")
def value_error(context):
    raise ValueError("bad quantity")


@then("a missing key is read")
def missing_key(context):
    return {}["total"]


@then("the service answers")
def service_answers(context):
    socket.create_connection(("127.0.0.1", refused_port()), timeout=1)


@then("the other service answers")
def other_service_answers(context):
    socket.create_connection(("127.0.0.1", refused_port()), timeout=1)


@then("the wait times out")
def wait_times_out(context):
    raise TimeoutError("no window after 20 seconds")


@then("it passes the second time")
def passes_second_time(context):
    if "once" not in passed_before:
        passed_before.add("once")
        raise AssertionError("not yet")


@then("the error has two lines")
def error_has_two_lines(context):
    raise AssertionError('first line says "done"\nsecond line')


@then("doubling {number:d} gives {result:d}")
def doubling(context, number, result):
    assert number * 2 == result, f"Expected {result} but got {number * 2}"
