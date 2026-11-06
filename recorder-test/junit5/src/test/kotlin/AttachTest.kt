import java.nio.file.Files
import org.junit.jupiter.api.Assertions
import org.junit.jupiter.api.Test
import org.junitpioneer.jupiter.RetryingTest
import q6report.Report

// Bytes a page cannot show as text, as a video's are.
private val VIDEO = byteArrayOf(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32)

// Attaches a file the way a suite's teardown does, and deletes it straight after, as a suite may.
private fun attachWritten(name: String, fileName: String, content: ByteArray) {
  val file = Files.createTempDirectory("q6-report-attach").resolve(fileName)
  Files.write(file, content)
  Report.attach(name, file)
  Files.delete(file)
}

class AttachTest {
  @Test
  fun `keeps what it attached`() {
    val log = Files.createTempDirectory("q6-report-attach").resolve("order.log")
    Files.write(log, "1 item, café\n".toByteArray())
    Report.attach(log)
    attachWritten("Execution video", "run.mp4", VIDEO)
  }

  @RetryingTest(2)
  fun `passes on its second attempt with a log of each`() {
    attempts += 1
    attachWritten("Attempt log", "attempt.log", "attempt $attempts\n".toByteArray())
    Assertions.assertTrue(attempts >= 2, "not ready yet")
  }

  private companion object {
    var attempts = 0
  }
}
