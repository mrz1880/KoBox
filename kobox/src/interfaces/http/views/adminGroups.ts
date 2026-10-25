interface GroupEntry {
  readonly href: string;
  readonly title: string;
  readonly blurb: string;
  readonly tag?: string;
}

export interface AdminGroup {
  readonly path: string;
  readonly title: string;
  // the line under its menu entry
  readonly hint: string;
  readonly intro: string;
  readonly entries: readonly GroupEntry[];
}

// The administration menu holds one entry per job an admin comes to do; the
// pages behind each are listed here with what they are for, rather than lined
// up in the bar.
export const NETWORK_AND_SECURITY: AdminGroup = {
  path: '/admin/network',
  title: 'Network & security',
  hint: 'Addresses, trackers, blocklists',
  intro: 'Who reaches the box and how, and what rTorrent talks to.',
  entries: [
    {
      href: '/admin/addresses',
      title: 'Trusted addresses',
      tag: 'Optional',
      blurb:
        "A member's fixed addresses, such as their home connection. From them they pass the firewall and can mount their folder over NFS without the VPN. Without any, everything else works: the portal, Nextcloud, SFTP and the VPN.",
    },
    {
      href: '/admin/trackers',
      title: 'Trackers',
      blurb: 'The private trackers allowed, and their certificates.',
    },
    {
      href: '/admin/blocklists',
      title: 'Blocklists',
      blurb: 'The address ranges rTorrent refuses to talk to.',
    },
    {
      href: '/admin/fair-use',
      title: 'Fair use',
      blurb:
        "Each member's upload compared with the others, and the exceptions.",
    },
  ],
};

export const SYSTEM: AdminGroup = {
  path: '/admin/system',
  title: 'System',
  hint: 'Mail, domain, updates',
  intro: 'What the box needs to run and to reach people.',
  entries: [
    {
      href: '/admin/mail-relay',
      title: 'Mail relay',
      blurb: 'Invitations, forgotten passwords and alerts leave through it.',
    },
    {
      href: '/admin/mails',
      title: 'Sent mails',
      blurb: 'What the box sent, and what it could not.',
    },
    {
      href: '/admin/domain',
      title: 'Domain and certificate',
      blurb: "The box's public name and its Let's Encrypt certificate.",
    },
    {
      href: '/admin/packages',
      title: 'Updates',
      blurb: 'Debian packages waiting to be installed.',
    },
  ],
};

export const TROUBLESHOOTING: AdminGroup = {
  path: '/admin/troubleshooting',
  title: 'Troubleshooting',
  hint: 'Logs, generated files',
  intro: 'To understand a problem. Nothing here changes the box.',
  entries: [
    {
      href: '/admin/logs',
      title: 'Logs',
      blurb:
        "A service's latest lines, to read or to hand over for a diagnosis.",
    },
    {
      href: '/admin/config',
      title: 'Configuration files',
      blurb:
        'What KoBox wrote for nginx, rTorrent, the firewall and the rest, read-only.',
    },
  ],
};

export const ADMIN_GROUPS: readonly AdminGroup[] = [
  NETWORK_AND_SECURITY,
  SYSTEM,
  TROUBLESHOOTING,
];
