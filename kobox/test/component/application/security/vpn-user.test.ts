import { beforeEach, describe, expect, it } from 'vitest';
import { DeprovisionVpnUser } from '../../../../src/application/security/DeprovisionVpnUser.js';
import { ProvisionVpnUser } from '../../../../src/application/security/ProvisionVpnUser.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { FakeVpnPki } from '../../../../src/infrastructure/system/fakes/FakeVpnPki.js';

const alice = Username.parse('alice');

let pki: FakeVpnPki;

beforeEach(() => {
  pki = new FakeVpnPki();
});

describe('ProvisionVpnUser', () => {
  it('should_ensure_client_material_and_ask_for_an_openvpn_re_render', async () => {
    const report = await new ProvisionVpnUser({ pkiProvision: pki }).execute({ username: alice });

    expect(pki.ensuredClients).toEqual(['alice']);
    expect(report.openVpnDirty).toBe(true);
  });

  it('should_be_idempotent_via_the_port_contract', async () => {
    const useCase = new ProvisionVpnUser({ pkiProvision: pki });
    await useCase.execute({ username: alice });
    await useCase.execute({ username: alice });

    // the fake mirrors the adapter: ensure is issue-once
    expect(pki.ensuredClients).toEqual(['alice']);
    expect(await pki.clientMaterial(alice)).toBeDefined();
  });
});

describe('DeprovisionVpnUser', () => {
  it('should_remove_client_material_and_ask_for_an_openvpn_re_render', async () => {
    await new ProvisionVpnUser({ pkiProvision: pki }).execute({ username: alice });

    const report = await new DeprovisionVpnUser({ pkiProvision: pki }).execute({
      username: alice,
    });

    expect(await pki.clientMaterial(alice)).toBeUndefined();
    expect(report.openVpnDirty).toBe(true);
  });
});
