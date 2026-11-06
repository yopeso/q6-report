import org.junit.jupiter.api.Assertions
import org.junit.jupiter.api.Test
import q6report.Step

// A page object whose methods are marked as steps the way such suites mark them: internal functions, one calling
// another, one returning a value, and texts naming their arguments.
class BasketPage {
  @Step("Open the basket")
  internal fun open() {}

  @Step("Add {0} items")
  internal fun add(count: Int) {
    open()
  }

  @Step("Check the basket holds {0}")
  internal fun holds(count: Int): Boolean = count == 2

  @Step
  internal fun empty() {}

  @Step("Check the total is {0} euro")
  internal fun seeTotal(amount: Int) = Assertions.assertEquals(amount, 14)
}

class StepAnnotationTest {
  private val page = BasketPage()

  @Test
  fun `fills the basket`() {
    page.add(2)
    Assertions.assertTrue(page.holds(2))
    page.empty()
  }

  @Test
  fun `totals the basket`() {
    page.open()
    page.seeTotal(15)
    page.empty()
  }
}
