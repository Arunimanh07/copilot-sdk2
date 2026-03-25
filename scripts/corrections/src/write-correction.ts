import type { GitHub, Context, Core } from './github-types';
import { CORRECTIONS_BRANCH } from './types';
import type { Correction } from './types';

interface WriteCorrectionParams {
  github: GitHub;
  context: Context;
  core: Core;
  correction: Correction;
}

export async function writeCorrection({ github, context, core, correction }: WriteCorrectionParams) {
  const branchName = CORRECTIONS_BRANCH;
  const filePath = `evals/corrections/issue-${correction.issue_number}.json`;
  const fileContent = JSON.stringify(correction, null, 2) + '\n';
  const commitMessage = correction.confirmed
    ? `Track confirmation for issue #${correction.issue_number}`
    : `Track correction for issue #${correction.issue_number}: ${correction.agent_label} → ${correction.corrected_label}`;

  const defaultBranch = context.payload.repository!.default_branch;

  // Ensure the corrections branch exists (create from default branch if needed)
  let branchExists = false;
  try {
    await github.rest.repos.getBranch({
      owner: context.repo.owner,
      repo: context.repo.repo,
      branch: branchName,
    });
    branchExists = true;
  } catch (e: any) {
    if (e.status !== 404) throw e;
  }

  if (!branchExists) {
    const defaultRef = await github.rest.git.getRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `heads/${defaultBranch}`,
    });

    try {
      await github.rest.git.createRef({
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: `refs/heads/${branchName}`,
        sha: defaultRef.data.object.sha,
      });
      core.info(`Created branch "${branchName}"`);
    } catch (createErr: any) {
      // Another concurrent job may have created the branch — that's fine
      if (createErr.status !== 422) throw createErr;
      core.info(`Branch "${branchName}" was created concurrently — proceeding`);
    }
  }

  // Check if file already exists on the branch
  let existingSha: string | undefined;
  try {
    const existing = await github.rest.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: filePath,
      ref: branchName,
    });
    existingSha = (existing.data as { sha: string }).sha;
  } catch (e: any) {
    if (e.status !== 404) throw e;
  }

  // Create or update the file
  await github.rest.repos.createOrUpdateFileContents({
    owner: context.repo.owner,
    repo: context.repo.repo,
    path: filePath,
    message: commitMessage,
    content: Buffer.from(fileContent).toString('base64'),
    branch: branchName,
    ...(existingSha ? { sha: existingSha } : {}),
  });
  core.info(`Wrote ${filePath} to branch "${branchName}"`);

  // Find or create the PR
  const existingPRs = await github.rest.pulls.list({
    owner: context.repo.owner,
    repo: context.repo.repo,
    head: `${context.repo.owner}:${branchName}`,
    state: 'open',
  });

  if (existingPRs.data.length === 0) {
    const pr = await github.rest.pulls.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: 'Classification corrections',
      body: [
        'This PR contains classification corrections tracked by the correction tracker.',
        '',
        'Each file in `evals/corrections/` represents a case where a human corrected',
        "the AI triage agent's classification.",
        '',
        'Review the corrections and merge when ready.',
      ].join('\n'),
      head: branchName,
      base: defaultBranch,
    });
    core.info(`Created PR #${pr.data.number}`);
  } else {
    core.info(`PR #${existingPRs.data[0].number} already exists`);
  }
}
