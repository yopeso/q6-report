package q6report;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/** What a JVM recorder needs, so the listener holds only the mapping from JUnit's events to a result. */
final class Kit {
  private static final int RECORD_VERSION = 2;
  private static final int MAX_MESSAGE = 2000;
  private static final int MAX_STACK = 4000;
  private static final String FRAMEWORK = "junit5";
  private static final String DEFAULT_BUG_TAG = "^@(bug[-:].+)$";
  /** The machinery around a suite: never where it failed, and never where its steps are. */
  static final List<String> LIBRARIES =
      List.of("java.", "javax.", "jdk.", "sun.", "com.sun.", "kotlin.", "kotlinx.", "org.junit.", "org.opentest4j.", "org.gradle.", "org.openqa.", "io.appium.", "worker.org.gradle.", "q6report.");
  // Selenium and Appium are told apart by class name, so a suite without them needs nothing more on its classpath.
  private static final Set<String> ENV_NAMES =
      Set.of("SessionNotCreatedException", "NoSuchSessionException", "UnreachableBrowserException", "NoSuchWindowException");
  private static final Set<String> MISSING_NAMES = Set.of("org.openqa.selenium.NoSuchElementException", "org.openqa.selenium.ElementNotInteractableException");
  // Numbers this process's attachments, so two files of one name attached at once stay two files.
  private static final AtomicLong ATTACHED = new AtomicLong();

  private Kit() {}

  static Path laneFolder() {
    String dir = orElse(System.getenv("Q6_REPORT_DIR"), "q6-report");
    String lane = orElse(System.getenv("Q6_REPORT_LANE"), FRAMEWORK).replaceAll("[^\\w.-]+", "-").replaceAll("^[.-]+|[.-]+$", "");
    return Paths.get(dir, ".run", lane.isEmpty() ? FRAMEWORK : lane);
  }

  private static String orElse(String value, String fallback) {
    return value == null || value.isEmpty() ? fallback : value;
  }

  /** Adds one line to this process's own file, so parallel forks never share one. */
  static synchronized void write(Map<String, Object> result) throws IOException {
    Path folder = laneFolder();
    Files.createDirectories(folder);
    result.put("v", RECORD_VERSION);
    result.put("finishedAt", Instant.now().toString());
    Path file = folder.resolve(FRAMEWORK + "-" + ProcessHandle.current().pid() + ".jsonl");
    Files.write(file, (json(result) + "\n").getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE, StandardOpenOption.APPEND);
  }

  /** Writes a screenshot into the lane's folder, which travels with its results, and returns its path there. */
  static String keepImage(byte[] bytes) throws IOException {
    Path images = laneFolder().resolve("images");
    Files.createDirectories(images);
    String name = ProcessHandle.current().pid() + "-" + System.nanoTime() + ".png";
    Files.write(images.resolve(name), bytes);
    return "images/" + name;
  }

  /** Copies an attached file into the lane's folder, which travels with its results, and returns its path there. */
  static String keepAttachment(Path file) throws IOException {
    Path attachments = laneFolder().resolve("attachments");
    Files.createDirectories(attachments);
    String name = ProcessHandle.current().pid() + "-" + ATTACHED.incrementAndGet() + "-" + file.getFileName();
    Files.copy(file, attachments.resolve(name));
    return "attachments/" + name;
  }

  static void warn(String message) {
    System.err.println("q6-report: " + message);
  }

  private static boolean isA(Throwable error, Set<String> names) {
    for (Class<?> type = error.getClass(); type != null; type = type.getSuperclass()) {
      if (names.contains(type.getName()) || names.contains(type.getSimpleName())) return true;
    }
    return false;
  }

  /** What the error object says it is, from its type and never from its wording. */
  static String kindOf(Throwable error) {
    if (error instanceof AssertionError) return "check";
    // A wait for an element ends in a timeout whose cause is the element it never found.
    if (isTimeout(error)) return error.getCause() != null && isA(error.getCause(), MISSING_NAMES) ? "missing" : "timeout";
    if (isA(error, MISSING_NAMES)) return "missing";
    if (isA(error, ENV_NAMES) || error instanceof ConnectException || error instanceof UnknownHostException
        || error instanceof NoRouteToHostException || error instanceof SocketException) return "env";
    // Chrome's own way of saying a page could not be reached; it has no type of its own, so this one reads its words.
    if (isA(error, Set.of("org.openqa.selenium.WebDriverException")) && String.valueOf(error.getMessage()).contains("net::ERR")) return "env";
    return "error";
  }

