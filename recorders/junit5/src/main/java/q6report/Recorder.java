package q6report;

import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.platform.engine.TestExecutionResult;
import org.junit.platform.engine.TestSource;
import org.junit.platform.engine.support.descriptor.ClassSource;
import org.junit.platform.engine.support.descriptor.MethodSource;
import org.junit.platform.launcher.TestExecutionListener;
import org.junit.platform.launcher.TestIdentifier;
import org.junit.platform.launcher.TestPlan;

/** Found through META-INF/services, so a suite turns it on by adding the dependency. It writes one line per test. */
public final class Recorder implements TestExecutionListener {
  private final Map<String, Long> started = new ConcurrentHashMap<>();
  // A retried test's newest attempt, how many it has had and every attempt's files, until its last attempt is known.
  private final Map<String, Map<String, Object>> newestAttempt = new ConcurrentHashMap<>();
  private final Map<String, Integer> attemptsOf = new ConcurrentHashMap<>();
  private final Map<String, List<Map<String, Object>>> attachedOf = new ConcurrentHashMap<>();
  private final AtomicBoolean isAgentChecked = new AtomicBoolean();
  private TestPlan plan;

  @Override
  public void testPlanExecutionStarted(TestPlan testPlan) {
    plan = testPlan;
  }

  @Override
  public void executionStarted(TestIdentifier test) {
    if (!test.isTest()) return;
    // Inside the first test, as Gradle keeps only what a test prints in its results, where a person looks for it.
    if (isAgentChecked.compareAndSet(false, true)) Steps.warnWithoutAgent();
    started.put(test.getUniqueId(), System.currentTimeMillis());
    Report.startTest(test.getUniqueId());
  }

  @Override
  public void executionSkipped(TestIdentifier test, String reason) {
    // A disabled class or test template is skipped as a whole, and JUnit announces none of its tests.
    if (test.isTest() || isClass(test) || isMethodContainer(test)) record(test, "skipped", null);
  }

  @Override
  public void executionFinished(TestIdentifier test, TestExecutionResult result) {
    if (isRetrying(test) && test.isContainer()) {
      writeNewestAttempt(test);
      return;
    }
    // A class whose @BeforeAll failed runs no test at all, so without this the run would read as green.
    boolean isClassFailure = isClass(test) && result.getStatus() == TestExecutionResult.Status.FAILED;
    if (!test.isTest() && !isClassFailure) return;
    Report.endTest();
    Throwable error = result.getThrowable().orElse(null);
    String status = statusOf(result);
    if (isRetrying(test)) keepAttempt(test, status, error);
    else record(test, status, error);
  }

  private static String statusOf(TestExecutionResult result) {
    switch (result.getStatus()) {
      case SUCCESSFUL:
        return "passed";
      case ABORTED:
        return "skipped";
      default:
        return "failed";
    }
  }

  private void keepAttempt(TestIdentifier attempt, String status, Throwable error) {
    TestIdentifier retried = plan.getParent(attempt).orElse(attempt);
    try {
      newestAttempt.put(retried.getUniqueId(), resultOf(retried, attempt, status, withoutRetryWrapper(error)));
      int number = attemptsOf.merge(retried.getUniqueId(), 1, Integer::sum);
      // Every attempt's files stay, as the files of a failed attempt are what tells why a pass on a retry is flaky.
      List<Map<String, Object>> files = attachedOf.computeIfAbsent(retried.getUniqueId(), key -> new ArrayList<>());
      for (Map<String, Object> file : Report.takeAttachments(attempt.getUniqueId())) {
        file.put("attempt", number);
        files.add(file);
      }
    } catch (Exception failure) {
      Kit.warn("The report could not record \"" + retried.getDisplayName() + "\": " + failure);
    }
  }

  private void writeNewestAttempt(TestIdentifier retried) {
    Map<String, Object> line = newestAttempt.remove(retried.getUniqueId());
    Integer attempts = attemptsOf.remove(retried.getUniqueId());
    List<Map<String, Object>> files = attachedOf.remove(retried.getUniqueId());
    if (line == null) return;
    line.put("attempts", attempts);
    if (files != null && !files.isEmpty()) {
      // Which attempt a file came from says something only when there was more than one.
      if (attempts != null && attempts == 1) files.forEach(file -> file.remove("attempt"));
      line.put("attachments", files);
    }
    try {
      Kit.write(line);
    } catch (Exception failure) {
      Kit.warn("The report could not record \"" + retried.getDisplayName() + "\": " + failure);
    }
  }

