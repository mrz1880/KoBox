import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_NAMES,
  ComponentName,
  InvalidComponentNameError,
} from '../../../../src/domain/installation/ComponentName.js';
import {
  INSTALL_STATES,
  InstallState,
  InvalidInstallStateError,
} from '../../../../src/domain/installation/InstallState.js';
import { InvalidVersionError, Version } from '../../../../src/domain/installation/Version.js';

describe('ComponentName', () => {
  it('should_parse_every_cataloged_component_name', () => {
    for (const name of COMPONENT_NAMES) {
      expect(ComponentName.parse(name).value).toBe(name);
    }
  });

  it('should_include_the_v1_core_components', () => {
    for (const expected of [
      'kobox-core',
      'apt-sources',
      'sshd',
      'tweaks',
      'quota',
      'nginx',
      'rtorrent',
      'rutorrent',
      'bind',
      'dnscrypt',
      'pgl',
      'fail2ban',
      'openvpn',
      'postfix',
    ]) {
      expect(COMPONENT_NAMES).toContain(expected);
    }
  });

  it('should_reject_a_name_outside_the_closed_catalog', () => {
    expect(() => ComponentName.parse('netdata')).toThrow(InvalidComponentNameError);
    expect(() => ComponentName.parse('')).toThrow(InvalidComponentNameError);
    expect(() => ComponentName.parse('nginx; rm -rf /')).toThrow(InvalidComponentNameError);
  });

  it('should_compare_by_value', () => {
    expect(ComponentName.parse('nginx').equals(ComponentName.parse('nginx'))).toBe(true);
    expect(ComponentName.parse('nginx').equals(ComponentName.parse('bind'))).toBe(false);
  });
});

describe('InstallState', () => {
  it('should_parse_the_four_registry_states', () => {
    expect(INSTALL_STATES).toEqual(['to_install', 'installed', 'failed', 'skipped']);
    for (const state of INSTALL_STATES) {
      expect(InstallState.parse(state).value).toBe(state);
    }
  });

  it('should_reject_unknown_states', () => {
    expect(() => InstallState.parse('is_installed')).toThrow(InvalidInstallStateError);
  });

  it('should_mark_everything_but_installed_as_pending', () => {
    // anti-#122: a failed component re-enters the plan without redoing the
    // rest; skipped re-enters too — skip checks are cheap and idempotent,
    // and a skip whose cause was fixed (env pin set, package packaged)
    // must be recoverable by plain re-run, never by DB surgery
    expect(InstallState.parse('to_install').isPending()).toBe(true);
    expect(InstallState.parse('failed').isPending()).toBe(true);
    expect(InstallState.parse('skipped').isPending()).toBe(true);
    expect(InstallState.parse('installed').isPending()).toBe(false);
  });
});

describe('Version', () => {
  it('should_parse_debian_style_versions', () => {
    for (const raw of ['0.9.8', '1.24.0-1~deb12u1', '2:1.18.0', '9.18.24-1', '4.6.1+git']) {
      expect(Version.parse(raw).value).toBe(raw);
    }
  });

  it('should_reject_shell_metacharacters_and_junk', () => {
    for (const raw of ['', ' ', '1.0 && reboot', 'v$(id)', 'a'.repeat(70), '-1.0', '.hidden']) {
      expect(() => Version.parse(raw)).toThrow(InvalidVersionError);
    }
  });

  it('should_never_accept_a_string_with_characters_outside_the_safe_charset', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }).filter((s) => /[^0-9A-Za-z.+~:-]/.test(s)),
        (raw) => {
          expect(() => Version.parse(raw)).toThrow(InvalidVersionError);
        },
      ),
    );
  });

  it('should_compare_by_value', () => {
    expect(Version.parse('1.2.3').equals(Version.parse('1.2.3'))).toBe(true);
    expect(Version.parse('1.2.3').equals(Version.parse('1.2.4'))).toBe(false);
  });
});
