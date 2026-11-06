import java.io.File
import java.net.ServerSocket
import java.time.Duration
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Disabled
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.openqa.selenium.By
import org.openqa.selenium.OutputType
import org.openqa.selenium.TakesScreenshot
import org.openqa.selenium.WebDriver
import org.openqa.selenium.WebElement
import org.openqa.selenium.chrome.ChromeDriver
import org.openqa.selenium.chrome.ChromeOptions
import org.openqa.selenium.support.ui.ExpectedCondition
import org.openqa.selenium.support.ui.ExpectedConditions
import org.openqa.selenium.support.ui.WebDriverWait
import q6report.Report
import q6report.ReportExtension

const val PAGE = "data:text/html,<title>Shop</title><h1>Shop</h1><button>Pay</button><p id=total>Total 7</p>"

// A named condition, as a lambda would put its memory address in the error, and a wait's cause is what this one proves.
object RefundButton : ExpectedCondition<WebElement> {
  override fun apply(driver: WebDriver): WebElement = driver.findElement(By.id("refund"))

  override fun toString() = "the refund button"
}

@ExtendWith(ReportExtension::class)
class ShopTest {
  lateinit var driver: WebDriver

  @BeforeEach
  fun open() {
    driver = ChromeDriver(ChromeOptions().addArguments("--headless=new", "--no-sandbox", "--disable-gpu"))
    Report.screenshots { (driver as TakesScreenshot).getScreenshotAs(OutputType.BYTES) }
  }

  @AfterEach
  fun close() {
    driver.quit()
  }

  private fun checkTotal(actual: Int, want: Int) = Assertions.assertEquals(want, actual)

  @Test
  fun `shows the shop`() {
    Report.step("open the page") { driver.get(PAGE) }
    Report.step("see the heading") { Assertions.assertEquals("Shop", driver.findElement(By.tagName("h1")).text) }
  }

  @Test
  fun `totals the order`() {
    Report.step("open the page") { driver.get(PAGE) }
    Report.step("see the total") { Assertions.assertEquals("Total 8", driver.findElement(By.id("total")).text) }
  }

  @Test
  fun `finds a missing button`() {
    driver.get(PAGE)
    driver.findElement(By.id("refund")).click()
  }

  @Test
  fun `waits for a missing button`() {
    driver.get(PAGE)
    WebDriverWait(driver, Duration.ofMillis(500)).until(ExpectedConditions.visibilityOfElementLocated(By.id("refund")))
  }

  @Test
  fun `keeps looking for a missing button`() {
    driver.get(PAGE)
    WebDriverWait(driver, Duration.ofMillis(500)).until(RefundButton)
  }

  @Test
  fun `waits for a page that never changes`() {
    driver.get(PAGE)
    WebDriverWait(driver, Duration.ofMillis(500)).until(ExpectedConditions.titleIs("Paid"))
  }

  @Test
  fun `reaches the server`() {
    // A port nothing listens on, so the connection is really refused; Chrome blocks low ones such as 9 by another route.
    val port = ServerSocket(0).use { it.localPort }
    driver.get("http://127.0.0.1:$port/shop")
  }

  @Test
  fun `reads a missing field`() {
    driver.get(PAGE)
    val text: String? = null
    text!!.length
  }

  @Test
  fun `empties a list that is empty`() {
    driver.get(PAGE)
    emptyList<Int>().iterator().next()
  }

  @Test
  fun `opens a file that is not there`() {
    File("/nowhere/q6-report/fixture.csv").readText()
  }

  @Test
  fun `totals by helper one`() = checkTotal(1, 2)

  // Another project's own bug tag, which only that project's pattern marks as a known bug.
  @Tag("BL-030")
  @Test
  fun `totals by helper two`() = checkTotal(30, 40)

  @Disabled("not ready")
  @Test
  fun `is not ready`() {}

  @Tag("bug:SHOP-1")
  @Test
  fun `charges twice`() {
    Assertions.fail<Unit>("charged 2 times")
  }

  @ParameterizedTest
  @CsvSource("1,2", "3,7")
  fun doubles(a: Int, b: Int) = Assertions.assertEquals(b, a * 2)
}
