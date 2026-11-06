import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Disabled
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance

// A class that fails before any test runs, and a class skipped as a whole, of which JUnit announces no test.
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class NoSetupTest {
  @BeforeAll
  fun setUp() {
    throw IllegalStateException("the fixture would not start")
  }

  @Test
  fun `never runs`() {}
}

@Disabled("not ready")
class NotReadyTest {
  @Test
  fun `never runs either`() {}
}
