package q6report;

import java.io.File;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * What {@link StepAgent} adds around a {@link Step} method calls as it starts and ends. That code runs as part of the
 * suite's own class, so these are public; a suite marks a step with {@link Step} or {@link Report#step} instead.
 */
public final class Steps {
  private static final Pattern PLACEHOLDER = Pattern.compile("\\{([^{}]+)\\}");

  private Steps() {}

  /** A step that has started: its text, and when. */
  private static final class Open {
    final String text;
    final long started;

    Open(String text, long started) {
      this.text = text;
      this.started = started;
    }
  }

  /** Opens the step a {@link Step} method is, with its arguments in its text. Never throws into the test. */
  public static Object open(Method method, Object[] arguments) {
    try {
      String text = textOf(method, arguments);
      return new Open(text, Report.startStep());
    } catch (RuntimeException error) {
      Kit.warn("The report could not start the step " + method.getName() + ": " + error);
      return null;
    }
  }

  /** Ends a step {@link #open} opened, as failed when it threw. */
  public static void close(Object step, Throwable error) {
    if (!(step instanceof Open)) return;
    Open open = (Open) step;
    Report.endStep(open.text, error == null ? "passed" : "failed", open.started);
  }

  /**
   * Says so when the suite marks steps with {@link Step} and runs without the agent, as those steps would be missing
   * without a word. Only folders on the class path are read, which is where a suite's own compiled classes are.
   */
  static void warnWithoutAgent() {
    if (System.getProperty(StepAgent.INSTALLED) != null) return;
    for (String entry : System.getProperty("java.class.path", "").split(File.pathSeparator)) {
      Path folder = Paths.get(entry);
      if (!Files.isDirectory(folder)) continue;
      try (Stream<Path> files = Files.walk(folder)) {
        Optional<Path> marked = files.filter(file -> file.toString().endsWith(".class")).filter(Steps::marksAStep).findFirst();
        if (marked.isPresent()) {
          Kit.warn(folder.relativize(marked.get()) + " marks steps with @Step, and the test JVM was started without the recorder's jar as"
              + " its Java agent, so no such step is recorded. Add -javaagent:<the q6-report-junit5 jar> to the test task's JVM arguments.");
          return;
        }
      } catch (IOException | UncheckedIOException error) {
        Kit.warn("The report could not look for @Step in " + folder + ": " + error);
      }
    }
  }

  // A class that uses the annotation names it in its constant pool, in the form the JVM writes a type.
  private static boolean marksAStep(Path file) {
    try {
      return new String(Files.readAllBytes(file), StandardCharsets.ISO_8859_1).contains("Lq6report/Step;");
    } catch (IOException error) {
      return false;
    }
  }

  /** The annotation's text with each {0} or {name} filled in, or the method's name without a text. */
  static String textOf(Method method, Object[] arguments) {
    Step step = method.getAnnotation(Step.class);
    String text = step == null || step.value().isEmpty() ? nameOf(method) : step.value();
    Parameter[] parameters = method.getParameters();
    Matcher found = PLACEHOLDER.matcher(text);
    StringBuilder out = new StringBuilder();
    while (found.find()) {
      String key = found.group(1);
      Integer index = indexOf(key, parameters);
      String value = index != null && index < arguments.length ? valueOf(arguments[index]) : found.group();
      found.appendReplacement(out, Matcher.quoteReplacement(value));
    }
    return found.appendTail(out).toString();
  }

  /** Which argument a placeholder names: by position, or by name when the class kept its parameter names. */
  private static Integer indexOf(String key, Parameter[] parameters) {
    if (key.length() < 4 && key.chars().allMatch(Character::isDigit)) return Integer.parseInt(key);
    for (int i = 0; i < parameters.length; i++) {
      if (parameters[i].isNamePresent() && parameters[i].getName().equals(key)) return i;
    }
    return null;
  }

  // Kotlin compiles an internal method under its name and its module's, e.g: open$app, and a person wrote only the first.
  private static String nameOf(Method method) {
    String name = method.getName();
    int module = name.indexOf('$');
    return module > 0 ? name.substring(0, module) : name;
  }

  private static String valueOf(Object value) {
    if (value instanceof Object[]) return Arrays.deepToString((Object[]) value);
    if (value != null && value.getClass().isArray()) return Arrays.deepToString(new Object[] {value}).replaceAll("^\\[|\\]$", "");
    return String.valueOf(value);
  }
}
