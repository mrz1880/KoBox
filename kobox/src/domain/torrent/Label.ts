import { DomainError } from '../shared/DomainError.js';

export class InvalidLabelError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid label ${JSON.stringify(raw)}: ${reason}`);
  }
}

export const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// A label (rtorrent custom1) becomes a directory segment under the user's
// home and an execFile argv value: the charset makes it path- and shell-safe
// by construction (no leading dot, no slash, no metacharacters).
//
// Case is PRESERVED, not folded. A live MySB box carries Films, Series, Divers;
// the label also names the folder the member's files land in on their own NAS,
// so lower-casing on import would create a second set of folders beside the
// ones already full of their files. Accents and spaces stay out — MySB stripped
// those too, so nothing real depends on them.
export class Label {
  private constructor(readonly value: string) {}

  static parse(raw: string): Label {
    if (!LABEL_PATTERN.test(raw)) {
      throw new InvalidLabelError(raw, 'must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}');
    }
    return new Label(raw);
  }

  equals(other: Label): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
