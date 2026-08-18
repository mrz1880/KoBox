// What /etc/kobox/worker.env should hold after an install.
//
// It used to be the current shell's KOBOX_* and nothing else, which made
// re-running `kobox install` destructive: an operator running it from a plain
// terminal wiped every setting the box had been configured with. That is the
// opposite of what a convergent installer promises, and it cost a live box its
// aria2 RPC secret, leaving every debrid download failing with "Unauthorized"
// while aria2 itself was running perfectly.
//
// So the shell wins on what it actually says, and stays silent about the rest.
// Removing a setting becomes an explicit edit of a root-only file rather than a
// side effect of forgetting to export it.
export function mergeKoboxEnv(
  existing: ReadonlyMap<string, string> | undefined,
  fromShell: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  return new Map([...(existing ?? new Map<string, string>()), ...fromShell]);
}

// Parses the file we wrote last time. Anything unparseable is ignored rather
// than guessed at: a malformed line must not become a key with a wrong value.
export function parseEnvFile(content: string | undefined): ReadonlyMap<string, string> {
  const parsed = new Map<string, string>();
  for (const line of (content ?? '').split('\n')) {
    const match = /^(KOBOX_[A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      parsed.set(match[1], match[2]);
    }
  }
  return parsed;
}

// Makes a root CLI invocation see the same configuration the worker unit does.
// systemd hands worker.env to the worker; a person typing `kobox doctor` gets
// only their own shell, so without this the CLI would report aria2 unreachable
// on a perfectly healthy box purely because it never read the secret.
//
// Existing variables win: an operator overriding one on the command line means
// it, and this must not undo that.
export function loadWorkerEnvInto(
  env: Record<string, string | undefined>,
  fileContent: string | undefined,
): void {
  for (const [key, value] of parseEnvFile(fileContent)) {
    env[key] ??= value;
  }
}
