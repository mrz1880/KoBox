// How a contact with a member's machine treats the identity (host key) the
// machine presents.
//
// - keep-recorded: a machine never contacted has its identity recorded; one
//   whose identity is recorded must present that same one, or nothing is
//   done. Every transfer contacts the machine this way, and so does the check
//   KoBox runs on its own after the member saves their destination.
// - accept-presented: the member, testing the connection, accepts whatever
//   identity the machine presents now and it replaces the recorded one. It is
//   how a reinstalled machine is trusted again, and only the member's own
//   "test it now" asks for it: a changed identity is never accepted silently.
export const HOST_KEY_TRUSTS = ['keep-recorded', 'accept-presented'] as const;

export type HostKeyTrust = (typeof HOST_KEY_TRUSTS)[number];
