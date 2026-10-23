---
name: Report a bug
about: Something on a KoBox box does not behave as expected
title: "[BUG] "
labels: bug

---

## What happens

A clear and short description of the problem.

## Steps to reproduce

1. ...
2. ...

## What you expected

## Diagnostics

Remove anything private (hostnames, IP addresses, member names) before posting.

- `kobox doctor`
- `kobox install-status`
- `journalctl -u kobox-worker -u kobox-portal --since "1 hour ago"`

## Environment

- KoBox version: _(tag, e.g. v1.0.1)_
- Debian version: _(`cat /etc/debian_version`)_
- Kernel: _(`uname -r`)_
- Hardware: _(CPU, RAM, disks, RAID)_
