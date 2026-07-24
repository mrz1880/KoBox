// A fully rendered managed file: content is the whole desired state. Applying
// it is idempotent — adapters write only when the on-disk content differs and
// never touch paths outside this list (no more destructive regeneration).
export interface RenderedFile {
  readonly path: string;
  readonly content: string;
  readonly mode: string; // octal, e.g. '0640'
  readonly owner: string;
  readonly group: string;
}

export interface ManagedFilesPort {
  // Returns the paths whose content actually changed.
  apply(files: readonly RenderedFile[]): Promise<readonly string[]>;
}
