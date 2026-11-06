import { categoryDescription, failingStretch, median, type Model, type Result } from '../analysis.ts';
import { type Attachment, attachmentsFolderOf } from '../model.ts';
import { strip } from './charts.ts';
import { h, icon } from './dom.ts';
import { failingChip, fmtDateTime, fmtTime } from './format.ts';
import { badge, catLabel, currentPath, go, runHash, shotUri, testHash } from './views.ts';

export function findResult(model: Model, hash: string): Result | undefined {
  const match = /[?&]r=(d?)(\d+):([^:&]+):([^:&]+)/.exec(hash);
  if (!match) return undefined;
  const run = (match[1] ? model.debugRuns : model.runs).find((candidate) => candidate.n === Number(match[2]));
  const lane = decodeURIComponent(match[3]!);
  const test = decodeURIComponent(match[4]!);
  return run?.results.find((result) => result.lane === lane && result.test === test);
}

/** What this step took on the same lane's last passes, for flagging one that suddenly took much longer. */
function usualStepMs(result: Result, index: number): number {
  const times: number[] = [];
  let cursor = result.prev;
  for (let i = 0; cursor && i < 10; i++, cursor = cursor.prev) {
    const step = cursor.steps[index];
    if (cursor.status === 'passed' && step?.text === result.steps[index]?.text && step) times.push(step.ms);
  }
  return times.length >= 3 ? median(times) : 0;
}

/** Says so when the command runs more than this test, as a person would otherwise run far more than they meant to. */
function sharedCommandNote(model: Model, { rerunScope: scope }: Result): HTMLElement[] {
  if (scope === undefined) return [];
  const sharing = scope ? model.tests.filter((test) => test.tags.includes(scope)).length : model.tests.length;
  if (sharing <= 1) return [];
  const { tests } = model.copy;
  return [
    h('p', {
      cls: 'note',
      text: scope
        ? `This test has no tag of its own, so this runs all ${sharing} ${tests} tagged ${scope}.`
        : `This test has no tag, so this runs all ${sharing} ${tests}.`,
    }),
  ];
}

function rerunSection(model: Model, result: Result, command: string): HTMLElement[] {
  const copy = h('button', {
    cls: 'link',
    style: 'font-size:13px;white-space:nowrap',
    text: 'Copy',
    onclick: () => {
      const done = () => {
        copy.textContent = 'Copied';
        setTimeout(() => {
          copy.textContent = 'Copy';
        }, 1400);
      };
      // A page opened from a file has no clipboard API in most browsers, so the older way has to work too.
      if (navigator.clipboard && window.isSecureContext) {
        void navigator.clipboard.writeText(command).then(done);
        return;
      }
      const area = h('textarea', { style: 'position:fixed;opacity:0' });
      area.value = command;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      done();
    },
  });
  return [
    h('div', { cls: 'h4', text: 'Run it again' }),
    h('div', { cls: 'cmd' }, [h('code', { text: command }), copy]),
    ...sharedCommandNote(model, result),
  ];
}

/**
 * Each file a test attached, linked to its copy in the folder beside the page, with a short text also shown here, as the
 * page may travel without that folder. A run recorded before attachments were kept still lists where its recorder put each.
 */
function attachmentsSection(model: Model, result: Result, files: Attachment[], isGone: boolean): HTMLElement[] {
  const folder = attachmentsFolderOf(model.project);
  const shotLimit = result.run.isDebug ? model.debugShotRuns : model.shotRuns;
  const rows = files.map((file) => {
    const text = file.stored === undefined ? undefined : model.texts[file.stored];
    return h('li', {}, [
      file.stored && !isGone
        ? h('a', { cls: 'link', href: `./${folder}/${file.stored}`, target: '_blank', rel: 'noopener', text: file.name })
        : h('b', { text: file.name }),
      (result.attempts ?? 1) > 1 && file.attempt ? h('span', { cls: 'chip', text: `attempt ${file.attempt}` }) : null,
      file.stored ? null : h('span', { cls: 'mono', text: file.path }),
      text === undefined ? null : h('details', { cls: 'stack' }, [h('summary', { text: 'Show the text' }), h('pre', { text })]),
    ]);
  });
  return [
    h('div', { cls: 'h4', text: 'Attachments' }),
    h('ul', { cls: 'attachments' }, rows),
    ...(isGone && files.some((file) => file.stored)
      ? [
          h('p', {
            cls: 'note',
            text: `Attachments stay for the newest ${shotLimit} runs, so these are gone. The step and the error stay for good.`,
          }),
        ]
      : []),
  ];
}

