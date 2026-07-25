// Read-and-stage git operations for upgrades. The contract that kills the
// legacy GitHubRepoUpdate (§5.6): NOTHING here ever mutates the tree that is
// running — releases are staged as separate worktrees at pinned refs.
export interface GitPort {
  fetch(repoDir: string): Promise<void>;
  refExists(repoDir: string, ref: string): Promise<boolean>;
  resolveRef(repoDir: string, ref: string): Promise<string>;
  worktreeAdd(repoDir: string, path: string, ref: string): Promise<void>;
  worktreeRemove(repoDir: string, path: string): Promise<void>;
  currentRef(repoDir: string): Promise<string>;
}
