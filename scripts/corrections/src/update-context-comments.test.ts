import { describe, it, expect } from 'vitest';
import { updateContextComments } from './update-context-comments';
import { mockCore, mockGitHub, mockCommentContext } from './test-helpers';
import type { Correction } from './types';

function encodeCorrectionFile(correction: Correction): string {
  return Buffer.from(JSON.stringify(correction, null, 2) + '\n').toString('base64');
}

const baseCorrectionFixture: Correction = {
  issue_number: 42,
  snapshot: {
    title: 'Test issue',
    body: 'Test body',
    author: 'author',
    created_at: '2026-01-01T00:00:00Z',
  },
  agent_label: 'enhancement',
  corrected_label: 'bug',
  corrected_by: 'maintainer',
  corrected_at: '2026-01-01T01:00:00Z',
  context_comments: [],
  confirmed: false,
};

describe('updateContextComments', () => {
  it('ignores bot comments', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = mockCommentContext({ commenterType: 'Bot' });

    await updateContextComments({ github, context, core });

    expect(core.info).toHaveBeenCalledWith('Ignoring bot comment');
    expect(github.rest.repos.getContent).not.toHaveBeenCalled();
  });

  it('ignores comments when no correction file exists', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = mockCommentContext({});

    // getContent already defaults to 404 in mockGitHub

    await updateContextComments({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('No correction file for issue #42')
    );
  });

  it('ignores comments when correction PR is already merged', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = mockCommentContext({});

    github.rest.repos.getContent.mockResolvedValue({
      data: {
        content: encodeCorrectionFile(baseCorrectionFixture),
        sha: 'file-sha',
      },
    });
    github.rest.pulls.list.mockResolvedValue({ data: [] }); // no open PRs

    await updateContextComments({ github, context, core });

    expect(core.info).toHaveBeenCalledWith('Correction PR already merged — not updating');
  });

  it('ignores comments from non-corrector users', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = mockCommentContext({ commenter: 'someone-else' });

    github.rest.repos.getContent.mockResolvedValue({
      data: {
        content: encodeCorrectionFile(baseCorrectionFixture),
        sha: 'file-sha',
      },
    });
    github.rest.pulls.list.mockResolvedValue({ data: [{ number: 99 }] });

    await updateContextComments({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining("doesn't match corrector")
    );
    expect(github.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it('appends comment from corrector to existing correction', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = mockCommentContext({
      commenter: 'maintainer',
      commentBody: 'This is a regression from v2.0',
    });

    github.rest.repos.getContent.mockResolvedValue({
      data: {
        content: encodeCorrectionFile(baseCorrectionFixture),
        sha: 'file-sha',
      },
    });
    github.rest.pulls.list.mockResolvedValue({ data: [{ number: 99 }] });

    await updateContextComments({ github, context, core });

    expect(github.rest.repos.createOrUpdateFileContents).toHaveBeenCalled();

    const call = github.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    const updatedCorrection: Correction = JSON.parse(
      Buffer.from(call.content, 'base64').toString('utf8')
    );
    expect(updatedCorrection.context_comments).toHaveLength(1);
    expect(updatedCorrection.context_comments[0].body).toBe('This is a regression from v2.0');
    expect(updatedCorrection.context_comments[0].author).toBe('maintainer');
    expect(call.sha).toBe('file-sha');
  });

  it('preserves existing context_comments when appending', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = mockCommentContext({
      commenter: 'maintainer',
      commentBody: 'Second comment',
    });

    const correctionWithExisting: Correction = {
      ...baseCorrectionFixture,
      context_comments: [
        { author: 'maintainer', body: 'First comment', created_at: '2026-01-01T00:30:00Z' },
      ],
    };

    github.rest.repos.getContent.mockResolvedValue({
      data: {
        content: encodeCorrectionFile(correctionWithExisting),
        sha: 'file-sha',
      },
    });
    github.rest.pulls.list.mockResolvedValue({ data: [{ number: 99 }] });

    await updateContextComments({ github, context, core });

    const call = github.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    const updatedCorrection: Correction = JSON.parse(
      Buffer.from(call.content, 'base64').toString('utf8')
    );
    expect(updatedCorrection.context_comments).toHaveLength(2);
    expect(updatedCorrection.context_comments[0].body).toBe('First comment');
    expect(updatedCorrection.context_comments[1].body).toBe('Second comment');
  });
});
