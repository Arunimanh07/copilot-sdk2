import { describe, it, expect, vi } from 'vitest';
import { writeCorrection } from './write-correction';
import { mockCore, mockGitHub } from './test-helpers';
import type { Correction } from './types';

function baseContext() {
  return {
    payload: { repository: { default_branch: 'main' } },
    repo: { owner: 'github', repo: 'copilot-sdk' },
  };
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

describe('writeCorrection', () => {
  // --- Fix #1 regression: branch must NOT be force-pushed ---
  it('does not force-push the branch when it already exists', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = baseContext();

    // Branch already exists
    github.rest.repos.getBranch.mockResolvedValue({ data: {} });

    await writeCorrection({ github, context, core, correction: baseCorrectionFixture });

    // updateRef must never be called — that was the old force-push behavior
    expect(github.rest.git.updateRef).not.toHaveBeenCalled();
    // getRef should also not be called (only needed for branch creation)
    expect(github.rest.git.getRef).not.toHaveBeenCalled();
    // But we should still write the file
    expect(github.rest.repos.createOrUpdateFileContents).toHaveBeenCalled();
  });

  it('creates branch from default branch when it does not exist', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = baseContext();

    // Branch does not exist
    github.rest.repos.getBranch.mockRejectedValue({ status: 404 });

    await writeCorrection({ github, context, core, correction: baseCorrectionFixture });

    expect(github.rest.git.getRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/main' })
    );
    expect(github.rest.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'refs/heads/triage-corrections',
        sha: 'abc123',
      })
    );
  });

  it('handles concurrent branch creation gracefully (422 error)', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = baseContext();

    github.rest.repos.getBranch.mockRejectedValue({ status: 404 });
    github.rest.git.createRef.mockRejectedValue({ status: 422 });

    await writeCorrection({ github, context, core, correction: baseCorrectionFixture });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('created concurrently')
    );
    // Should still proceed to write the file
    expect(github.rest.repos.createOrUpdateFileContents).toHaveBeenCalled();
  });

  it('propagates unexpected errors during branch creation', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = baseContext();

    github.rest.repos.getBranch.mockRejectedValue({ status: 404 });
    github.rest.git.createRef.mockRejectedValue({ status: 500, message: 'Server error' });

    await expect(
      writeCorrection({ github, context, core, correction: baseCorrectionFixture })
    ).rejects.toEqual({ status: 500, message: 'Server error' });
  });

  it('passes existing file SHA when updating an existing correction', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = baseContext();

    github.rest.repos.getBranch.mockResolvedValue({ data: {} });
    github.rest.repos.getContent.mockResolvedValue({
      data: { sha: 'existing-file-sha' },
    });

    await writeCorrection({ github, context, core, correction: baseCorrectionFixture });

    expect(github.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ sha: 'existing-file-sha' })
    );
  });

  it('omits sha when creating a new correction file', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = baseContext();

    github.rest.repos.getBranch.mockResolvedValue({ data: {} });
    // getContent defaults to 404 in mockGitHub

    await writeCorrection({ github, context, core, correction: baseCorrectionFixture });

    const call = github.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    expect(call.sha).toBeUndefined();
  });

  it('creates PR when none exists', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = baseContext();

    github.rest.repos.getBranch.mockResolvedValue({ data: {} });
    github.rest.pulls.list.mockResolvedValue({ data: [] });

    await writeCorrection({ github, context, core, correction: baseCorrectionFixture });

    expect(github.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        head: 'triage-corrections',
        base: 'main',
      })
    );
  });

  it('reuses existing open PR', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = baseContext();

    github.rest.repos.getBranch.mockResolvedValue({ data: {} });
    github.rest.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

    await writeCorrection({ github, context, core, correction: baseCorrectionFixture });

    expect(github.rest.pulls.create).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith('PR #55 already exists');
  });

  it('writes confirmation file with correct commit message', async () => {
    const core = mockCore();
    const github = mockGitHub();
    const context = baseContext();

    github.rest.repos.getBranch.mockResolvedValue({ data: {} });

    const confirmation: Correction = { ...baseCorrectionFixture, confirmed: true };
    await writeCorrection({ github, context, core, correction: confirmation });

    expect(github.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Track confirmation for issue #42',
      })
    );
  });
});
