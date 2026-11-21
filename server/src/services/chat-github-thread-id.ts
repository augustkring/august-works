export type GitHubReviewThreadIdentity = {
  repository: string;
  issue: boolean;
  number: string;
  reviewCommentId: string | null;
};

export function parseGitHubReviewThreadIdentity(value: string): GitHubReviewThreadIdentity | null {
  const match = /^github:([^:]+):(?:(issue):)?([1-9][0-9]*)(?::rc:([1-9][0-9]*))?$/.exec(value);
  if (!match) return null;
  return {
    repository: match[1]!,
    issue: Boolean(match[2]),
    number: match[3]!,
    reviewCommentId: match[4] ?? null,
  };
}
