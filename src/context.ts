import { spawnSync } from 'node:child_process';

export interface RunContext {
  batch?: string;
  commit?: string;
  branch?: string;
  trigger: string;
  url?: string;
  /** Set by the variable each CI documents for a pull request's run, and only inside that CI. */
  isPullRequest?: boolean;
}

type Env = Record<string, string | undefined>;

/** Where a run came from, read from what each CI sets, so a run needs no configuration to say it. */
export function ciContext(env: Env): RunContext {
  if (env.GITHUB_ACTIONS) {
    const url =
      env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : undefined;
    return {
      trigger: 'GitHub Actions',
      ...(env.GITHUB_RUN_ID ? { batch: `github-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT ?? '1'}` } : {}),
      ...(env.GITHUB_SHA ? { commit: env.GITHUB_SHA } : {}),
      // On a pull request GITHUB_REF_NAME is its merge ref, e.g: 12/merge, and the head ref is the branch a person named.
      ...(env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME ? { branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME } : {}),
      ...(url ? { url } : {}),
      // Set on every other event too, as an empty value, so only a non-empty one means a pull request.
      ...(env.GITHUB_BASE_REF ? { isPullRequest: true } : {}),
    };
  }
  if (env.GITLAB_CI) {
    return {
      trigger: 'GitLab CI',
      ...(env.CI_PIPELINE_ID ? { batch: `gitlab-${env.CI_PIPELINE_ID}` } : {}),
      ...(env.CI_COMMIT_SHA ? { commit: env.CI_COMMIT_SHA } : {}),
      ...(env.CI_COMMIT_REF_NAME ? { branch: env.CI_COMMIT_REF_NAME } : {}),
      ...(env.CI_PIPELINE_URL ? { url: env.CI_PIPELINE_URL } : {}),
      ...(env.CI_MERGE_REQUEST_IID ? { isPullRequest: true } : {}),
    };
  }
  if (env.JENKINS_URL) {
    return {
      trigger: 'Jenkins',
      ...(env.BUILD_TAG ? { batch: `jenkins-${env.BUILD_TAG}` } : {}),
      ...(env.GIT_COMMIT ? { commit: env.GIT_COMMIT } : {}),
      ...(env.GIT_BRANCH ? { branch: env.GIT_BRANCH } : {}),
      ...(env.BUILD_URL ? { url: env.BUILD_URL } : {}),
      ...(env.CHANGE_ID ? { isPullRequest: true } : {}),
    };
  }
  return { trigger: env.CI ? 'CI' : 'Local' };
}

function git(args: string[], cwd: string): string | undefined {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 2000 });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

/** The CI's own values win; outside one, the checkout says, and a client's folder with no checkout says nothing. */
export function runContext(env: Env, cwd: string): RunContext {
  const context = ciContext(env);
  const commit = context.commit ?? git(['rev-parse', 'HEAD'], cwd);
  const branch = context.branch ?? git(['branch', '--show-current'], cwd);
  return { ...context, ...(commit ? { commit } : {}), ...(branch ? { branch } : {}) };
}

/**
 * Whether a run joins the project's history. A pull request's run never does, or a branch that breaks a test and then fixes
 * it would read as flaky; Q6_RUN_SCOPE answers what a tag means, so its "full" does not make a pull request one.
 */
export function isFullRun(env: Env, isNarrowed: boolean): boolean {
  if (ciContext(env).isPullRequest) return false;
  return env.Q6_RUN_SCOPE ? env.Q6_RUN_SCOPE === 'full' : !isNarrowed;
}
