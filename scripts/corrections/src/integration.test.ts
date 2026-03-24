/**
 * Integration tests for the correction tracking system.
 *
 * These exercise the full flow (detection → branch management → file write → PR)
 * with realistic webhook payloads and a recording GitHub client that captures
 * every API call in order. They catch wiring bugs that unit tests miss —
 * wrong field names, missing .data unwrapping, incorrect call sequences, etc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackCorrection } from './track-correction';
import { updateContextComments } from './update-context-comments';
import type { Correction } from './types';

// ---------------------------------------------------------------------------
// Realistic webhook payloads (modeled after actual GitHub webhook JSON)
// ---------------------------------------------------------------------------

function issuesLabeledPayload(opts: {
  labelName: string;
  issueNumber?: number;
  issueTitle?: string;
  issueBody?: string;
  issueAuthor?: string;
  actor?: string;
  actorType?: string;
  currentLabels?: string[];
}) {
  return {
    payload: {
      action: 'labeled' as const,
      label: { id: 501, name: opts.labelName, color: 'd73a4a', description: '' },
      sender: { login: opts.actor ?? 'senior-dev', type: opts.actorType ?? 'User', id: 1001 },
      issue: {
        number: opts.issueNumber ?? 123,
        title: opts.issueTitle ?? 'Login page returns 500 after password reset',
        body:
          opts.issueBody ??
          'When I try to log in after resetting my password, the server returns a 500 error.\n\n' +
            'Steps to reproduce:\n1. Reset password via email\n2. Click login\n3. Enter new password\n4. See 500 error',
        user: { login: opts.issueAuthor ?? 'end-user', type: 'User', id: 2001 },
        created_at: '2026-03-20T10:00:00Z',
        updated_at: '2026-03-20T14:30:00Z',
        labels: (opts.currentLabels ?? ['bug', 'ai-triaged']).map((name, i) => ({
          id: 200 + i,
          name,
          color: 'ededed',
        })),
        state: 'open',
      },
      repository: {
        id: 9999,
        full_name: 'myorg/myrepo',
        default_branch: 'main',
        private: false,
      },
    },
    repo: { owner: 'myorg', repo: 'myrepo' },
  };
}

function issuesUnlabeledPayload(opts: {
  labelName: string;
  issueNumber?: number;
  actor?: string;
  currentLabels?: string[];
}) {
  return {
    payload: {
      action: 'unlabeled' as const,
      label: { id: 502, name: opts.labelName, color: '0075ca', description: '' },
      sender: { login: opts.actor ?? 'senior-dev', type: 'User', id: 1001 },
      issue: {
        number: opts.issueNumber ?? 123,
        title: 'Login page returns 500 after password reset',
        body: 'When I try to log in after resetting my password...',
        user: { login: 'end-user', type: 'User', id: 2001 },
        created_at: '2026-03-20T10:00:00Z',
        updated_at: '2026-03-20T14:30:00Z',
        labels: (opts.currentLabels ?? ['bug']).map((name, i) => ({
          id: 200 + i,
          name,
          color: 'ededed',
        })),
        state: 'open',
      },
      repository: {
        id: 9999,
        full_name: 'myorg/myrepo',
        default_branch: 'main',
        private: false,
      },
    },
    repo: { owner: 'myorg', repo: 'myrepo' },
  };
}

function issueCommentPayload(opts: {
  issueNumber?: number;
  commenter?: string;
  commenterType?: string;
  commentBody?: string;
}) {
  return {
    payload: {
      action: 'created' as const,
      issue: { number: opts.issueNumber ?? 123 },
      comment: {
        id: 7001,
        user: {
          login: opts.commenter ?? 'senior-dev',
          type: opts.commenterType ?? 'User',
          id: 1001,
        },
        body:
          opts.commentBody ??
          'This is clearly a bug — the error trace points to the auth module, not a feature request.',
        created_at: '2026-03-20T15:00:00Z',
        updated_at: '2026-03-20T15:00:00Z',
      },
      repository: {
        id: 9999,
        full_name: 'myorg/myrepo',
        default_branch: 'main',
        private: false,
      },
    },
    repo: { owner: 'myorg', repo: 'myrepo' },
  };
}

// ---------------------------------------------------------------------------
// Recording GitHub client — captures every API call in order
// ---------------------------------------------------------------------------

interface ApiCall {
  method: string;
  params: any;
}

interface RecordingState {
  actorPermission?: string;
  branchExists?: boolean;
  correctionFileOnBranch?: Correction | null;
  correctionFileSha?: string;
  openPRNumber?: number | null;
  timelineEvents?: any[];
  issueComments?: any[];
  defaultBranchSha?: string;
}

function createRecordingClient(state: RecordingState = {}) {
  const calls: ApiCall[] = [];

  const permission = state.actorPermission ?? 'write';
  const branchExists = state.branchExists ?? false;
  const openPR = state.openPRNumber ?? null;
  const defaultSha = state.defaultBranchSha ?? 'a1b2c3d4e5f6';
  const correctionFile = state.correctionFileOnBranch ?? null;
  const fileSha = state.correctionFileSha ?? 'file-sha-001';

  function record(method: string, handler: (params: any) => any) {
    const fn = vi.fn().mockImplementation((params: any) => {
      calls.push({ method, params });
      return handler(params);
    });
    return fn;
  }

  const listEventsForTimeline = vi.fn();
  const listComments = vi.fn();

  const github = {
    rest: {
      repos: {
        getCollaboratorPermissionLevel: record(
          'repos.getCollaboratorPermissionLevel',
          () => ({ data: { permission } })
        ),
        getBranch: record('repos.getBranch', () => {
          if (!branchExists) {
            const err: any = new Error('Not Found');
            err.status = 404;
            throw err;
          }
          return { data: { name: 'triage-corrections' } };
        }),
        getContent: record('repos.getContent', (params: any) => {
          if (correctionFile && params.ref === 'triage-corrections') {
            const encoded = Buffer.from(
              JSON.stringify(correctionFile, null, 2) + '\n'
            ).toString('base64');
            return { data: { content: encoded, sha: fileSha } };
          }
          const err: any = new Error('Not Found');
          err.status = 404;
          throw err;
        }),
        createOrUpdateFileContents: record(
          'repos.createOrUpdateFileContents',
          () => ({ data: {} })
        ),
      },
      git: {
        getRef: record('git.getRef', () => ({
          data: { object: { sha: defaultSha } },
        })),
        createRef: record('git.createRef', () => ({ data: {} })),
        updateRef: record('git.updateRef', () => ({ data: {} })),
      },
      issues: {
        listEventsForTimeline,
        listComments,
      },
      pulls: {
        list: record('pulls.list', () => ({
          data: openPR != null ? [{ number: openPR }] : [],
        })),
        create: record('pulls.create', () => ({ data: { number: 42 } })),
      },
    },
    paginate: vi.fn().mockImplementation((method: any, params: any) => {
      calls.push({
        method:
          method === listEventsForTimeline
            ? 'paginate(issues.listEventsForTimeline)'
            : method === listComments
              ? 'paginate(issues.listComments)'
              : 'paginate(unknown)',
        params,
      });
      if (method === listEventsForTimeline) {
        return Promise.resolve(state.timelineEvents ?? []);
      }
      if (method === listComments) {
        return Promise.resolve(state.issueComments ?? []);
      }
      return Promise.resolve([]);
    }),
  };

  const core = {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    setFailed: vi.fn(),
    setOutput: vi.fn(),
  };

  return { github, core, calls };
}

// Helper: decode a base64-encoded correction from an API call
function decodeWrittenCorrection(calls: ApiCall[]): Correction {
  const writeCall = calls.find((c) => c.method === 'repos.createOrUpdateFileContents');
  if (!writeCall) throw new Error('No createOrUpdateFileContents call found');
  return JSON.parse(Buffer.from(writeCall.params.content, 'base64').toString('utf8'));
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe('Integration: correction tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T14:35:00Z'));
  });

  describe('Scenario: Human corrects AI classification (fresh branch)', () => {
    // Issue #123 was classified as "enhancement" by the AI.
    // A senior dev removes "enhancement", adds "bug".
    // The corrections branch does not exist yet.

    it('creates branch, writes correction file, and opens PR', async () => {
      const context = issuesLabeledPayload({
        labelName: 'bug',
        currentLabels: ['bug', 'ai-triaged'],
      });

      const { github, core, calls } = createRecordingClient({
        actorPermission: 'write',
        branchExists: false,
        timelineEvents: [
          {
            event: 'unlabeled',
            label: { name: 'enhancement' },
            actor: { login: 'senior-dev' },
            created_at: '2026-03-20T14:34:50Z', // 10 seconds ago
          },
        ],
        issueComments: [
          {
            user: { login: 'senior-dev' },
            body: 'This is clearly a bug — the stack trace shows an auth module crash.',
            created_at: '2026-03-20T14:34:30Z',
          },
          {
            user: { login: 'someone-else' },
            body: 'I can reproduce this too.',
            created_at: '2026-03-20T14:34:40Z',
          },
        ],
      });

      await trackCorrection({ github, context, core });

      // Verify the full call sequence
      const methodSequence = calls.map((c) => c.method);
      expect(methodSequence).toEqual([
        'repos.getCollaboratorPermissionLevel',
        'paginate(issues.listEventsForTimeline)',
        'paginate(issues.listComments)',
        'repos.getBranch',
        'git.getRef',
        'git.createRef',
        'repos.getContent',
        'repos.createOrUpdateFileContents',
        'pulls.list',
        'pulls.create',
      ]);

      // Verify the correction file content
      const written = decodeWrittenCorrection(calls);
      expect(written).toMatchObject({
        issue_number: 123,
        snapshot: {
          title: 'Login page returns 500 after password reset',
          author: 'end-user',
          created_at: '2026-03-20T10:00:00Z',
        },
        agent_label: 'enhancement',
        corrected_label: 'bug',
        corrected_by: 'senior-dev',
        confirmed: false,
      });
      // Only the actor's comment should be included, not "someone-else"
      expect(written.context_comments).toHaveLength(1);
      expect(written.context_comments[0].body).toContain('auth module crash');
      // Snapshot body should contain the full issue body
      expect(written.snapshot.body).toContain('Steps to reproduce');

      // Verify branch was created from main
      const createRefCall = calls.find((c) => c.method === 'git.createRef');
      expect(createRefCall!.params.sha).toBe('a1b2c3d4e5f6');

      // Verify file path follows the naming convention
      const writeCall = calls.find((c) => c.method === 'repos.createOrUpdateFileContents');
      expect(writeCall!.params.path).toBe('evals/corrections/issue-123.json');
      expect(writeCall!.params.branch).toBe('triage-corrections');

      // Verify PR was created against main
      const prCall = calls.find((c) => c.method === 'pulls.create');
      expect(prCall!.params.base).toBe('main');
      expect(prCall!.params.head).toBe('triage-corrections');
    });
  });

  describe('Scenario: Second correction accumulates on existing branch', () => {
    // A different issue (#456) is corrected.
    // The corrections branch and PR already exist from the first correction.

    it('commits to existing branch and reuses open PR', async () => {
      const context = issuesLabeledPayload({
        labelName: 'documentation',
        issueNumber: 456,
        issueTitle: 'How do I configure logging?',
        issueBody: 'I want to set up logging in my app but the docs are unclear.',
        issueAuthor: 'new-contributor',
        currentLabels: ['documentation', 'ai-triaged'],
      });

      const { github, core, calls } = createRecordingClient({
        actorPermission: 'admin',
        branchExists: true,
        openPRNumber: 42,
        timelineEvents: [
          {
            event: 'unlabeled',
            label: { name: 'question' },
            actor: { login: 'senior-dev' },
            created_at: '2026-03-20T14:34:55Z',
          },
        ],
        issueComments: [],
      });

      await trackCorrection({ github, context, core });

      const methodSequence = calls.map((c) => c.method);

      // Should NOT create branch or PR
      expect(methodSequence).not.toContain('git.getRef');
      expect(methodSequence).not.toContain('git.createRef');
      expect(methodSequence).not.toContain('pulls.create');

      // Should still write the file and check for existing PR
      expect(methodSequence).toContain('repos.createOrUpdateFileContents');
      expect(methodSequence).toContain('pulls.list');

      // Verify correction content
      const written = decodeWrittenCorrection(calls);
      expect(written.issue_number).toBe(456);
      expect(written.agent_label).toBe('question');
      expect(written.corrected_label).toBe('documentation');
      expect(written.context_comments).toHaveLength(0);
    });
  });

  describe('Scenario: Human confirms AI classification', () => {
    // Maintainer removes "ai-triaged" without changing the classification label,
    // signaling agreement with the AI's classification.

    it('records a confirmation with matching agent/corrected labels', async () => {
      const context = issuesUnlabeledPayload({
        labelName: 'ai-triaged',
        currentLabels: ['enhancement'], // ai-triaged was just removed, enhancement stays
      });

      const { github, core, calls } = createRecordingClient({
        actorPermission: 'maintain',
        branchExists: false,
      });

      await trackCorrection({ github, context, core });

      // Verify a file was written
      const written = decodeWrittenCorrection(calls);
      expect(written.confirmed).toBe(true);
      expect(written.agent_label).toBe('enhancement');
      expect(written.corrected_label).toBe('enhancement');
      expect(written.context_comments).toEqual([]);

      // Should log confirmation
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Confirmation')
      );
    });
  });

  describe('Scenario: Late justification comment appended', () => {
    // A correction was already recorded. The corrector comes back and adds
    // a comment explaining their reasoning. The system should append it.

    const existingCorrection: Correction = {
      issue_number: 123,
      snapshot: {
        title: 'Login page returns 500 after password reset',
        body: 'When I try to log in...',
        author: 'end-user',
        created_at: '2026-03-20T10:00:00Z',
      },
      agent_label: 'enhancement',
      corrected_label: 'bug',
      corrected_by: 'senior-dev',
      corrected_at: '2026-03-20T14:35:00Z',
      context_comments: [
        {
          author: 'senior-dev',
          body: 'This is a bug, not an enhancement.',
          created_at: '2026-03-20T14:34:30Z',
        },
      ],
      confirmed: false,
    };

    it('appends the new comment and preserves existing ones', async () => {
      const context = issueCommentPayload({
        commenter: 'senior-dev',
        commentBody: 'To clarify — the root cause is a null pointer in PasswordResetHandler.java.',
      });

      const { github, core, calls } = createRecordingClient({
        branchExists: true,
        correctionFileOnBranch: existingCorrection,
        correctionFileSha: 'file-sha-v2',
        openPRNumber: 42,
      });

      await updateContextComments({ github, context, core });

      // Verify file was updated
      const writeCall = calls.find((c) => c.method === 'repos.createOrUpdateFileContents');
      expect(writeCall).toBeDefined();

      const updated: Correction = JSON.parse(
        Buffer.from(writeCall!.params.content, 'base64').toString('utf8')
      );

      // Should have 2 comments now (original + new)
      expect(updated.context_comments).toHaveLength(2);
      expect(updated.context_comments[0].body).toBe('This is a bug, not an enhancement.');
      expect(updated.context_comments[1].body).toContain('PasswordResetHandler.java');

      // Must pass the existing file SHA for the update
      expect(writeCall!.params.sha).toBe('file-sha-v2');
      expect(writeCall!.params.branch).toBe('triage-corrections');

      // Rest of the correction should be unchanged
      expect(updated.agent_label).toBe('enhancement');
      expect(updated.corrected_label).toBe('bug');
      expect(updated.issue_number).toBe(123);
    });

    it('ignores comment from a different user', async () => {
      const context = issueCommentPayload({
        commenter: 'random-person',
        commentBody: 'I agree this is a bug.',
      });

      const { github, core, calls } = createRecordingClient({
        branchExists: true,
        correctionFileOnBranch: existingCorrection,
        correctionFileSha: 'file-sha-v2',
        openPRNumber: 42,
      });

      await updateContextComments({ github, context, core });

      expect(calls.find((c) => c.method === 'repos.createOrUpdateFileContents')).toBeUndefined();
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("doesn't match corrector")
      );
    });
  });

  describe('Scenario: Permission guard blocks read-only users', () => {
    it('stops after permission check with no further API calls', async () => {
      const context = issuesLabeledPayload({
        labelName: 'bug',
        actor: 'random-triager',
        currentLabels: ['bug', 'ai-triaged'],
      });

      const { github, core, calls } = createRecordingClient({
        actorPermission: 'read',
      });

      await trackCorrection({ github, context, core });

      // Only the permission check should have been made — nothing else
      const methodSequence = calls.map((c) => c.method);
      expect(methodSequence).toEqual(['repos.getCollaboratorPermissionLevel']);

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('only write/maintain/admin')
      );
    });
  });

  describe('Scenario: Non-correction label change is ignored', () => {
    it('does nothing when a non-classification label is added', async () => {
      const context = issuesLabeledPayload({
        labelName: 'priority/high',
        currentLabels: ['bug', 'ai-triaged', 'priority/high'],
      });

      const { github, core, calls } = createRecordingClient({
        actorPermission: 'write',
      });

      await trackCorrection({ github, context, core });

      // Permission check happens, then it bails — no branch/file/PR operations
      const methodSequence = calls.map((c) => c.method);
      expect(methodSequence).toEqual(['repos.getCollaboratorPermissionLevel']);
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('does not match correction or confirmation')
      );
    });
  });

  describe('Scenario: Overwrite existing correction for same issue', () => {
    // A correction for issue #123 already exists on the branch.
    // A new correction event fires (e.g., the maintainer changed their mind again).
    // The file should be updated with the new correction, passing the existing SHA.

    it('updates the existing file using its SHA', async () => {
      const existingCorrection: Correction = {
        issue_number: 123,
        snapshot: {
          title: 'Login page returns 500 after password reset',
          body: 'When I try to log in...',
          author: 'end-user',
          created_at: '2026-03-20T10:00:00Z',
        },
        agent_label: 'enhancement',
        corrected_label: 'bug',
        corrected_by: 'senior-dev',
        corrected_at: '2026-03-20T14:35:00Z',
        context_comments: [],
        confirmed: false,
      };

      const context = issuesLabeledPayload({
        labelName: 'question',
        currentLabels: ['question', 'ai-triaged'],
      });

      const { github, core, calls } = createRecordingClient({
        actorPermission: 'write',
        branchExists: true,
        openPRNumber: 42,
        correctionFileOnBranch: existingCorrection,
        correctionFileSha: 'old-file-sha',
        timelineEvents: [
          {
            event: 'unlabeled',
            label: { name: 'bug' },
            actor: { login: 'senior-dev' },
            created_at: '2026-03-20T14:34:58Z',
          },
        ],
        issueComments: [],
      });

      await trackCorrection({ github, context, core });

      const writeCall = calls.find((c) => c.method === 'repos.createOrUpdateFileContents');
      expect(writeCall!.params.sha).toBe('old-file-sha');

      const written = decodeWrittenCorrection(calls);
      expect(written.agent_label).toBe('bug');
      expect(written.corrected_label).toBe('question');
    });
  });
});