  private static boolean isTimeout(Throwable error) {
    return error instanceof TimeoutException || error instanceof SocketTimeoutException || isA(error, Set.of("org.openqa.selenium.TimeoutException"));
  }

  /** A thrown type says something an assertion's own message does not need, so only an assertion goes without it. */
  static String messageOf(Throwable error) {
    String text = error.getMessage() == null ? "" : error.getMessage().trim();
    String message;
    if (error instanceof AssertionError) message = text.isEmpty() ? error.getClass().getSimpleName() : text;
    else message = text.isEmpty() ? error.getClass().getSimpleName() : error.getClass().getSimpleName() + ": " + text;
    return cut(message, MAX_MESSAGE);
  }

  static String stackOf(Throwable error) {
    java.io.StringWriter text = new java.io.StringWriter();
    error.printStackTrace(new java.io.PrintWriter(text));
    return cut(text.toString(), MAX_STACK);
  }

  /** Where it failed: the deepest frame in the suite's own code, as file:line. */
  static String atOf(Throwable error) {
    for (StackTraceElement frame : error.getStackTrace()) {
      String type = frame.getClassName();
      if (frame.getFileName() == null || frame.getLineNumber() < 0 || LIBRARIES.stream().anyMatch(type::startsWith)) continue;
      return frame.getFileName() + ":" + frame.getLineNumber();
    }
    return null;
  }

  /** The known bug a test's tags mark, by the pattern Q6_REPORT_BUG_TAG gives; its first group is the bug, or the whole match. */
  static String knownBugOf(List<String> tags) {
    Pattern pattern;
    try {
      pattern = Pattern.compile(orElse(System.getenv("Q6_REPORT_BUG_TAG"), DEFAULT_BUG_TAG), Pattern.CASE_INSENSITIVE);
    } catch (PatternSyntaxException error) {
      warn("Q6_REPORT_BUG_TAG is not a pattern, so no test is marked as a known bug: " + error.getMessage());
      return null;
    }
    for (String tag : tags) {
      Matcher found = pattern.matcher(tag);
      if (found.find()) return found.groupCount() > 0 ? found.group(1) : found.group();
    }
    return null;
  }

  /** The command that runs a test again, from the template in Q6_REPORT_RERUN; a name reaches the shell quoted. */
  static String rerunOf(String name, String file) {
    String template = System.getenv("Q6_REPORT_RERUN");
    if (template == null || template.isEmpty()) return null;
    return template.replace("{name}", shellQuote(name)).replace("{file}", shellQuote(file));
  }

  private static String shellQuote(String value) {
    return "'" + value.replace("'", "'\\''") + "'";
  }

  private static String cut(String text, int limit) {
    return text.length() <= limit ? text : text.substring(0, limit);
  }

  /** No JSON library, as one here could fight the version a suite already has. A null is left out, as a field a framework cannot fill stays unset. */
  static String json(Object value) {
    if (value instanceof Map) {
      StringBuilder out = new StringBuilder("{");
      for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
        if (entry.getValue() == null) continue;
        if (out.length() > 1) out.append(',');
        out.append(json(String.valueOf(entry.getKey()))).append(':').append(json(entry.getValue()));
      }
      return out.append('}').toString();
    }
    if (value instanceof List) {
      StringBuilder out = new StringBuilder("[");
      for (Object item : (List<?>) value) {
        if (out.length() > 1) out.append(',');
        out.append(json(item));
      }
      return out.append(']').toString();
    }
    if (value instanceof Number || value instanceof Boolean) return value.toString();
    StringBuilder out = new StringBuilder("\"");
    String text = String.valueOf(value);
    for (int i = 0; i < text.length(); i++) {
      char ch = text.charAt(i);
      switch (ch) {
        case '"': out.append("\\\""); break;
        case '\\': out.append("\\\\"); break;
        case '\n': out.append("\\n"); break;
        case '\r': out.append("\\r"); break;
        case '\t': out.append("\\t"); break;
        default:
          if (ch < 0x20) out.append(String.format("\\u%04x", (int) ch));
          else out.append(ch);
      }
    }
    return out.append('"').toString();
  }
}
