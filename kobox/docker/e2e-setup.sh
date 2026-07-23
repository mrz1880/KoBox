#!/usr/bin/env bash
# Prepares a fresh Debian 12 container for the Phase 0 E2E run.
# Idempotent: safe to run more than once.
set -euo pipefail

E2E_USER="${1:?usage: e2e-setup.sh <username>}"

# sshd chroot for the sftp group (KoBox pairs this with kobox-sftp membership)
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/kobox-sftp.conf <<'EOF'
Match Group kobox-sftp
    ChrootDirectory %h
    ForceCommand internal-sftp
    AllowTcpForwarding no
EOF

# Phase 0 does not provision rtorrent (Phase 1 does); the E2E pre-creates the
# per-user unit that suspend/resume will drive.
cat > "/etc/systemd/system/rtorrent-${E2E_USER}.service" <<EOF
[Unit]
Description=dummy rtorrent instance for ${E2E_USER} (E2E)

[Service]
ExecStart=/bin/sleep infinity

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "e2e-setup done for ${E2E_USER}"
