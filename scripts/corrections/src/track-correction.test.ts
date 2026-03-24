import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackCorrection } from './track-correction';
import { mockCore, mockGitHub, mockLabelContext } from './test-helpers';

describe('trackCorrection', () => {
  let core: ReturnType<typeof mockCore>;
  let github: ReturnType<typeof mockGitHub>;

  beforeEach(() => {
    core = mockCore();
    github = mockGitHub();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  // --- Bot filtering ---
  it('ignores bot-triggered events', async () => {
    const context = mockLabelContext({
      action: 'labeled',
      labelName: 'bug',
      actorType: 'Bot',
    });

    await trackCorrection({ github, context, core });

    expect(core.info).toHaveBeenCalledWith('Ignoring bot-triggered label event');
    expect(github.rest.repos.getCollaboratorPermissionLevel).not.toHaveBeenCalled();
  });

  // --- Permission guard ---
  it('ignores events from users without write access', async () => {
    const context = mockLabelContext({
      action: 'labeled',
      labelName: 'bug',
      currentLabels: ['bug', 'ai-triaged'],
    });

    github.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: 'read' },
    });

    await trackCorrection({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('only write/maintain/admin can record corrections')
    );
  });

  it('allows maintainers to record corrections', async () => {
    const context = mockLabelContext({
      action: 'labeled',
      labelName: 'bug',
      currentLabels: ['bug', 'ai-triaged'],
    });

    // Set up as a correction scenario with timeline
    const twoSecondsAgo = new Date('2026-01-15T11:59:58Z').toISOString();
    github.paginate
      .mockResolvedValueOnce([
        {
          event: 'unlabeled',
          label: { name: 'enhancement' },
          actor: { login: 'maintainer' },
          created_at: twoSecondsAgo,
        },
      ])
      .mockResolvedValueOnce([]); // comments

    await trackCorrection({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('changed from "enhancement" to "bug"')
    );
  });

  // --- Confirmation ---
  it('records confirmation when ai-triaged is removed without classification change', async () => {
    const context = mockLabelContext({
      action: 'unlabeled',
      labelName: 'ai-triaged',
      currentLabels: ['bug'],
    });

    await trackCorrection({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Confirmation')
    );
    expect(github.rest.repos.createOrUpdateFileContents).toHaveBeenCalled();

    // Verify the written content is a confirmation
    const call = github.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    const content = JSON.parse(Buffer.from(call.content, 'base64').toString('utf8'));
    expect(content.confirmed).toBe(true);
    expect(content.agent_label).toBe('bug');
    expect(content.corrected_label).toBe('bug');
  });

  it('ignores ai-triaged removal when no classification label remains', async () => {
    const context = mockLabelContext({
      action: 'unlabeled',
      labelName: 'ai-triaged',
      currentLabels: [], // no classification labels left
    });

    await trackCorrection({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      'ai-triaged removed but no classification label present — ignoring'
    );
    expect(github.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  // --- Correction detection ---
  it('detects correction when classification label changes', async () => {
    const context = mockLabelContext({
      action: 'labeled',
      labelName: 'bug',
      currentLabels: ['bug', 'ai-triaged'],
    });

    const twoSecondsAgo = new Date('2026-01-15T11:59:58Z').toISOString();
    github.paginate
      .mockResolvedValueOnce([
        {
          event: 'unlabeled',
          label: { name: 'enhancement' },
          actor: { login: 'maintainer' },
          created_at: twoSecondsAgo,
        },
      ])
      .mockResolvedValueOnce([
        {
          user: { login: 'maintainer' },
          body: 'This is actually a bug, not an enhancement',
          created_at: twoSecondsAgo,
        },
      ]);

    await trackCorrection({ github, context, core });

    expect(github.rest.repos.createOrUpdateFileContents).toHaveBeenCalled();

    const call = github.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    const content = JSON.parse(Buffer.from(call.content, 'base64').toString('utf8'));
    expect(content.confirmed).toBe(false);
    expect(content.agent_label).toBe('enhancement');
    expect(content.corrected_label).toBe('bug');
    expect(content.context_comments).toHaveLength(1);
    expect(content.context_comments[0].body).toContain('actually a bug');
  });

  it('ignores classification label add without recent removal (initial triage)', async () => {
    const context = mockLabelContext({
      action: 'labeled',
      labelName: 'bug',
      currentLabels: ['bug', 'ai-triaged'],
    });

    github.paginate.mockResolvedValue([]); // no timeline events

    await trackCorrection({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('no recent removal found')
    );
    expect(github.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it('ignores same label re-applied', async () => {
    const context = mockLabelContext({
      action: 'labeled',
      labelName: 'bug',
      currentLabels: ['bug', 'ai-triaged'],
    });

    github.paginate.mockResolvedValue([
      {
        event: 'unlabeled',
        label: { name: 'bug' }, // same label
        actor: { login: 'maintainer' },
        created_at: new Date('2026-01-15T11:59:58Z').toISOString(),
      },
    ]);

    await trackCorrection({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Same label re-applied')
    );
    expect(github.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  // --- Comment pagination ---
  it('fetches up to 100 comments to capture actor context', async () => {
    const context = mockLabelContext({
      action: 'labeled',
      labelName: 'bug',
      currentLabels: ['bug', 'ai-triaged'],
    });

    const recentTimestamp = new Date('2026-01-15T11:59:58Z').toISOString();
    github.paginate
      .mockResolvedValueOnce([
        {
          event: 'unlabeled',
          label: { name: 'enhancement' },
          actor: { login: 'maintainer' },
          created_at: recentTimestamp,
        },
      ])
      .mockResolvedValueOnce([]); // comments

    await trackCorrection({ github, context, core });

    // Second paginate call should be for comments with per_page: 100
    expect(github.paginate).toHaveBeenNthCalledWith(
      2,
      github.rest.issues.listComments,
      expect.objectContaining({ per_page: 100 })
    );
  });

  // --- Non-matching events ---
  it('ignores non-classification label events', async () => {
    const context = mockLabelContext({
      action: 'labeled',
      labelName: 'priority/high',
      currentLabels: ['priority/high', 'bug', 'ai-triaged'],
    });

    await trackCorrection({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('does not match correction or confirmation pattern')
    );
  });

  it('ignores classification label added without ai-triaged present', async () => {
    const context = mockLabelContext({
      action: 'labeled',
      labelName: 'bug',
      currentLabels: ['bug'], // no ai-triaged
    });

    await trackCorrection({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('does not match correction or confirmation pattern')
    );
  });

  // --- Timeline window ---
  it('ignores old unlabel events outside 2-minute window', async () => {
    const context = mockLabelContext({
      action: 'labeled',
      labelName: 'bug',
      currentLabels: ['bug', 'ai-triaged'],
    });

    github.paginate.mockResolvedValue([
      {
        event: 'unlabeled',
        label: { name: 'enhancement' },
        actor: { login: 'maintainer' },
        created_at: new Date('2026-01-15T11:50:00Z').toISOString(), // 10 min ago
      },
    ]);

    await trackCorrection({ github, context, core });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('no recent removal found')
    );
  });

  // --- PR creation ---
  it('creates a new PR when none exists', async () => {
    const context = mockLabelContext({
      action: 'unlabeled',
      labelName: 'ai-triaged',
      currentLabels: ['bug'],
    });

    github.rest.pulls.list.mockResolvedValue({ data: [] });

    await trackCorrection({ github, context, core });

    expect(github.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Classification corrections' })
    );
  });

  it('reuses existing PR when one is open', async () => {
    const context = mockLabelContext({
      action: 'unlabeled',
      labelName: 'ai-triaged',
      currentLabels: ['bug'],
    });

    github.rest.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

    await trackCorrection({ github, context, core });

    expect(github.rest.pulls.create).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith('PR #77 already exists');
  });
});
