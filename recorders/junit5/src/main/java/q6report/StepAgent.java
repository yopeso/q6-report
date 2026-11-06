package q6report;

import static net.bytebuddy.matcher.ElementMatchers.declaresMethod;
import static net.bytebuddy.matcher.ElementMatchers.isAnnotatedWith;
import static net.bytebuddy.matcher.ElementMatchers.named;

import java.lang.instrument.Instrumentation;
import java.lang.reflect.Method;
import net.bytebuddy.agent.builder.AgentBuilder;
import net.bytebuddy.asm.Advice;
import net.bytebuddy.utility.JavaModule;

/**
 * Makes {@link Step} work: with the recorder's jar given to the test JVM as {@code -javaagent:<that jar>}, it adds the
 * opening and closing of a step around each method marked with it as its class loads, and changes nothing else.
 */
public final class StepAgent {
  private static final String STEP = "q6report.Step";
  /** Set once the agent runs: a system property, as the agent and a suite's classes may be loaded apart. */
  static final String INSTALLED = "q6report.stepAgent";

  private StepAgent() {}

  public static void premain(String options, Instrumentation instrumentation) {
    System.setProperty(INSTALLED, "installed");
    new AgentBuilder.Default()
        // Only code inside a method is added, never a field or a method, so a class keeps the shape it was compiled to.
        .disableClassFormatChanges()
        .ignore(type -> Kit.LIBRARIES.stream().anyMatch(type.getName()::startsWith))
        .type(declaresMethod(isAnnotatedWith(named(STEP))))
        .transform((builder, type, loader, module, domain) -> builder.visit(Advice.to(Around.class).on(isAnnotatedWith(named(STEP)))))
        .with(new AgentBuilder.Listener.Adapter() {
          @Override
          public void onError(String type, ClassLoader loader, JavaModule module, boolean isLoaded, Throwable error) {
            Kit.warn("The steps of " + type + " could not be marked, so they are left out: " + error);
          }
        })
        .installOn(instrumentation);
  }

  /** What is added around a step. It runs as part of the suite's own method, so it may only call what is public. */
  static final class Around {
    private Around() {}

    @Advice.OnMethodEnter(suppress = Throwable.class)
    static Object enter(@Advice.Origin Method method, @Advice.AllArguments Object[] arguments) {
      return Steps.open(method, arguments);
    }

    @Advice.OnMethodExit(onThrowable = Throwable.class, suppress = Throwable.class)
    static void exit(@Advice.Enter Object step, @Advice.Thrown Throwable error) {
      Steps.close(step, error);
    }
  }
}
