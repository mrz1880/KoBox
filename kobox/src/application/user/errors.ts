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
