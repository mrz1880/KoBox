# A fixed VPN address per member, NFS and Samba through the tunnels

Validated design, 2026-10-24.

## Why

A member's NAS mounts their home over NFS through the OpenVPN tunnel, and the
legacy box made that work by hand: one member had a fixed client address
(`client-config-dir` + `ifconfig-push`) and a read-write export to it, while
every home was also exported read-only to the three whole VPN subnets. NFS v3
trusts the client address alone, so any member on the VPN could mount any other
member's home. KoBox exports nothing to the tunnels and its firewall drops NFS
and Samba from them, so neither works at all.

The VPN stays optional: Nextcloud, the portal, ruTorrent, SFTP, the apps' RPC
and debrid downloads all work over the internet. The tunnels carry what must not
be exposed to it: NFS and Samba.

## Design

- Each member is allocated one host number when the account is created, stored
  like their rTorrent ports, and keeps it for life. It gives the same address in
  the three tunnels: `10.0.0.N`, `10.0.1.N`, `10.0.2.N`.
- KoBox renders one `client-config-dir` file per member (named after their
  certificate) with `ifconfig-push`, and removes it with the member. The servers
  run with `ccd-exclusive`: a certificate without a file is refused.
- A member's home is exported read-write only to their own VPN addresses (and to
  any trusted address added by hand), with `all_squash` to their uid and gid so
  whatever a NAS writes belongs to the member whatever its own uids are. No
  export to a whole subnet.
- `mountd` listens on a fixed port (`/etc/nfs.conf`); the firewall accepts NFS
  (111, 2049, mountd) and Samba (445) from the tunnel subnets only, never from
  the internet. NFS v3 without locking (`nolock`), so no statd or lockd.

## Tests

Unit: the allocation, the client file, the exports. Component: creating and
deleting a member. E2E in the container: the real exports and nfs.conf, checked
with `exportfs`. A real mount through OpenVPN is validated on the NAS.
