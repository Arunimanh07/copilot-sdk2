import type { GitHub, Context, Core } from './github-types';
import { CORRECTIONS_BRANCH } from './types';
import type { Correction } from './types';

interface UpdateContextCommentsParams {
  github: GitHub;
  context: Context;
  core: Core;
}

export async function updateContextComments({ github, context, core }: UpdateContextCommentsParams) {
  const issueNumber = context.payload.issue!.number;
  const commenter = context.payload.comment!.user!.login;
  const branchName = CORRECTIONS_BRANCH;
  const filePath = `evals/corrections/issue-${issueNumber}.json`;

  if (context.payload.comment!.user!.type === 'Bot') {
    core.info('Ignoring bot comment');
    return;
  }

  // Check if a correction file exists on the corrections branch
  let existingFile: any;
  try {
    existingFile = await github.rest.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: filePath,
      ref: branchName,
    });
  } catch (e: any) {
    if (e.status === 404) {
      core.info(`No correction file for issue #${issueNumber} — ignoring comment`);
      return;
    }
    throw e;
  }

  // Check if there's an open PR for this branch
  const openPRs = await github.rest.pulls.list({
    owner: context.repo.owner,
    repo: context.repo.repo,
    head: `${context.repo.owner}:${branchName}`,
    state: 'open',
  });

  if (openPRs.data.length === 0) {
    core.info('Correction PR already merged — not updating');
    return;
  }

  // Parse existing correction
  const content = Buffer.from(existingFile.data.content, 'base64').toString('utf8');
  const correction: Correction = JSON.parse(content);

  // Only append if commenter matches the corrector
  if (correction.corrected_by !== commenter) {
    core.info(
      `Comment by "${commenter}" doesn't match corrector "${correction.corrected_by}" — ignoring`
    );
    return;
  }

  // Append the new comment
  correction.context_comments.push({
    author: commenter,
    body: context.payload.comment!.body!,
    created_at: context.payload.comment!.created_at!,
  });

  // Update the file on the branch
  const updatedContent = JSON.stringify(correction, null, 2) + '\n';
  await github.rest.repos.createOrUpdateFileContents({
    owner: context.repo.owner,
    repo: context.repo.repo,
    path: filePath,
    message: `Update correction for issue #${issueNumber}: add context comment`,
    content: Buffer.from(updatedContent).toString('base64'),
    branch: branchName,
    sha: existingFile.data.sha,
  });

  core.info(`Appended comment to correction for issue #${issueNumber}`);
}

// Entry point for actions/github-script
module.exports = async (params: UpdateContextCommentsParams) => updateContextComments(params);