  // JUnit Pioneer ends a retried test's last failure in an error of its own, with the real one as its cause.
  private static Throwable withoutRetryWrapper(Throwable error) {
    if (error == null || error.getCause() == null || error.getMessage() == null) return error;
    boolean isWrapper = error.getClass().getSimpleName().equals("AssertionFailedError") && error.getMessage().startsWith("Test execution #");
    return isWrapper ? error.getCause() : error;
  }

  // Read by name, so a suite with no retry library needs nothing here. It may sit on an annotation of the suite's own.
  private static boolean isRetrying(TestIdentifier test) {
    if (!test.getSource().map(source -> source instanceof MethodSource).orElse(false)) return false;
    try {
      Method method = ((MethodSource) test.getSource().get()).getJavaMethod();
      Set<Class<?>> seen = new HashSet<>();
      for (Annotation annotation : method.getAnnotations())
        if (namesRetry(annotation.annotationType(), seen)) return true;
      return false;
    } catch (RuntimeException unreadable) {
      return false;
    }
  }

  private static boolean namesRetry(Class<? extends Annotation> type, Set<Class<?>> seen) {
    if (!seen.add(type)) return false;
    if (type.getSimpleName().equals("RetryingTest")) return true;
    for (Annotation annotation : type.getAnnotations())
      if (namesRetry(annotation.annotationType(), seen)) return true;
    return false;
  }

  private static boolean isMethodContainer(TestIdentifier test) {
    return test.isContainer() && test.getSource().map(source -> source instanceof MethodSource).orElse(false);
  }

  private static boolean isClass(TestIdentifier test) {
    return test.getSource().map(source -> source instanceof ClassSource).orElse(false);
  }

  private void record(TestIdentifier test, String status, Throwable error) {
    try {
      Map<String, Object> line = resultOf(test, test, status, error);
      List<Map<String, Object>> files = Report.takeAttachments(test.getUniqueId());
      line.put("attachments", files.isEmpty() ? null : files);
      Kit.write(line);
    } catch (Exception failure) {
      Kit.warn("The report could not record \"" + test.getDisplayName() + "\": " + failure);
    }
  }

  /** A result named for test, from what ran as ranAs: the same one, unless a retry library ran it as an attempt. */
  private Map<String, Object> resultOf(TestIdentifier test, TestIdentifier ranAs, String status, Throwable error) {
    TestSource source = test.getSource().orElse(null);
    String type = classNameOf(source);
    String method = source instanceof MethodSource ? ((MethodSource) source).getMethodName() : null;
    // Kotlin and Java both show a test as a call, and the brackets say nothing to a person reading the page.
    String name = test.getDisplayName().replaceAll("\\(\\)$", "");
    String group = type == null ? "" : type.substring(type.lastIndexOf('.') + 1);
    List<String> tags = new ArrayList<>();
    test.getTags().forEach(tag -> tags.add("@" + tag.getName()));
    tags.sort(null);
    List<Map<String, Object>> steps = Report.takeSteps(ranAs.getUniqueId());
    String image = Report.takeImage(ranAs.getUniqueId());
    long began = started.getOrDefault(ranAs.getUniqueId(), System.currentTimeMillis());

    Map<String, Object> line = new LinkedHashMap<>();
    line.put("test", idOf(test, type, method, name));
    line.put("name", name);
    line.put("group", group);
    line.put("file", type);
    line.put("tags", tags);
    line.put("status", status);
    line.put("ms", System.currentTimeMillis() - began);
    line.put("attempts", 1);
    line.put("steps", steps);
    line.put("knownBug", Kit.knownBugOf(tags));
    line.put("rerun", Kit.rerunOf(name, type == null ? "" : type));
    if ("failed".equals(status)) {
      for (int i = 0; i < steps.size(); i++) {
        if ("failed".equals(steps.get(i).get("status"))) {
          line.put("failedAt", i);
          break;
        }
      }
      if (error != null) {
        line.put("error", Kit.messageOf(error));
        line.put("stack", Kit.stackOf(error));
        line.put("at", Kit.atOf(error));
        line.put("kind", Kit.kindOf(error));
      }
      if (image != null) line.put("image", Map.of("path", image));
    }
    return line;
  }

  /** How a result finds its own history, so a changed display name stays one test; only a row of a parameterized test needs its name. */
  private static String idOf(TestIdentifier test, String type, String method, String name) {
    if (type == null) return test.getUniqueId();
    if (method == null) return type + "::" + name;
    return type + "::" + method + (test.getUniqueId().contains("test-template-invocation") ? "::" + name : "");
  }

  private static String classNameOf(TestSource source) {
    if (source instanceof MethodSource) return ((MethodSource) source).getClassName();
    if (source instanceof ClassSource) return ((ClassSource) source).getClassName();
    return null;
  }
}
