export class TrackerNotFoundError extends Error {
  constructor(host: string) {
    super(`no tracker registered for host ${host}`);
    this.name = 'TrackerNotFoundError';
  }
}

export class InvalidAnnounceUrlError extends Error {
  constructor(url: string, reason: string) {
    super(`invalid announce url ${JSON.stringify(url)}: ${reason}`);
    this.name = 'InvalidAnnounceUrlError';
  }
}
