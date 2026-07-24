export interface FairUseBreached {
  readonly type: 'FairUseBreached';
  readonly username: string;
  readonly metric: 'egress';
  readonly observedBps: number;
  readonly limitBps: number;
}

export interface AbnormalAuthRate {
  readonly type: 'AbnormalAuthRate';
  readonly username: string;
  readonly perHour: number;
  readonly limitPerHour: number;
}

export interface ServiceUnhealthy {
  readonly type: 'ServiceUnhealthy';
  readonly username: string;
  readonly detail: string;
}

export interface UserThrottled {
  readonly type: 'UserThrottled';
  readonly username: string;
  readonly rateBps: number;
}

export interface FairUseRecovered {
  readonly type: 'FairUseRecovered';
  readonly username: string;
}

export interface DynDnsAddressChanged {
  readonly type: 'DynDnsAddressChanged';
  readonly username: string;
  readonly host: string;
  readonly oldIp?: string;
  readonly newIp: string;
}

export interface FirewallApplied {
  readonly type: 'FirewallApplied';
  readonly outcome: 'applied' | 'rolled-back';
}

export type SecurityEvent =
  | FairUseBreached
  | AbnormalAuthRate
  | ServiceUnhealthy
  | UserThrottled
  | FairUseRecovered
  | DynDnsAddressChanged
  | FirewallApplied;
