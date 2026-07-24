# Phase 3 — Security & Network + Fair-use Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or execute in-session) with
> superpowers:test-driven-development for every task. One commit per task.

**Goal:** Implement the Security & Network bounded context plus fair-use observability layers 2-3
(AUDIT §1.5 + §3.7): declarative default-deny firewall (per-user chains, `iptables-restore`, end of
the destructive clean/create/refresh cycle §5.2), declarative fail2ban with the missing
"publickey flood" jail (the proven user-h vector: 1979 valid-key connections/day that no prod jail
catches), DynDNS restrict-IP (replaces `DynamicAddressResolver`), real ownership of
bind9/dnscrypt/pgl service reloads, OpenVPN multi-config without `comp-lzo`, per-user usage
metering (iptables `-m owner` counters, journald SSH auth rate), the `FairUseEvaluator` graduated
response (alert → auto-throttle via tc/HTB → **manual** suspension), and a real multi-channel
`NotificationPort` (ntfy + email + Discord). **This is the slice that neutralizes the user-h case
end-to-end.**

**Architecture:** New hexagonal context `kobox/src/domain/security/` (VOs + `FirewallPolicy`
aggregate + pure rendering + `FairUseEvaluator` domain service) / `application/security/` (use
cases) / infrastructure adapters (guarded iptables-restore apply with rollback, journald reader,
tc/HTB shaper, notification channels). Reuses Phase 0-2 foundations: `RenderedFile`/
`ManagedFilesPort` (write-if-changed), worker root + typed jobs + `ChainHints`, `CommandRunner`
argv-only with `timeoutMs`, `HealthProbePort` for the anti-lockout connectivity check. Network
policy is **decoupled from the job bus** (issue #120): OUTPUT stays ACCEPT (metered, never
blocked); pgl chains are declared seams repopulated by `pglcmd` reload after each restore.

**Tech Stack:** TypeScript strict, Drizzle/SQLite (WAL), Zod, vitest + fast-check, golden files,
Debian 12 systemd container (real iptables/fail2ban/journald/tc) for integration/E2E. No new
runtime dependencies (ntfy/Discord via `fetch`, email via `sendmail` execFile through Postfix).

**Locked decisions honored:** no `any`, `readonly`, optional chaining; execFile argv-only; VOs at
every boundary; rendering declarative + idempotent + golden-tested (`iptables-restore` of a
rendered file, never incremental `-A`); graduated response FROZEN (alert → auto-throttle via
`ShapingPort` → suspension stays MANUAL via existing `SuspendUser`), every action reversible and
audited; alert channels FROZEN (ntfy + email + Discord); neutral fixtures only
(user-a..h/alice/bob, 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, dyn.example.org); tests
never touch the real network; firewall rules never applied outside container/VM.

**Out of scope (deferred):** Installation/Provisioning incl. VPN PKI bootstrap (Phase 4),
Maintenance & Ops incl. cron wiring (Phase 5), portal (Phase 6). RKHunter/Lynis/Portsentry =
vendored config, no KoBox logic.

**Phase 2 debt settled here:** chain `render-blocklist-filters {username}` after
`provision-rtorrent`; prove rtorrent filter parse via journal ("IPv4 filter list size") in E2E.

**Branch:** `feature/phase3-security-network` from `main`.

---

## Task 1 — Security domain VOs

**Files:**
- Create: `kobox/src/domain/security/Cidr.ts`, `DynDnsHost.ts`, `JailName.ts`, `Bandwidth.ts`,
  `Threshold.ts`, `Rates.ts` (EgressRate + ConnectionRate), `FairUsePolicy.ts` (FairUsePolicy +
  ResourceBudget)
- Test: `kobox/test/unit/domain/security/*.test.ts`

