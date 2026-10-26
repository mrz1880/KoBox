import type { PortalCredentials } from './ports.js';

// The fields a login can lose. With exactOptionalPropertyTypes an absent field
// and an undefined one differ, and "none" is the absent one.
export type RemovableCredential = 'appTokenHash' | 'twoStep' | 'twoStepPending';

// Every other field kept as it is. Rebuilding a login field by field dropped
// whatever the list forgot: two-step sign-in vanished with the app token.
export function withoutCredential(
  credentials: PortalCredentials,
  ...fields: readonly RemovableCredential[]
): PortalCredentials {
  const kept = Object.entries(credentials).filter(
    ([key]) => !fields.some((field) => field === key),
  );
  // the entries are the login's own minus optional fields only, so the result
  // is still a PortalCredentials; the compiler cannot follow fromEntries
  return Object.fromEntries(kept) as unknown as PortalCredentials;
}
