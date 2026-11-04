import { describe, expect, it } from 'vitest';
import {
  ReserveMemberPorts,
  type AllocatedPortsPort,
} from '../../../../src/application/user/ReserveMemberPorts.js';
import { MEMBER_PORT_RESERVATION_PATH } from '../../../../src/domain/installation/rendering.js';
import type { MemberPort } from '../../../../src/domain/user/memberPortReservation.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { FakeKernelSettings } from '../../../../src/infrastructure/system/fakes/FakeKernelSettings.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';

class LedgerStub implements AllocatedPortsPort {
  ports: readonly MemberPort[] = [];

  listAllocated(): Promise<readonly MemberPort[]> {
    return Promise.resolve(this.ports);
  }
}

function world() {
  const ledger = new LedgerStub();
  const files = new FakeRtorrentConfig();
  const kernel = new FakeKernelSettings();
  return { ledger, files, kernel, useCase: new ReserveMemberPorts({ ledger, files, kernel }) };
}

describe('ReserveMemberPorts', () => {
  it('should_reserve_the_ports_of_the_ledger_and_load_them_into_the_kernel', async () => {
    const { ledger, files, kernel, useCase } = world();
    ledger.ports = [RtorrentPort.parse(45000), ScgiPort.parse(51101)];

    await useCase.execute();

    expect(files.contentAt(MEMBER_PORT_RESERVATION_PATH)).toContain(
      'net.ipv4.ip_local_reserved_ports = 45000,51101',
    );
    expect(kernel.loaded).toEqual([MEMBER_PORT_RESERVATION_PATH]);
  });

  it('should_leave_the_kernel_alone_when_the_reservation_has_not_changed', async () => {
    const { ledger, kernel, useCase } = world();
    ledger.ports = [RtorrentPort.parse(45000)];
    await useCase.execute();

    await useCase.execute();

    expect(kernel.loaded).toHaveLength(1);
  });
});
