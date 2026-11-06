// Plain Java with no dependency of its own at run time, so a suite in any JVM language keeps its own versions of everything.
// The one library it uses, for the agent behind @Step, is packed inside its jar under its own package.
plugins {
  `java-library`
  `maven-publish`
  // 9.6.1 is the newest, and older than two weeks.
  id("com.gradleup.shadow") version "9.6.1"
}

// Maven Central verified this group to Yopeso through its GitHub organisation.
group = "io.github.yopeso"
version = "0.0.0"

repositories { mavenCentral() }

java {
  // Maven Central refuses a release without them.
  withSourcesJar()
  withJavadocJar()
}

tasks.withType<JavaCompile> { options.release.set(11) }

// Only the "missing" group is off: a comment says why and not what, so not every method and parameter has one.
// Javadoc still checks the HTML, syntax and references of those that do.
tasks.withType<Javadoc> { (options as StandardJavadocDocletOptions).addStringOption("Xdoclint:all,-missing", "-quiet") }

tasks.withType<Jar> { from(rootDir.resolve("../../LICENSE")) { into("META-INF") } }

dependencies {
  // 5.9.0 is what the suites it was written for run on, and a suite brings its own at run time.
  compileOnly("org.junit.platform:junit-platform-launcher:1.9.0")
  compileOnly("org.junit.jupiter:junit-jupiter-api:5.9.0")
  // Adds a step around each @Step method as its class loads. 1.18.15 is the newest older than two weeks.
  implementation("net.bytebuddy:byte-buddy:1.18.15")
}

tasks.jar { archiveClassifier.set("plain") }

tasks.shadowJar {
  archiveClassifier.set("packed")
  // Under q6-report's own package, so a suite with Byte Buddy of its own, e.g: through Mockito, keeps its own version.
  relocate("net.bytebuddy", "q6report.shaded.bytebuddy")
  exclude("**/module-info.class")
  // Byte Buddy is under the same Apache licence as q6-report, so its LICENSE goes and q6-report's stands for both, added below, while
  // its NOTICE and the licence of the ASM it bundles stay, as that licence asks.
  transform(com.github.jengelman.gradle.plugins.shadow.transformers.ApacheLicenseResourceTransformer::class.java)
  transform(com.github.jengelman.gradle.plugins.shadow.transformers.ApacheNoticeResourceTransformer::class.java)
}

// The jar a suite takes: the packed one with q6-report's LICENSE, which is also the agent, so one dependency gives both.
val recorderJar by tasks.registering(Jar::class) {
  from(zipTree(tasks.shadowJar.flatMap { it.archiveFile })) { exclude("META-INF/MANIFEST.MF") }
  manifest { attributes("Premain-Class" to "q6report.StepAgent", "Multi-Release" to "true") }
}

tasks.assemble { dependsOn(recorderJar) }

publishing {
  publications {
    create<MavenPublication>("recorder") {
      // Byte Buddy is packed inside, so the published jar depends on nothing.
      artifact(recorderJar)
      artifact(tasks.named("sourcesJar"))
      artifact(tasks.named("javadocJar"))
      pom {
        name.set("q6-report JUnit 5 recorder")
        description.set("Records a JUnit 5 run for q6-report, a test report with history that opens from one file")
        licenses {
          license {
            name.set("Apache-2.0")
            url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
          }
        }
        developers {
          developer {
            name.set("Leo Mustatea")
            organization.set("Yopeso")
            organizationUrl.set("https://www.yopeso.com")
          }
        }
      }
    }
  }
  // A folder inside the build, which the recorder test installs from, so nothing is written to ~/.m2.
  repositories { maven { name = "build"; url = uri(layout.buildDirectory.dir("repo")) } }
}
