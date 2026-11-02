// rtorrent session directory of an instance. Trailing slash included because
// rtorrent's session.path.set expects a directory path ending with '/'.
export class SessionDir {
  // relative to the member's home, without the trailing slash
  static readonly TREE = 'rtorrent/.session';

  private constructor(readonly value: string) {}

  static forHome(home: string): SessionDir {
    return new SessionDir(`${home.replace(/\/$/, '')}/${SessionDir.TREE}/`);
  }

  toString(): string {
    return this.value;
  }
}
