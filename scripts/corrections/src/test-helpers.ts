import { vi } from 'vitest';

/**
 * Creates a mock Core object matching the @actions/core interface.
 */
export function mockCore() {
  return {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    setFailed: vi.fn(),
    setOutput: vi.fn(),
  };
}

/**
 * Creates a mock GitHub (Octokit) instance with chainable REST methods.
 */
export function mockGitHub(overrides: Record<string, any> = {}) {
  return {
    rest: {
      repos: {
        getBranch: vi.fn().mockResolvedValue({}),
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
        getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({
          data: { permission: 'admin' },
        }),
        createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
      },
      git: {
        getRef: vi.fn().mockResolvedValue({
          data: { object: { sha: 'abc123' } },
        }),
        createRef: vi.fn().mockResolvedValue({}),
        updateRef: vi.fn().mockResolvedValue({}),
      },
      issues: {
        listEventsForTimeline: vi.fn(),
        listComments: vi.fn().mockResolvedValue({ data: [] }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ data: { number: 99 } }),
      },
      ...overrides,
    },
    paginate: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Creates a mock Context for issues.labeled / issues.unlabeled events.
 */
export function mockLabelContext(opts: {
  action: 'labeled' | 'unlabeled';
  labelName: string;
  issueNumber?: number;
  currentLabels?: string[];
  actor?: string;
  actorType?: string;
}) {
  return {
    payload: {
      action: opts.action,
      label: { name: opts.labelName },
      sender: {
        login: opts.actor ?? 'maintainer',
        type: opts.actorType ?? 'User',
      },
      issue: {
        number: opts.issueNumber ?? 42,
        title: 'Test issue',
        body: 'Test body',
        user: { login: 'author' },
        created_at: '2026-01-01T00:00:00Z',
        labels: (opts.currentLabels ?? []).map((name) => ({ name })),
      },
      repository: { default_branch: 'main' },
    },
    repo: { owner: 'github', repo: 'copilot-sdk' },
  };
}

/**
 * Creates a mock Context for issue_comment.created events.
 */
export function mockCommentContext(opts: {
  issueNumber?: number;
  commenter?: string;
  commenterType?: string;
  commentBody?: string;
}) {
  return {
    payload: {
      action: 'created',
      issue: { number: opts.issueNumber ?? 42 },
      comment: {
        user: {
          login: opts.commenter ?? 'maintainer',
          type: opts.commenterType ?? 'User',
        },
        body: opts.commentBody ?? 'This should be classified as a bug because...',
        created_at: '2026-01-02T00:00:00Z',
      },
      repository: { default_branch: 'main' },
    },
    repo: { owner: 'github', repo: 'copilot-sdk' },
  };
}
