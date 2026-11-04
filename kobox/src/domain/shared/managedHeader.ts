// The first line of every file KoBox renders onto a box. Its wording lives
// here only: each renderer picks the comment syntax of its file format and,
// when useful, names what the file is.

/** The word that marks a file as KoBox's own, whatever version rendered it. */
export const MANAGED_MARK = 'KoBox-managed';

/** The comment syntaxes of the file formats KoBox renders. */
export type CommentPrefix = '#' | '//' | ';' | ';;';

/**
 * Builds the header line telling a reader that KoBox owns the file.
 *
 * @param prefix the comment syntax of the file format
 * @param subject what the file is ("firewall", "file for alice"), shown after the mark
 * @returns the header line, without its line break
 */
export function managedHeader(prefix: CommentPrefix, subject?: string): string {
  const owner = subject === undefined ? MANAGED_MARK : `${MANAGED_MARK} ${subject}`;
  return `${prefix} ${owner}, DO NOT EDIT (rendered declaratively).`;
}
