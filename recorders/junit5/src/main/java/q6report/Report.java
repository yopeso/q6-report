package q6report;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * What a suite may call: marking a step, attaching a file and saying how to take a screenshot. None is needed for a
 * test to be recorded, and a method marked with {@link Step} is a step without calling anything here.
 */
public final class Report {
  /** Takes a screenshot as image bytes. */
  public interface Screenshot {
    byte[] take() throws Exception;
  }

  /** A step's body, which may return a value. */
  public interface Body<T> {
    T run() throws Throwable;
  }

  private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();
  // How many steps are open on this thread, so a step run inside another is part of that one.
  private static final ThreadLocal<Integer> DEPTH = ThreadLocal.withInitial(() -> 0);
  private static final ThreadLocal<Screenshot> SCREENSHOT = new ThreadLocal<>();
  private static final Map<String, List<Map<String, Object>>> STEPS = new ConcurrentHashMap<>();
  private static final Map<String, String> IMAGES = new ConcurrentHashMap<>();
  private static final Map<String, List<Map<String, Object>>> ATTACHMENTS = new ConcurrentHashMap<>();

  private Report() {}

  /** Hands the recorder a way to take a screenshot on this thread, e.g: from a driver, while the test still holds it open. */
  public static void screenshots(Screenshot screenshot) {
    SCREENSHOT.set(screenshot);
  }

  /** Keeps a file of the test running on this thread, e.g: a video or a log, as it is at this moment, under its own name. */
  public static void attach(Path file) {
    attach(String.valueOf(file.getFileName()), file);
  }

  /** The same, under a name of the suite's own, e.g: "Execution video". */
  public static void attach(String name, Path file) {
    String test = CURRENT.get();
    if (test == null) {
      Kit.warn("\"" + name + "\" was attached while no test was running on this thread, so no result holds it");
      return;
    }
    try {
      Map<String, Object> attachment = new LinkedHashMap<>();
      attachment.put("name", name);
      attachment.put("path", Kit.keepAttachment(file));
      ATTACHMENTS.computeIfAbsent(test, key -> new ArrayList<>()).add(attachment);
    } catch (Exception error) {
      Kit.warn("The report could not keep the attachment " + file + ": " + error);
    }
  }

  /** Runs a step, and records it under the test running on this thread; a failure in it stays the test's own. */
  public static <T> T step(String text, Body<T> body) {
    long started = startStep();
    try {
      T value = body.run();
      endStep(text, "passed", started);
      return value;
    } catch (Throwable error) {
      endStep(text, "failed", started);
      return Report.<RuntimeException, T>rethrow(error);
    }
  }

  // A step's body may throw anything a test may, and the test has to see exactly that.
  @SuppressWarnings("unchecked")
  private static <E extends Throwable, T> T rethrow(Throwable error) throws E {
    throw (E) error;
  }

  /** Opens a step on this thread, and returns when it started. */
  static long startStep() {
    DEPTH.set(DEPTH.get() + 1);
    return System.currentTimeMillis();
  }

  /** Records a step as it ends, so in the order the test ran its steps, unless it ran inside another step. */
  static void endStep(String text, String status, long started) {
    // Never below none: a step opened before this test started ends with none open.
    int depth = Math.max(DEPTH.get() - 1, 0);
    DEPTH.set(depth);
    String test = CURRENT.get();
    if (depth > 0 || test == null) return;
    Map<String, Object> step = new LinkedHashMap<>();
    step.put("keyword", "");
    step.put("text", text);
    step.put("status", status);
    step.put("ms", System.currentTimeMillis() - started);
    STEPS.computeIfAbsent(test, key -> new ArrayList<>()).add(step);
  }

  /** A test starts on this thread with no step open, even if the test before it left one open. */
  static void startTest(String test) {
    CURRENT.set(test);
    DEPTH.remove();
  }

  static void endTest() {
    CURRENT.remove();
    DEPTH.remove();
  }

  /** Called at the moment of failure, as the driver is usually closed by the time JUnit reports the test finished. */
  static void takeScreenshot(String test) {
    Screenshot screenshot = SCREENSHOT.get();
    if (screenshot == null || IMAGES.containsKey(test)) return;
    try {
      IMAGES.put(test, Kit.keepImage(screenshot.take()));
    } catch (Exception error) {
      Kit.warn("The report could not take a screenshot: " + error);
    }
  }

  static List<Map<String, Object>> takeSteps(String test) {
    List<Map<String, Object>> steps = STEPS.remove(test);
    return steps == null ? new ArrayList<>() : steps;
  }

  static String takeImage(String test) {
    return IMAGES.remove(test);
  }

  static List<Map<String, Object>> takeAttachments(String test) {
    List<Map<String, Object>> files = ATTACHMENTS.remove(test);
    return files == null ? new ArrayList<>() : files;
  }
}
