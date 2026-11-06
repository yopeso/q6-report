package q6report;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a method as a step, so each call to it is one step of the test running it, e.g: {@code @Step("Open the basket")}.
 * {@code {0}} in the text is the method's first argument, and {@code {name}} the one named so when the class keeps its
 * parameter names. It takes effect only with the recorder's jar as a Java agent, which {@link StepAgent} says how to add.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Step {
  /** The step's text; the method's own name without it. */
  String value() default "";
}
