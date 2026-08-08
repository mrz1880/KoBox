import { describe, expect, it } from 'vitest';
import {
  ConfigDocument,
  ConfigPathOutsideEtcError,
  SecretBearingConfigError,
  UnknownConfigDocumentError,
} from '../../../../src/domain/installation/ConfigDocument.js';

describe('ConfigDocument', () => {
  it('should_accept_every_document_in_the_catalog', () => {
    for (const document of ConfigDocument.all()) {
      expect(ConfigDocument.parse(document.id).path, document.id).toBe(document.path);
    }
  });

  it('should_refuse_an_id_outside_the_catalog', () => {
    for (const bad of ['', 'passwd', '../scheduler', 'scheduler/../../etc/shadow']) {
      expect(() => ConfigDocument.parse(bad), bad).toThrow(UnknownConfigDocumentError);
    }
  });

  it('should_only_offer_files_kobox_writes_itself', () => {
    // "what did KoBox put on my box" is the question this screen answers. A
    // browser over the whole filesystem would answer a different, far more
    // dangerous one.
    for (const document of ConfigDocument.all()) {
      expect(document.path.startsWith('/etc/'), document.path).toBe(true);
    }
  });

  it('should_refuse_to_catalogue_a_file_that_carries_a_secret', () => {
    // The catalog is checked when it is built, not merely in a test: an entry
    // added later that points at the worker env or a private key must fail to
    // load, not fail review.
    for (const secret of [
      '/etc/kobox/worker.env',
      '/etc/kobox/portal.env',
      '/etc/kobox/aria2.conf',
      '/etc/kobox/debrid-key.pem',
      '/etc/nginx/kobox.htpasswd',
      '/etc/openvpn/kobox-pki/private/ca.key',
    ]) {
      expect(() => ConfigDocument.of('probe', 'Probe', secret, 'probe'), secret).toThrow(
        SecretBearingConfigError,
      );
    }
  });

  it('should_refuse_to_catalogue_anything_outside_etc', () => {
    for (const outside of ['/home/alice/.ssh/authorized_keys', '/var/lib/kobox/kobox.db', 'etc/x']) {
      expect(() => ConfigDocument.of('probe', 'Probe', outside, 'probe'), outside).toThrow(
        ConfigPathOutsideEtcError,
      );
    }
  });

  it('should_leave_out_the_ssh_dropin_kobox_installs_unreadable', () => {
    // it holds no secret, but it is 0600 and the portal is unprivileged.
    // Listing it would render "not on this box" for a file that is right there.
    const paths = ConfigDocument.all().map((document) => document.path);
    expect(paths).not.toContain('/etc/ssh/sshd_config.d/90-kobox.conf');
  });

  it('should_never_have_two_documents_claiming_the_same_id', () => {
    const ids = ConfigDocument.all().map((document) => document.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
