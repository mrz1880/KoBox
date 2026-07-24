#!/usr/bin/env bash
# Prepares a fresh Debian 12 container for the E2E runs.
# Idempotent: safe to run more than once.
set -euo pipefail

# sshd chroot for the sftp group (KoBox pairs this with kobox-sftp membership)
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/kobox-sftp.conf <<'EOF'
Match Group kobox-sftp
    ChrootDirectory %h
    ForceCommand internal-sftp
    AllowTcpForwarding no
EOF

# Since Phase 1 the rtorrent-<user> unit is provisioned by KoBox itself
# (ProvisionRtorrentInstance) — no dummy unit needed anymore.

# Phase 2 fixtures: the tracker/blocklist E2E hosts local TLS servers on
# 127.0.0.2 (NOT .1: the domain drops loopback .1 as unusable, like the
# legacy did) and resolves neutral fixture names to it via /etc/hosts.
# dns.lookup (getaddrinfo) honors /etc/hosts, so no DNS server is needed.
for fixture_host in tracker.example.org lists.example.net; do
    if ! grep -q "${fixture_host}" /etc/hosts; then
        echo "127.0.0.2 ${fixture_host}" >> /etc/hosts
    fi
done

# Network-file targets rendered by the Tracker context (bind/dnscrypt/pgl are
# not installed as services in the container — files are the truth, Phase 3
# owns the services).
mkdir -p /etc/pgl /etc/dnscrypt-proxy /etc/bind

echo "e2e-setup done"
