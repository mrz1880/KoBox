import { ChangePassword } from '../application/user/ChangePassword.js';
import { CreateUser } from '../application/user/CreateUser.js';
import { DeleteUser } from '../application/user/DeleteUser.js';
import { ResumeUser } from '../application/user/ResumeUser.js';
import { SuspendUser } from '../application/user/SuspendUser.js';
import type { PortAllocatorPort } from '../domain/user/PortAllocatorPort.js';
import type {
  NotificationPort,
  QuotaPort,
  ServiceControlPort,
  SftpPort,
  SystemAccountPort,
  UserRepository,
} from '../domain/user/ports.js';

export interface UseCaseDeps {
  readonly repo: UserRepository;
  readonly accounts: SystemAccountPort;
  readonly quota: QuotaPort;
  readonly sftp: SftpPort;
  readonly services: ServiceControlPort;
  readonly notifications: NotificationPort;
  readonly allocator: PortAllocatorPort;
}

export interface UseCases {
  readonly createUser: CreateUser;
  readonly deleteUser: DeleteUser;
  readonly changePassword: ChangePassword;
  readonly suspendUser: SuspendUser;
  readonly resumeUser: ResumeUser;
}

export function buildUseCases(deps: UseCaseDeps): UseCases {
  return {
    createUser: new CreateUser(deps),
    deleteUser: new DeleteUser(deps),
    changePassword: new ChangePassword(deps),
    suspendUser: new SuspendUser(deps),
    resumeUser: new ResumeUser(deps),
  };
}
