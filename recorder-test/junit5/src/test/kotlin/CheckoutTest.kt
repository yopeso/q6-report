import org.junit.jupiter.api.Assertions
import org.junit.jupiter.api.Test
import q6report.Report

// A page object whose actions are steps, where one action calls another, so a step runs inside a step.
class CheckoutPage {
  fun open() = Report.step("Open the checkout") {}

  fun pay(amount: Int) = Report.step("Pay $amount euro") { confirm() }

  fun confirm() = Report.step("Confirm the payment") {}

  fun seeTotal(amount: Int) = Report.step("See a total of $amount") { Assertions.assertEquals(amount, 7) }
}

class CheckoutTest {
  private val page = CheckoutPage()

  @Test
  fun `pays for the order`() {
    page.open()
    page.pay(7)
    Report.step("See the receipt") {}
  }

  @Test
  fun `totals the checkout`() {
    page.open()
    page.seeTotal(8)
    page.pay(8)
  }
}
