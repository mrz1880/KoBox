import { ComponentName } from './ComponentName.js';

export interface ComponentSpec {
  readonly name: ComponentName;
  readonly dependsOn: readonly ComponentName[];
}

function spec(name: string, dependsOn: readonly string[] = []): ComponentSpec {
  return {
    name: ComponentName.parse(name),
    dependsOn: dependsOn.map((dep) => ComponentName.parse(dep)),
  };
}

// Catalog order is the deterministic tie-breaker of the topological sort.
// kobox-core comes first: it owns the dirs and units everything else assumes.
export const COMPONENT_CATALOG: readonly ComponentSpec[] = [
  spec('kobox-core'),
  spec('apt-sources'),
  spec('sshd'),
  spec('tweaks'),
  spec('quota'),
  spec('dnscrypt'),
  // bind forwards to dnscrypt (127.0.0.1:52): resolver first
  spec('bind', ['dnscrypt']),
  spec('nginx'),
  spec('rtorrent'),
  spec('rutorrent', ['nginx', 'rtorrent']),
  spec('pgl'),
  spec('fail2ban', ['sshd']),
  spec('openvpn'),
  spec('postfix'),
];
