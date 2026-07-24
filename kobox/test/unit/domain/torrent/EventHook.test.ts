import { describe, expect, it } from 'vitest';
import { EventHook, InvalidEventHookError } from '../../../../src/domain/torrent/EventHook.js';

describe('EventHook', () => {
  it('should_expose_the_three_rtorrent_lifecycle_hooks', () => {
    expect(EventHook.all.map((hook) => hook.type)).toEqual(['inserted_new', 'finished', 'erased']);
  });

  it('should_bind_each_hook_to_its_shim_and_rc_event_key', () => {
    const inserted = EventHook.parse('inserted_new');
    expect(inserted.shimFilename).toBe('.rTorrent_inserted_new.sh');
    expect(inserted.rcEventKey).toBe('event.download.inserted_new');
    // legacy arg order preserved: hash, name, directory, loaded_file, custom2, custom1
    expect(inserted.rtorrentArgs).toEqual([
      '$d.hash=',
      '$d.name=',
      '$d.directory=',
      '$d.loaded_file=',
      '$d.custom2=',
      '$d.custom1=',
    ]);

    const finished = EventHook.parse('finished');
    expect(finished.shimFilename).toBe('.rTorrent_finished.sh');
    expect(finished.rtorrentArgs).toEqual([
      '$d.hash=',
      '$d.base_path=',
      '$d.directory=',
      '$d.name=',
      '$d.loaded_file=',
      '$d.custom1=',
    ]);

    const erased = EventHook.parse('erased');
    expect(erased.rtorrentArgs).toEqual(['$d.hash=', '$d.name=', '$d.directory=']);
  });

  it('should_reject_unknown_hook_types', () => {
    expect(() => EventHook.parse('paused')).toThrow(InvalidEventHookError);
  });
});
