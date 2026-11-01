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

export interface StuckBlocklist {
  readonly author: string;
  readonly name: string;
  readonly since: string; // when its outage began, UTC stamp
  readonly reason: string; // why the latest attempt failed
}

// Every list that has just gone a day without updating, in one message.
export interface BlocklistsNotUpdating {
  readonly type: 'BlocklistsNotUpdating';
  readonly lists: readonly StuckBlocklist[];
}

export type TrackerEvent = TrackerDiscovered | TrackerDied | TrackerCertRenewed | BlocklistsNotUpdating;
