export interface TrackerDiscovered {
  readonly type: 'TrackerDiscovered';
  readonly host: string;
}

export interface TrackerDied {
  readonly type: 'TrackerDied';
  readonly host: string;
}

export interface TrackerCertRenewed {
  readonly type: 'TrackerCertRenewed';
  readonly host: string;
  readonly expiresOn: string;
}

export interface BlocklistUpdateFailed {
  readonly type: 'BlocklistUpdateFailed';
  readonly author: string;
  readonly name: string;
}

export type TrackerEvent = TrackerDiscovered | TrackerDied | TrackerCertRenewed | BlocklistUpdateFailed;
