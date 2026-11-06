package q6report;

import org.junit.jupiter.api.extension.ExtensionContext;
import org.junit.jupiter.api.extension.LifecycleMethodExecutionExceptionHandler;
import org.junit.jupiter.api.extension.TestExecutionExceptionHandler;

/** Takes the screenshot when a test or its setup fails, while the driver is still open. It never changes what the test did. */
public final class ReportExtension implements TestExecutionExceptionHandler, LifecycleMethodExecutionExceptionHandler {
  @Override
  public void handleTestExecutionException(ExtensionContext context, Throwable error) throws Throwable {
    Report.takeScreenshot(context.getUniqueId());
    throw error;
  }

  @Override
  public void handleBeforeEachMethodExecutionException(ExtensionContext context, Throwable error) throws Throwable {
    Report.takeScreenshot(context.getUniqueId());
    throw error;
  }
}
