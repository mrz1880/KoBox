#!/usr/bin/env bash
# KoBox bootstrap — the ONLY bash a human runs on the box (AUDIT §3.6).
# Minimal pre-checks, Node LTS, sources, then hand off to the tested CLI:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/KoBox/main/kobox/bootstrap/install.sh | bash
# Env: KOBOX_SRC (existing checkout, skips clone), KOBOX_REPO (clone URL),
#      NODE_MAJOR (default 24). Everything after `exec` is TypeScript.
set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-24}"
# no baked default on purpose (public fork, no identities in the tree):
# cloning a fresh box requires KOBOX_REPO=<your fork's https url>
KOBOX_REPO="${KOBOX_REPO:-}"
INSTALL_ROOT="/opt/KoBox"

fail() { echo "kobox bootstrap: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "must run as root"
grep -q '^ID=debian$' /etc/os-release || fail "Debian required (kobox install re-checks the version)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl git gnupg xz-utils >/dev/null

# Node >= NODE_MAJOR: reuse what's there (containers ship it), else NodeSource
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR" ]; }
if ! node_ok; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -qq --no-install-recommends nodejs >/dev/null
fi
node_ok || fail "node >= ${NODE_MAJOR} not available after install"
corepack enable pnpm

# Source tree: an existing checkout (KOBOX_SRC or a repo we run from) wins;
# a fresh box clones. Never `git reset --hard` on someone's working tree.
if [ -n "${KOBOX_SRC:-}" ]; then
    SRC="$KOBOX_SRC"
elif [ -d "${INSTALL_ROOT}/kobox" ]; then
    SRC="${INSTALL_ROOT}/kobox"
else
    [ -n "$KOBOX_REPO" ] || fail "set KOBOX_REPO=<fork https url> to clone (or KOBOX_SRC=<checkout>)"
    git clone --depth 1 "$KOBOX_REPO" "$INSTALL_ROOT"
    SRC="${INSTALL_ROOT}/kobox"
fi
[ -f "${SRC}/package.json" ] || fail "no kobox package at ${SRC}"

cd "$SRC"
pnpm install --frozen-lockfile
pnpm build

exec node dist/interfaces/cli/main.js install "$@"