**Specs:**
- `Cidr.parse(raw)`: strict IPv4 CIDR `a.b.c.d/n`, octets via `IPV4_PATTERN`, prefix 0-32,
  **canonical only** (host bits must be zero — `192.0.2.1/24` throws, parse-don't-validate).
  Accessors: `value`, `contains(ip: IpAddress): boolean`, `equals`. `Cidr.host(ip)` = /32 helper.
  **fast-check:** (1) round-trip `parse(parse(x).value)`; (2) `contains` is true for the network
  address and false for any IP outside the mask; (3) junk with chars outside `[0-9./]` throws.
- `DynDnsHost.parse(raw)`: FQDN, lowercase-normalized, ≤253 chars, ≥2 labels, label charset
  `[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?`, **rejects IPv4 literals** (contrast with `TrackerHost`:
  a dyndns entry that is an IP makes no sense). Shell-safe by construction. **fast-check:**
  parsed values never start with `-`, never contain metacharacters; idempotent round-trip.
- `JailName.parse(raw)`: `/^[a-z][a-z0-9-]{0,31}$/`.
- `Bandwidth`: `Bandwidth.bitsPerSecond(n)` (positive int), `Bandwidth.mbit(n)`, accessors
  `bps`, `toTcRate()` → `"NNNkbit"` (integer kbit, tc-safe), `isExceededBy(rate: EgressRate)`.
- `Rates.ts`: `EgressRate.fromDelta(bytes, seconds)` (→ `bitsPerSecond`), guards seconds > 0;
  `ConnectionRate.perHour(count, windowMinutes)` → normalized count/hour.
- `Threshold.of(limit)`: `isExceededBy(observed)` strict `>`.
- `FairUsePolicy`: named default policy — `sustainedEgress: Bandwidth`,
  `maxAuthPerHour: number`, `throttleTo: Bandwidth`; `budgetFor(overrides?)` → `ResourceBudget`
  (per-user effective budget, same three fields, overrides win field-by-field).
  Defaults come from the caller (composition), not hardcoded here.

**TDD steps:** per VO: failing unit test (BDD names, fast-check for `Cidr`/`DynDnsHost`) →
`pnpm test:unit` fail → implement (`private constructor` + `static parse`, matching
`IpAddress`/`TrackerHost` style, errors extend `DomainError`) → pass.

**Commit:** `feat(security): domain value objects (Cidr, DynDnsHost, fair-use budgets)`

## Task 2 — `FirewallPolicy` aggregate + pure iptables rendering (golden)

**Files:**
- Create: `kobox/src/domain/security/FirewallPolicy.ts`, `kobox/src/domain/security/rendering.ts`
- Test: `kobox/test/unit/domain/security/FirewallPolicy.test.ts`, `rendering.test.ts`
- Golden: `kobox/test/golden/security/firewall.rules.golden`

**Specs:**
- `FirewallUser`: `{ username: Username, uid: number, rtorrentPort: number,
  addresses: readonly IpAddress[] }`.
- `FirewallPolicy.create({ sshPort, portalPort, vpn: {tunGwPort, tunPort, tapPort, subnets},
  users })` — **anti-lockout by construction**: the aggregate always emits loopback ACCEPT,
  established/related ACCEPT and SSH ACCEPT; there is no API to omit them (unit-test: rendered
  output always contains those three rules regardless of input).
- `renderFirewallRules(policy): RenderedFile` → `/etc/kobox/firewall.rules`, mode 0600 root:root.
  One deterministic `iptables-restore` document:
  - `*filter` — `:INPUT DROP`, `:FORWARD DROP`, `:OUTPUT ACCEPT` (**issue #120: outbound is
    metered, never blocked**). Declared chains: `pgl_in` (empty seam, jump first in INPUT —
    `pglcmd` repopulates after reload), `kobox-meter-in`, `kobox-meter-out`, one `kobox-u-<user>`
    per user.
  - INPUT order: lo / established / pgl_in jump / SSH / portal / 80+443 / VPN udp ports /
    per-user `-p tcp --dport <rtorrentPort> -j kobox-u-<user>`.
  - `kobox-u-<user>`: `-j kobox-meter-in` accounting then ACCEPT (rtorrent peers are public;
    the per-user chain is the seam where restrict-IP rules for private services land).
  - `kobox-meter-in`: per user `-p tcp --dport <rtorrentPort> -m comment --comment
    "kobox:ingress:<user>" -j RETURN`.
  - OUTPUT jumps `kobox-meter-out` first; that chain holds per-uid
    `-m owner --uid-owner <uid> -m comment --comment "kobox:egress:<user>" -j RETURN`.
  - FORWARD: tun/tap subnets out + established back (VPN with-GW routing).
  - `*nat` — POSTROUTING MASQUERADE for the with-GW subnet only. mangle is **not** rendered
    (it belongs to the shaper, Task 11 — restore must not wipe live throttles).
  - Users sorted by name; everything deterministic. Golden fixture: alice(1001)/bob(1002),
    addresses in 192.0.2.0/24, ssh 22, portal 8189, vpn 8193-8195, subnets 10.0.{0,1,2}.0/24.

**TDD steps:** failing golden + invariant tests (`UPDATE_GOLDEN=1` regen pattern from Phase 1/2)
→ implement pure render → pass.

**Commit:** `feat(security): FirewallPolicy aggregate with declarative iptables rendering`

## Task 3 — Fail2ban declarative rendering (golden) — the "publickey flood" jail

**Files:**
- Create: rendering additions in `kobox/src/domain/security/rendering.ts`
- Test: `kobox/test/unit/domain/security/rendering.test.ts` (extend)
- Golden: `kobox/test/golden/security/jail.kobox.local.golden`,
  `kobox/test/golden/security/filter.kobox-publickey-flood.conf.golden`

**Specs:**
- `renderFail2banJails(ignoreIps: readonly IpAddress[], sshPort): RenderedFile` →
  `/etc/fail2ban/jail.d/kobox.local` (0644 root:root): `[DEFAULT]` with
  `backend = systemd`, `ignoreip = 127.0.0.1/8 ::1` + sorted user addresses; `[sshd]` enabled
  (port = sshPort); `[nginx-http-auth]` enabled; `[kobox-publickey-flood]` enabled —
  `filter = kobox-publickey-flood`, `port = <sshPort>`, `maxretry = 30`, `findtime = 3600`,
  `bantime = 3600` (the user-h vector ≈ 82 accepted keys/hour; 30/h is well above any human).
- `renderPublickeyFloodFilter(): RenderedFile` → `/etc/fail2ban/filter.d/kobox-publickey-flood.conf`:
  `[Definition]` with `journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd`,
  `failregex = ^.*Accepted publickey for \S+ from <HOST> port \d+.*$` — **fail2ban counting
  *accepted* logins is the whole point: valid-key floods are invisible to every stock jail.**

**Commit:** `feat(security): declarative fail2ban jails with publickey-flood filter`

## Task 4 — OpenVPN declarative rendering (golden), no comp-lzo

**Files:**
- Create: rendering additions in `kobox/src/domain/security/rendering.ts` (or `vpn.ts` if >150
  lines)
- Test: `kobox/test/unit/domain/security/vpn-rendering.test.ts`
- Golden: `kobox/test/golden/security/openvpn-tun-gw.conf.golden`, `openvpn-tun.conf.golden`,
  `openvpn-tap.conf.golden`, `openvpn-client.ovpn.golden`

**Specs:**
- `VPN_VARIANTS`: `tun-gw` (port 8193, dev tun, subnet 10.0.0.0/24, push redirect-gateway +
  block-outside-dns + DNS 10.0.0.1), `tun` (8194, 10.0.1.0/24, no redirect), `tap` (8195,
  10.0.2.0/24, no redirect).
- `renderOpenVpnServer(variant, pkiPaths): RenderedFile` → `/etc/openvpn/server/kobox-<variant>.conf`
  (0600): `proto udp4`, `topology subnet`, `data-ciphers AES-256-GCM:AES-128-GCM`,
  `auth SHA256`, `keepalive 10 120`, `user nobody` / `group nogroup`, `persist-key/tun`,
  **no `comp-lzo`, no `compress`** (VORACLE — assert its absence in the unit test).
- `renderOpenVpnClientProfile(username, variant, remote: DynDnsHost, material): RenderedFile` →
  `/etc/kobox/vpn-profiles/<user>/kobox-<variant>.ovpn` (0640 root:<user>) with inline
  `<ca>/<cert>/<key>` blocks from `material` (a `VpnClientMaterial` value: three PEM strings).
  PKI *generation* is Phase 4; Phase 3 renders from existing material.

**Commit:** `feat(security): declarative OpenVPN server configs and client profiles (no comp-lzo)`

## Task 5 — Security ports, events, schema migration, repositories, fakes

**Files:**
- Create: `kobox/src/domain/security/ports.ts`, `kobox/src/domain/security/events.ts`
- Modify: `kobox/src/infrastructure/persistence/schema.ts`, `db.ts` (migration),
  `kobox/src/domain/tracker/ports.ts` (`UserAddress` gains optional hostname provenance)
- Create: `kobox/src/infrastructure/persistence/SqliteFairUseRepository.ts`,
  `InMemoryFairUseRepository.ts`; extend `SqliteUserAddressRepository` + `InMemoryUserAddressRepository`
- Create: fakes `FakeFirewallApply.ts`, `FakeShaping.ts`, `FakeUsageMeter.ts`,
  `FakeSshAuthLog.ts`, `FakeUserIdentity.ts`, `FakeNetworkServices.ts`, `FakeVpnPki.ts` under
  `kobox/src/infrastructure/system/fakes/`
- Test: `kobox/test/integration/persistence/sqlite.test.ts` (extend),
  `kobox/test/unit/infrastructure/security-fakes.test.ts`

**Specs:**
- Schema:
  - `user_addresses`: add `checkBy` enum `'ipv4'|'hostname'` (default `'ipv4'`), `hostname`
    text nullable, make `ipv4` nullable (hostname rows before first resolution), add
    `unique(username, hostname)`.
  - `fair_use_state`: `username` unique, `level` enum `'none'|'alerted'|'throttled'`,
    `healthState` enum `'healthy'|'unhealthy'` default healthy, `updatedAt`.
  - `fair_use_events`: id, username, eventType, detailJson, createdAt — **the audit trail**
    (append-only).
  - `fair_use_policies`: username unique, `egressLimitBps` / `authRatePerHour` /
    `throttleToBps` all nullable (override-only; defaults live in composition).
  - `usage_samples`: username unique, egressBytes, ingressBytes, sampledAt (delta basis).
  - `pnpm drizzle-kit generate` for the migration.
- `events.ts`: `FairUseBreached {username, metric: 'egress', observedBps, limitBps}`,
  `AbnormalAuthRate {username, perHour, limitPerHour}`, `ServiceUnhealthy {username, detail}`,
  `UserThrottled {username, rateBps}`, `FairUseRecovered {username}`,
  `DynDnsAddressChanged {host, username, oldIp?, newIp}`, `FirewallApplied {changed}`.
  `SecurityEvent` union + `SecurityNotificationPort { notify(event): Promise<void> }`.
- `ports.ts`:
  - `FirewallApplyPort { apply(rules: RenderedFile): Promise<'applied'|'unchanged'|'rolled-back'> }`
  - `ShapingPort { throttle(username, uid, rate: Bandwidth): Promise<void>;
    unthrottle(username, uid): Promise<void>; isThrottled(uid): Promise<boolean> }`
  - `UsageMeterPort { readCounters(): Promise<readonly UsageCounter[]> }` with
    `UsageCounter {username, egressBytes, ingressBytes}` (cumulative since last firewall apply)
  - `SshAuthLogPort { countAcceptedPublickey(username, windowMinutes): Promise<number> }`
  - `UserIdentityPort { uidOf(username): Promise<number | undefined> }`
  - `DynDnsResolverPort { resolve(host: DynDnsHost): Promise<IpAddress | undefined> }`
  - `NetworkServicePort { reloadFirewallDependents(): Promise<void>; reloadFail2ban(): Promise<void>;
    reloadDns(): Promise<void>; reloadPeerGuardian(): Promise<void> }` — real management with
    escalated errors (a failed reload FAILS the job now; Phase 2's best-effort semantics stay
    only in the legacy tracker adapter until Task 7 swaps it).
  - `FairUseStateRepository` (get/save state, appendEvent, listEvents(username)),
    `FairUsePolicyRepository` (overridesFor(username)), `UsageSampleRepository` (get/put).
  - `VpnPkiPort { clientMaterial(username): Promise<VpnClientMaterial | undefined>;
    serverPaths(): VpnServerPaths }`.
- Fakes mirror Phase 0-2 style (in-memory, recording).

**Commit:** `feat(security): ports, events, fair-use schema and repositories`

## Task 6 — Guarded firewall apply (use case + adapter + job + chaining)

**Files:**
- Create: `kobox/src/application/security/ApplyFirewall.ts`,
  `kobox/src/infrastructure/system/IptablesRestoreAdapter.ts`
- Modify: `kobox/src/application/jobs/contract.ts` (`apply-firewall` {}),
  `kobox/src/interfaces/worker/JobWorker.ts` (execute + `firewallDirty` ChainHint; chain after
  `provision-rtorrent`/`deprovision-rtorrent`), `useCases.ts`, `composition.ts`,
  `cli/main.ts` + `buildJob.ts` (`apply-firewall` command)
- Test: `kobox/test/component/application/security/firewall.test.ts`,
  `kobox/test/component/interfaces/worker-loop.test.ts` (extend),
  `kobox/test/contract/jobContract.test.ts` (snapshot grows)

**Specs:**
- `ApplyFirewall.execute()`: load users (repo) + instances (rtorrent ports) + uids
  (`UserIdentityPort`, skip account-less users with a warning path tested) + addresses
  (resolved only) → build `FirewallPolicy` (ssh/portal/vpn ports from injected
  `SecuritySettings`) → `renderFirewallRules` → `FirewallApplyPort.apply` → on `applied`:
  `NetworkServicePort.reloadPeerGuardian()` (pgl repopulates its seam chains) + notify
  `FirewallApplied`; on `rolled-back`: throw (job fails loudly — silent lockout-avoidance is
  itself an alert).
- `IptablesRestoreAdapter` (**the anti-lockout guard**): (1) snapshot `iptables-save`;
  (2) write rendered file via `ManagedFilesPort` — if content unchanged, return `'unchanged'`
  (idempotence, no restore); (3) `iptables-restore <file>` via stdin (argv-only,
  `timeoutMs 10_000`); (4) probe: `HealthProbePort.checkSocket('127.0.0.1', sshPort)` — sshd
  must still accept connections; (5) on probe failure `iptables-restore` the snapshot and
  return `'rolled-back'`. Component-test the sequencing with fakes (probe-fail ⇒ snapshot
  restored exactly once).
- Worker: `create-user` chain already provisions; extend `provision-rtorrent` completion to
  chain `apply-firewall` (ports now allocated) and `deprovision-rtorrent` likewise.

**Commit:** `feat(security): guarded iptables-restore apply with rollback and worker chaining`

## Task 7 — Fail2ban render use case + real network service management

**Files:**
- Create: `kobox/src/application/security/RenderFail2ban.ts`,
  `kobox/src/infrastructure/system/NetworkServiceAdapter.ts`
- Modify: `contract.ts` (`render-fail2ban` {}), `JobWorker.ts` (+ `fail2banDirty` hint),
  `useCases.ts`, `composition.ts` (tracker context now receives the **real**
  `NetworkServiceAdapter` for `reloadDns`/`reloadPeerGuardian` — the Phase 2 best-effort
  adapter is deleted), `cli/main.ts`/`buildJob.ts`
- Delete: `kobox/src/infrastructure/system/NetworkServiceReloadAdapter.ts` (superseded)
- Test: `kobox/test/component/application/security/fail2ban.test.ts`, adapter unit test with
  recording runner

**Specs:**
- `RenderFail2ban.execute()`: addresses (resolved) → `renderFail2banJails` + filter →
  `ManagedFilesPort.apply` → if changed: `NetworkServicePort.reloadFail2ban()`.
- `NetworkServiceAdapter implements NetworkServicePort` (+ tracker's
  `NetworkServiceReloadPort`): `systemctl reload-or-restart fail2ban`, `rndc reload`,
  `systemctl try-restart dnscrypt-proxy`, `pglcmd reload` — each argv-only with `timeoutMs`;
  exit≠0 **throws** (`CommandFailedError`), except when the unit is not installed
  (`systemctl list-unit-files` gate, warn+skip — dev containers lack bind9): the "service
  absent" tolerance is explicit and logged, no blanket catch.

**Commit:** `feat(security): fail2ban rendering and real network service management`

## Task 8 — DynDNS restrict-IP (hostname addresses + periodic resolution)

**Files:**
- Create: `kobox/src/application/security/ResolveDynDns.ts`,
  `kobox/src/infrastructure/system/DynDnsLookupAdapter.ts`
- Modify: `kobox/src/application/tracker/ManageUserAddress.ts` (accept hostname flavor) or new
  `application/security/ManageUserHostname.ts` (prefer this — security owns DynDNS),
  `contract.ts` (`add-user-hostname`/`remove-user-hostname` {username, hostname},
  `resolve-dyndns` {}), `JobWorker.ts` (hints: whitelist+firewall+fail2ban dirty on change),
  `cli/main.ts`/`buildJob.ts`
- Test: `kobox/test/component/application/security/dyndns.test.ts`

**Specs:**
- `ManageUserHostname`: add/remove `{username, host: DynDnsHost}` rows (`checkBy='hostname'`,
  ipv4 null until resolved); report `{firewallDirty, fail2banDirty, whitelistDirty}` only
  after a remove of a resolved row (add contributes nothing until first resolution).
- `ResolveDynDns.execute({})`: for each hostname row: `DynDnsResolverPort.resolve` →
  unchanged ⇒ nothing; changed ⇒ update row, notify `DynDnsAddressChanged`, mark dirty;
  unresolvable ⇒ keep last IP (grace — a flapping dyndns must not evict a user), log.
  Report dirty flags; worker chains `render-whitelist` + `apply-firewall` + `render-fail2ban`.
  This replaces the legacy `DynamicAddressResolver` cron */5 (cron wiring itself = Phase 5;
  E2E drives the job directly).
- `DynDnsLookupAdapter`: `node:dns/promises.lookup` (family 4, respects `/etc/hosts` — the
  E2E fixture seam) → `IpAddress | undefined`; never throws on NXDOMAIN.

**Commit:** `feat(security): DynDNS hostname addresses with periodic resolution job`

## Task 9 — OpenVPN render use case + job + CLI

**Files:**
- Create: `kobox/src/application/security/RenderOpenVpn.ts`,
  `kobox/src/infrastructure/system/FsVpnPkiAdapter.ts`
- Modify: `contract.ts` (`render-openvpn` {}), `JobWorker.ts`, `useCases.ts`, `composition.ts`,
  `cli/main.ts`/`buildJob.ts`
- Test: `kobox/test/component/application/security/openvpn.test.ts`

**Specs:**
- `RenderOpenVpn.execute()`: render 3 server configs (PKI paths from `VpnPkiPort.serverPaths()`);
  for each active user with available `clientMaterial`, render the 3 profile variants; users
  without material are skipped with a logged warning (PKI bootstrap = Phase 4). Apply via
  `ManagedFilesPort`; no service restart (OpenVPN restart drops tunnels — operator decision,
  documented in the CLI description).
- `FsVpnPkiAdapter`: reads `/etc/openvpn/kobox-pki/{ca.crt,issued/<user>.crt,private/<user>.key}`
  (`KOBOX_VPN_PKI` overridable); missing files ⇒ `undefined`.

**Commit:** `feat(security): OpenVPN config rendering use case`

## Task 10 — Usage metering adapters

**Files:**
- Create: `kobox/src/infrastructure/system/IptablesUsageMeterAdapter.ts`,
  `JournaldSshAuthAdapter.ts`, `GetentUserIdentityAdapter.ts`
- Test: `kobox/test/unit/infrastructure/system/security-adapters.test.ts` (fixture-driven parse
  tests with a recording fake runner)

**Specs:**
- `IptablesUsageMeterAdapter`: `iptables -nvxL kobox-meter-out` + `-nvxL kobox-meter-in` →
  parse `pkts bytes … /* kobox:egress:<user> */` lines into `UsageCounter[]`; tolerant of
  missing chains (fresh box ⇒ `[]`). Pure parse function exported for direct unit testing.
- `JournaldSshAuthAdapter`: `journalctl -u ssh -u sshd --since -<windowMinutes>m
  --grep Accepted publickey --output json` (argv array, `timeoutMs 10_000`) → count lines whose
  MESSAGE matches `Accepted publickey for <username> `; exit code 1 with empty output = zero
  matches (journalctl semantics), not an error.
- `GetentUserIdentityAdapter`: `getent passwd <user>` → uid field; exit 2 ⇒ `undefined`.

**Commit:** `feat(security): iptables and journald usage metering adapters`

## Task 11 — tc/HTB shaping adapter

**Files:**
- Create: `kobox/src/infrastructure/system/TcShapingAdapter.ts`
- Test: `kobox/test/unit/infrastructure/system/security-adapters.test.ts` (extend — argv
  sequences recorded per operation)

**Specs:**
- Interface egress shaping on `KOBOX_WAN_IF` (default `eth0`), constructor-injected.
- `throttle(username, uid, rate)`: idempotent sequence — `tc qdisc replace dev <if> root handle 1:
  htb default 0`; `tc class replace dev <if> parent 1: classid 1:<uid> htb rate <rate.toTcRate()>`;
  `tc filter replace dev <if> parent 1: protocol ip prio 1 handle <uid> fw flowid 1:<uid>`;
  mangle mark rule via `iptables -t mangle` (`-C` check then `-A` — the mangle table is owned
  here, never by the rendered ruleset, so firewall re-applies keep live throttles).
- `unthrottle`: delete filter/class/mangle rule, each guarded by existence check; qdisc left in
  place (harmless empty root).
- `isThrottled(uid)`: `tc class show` parse.

**Commit:** `feat(security): tc/HTB per-user shaping adapter`

## Task 12 — `FairUseEvaluator` + `EvaluateFairUse` (the graduated response)

**Files:**
- Create: `kobox/src/domain/security/FairUseEvaluator.ts`,
  `kobox/src/application/security/EvaluateFairUse.ts`
- Modify: `contract.ts` (`evaluate-fair-use` {}), `JobWorker.ts`, `useCases.ts`,
  `composition.ts` (default policy from env `KOBOX_FAIRUSE_*` with sane defaults), `cli/main.ts`
  (`evaluate-fair-use`, `show-usage` JSON operator view)
- Test: `kobox/test/unit/domain/security/FairUseEvaluator.test.ts`,
  `kobox/test/component/application/security/fair-use.test.ts`

**Specs:**
- `FairUseEvaluator.evaluate({observed, budget, level, healthState})` — **pure domain service**
  returning `{nextLevel, nextHealthState, events, actions}` where actions ⊆
  `{'notify','throttle','unthrottle'}`. FROZEN graduated response:
  - level `none` + breach ⇒ `alerted`, emit `FairUseBreached`/`AbnormalAuthRate`, notify.
  - level `alerted` + still breached ⇒ `throttled`, action `throttle` (budget.throttleTo),
    emit `UserThrottled`, notify.
  - level `throttled` + still breached ⇒ stays `throttled` (idempotent, no re-notify spam).
  - any level > `none` + no breach ⇒ `none`, action `unthrottle` (if was throttled), emit
    `FairUseRecovered`, notify.
  - **Suspension is NEVER an action here** — manual `SuspendUser` only (unit-test asserts the
    action union cannot express it).
  - health: probe transition healthy→unhealthy emits `ServiceUnhealthy` (once, on transition).
  Full truth-table unit tests.
- `EvaluateFairUse.execute({now})`: for each **active** user: uid; counters delta vs
  `usage_samples` (first run = baseline, no judgment); `EgressRate.fromDelta`; SSH auth count
  (window 60 min) → `ConnectionRate`; rtorrent socket probe (skip suspended); budget =
  defaults ⊕ per-user overrides → evaluator → persist state, **append every event to
  `fair_use_events` (audit)**, notify via `SecurityNotificationPort`, apply throttle/unthrottle
  via `ShapingPort`. Counter reset (firewall re-apply zeroes counters) ⇒ delta < 0 ⇒ treat as
  new baseline, never a negative rate (explicit test).

**Commit:** `feat(security): FairUseEvaluator with graduated alert-throttle response`

## Task 13 — Multi-channel notifications (ntfy + email + Discord)

**Files:**
- Create: `kobox/src/infrastructure/notifications/NtfyChannel.ts`, `EmailChannel.ts`,
  `DiscordChannel.ts`, `MultiChannelNotifier.ts`, `formatEvent.ts`
- Modify: `composition.ts` (channels from env: `KOBOX_NTFY_URL` [+topic in URL],
  `KOBOX_DISCORD_WEBHOOK`, `KOBOX_ALERT_EMAIL`; zero channels configured ⇒ console fallback
  stays), keep `ConsoleNotificationAdapter`
- Test: `kobox/test/unit/infrastructure/notifications.test.ts` (fetch injected as function;
  email channel with recording runner), `kobox/test/component/application/security/fair-use.test.ts`
  (extend: breach fans out to all three channels)

**Specs:**
- `formatEvent(event: UserEvent | TrackerEvent | SecurityEvent)` → `{title, body, priority}`
  (priority 'high' for `FairUseBreached`/`AbnormalAuthRate`/`ServiceUnhealthy`/`UserThrottled`).
- `NtfyChannel`: POST `KOBOX_NTFY_URL` body=body, headers Title/Priority; injected `fetch`
  (testable, no real network), `AbortSignal.timeout(5000)`.
- `DiscordChannel`: POST webhook JSON `{content: "**title**\nbody"}`.
- `EmailChannel`: `sendmail -t` via `CommandRunner` stdin (`To/Subject/body`) — reuses the
  Postfix relay, argv-only.
- `MultiChannelNotifier implements NotificationPort, TrackerNotificationPort,
  SecurityNotificationPort`: fan-out sequentially; a channel failure is logged and never
  breaks the others nor the calling use case (unit-tested).

**Commit:** `feat(security): real ntfy, email and Discord notification channels`

## Task 14 — Phase 2 debt: filter chaining + journal proof

**Files:**
- Modify: `kobox/src/interfaces/worker/JobWorker.ts` (chain
  `render-blocklist-filters {username}` after `provision-rtorrent`, before `apply-firewall`),
  `kobox/test/component/interfaces/worker-loop.test.ts`,
  `kobox/test/e2e/tracker-blocklist.e2e.test.ts` (assert `journalctl -u rtorrent-<user>` or
  rtorrent log contains `IPv4 filter list size` with size > 0 after filter render + restart)

**Commit:** `fix(tracker): chain per-user blocklist filter render after provisioning, prove parse via journal`

## Task 15 — Container toolchain + integration tests (real iptables/journald/fail2ban/tc)

**Files:**
- Modify: `kobox/docker/Dockerfile` (+ `iptables fail2ban iproute2 openvpn`),
  `docker/e2e-setup.sh` (add `dyn.example.org → 127.0.0.2` hosts entry)
- Create: `kobox/test/integration/system/security-adapters.int.test.ts` (skips outside
  linux/root like Phase 0-2 suites)

**Specs (integration, in-container):**
- `IptablesRestoreAdapter`: apply golden-shaped policy → `iptables-save` contains lo/established/
  SSH + user chains; re-apply ⇒ `'unchanged'`; forced-failing probe (stub) ⇒ `'rolled-back'`
  and `iptables-save` equals pre-apply snapshot. **Never run outside the container** (suite
  root+linux gated).
- `JournaldSshAuthAdapter`: emit fixture lines via `systemd-cat -t sshd` then count.
- Fail2ban renders pass `fail2ban-client -t` (config test only, service not started).
- `TcShapingAdapter`: throttle/unthrottle against a `dummy0` link (`ip link add`), assert
  class exists/disappears.
- `IptablesUsageMeterAdapter`: after apply + local traffic, counters parse to numbers.

**Commit:** `test(security): integration coverage against real iptables, journald, fail2ban and tc`

## Task 16 — E2E Debian 12: the user-h scenario end-to-end

**Files:**
- Create: `kobox/test/e2e/security-network.e2e.test.ts` (sequential, like Phase 1/2 E2E)

**Scenario (all through CLI → queue → root worker, fixtures local only):**
1. Create user via CLI + worker drain → firewall applied: `iptables-save` shows default-deny
   INPUT **with** lo/established/SSH intact (we are still able to exec in the container —
   the probe passed), per-user chain + meter rules present. Re-run `apply-firewall` ⇒ no-op.
2. `add-user-hostname alice dyn.example.org` + `resolve-dyndns` (fixture IP via `/etc/hosts`)
   → address row resolved; `allow.p2p` + fail2ban `ignoreip` + firewall contain 127.0.0.2;
   flip the hosts entry, re-resolve → all three refreshed (the `DynamicAddressResolver`
   replacement proven).
3. Fail2ban files rendered and `fail2ban-client -t` green (publickey-flood jail present).
4. Flood journald with `Accepted publickey for alice` lines (`systemd-cat -t sshd`, > 30/h);
   local ntfy fixture server on 127.0.0.2 (async execFile — Phase 2 trap); `evaluate-fair-use`
   run 1 ⇒ ntfy fixture received `AbnormalAuthRate` alert, state `alerted`, audit row present.
5. `evaluate-fair-use` run 2 (still breaching) ⇒ throttled: tc class exists for alice's uid,
   `UserThrottled` notified, audit appended. Breach stops ⇒ run 3 recovers: class gone,
   `FairUseRecovered`.
6. Manual path stays manual: `suspend-user` + worker ⇒ account locked (Phase 0 behavior still
   green with firewall active).
7. `render-openvpn` with fixture PKI material ⇒ 3 server configs + alice profiles on disk,
   `grep -c comp-lzo` = 0.

**Commit:** `feat(security): full-stack E2E on Debian 12 (firewall, dyndns, publickey flood, graduated response)`

## Task 17 — Docs, verification, Phase 4 brief, PR

- Update `docs/DEV.md` (security env vars, new make notes, ntfy fixture, `KOBOX_WAN_IF`).
- `verification-before-completion`: `pnpm lint && pnpm typecheck && pnpm coverage` (≥85 %
  domain+application) && `pnpm build` && `make test-int` && `make e2e` — full output read, zsh
  pipe-exit trap respected (no `| tail`).
- `requesting-code-review` → fix findings (`receiving-code-review`).
- Write `docs/PHASE-4-BRIEF.md` (Installation & Provisioning) mirroring this brief's format.
- Draft PR to `main`: <200 words, no session link.

**Commits:** `docs(dev): phase 3 environment and fixtures`, `docs: add Phase 4 implementation brief`
