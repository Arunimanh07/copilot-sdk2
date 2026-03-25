export interface Correction {
  issue_number: number;
  snapshot: {
    title: string;
    body: string;
    author: string;
    created_at: string;
  };
  agent_label: string;
  corrected_label: string;
  corrected_by: string;
  corrected_at: string;
  context_comments: ContextComment[];
  confirmed: boolean;
}

export interface ContextComment {
  author: string;
  body: string;
  created_at: string;
}

export const CLASSIFICATION_LABELS = ['bug', 'enhancement', 'question', 'documentation', 'other'];
export const REVIEW_LABEL = 'ai-triaged';
export const CORRECTIONS_BRANCH = 'triage-corrections';
