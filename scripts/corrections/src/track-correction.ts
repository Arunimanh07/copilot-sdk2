import type { GitHub, Context, Core } from './github-types';
import { CLASSIFICATION_LABELS, REVIEW_LABEL, CORRECTIONS_BRANCH } from './types';
import type { Correction } from './types';
import { writeCorrection } from './write-correction';

interface TrackCorrectionParams {
  github: GitHub;
  context: Context;
  core: Core;
}

export async function trackCorrection({ github, context, core }: TrackCorrectionParams) {
  const issue = context.payload.issue!;
  const label = context.payload.label!;
  const action = context.payload.action; // 'labeled' or 'unlabeled'
  const actor = context.payload.sender!.login;

  if (context.payload.sender!.type === 'Bot') {
    core.info('Ignoring bot-triggered label event');
    return;
  }

  // Check if actor has maintainer-level access
  const permission = await github.rest.repos.getCollaboratorPermissionLevel({
    owner: context.repo.owner,
    repo: context.repo.repo,
    username: actor,
  });
  const role = permission.data.permission;
  if (role !== 'admin' && role !== 'maintain' && role !== 'write') {
    core.info(`Actor "${actor}" has "${role}" permission — only write/maintain/admin can record corrections`);
    return;
  }

  const currentLabels = issue.labels!.map((l: { name: string }) => l.name);
  const hasReviewLabel = currentLabels.includes(REVIEW_LABEL);
  const isClassificationLabel = CLASSIFICATION_LABELS.includes(label.name);
  const isReviewLabel = label.name === REVIEW_LABEL;

  // --- Case 1: Confirmation (ai-triaged removed, no classification change) ---
  if (action === 'unlabeled' && isReviewLabel) {
    const remainingClassification = currentLabels.find((l: string) =>
      CLASSIFICATION_LABELS.includes(l)
    );
    if (!remainingClassification) {
      core.info('ai-triaged removed but no classification label present — ignoring');
      return;
    }

    core.info(
      `Confirmation: ${actor} confirmed classification "${remainingClassification}" on issue #${issue.number}`
    );

    const correction: Correction = {
      issue_number: issue.number,
      snapshot: {
        title: issue.title!,
        body: issue.body ?? '',
        author: issue.user!.login,
        created_at: issue.created_at!,
      },
      agent_label: remainingClassification,
      corrected_label: remainingClassification,
      corrected_by: actor,
      corrected_at: new Date().toISOString(),
      context_comments: [],
      confirmed: true,
    };

    await writeCorrection({ github, context, core, correction });
    return;
  }

  // --- Case 2: Correction (classification label changed while ai-triaged present) ---
  if (action === 'labeled' && isClassificationLabel && hasReviewLabel) {
    const timeline = await github.paginate(github.rest.issues.listEventsForTimeline, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issue.number,
      per_page: 100,
    });

    const now = new Date();
    const recentUnlabels = timeline
      .filter(
        (e: any) =>
          e.event === 'unlabeled' &&
          CLASSIFICATION_LABELS.includes(e.label?.name) &&
          e.actor?.login === actor &&
          now.getTime() - new Date(e.created_at).getTime() < 120_000
      )
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (recentUnlabels.length === 0) {
      core.info(
        `Classification label "${label.name}" added but no recent removal found — may be initial triage, ignoring`
      );
      return;
    }

    const agentLabel = recentUnlabels[0].label.name;
    const correctedLabel = label.name;

    if (agentLabel === correctedLabel) {
      core.info(`Same label re-applied ("${agentLabel}") — ignoring`);
      return;
    }

    core.info(
      `Correction: ${actor} changed from "${agentLabel}" to "${correctedLabel}" on issue #${issue.number}`
    );

    const comments = await github.paginate(github.rest.issues.listComments, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issue.number,
      per_page: 100,
    });

    const contextComments = comments
      .filter((c: any) => c.user.login === actor)
      .slice(-5)
      .map((c: any) => ({
        author: c.user.login,
        body: c.body,
        created_at: c.created_at,
      }));

    const correction: Correction = {
      issue_number: issue.number,
      snapshot: {
        title: issue.title!,
        body: issue.body ?? '',
        author: issue.user!.login,
        created_at: issue.created_at!,
      },
      agent_label: agentLabel,
      corrected_label: correctedLabel,
      corrected_by: actor,
      corrected_at: new Date().toISOString(),
      context_comments: contextComments,
      confirmed: false,
    };

    await writeCorrection({ github, context, core, correction });
    return;
  }

  core.info(
    `Label event "${action}" for "${label.name}" does not match correction or confirmation pattern — ignoring`
  );
}

// Entry point for actions/github-script
module.exports = async (params: TrackCorrectionParams) => trackCorrection(params);
