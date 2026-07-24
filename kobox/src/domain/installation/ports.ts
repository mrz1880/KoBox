// Read-only facts about the host, gathered BEFORE any mutation. hasTunDevice
// is not a preflight gate — the openvpn installer uses it to decide whether
// tunnels can actually start (containers usually lack /dev/net/tun).
export interface SystemFacts {
  readonly osId: string;
  readonly osVersionId: string;
  readonly arch: string;
  readonly euid: number;
  readonly rootFsType: string;
  readonly hasDefaultRoute: boolean;
  readonly hasTunDevice: boolean;
}

export interface SystemFactsPort {
  gather(): Promise<SystemFacts>;
}
