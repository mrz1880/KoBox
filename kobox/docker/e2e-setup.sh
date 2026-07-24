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
echo "e2e-setup done"
