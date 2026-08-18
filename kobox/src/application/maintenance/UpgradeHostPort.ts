// Host-side steps of an upgrade, each with propagated exit codes (§5.6: the
// legacy screen+busy-wait dispatch inspected the wrong $?).
export interface UpgradeHostPort {
  // pnpm install --frozen-lockfile && pnpm build inside the staged tree
  buildRelease(path: string): Promise<void>;
  // run the STAGED build's migrator against the live DB (additive-only rule)
  migrateWith(path: string): Promise<void>;
  currentTarget(link: string): Promise<string | undefined>;
  // atomic flip: temp symlink + rename(2) over the link
  switchCurrent(link: string, target: string): Promise<void>;
  // systemctl restart kobox-worker, then bounded is-active verification
  restartWorkerAndVerify(): Promise<boolean>;
  // The portal runs from the same symlink. Restarting only the worker left it
  // serving the previous release, which on a live box looked like a folder the
  // portal accepted and the worker then refused. Not a health gate: the worker
  // is what decides whether to roll back, the portal simply has to follow.
  restartPortal(): Promise<void>;
}
