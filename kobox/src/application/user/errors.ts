import { DomainError } from '../../domain/shared/DomainError.js';

export class UserAlreadyExistsError extends DomainError {
  constructor(username: string) {
    super(`user ${username} already exists`);
  }
}

export class UserNotFoundError extends DomainError {
  constructor(username: string) {
    super(`user ${username} not found`);
  }
}

// A system account created before the portal existed has no credential row:
// there is no login whose role could change until it is given a password.
export class PortalLoginMissingError extends DomainError {
  constructor(username: string) {
    super(`user ${username} has no portal login yet: set a password with change-password first`);
  }
}