/** A failure no step holds happened in a hook or in the test's own code between its steps, which only its place tells apart. */
function failedOutsideSteps(result: Result): string {
  if (!result.steps.length) return 'Failed';
  return result.at ? `Failed outside any step, at ${result.at}` : 'Failed outside any step';
}

export function renderSheet(model: Model): void {
  document.getElementById('sheet-root')?.remove();
  const result = findResult(model, location.hash);
  document.body.classList.toggle('is-locked', Boolean(result));
  if (!result) return;
  const close = () => go(`#${currentPath()}`);
  const stretch = result.status === 'failed' ? failingStretch(result) : undefined;
  const lane = model.lanes.find((candidate) => candidate.id === result.lane);
  const failedStep = result.failedAt === undefined ? undefined : result.steps[result.failedAt];
  const uri = shotUri(model, result);
  const newest = (result.run.isDebug ? model.debugRuns : model.runs).at(-1)!.n;
  const shotLimit = result.run.isDebug ? model.debugShotRuns : model.shotRuns;
  const longest = Math.max(1, ...result.steps.map((step) => step.ms));
  const history = model.tests.find((test) => test.id === result.test)?.history[result.lane] ?? [];
  const attempts: Result[] = [];
  for (let cursor: Result | undefined = result; cursor?.run.isDebug; cursor = cursor.prev) attempts.unshift(cursor);

  const stepRows = result.steps.map((step, index) => {
    const usual = step.status === 'passed' ? usualStepMs(result, index) : 0;
    const glyph =
      step.status === 'failed' ? icon('x', 't-fail') : step.status === 'passed' ? icon('check', 't-pass') : icon('minus', 't-mute');
    return h('li', { cls: `is-${step.status === 'notRun' ? 'unrun' : step.status}` }, [
      h('span', { cls: 'g' }, [glyph]),
      h('span', { cls: 'txt' }, [
        h('span', { cls: 'kw', text: `${step.keyword} ` }),
        step.text,
        usual && step.ms > usual * 1.5 && step.ms - usual > 1000 ? h('span', { cls: 'slow', text: `Usually ${fmtTime(usual)}` }) : null,
      ]),
      h('span', { cls: 'bar' }, step.status === 'notRun' ? [] : [h('i', { style: `width:${Math.max(3, (step.ms / longest) * 100)}%` })]),
      h('span', { cls: 'tm', text: step.status === 'notRun' ? 'not run' : fmtTime(step.ms) }),
    ]);
  });
  // A test stops where it fails, so a failure no step holds came after its last step, and the list must not end all green.
  if (result.status === 'failed' && !failedStep && result.steps.length) {
    stepRows.push(
      h('li', { cls: 'is-failed' }, [
        h('span', { cls: 'g' }, [icon('x', 't-fail')]),
        h('span', { cls: 'txt', text: result.at ? `Failed here, outside any step, at ${result.at}` : 'Failed here, outside any step' }),
        h('span', { cls: 'bar' }),
        h('span', { cls: 'tm' }),
      ]),
    );
  }

  const screenshot = (() => {
    if (result.status !== 'failed') return null;
    // A lane that never kept an image has no screen, so a sentence on every failure there would say nothing.
    if (!result.image && !model.lanesWithImages.has(result.lane)) return null;
    if (uri) {
      return h(
        'button',
        {
          cls: 'shot',
          'aria-label': 'Enlarge the screenshot',
          onclick: () => {
            const zoom = document.getElementById('zoom') as HTMLDialogElement;
            (document.getElementById('zoom-img') as HTMLImageElement).src = uri;
            zoom.showModal();
          },
        },
        [h('img', { src: uri, alt: `The screen when "${result.name}" failed` })],
      );
    }
    return h('p', {
      cls: 'placeholder',
      text:
        result.image && result.run.n <= newest - shotLimit
          ? `Screenshots stay for the newest ${shotLimit} runs, so this one is gone. The step and the error stay for good.`
          : result.image
            ? `This screenshot is left out of the page to keep it small. It is under the project's history folder, as screenshots/${result.image.path}.`
            : model.copy.noScreenshot,
    });
  })();

  const root = h('div', { id: 'sheet-root' }, [
    h('div', { cls: 'scrim', onclick: close }),
    h('aside', { cls: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': result.name, tabindex: '-1' }, [
      h('div', { cls: 'sheet-h' }, [
        h('div', { cls: 'sheet-top' }, [
          badge(result.status),
          stretch
            ? h('span', {
                cls: stretch.since === result && !stretch.isCut ? 'chip is-new' : 'chip is-still',
                text: stretch.since === result && !stretch.isCut ? 'New in this run' : failingChip(stretch),
              })
            : null,
          model.lanes.length > 1 && lane ? h('span', { cls: 'chip', text: lane.long }) : null,
        ]),
        h('h2', { text: result.name }),
        h('p', {
          cls: 'sub',
          text: [
            result.group,
            fmtDateTime(result.run.at),
            result.status === 'skipped' ? '' : fmtTime(result.ms),
            (result.attempts ?? 1) > 1 ? `ran ${result.attempts} times` : '',
          ]
            .filter(Boolean)
            .join(', '),
        }),
        h('div', { cls: 'links' }, [
          model.isDebug
            ? model.mainReport && model.tests.some((test) => test.id === result.test)
              ? h('a', {
                  cls: 'link',
                  href: `./${encodeURIComponent(model.mainReport)}${testHash(result.test)}`,
                  text: 'History of this test',
                })
              : null
            : h('a', { cls: 'link', href: testHash(result.test), text: 'History of this test' }),
          h('a', { cls: 'link', href: runHash(result.run), text: `${result.run.isDebug ? 'Trial run' : 'Run'} #${result.run.n}` }),
          result.run.url ? h('a', { cls: 'link', href: result.run.url, target: '_blank', rel: 'noopener', text: 'Open in CI' }) : null,
        ]),
        h('button', { cls: 'close', 'aria-label': 'Close', onclick: close }, [icon('close')]),
      ]),
      h('div', { cls: 'sheet-b' }, [
        result.status === 'failed'
          ? h('div', { cls: 'fail-box' }, [
              failedStep
                ? h('div', {
                    cls: 'at',
                    text: `Failed at step ${result.failedAt! + 1} of ${result.steps.length}: ${failedStep.keyword} ${failedStep.text}`,
                  })
                : h('div', { cls: 'at', text: failedOutsideSteps(result) }),
              h('code', { text: result.error ?? '' }),
            ])
          : null,
        result.status === 'skipped' ? h('p', { cls: 'placeholder', text: model.copy.skippedResult }) : null,
        screenshot,
        result.category
          ? h('div', {}, [
              h('div', { cls: 'h4', text: result.status === 'failed' ? 'Why it failed' : 'Why it counts as flaky' }),
              h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, [
                catLabel(result.category),
                h('span', { style: 'color:var(--ink3);font-size:12.5px', text: categoryDescription(result.category, model.copy) }),
                result.knownBug ? h('span', { cls: 'chip' }, [icon('bug'), result.knownBug]) : null,
              ]),
            ])
          : null,
        result.steps.length ? h('div', { cls: 'h4', text: 'Steps' }) : null,
        result.steps.length ? h('ol', { cls: 'steps' }, stepRows) : null,
        result.stack ? h('details', { cls: 'stack' }, [h('summary', { text: 'Stack trace' }), h('pre', { text: result.stack })]) : null,
        attempts.length > 1 ? h('div', { cls: 'h4', text: 'Your attempts at this test' }) : null,
        attempts.length > 1 ? strip(attempts, 10) : null,
        history.length
          ? h('div', { cls: 'h4', text: result.run.isDebug ? 'Last 30 full runs on this lane' : 'Last 30 results on this lane' })
          : null,
        history.length ? strip(history) : null,
        ...(result.rerun ? rerunSection(model, result, result.rerun) : []),
        ...(result.attachments?.length ? attachmentsSection(model, result, result.attachments, result.run.n <= newest - shotLimit) : []),
        result.tags.length ? h('div', { cls: 'h4', text: 'Tags' }) : null,
        result.tags.length
          ? h(
              'div',
              { style: 'display:flex;gap:6px;flex-wrap:wrap' },
              result.tags.map((tag) => h('span', { cls: 'chip', text: tag })),
            )
          : null,
      ]),
    ]),
  ]);
  document.body.append(root);
  root.querySelector<HTMLElement>('.sheet')?.focus();
}
