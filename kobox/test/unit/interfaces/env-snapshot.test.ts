import { describe, expect, it } from 'vitest';
import { loadWorkerEnvInto, mergeKoboxEnv, parseEnvFile } from '../../../src/interfaces/envSnapshot.js';

describe('mergeKoboxEnv', () => {
  it('should_keep_a_setting_the_current_shell_never_heard_of', () => {
    // re-running `kobox install` from a plain shell used to rewrite worker.env
    // from that shell alone, silently dropping every secret the box was
    // configured with. The aria2 RPC secret went that way on a live box.
    const existing = new Map([['KOBOX_ARIA2_RPC_SECRET', 'kept'], ['KOBOX_DB', 'old.db']]);
    const fromShell = new Map([['KOBOX_DB', 'new.db']]);

    const merged = mergeKoboxEnv(existing, fromShell);

    expect(merged.get('KOBOX_ARIA2_RPC_SECRET')).toBe('kept');
    expect(merged.get('KOBOX_DB')).toBe('new.db');
  });

  it('should_let_the_current_shell_win_on_what_it_does_say', () => {
    const merged = mergeKoboxEnv(new Map([['KOBOX_DB', 'old']]), new Map([['KOBOX_DB', 'new']]));

    expect(merged.get('KOBOX_DB')).toBe('new');
  });

  it('should_start_from_nothing_on_a_fresh_box', () => {
    const merged = mergeKoboxEnv(undefined, new Map([['KOBOX_DB', 'first']]));

    expect([...merged]).toEqual([['KOBOX_DB', 'first']]);
  });
});

describe('parseEnvFile', () => {
  it('should_read_back_what_a_previous_install_wrote', () => {
    const parsed = parseEnvFile('# KoBox-managed\nKOBOX_DB=/var/lib/kobox/kobox.db\nKOBOX_X=a=b\n');

    expect(parsed.get('KOBOX_DB')).toBe('/var/lib/kobox/kobox.db');
    // a value may contain '=': only the first one separates
    expect(parsed.get('KOBOX_X')).toBe('a=b');
  });

  it('should_ignore_a_line_it_cannot_read_rather_than_guess', () => {
    // a wrong value is worse than a missing one: it would be handed to a daemon
    const parsed = parseEnvFile('garbage\nNOT_KOBOX=1\nKOBOX_OK=1\n');

    expect([...parsed]).toEqual([['KOBOX_OK', '1']]);
  });

  it('should_cope_with_no_file_at_all', () => {
    expect([...parseEnvFile(undefined)]).toEqual([]);
  });
});

describe('loadWorkerEnvInto', () => {
  it('should_give_a_root_cli_the_configuration_the_worker_unit_has', () => {
    // systemd hands worker.env to the worker; a person typing `kobox doctor`
    // gets only their own shell, and would otherwise be told aria2 is
    // unreachable on a perfectly healthy box
    const env: Record<string, string | undefined> = {};

    loadWorkerEnvInto(env, 'KOBOX_ARIA2_RPC_SECRET=from-the-box\n');

    expect(env.KOBOX_ARIA2_RPC_SECRET).toBe('from-the-box');
  });

  it('should_let_an_explicit_override_stand', () => {
    const env: Record<string, string | undefined> = { KOBOX_DB: '/tmp/mine.db' };

    loadWorkerEnvInto(env, 'KOBOX_DB=/var/lib/kobox/kobox.db\n');

    expect(env.KOBOX_DB).toBe('/tmp/mine.db');
  });
});
