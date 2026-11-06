// The versions the Kotlin suites this recorder was written for are on, so it is proven against what they run.
plugins { kotlin("jvm") version "2.0.21" }

repositories {
  // What the recorder publishes, which pnpm check:recorders writes first, so the suite takes it the way a team will,
  // and never a copy from Maven Central.
  exclusiveContent {
    forRepository { maven { url = uri("../../recorders/junit5/build/repo") } }
    filter { includeGroup("io.github.yopeso") }
  }
  mavenCentral()
}

dependencies {
  testImplementation("io.github.yopeso:q6-report-junit5:0.1.0")
  testImplementation("org.junit.jupiter:junit-jupiter-api:5.9.0")
  testImplementation("org.junit.jupiter:junit-jupiter-params:5.9.0")
  testRuntimeOnly("org.junit.jupiter:junit-jupiter-engine:5.9.0")
  testImplementation("org.junit.platform:junit-platform-launcher:1.9.0")
  testImplementation("org.seleniumhq.selenium:selenium-java:4.27.0")
  testImplementation("org.junit-pioneer:junit-pioneer:2.0.1")
}

tasks.test {
  useJUnitPlatform()
  // Two forks, as a suite running in parallel has, each writing a file of its own.
  maxParallelForks = 2
  // @Step works through the recorder's jar as a Java agent, as a suite's build gives it. The recorder test leaves it out
  // once, with -PwithoutStepAgent, to see the recorder say so.
  if (!project.hasProperty("withoutStepAgent")) {
    jvmArgumentProviders.add(CommandLineArgumentProvider {
      listOf("-javaagent:" + configurations.testRuntimeClasspath.get().single { it.name.startsWith("q6-report-junit5") })
    })
  }
}
