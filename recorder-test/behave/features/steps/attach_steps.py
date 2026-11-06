import os
import tempfile

import q6_report
from behave import then


@then("the order log is attached")
def order_log_attached(context):
    path = os.path.join(tempfile.mkdtemp(), "order.log")
    with open(path, "w", encoding="utf-8") as stream:
        stream.write("1 item, café\n")
    q6_report.attach(path, "Order log")
