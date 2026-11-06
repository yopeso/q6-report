import org.junit.jupiter.api.Assertions
import org.junit.jupiter.api.Assumptions
import org.junit.jupiter.api.Test

// No driver and no extension: a suite with no screen, and the second fork's own file.
class CartTest {
  @Test
  fun `adds an item`() = Assertions.assertEquals(1, 1)

  @Test
  fun `cannot run here`() = Assumptions.assumeTrue(false, "needs a printer")

  @Test
  fun `says "it's done" in café`() {
    throw AssertionError("first line says \"done\"\nsecond line")
  }
}
