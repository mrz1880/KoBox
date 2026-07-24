import { DomainError } from '../shared/DomainError.js';

export class InvalidEventHookError extends DomainError {
  constructor(raw: string) {
    super(`invalid event hook ${JSON.stringify(raw)}`);
  }
}

export type EventHookType = 'inserted_new' | 'finished' | 'erased';

// The three rtorrent lifecycle events KoBox listens to. Each hook binds an
// rc event key to a per-user shim; the argv order mirrors the legacy
// templates so torrents keep flowing identically through the rewrite.
export class EventHook {
  static readonly insertedNew = new EventHook('inserted_new', [
    '$d.hash=',
    '$d.name=',
    '$d.directory=',
    '$d.loaded_file=',
    '$d.custom2=',
    '$d.custom1=',
  ]);
  static readonly finished = new EventHook('finished', [
    '$d.hash=',
    '$d.base_path=',
    '$d.directory=',
    '$d.name=',
    '$d.loaded_file=',
    '$d.custom1=',
  ]);
  static readonly erased = new EventHook('erased', ['$d.hash=', '$d.name=', '$d.directory=']);

  static readonly all: readonly EventHook[] = [
    EventHook.insertedNew,
    EventHook.finished,
    EventHook.erased,
  ];

  private constructor(
    readonly type: EventHookType,
    readonly rtorrentArgs: readonly string[],
  ) {}

  static parse(raw: string): EventHook {
    const hook = EventHook.all.find((candidate) => candidate.type === raw);
    if (!hook) {
      throw new InvalidEventHookError(raw);
    }
    return hook;
  }

  get shimFilename(): string {
    return `.rTorrent_${this.type}.sh`;
  }

  get rcEventKey(): string {
    return `event.download.${this.type}`;
  }
}
