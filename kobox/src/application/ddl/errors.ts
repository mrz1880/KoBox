import { DomainError } from '../../domain/shared/DomainError.js';

export class DebridDownloadNotFoundError extends DomainError {
  constructor(id: number) {
    super(`debrid download ${String(id)} not found`);
  }
}
