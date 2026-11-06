/**
 * The words that depend on what a suite is built on. The rest of the page's words are the same for every suite, and
 * stay where they are drawn. A suite passes only the ones it wants different, with writeReport's copy option.
 */
export interface Copy {
  /** One test, and more than one, e.g: "12 tests on 2 lanes". */
  test: string;
  tests: string;
  /** What tests are grouped by, in the search box. */
  group: string;
  /** What fails to start when a run cannot start, one and more than one. */
  startUnit: string;
  startUnits: string;
  /** Follows a count of startUnit. */
  notStarted: string;
  /** Under the count of skipped results. */
  skippedFoot: string;
  /** On a skipped result. */
  skippedResult: string;
  /** On a failure that has no screenshot. */
  noScreenshot: string;
  /** Where a history is kept, before a project has trends to draw. */
  historyHome: string;
  /** What a known bug means in this suite. */
  knownBug: string;
}

export const DEFAULT_COPY: Copy = {
  test: 'test',
  tests: 'tests',
  group: 'group',
  startUnit: 'test file',
  startUnits: 'test files',
  notStarted: "failed before any test began. The run's output says why.",
  skippedFoot: 'did not run',
  skippedResult: 'This test did not run.',
  noScreenshot: 'This failure has no screenshot.',
  historyHome: "Each run adds to its project's history, as long as the history folder is kept between runs.",
  knownBug: 'A person marked it as a known bug',
};
