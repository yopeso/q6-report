import java.util.Base64
import org.junit.jupiter.api.Assertions
import org.junit.jupiter.api.Assumptions
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Disabled
import org.junit.jupiter.api.extension.ExtendWith
import org.junitpioneer.jupiter.RetryingTest
import q6report.Report
import q6report.ReportExtension

// How a suite usually takes a retry library: through an annotation of its own.
@RetryingTest(3)
annotation class Retried

private val ONE_PIXEL: ByteArray =
  Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7yMK/gAAAABJRU5ErkJggg==")

// One result per test whatever the attempts, named for the test and not for the attempt.
@ExtendWith(ReportExtension::class)
class RetryTest {
  @BeforeEach
  fun screen() = Report.screenshots { ONE_PIXEL }

  @RetryingTest(3)
  fun `passes first time`() = Assertions.assertEquals(1, 1)

  @Retried
  fun `passes on the second attempt`() {
    attemptsSoFar += 1
    Assertions.assertTrue(attemptsSoFar >= 2, "not ready yet")
  }

  @Retried
  fun `fails every attempt`() = Assertions.assertEquals(1, 2, "never adds up")

  @Retried
  fun `throws every attempt`() {
    throw IllegalStateException("the cart is gone")
  }

  @Retried
  fun `cannot run here`() = Assumptions.assumeTrue(false, "needs a printer")

  @Disabled("not on this app")
  @Retried
  fun `is turned off`() {
    Assertions.fail<Unit>("a disabled test must not run")
  }

  private companion object {
    var attemptsSoFar = 0
  }
}
