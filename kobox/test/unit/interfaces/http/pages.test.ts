import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loginPage } from '../../../../src/interfaces/http/views/loginPage.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { translatorFor } from '../../../../src/interfaces/http/views/messages.js';
import {
  accessPage,
  adminHomePage,
  signalStrip,
} from '../../../../src/interfaces/http/views/userPages.js';
import { accessFacts, G, signalRow as row } from './viewFixtures.js';

const ENGLISH = { language: Language.en, t: translatorFor(Language.en) };
const VIEWER = { username: 'alice', role: 'user' as const, csrfToken: 'csrf', ...ENGLISH };
const ADMIN = { username: 'boss', role: 'admin' as const, csrfToken: 'csrf', ...ENGLISH };

// how many meter segments are lit
function litSegments(html: string): number {
  return (html.match(/<i class="on/g) ?? []).length;
}

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../golden/portal');

function expectGolden(name: string, actual: string): void {
  const goldenPath = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, actual);
  }
  expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
}

describe('portal pages', () => {
  it('should_render_the_login_page_golden', () => {
    const content = loginPage(ENGLISH);

    expect(content).toContain('<meta name="viewport"');
    expectGolden('login.html.golden', content);
  });

  it('should_escape_the_error_message_on_the_login_page', () => {
    const content = loginPage(ENGLISH, '<img src=x onerror=alert(1)>');

    expect(content).not.toContain('<img src=x');
    expect(content).toContain('&lt;img src=x');
  });

  it('should_light_the_meter_in_proportion_to_the_busiest_channel', () => {
    const full = signalStrip(row({ egressBytes: 200 * G, scaleBytes: 200 * G }), ENGLISH.t);
    const half = signalStrip(row({ egressBytes: 100 * G, scaleBytes: 200 * G }), ENGLISH.t);
    const quiet = signalStrip(row({ egressBytes: 0, scaleBytes: 200 * G }), ENGLISH.t);

    expect(litSegments(full.value)).toBe(24);
    expect(litSegments(half.value)).toBe(12);
    expect(litSegments(quiet.value)).toBe(0);
    // a channel at full scale reaches the peak zone — that is what makes an
    // outlier visible without reading a number
    expect(full.value).toContain('on peak');
    expect(half.value).not.toContain('on peak');
  });

  it('should_drop_the_meter_when_there_is_nothing_honest_to_compare_against', () => {
    // a user looking at their own channel: no fleet to scale against, so the
    // fair-use verdict is shown instead of a meaningless bar
    const own = signalStrip(row({ label: 'Your channel' }), ENGLISH.t);

    expect(own.value).not.toContain('<div class="vu"');
    expect(own.value).toContain('within fair use');
    expect(own.value).toContain('Your channel');
  });

  it('should_read_the_state_of_a_channel_from_its_led_and_words', () => {
    expect(signalStrip(row({ suspended: true }), ENGLISH.t).value).toContain('led off');
    expect(signalStrip(row({ healthy: false }), ENGLISH.t).value).toContain('led bad');
    expect(signalStrip(row({ level: 'throttled' }), ENGLISH.t).value).toContain('led bad');
    expect(signalStrip(row({ level: 'alerted' }), ENGLISH.t).value).toContain('led warn');
    expect(signalStrip(row({ suspended: true }), ENGLISH.t).value).toContain('suspended');
    expect(signalStrip(row({ healthy: false }), ENGLISH.t).value).toContain('service down');
  });

  it('should_order_the_fleet_loudest_first_so_an_outlier_is_on_top', () => {
    const page = adminHomePage(
      [
        row({ username: 'quiet', egressBytes: 1 * G }),
        row({ username: 'loud', egressBytes: 900 * G }),
        row({ username: 'middling', egressBytes: 50 * G }),
      ],
      'blocking',
      ADMIN,
    );

    expect(page.indexOf('loud')).toBeLessThan(page.indexOf('middling'));
    expect(page.indexOf('middling')).toBeLessThan(page.indexOf('quiet'));
  });

  it('should_present_the_vpn_profiles_as_a_choice_with_a_recommendation', () => {
    const page = accessPage(VIEWER, accessFacts());

    // named by what they do, not by the protocol
    expect(page).toContain('Everything through the seedbox');
    expect(page).toContain('Usual choice');
    for (const variant of ['tun-gw', 'tun', 'tap']) {
      expect(page, variant).toContain(`/access/ovpn/${variant}`);
    }
  });

  it('should_omit_the_sftp_host_until_the_operator_configures_one', () => {
    const without = accessPage(VIEWER, accessFacts());
    const with_ = accessPage(VIEWER, accessFacts({ sftpHost: 'seedbox.example.org' }));

    expect(without).not.toContain('SFTP host');
    expect(with_).toContain('seedbox.example.org');
  });

  // asked by a member: the key section is where they look, so it says where
  // to connect and where to put the file
  it('should_say_beside_the_key_how_to_send_a_torrent_with_it', () => {
    const page = accessPage(
      VIEWER,
      accessFacts({ sftpHost: 'seedbox.example.org', sshPort: 2222 }),
    );

    expect(page).toContain('scp -P 2222 my.torrent alice@seedbox.example.org:rtorrent/watch/FOLDER/');
  });
});
