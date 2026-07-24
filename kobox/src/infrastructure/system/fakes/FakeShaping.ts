import type { Bandwidth } from '../../../domain/security/Bandwidth.js';
import type { ShapingPort } from '../../../domain/security/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeShaping implements ShapingPort {
  readonly throttled = new Map<number, { username: string; rate: Bandwidth }>();

  throttle(username: Username, uid: number, rate: Bandwidth): Promise<void> {
    this.throttled.set(uid, { username: username.value, rate });
    return Promise.resolve();
  }

  unthrottle(_username: Username, uid: number): Promise<void> {
    this.throttled.delete(uid);
    return Promise.resolve();
  }

  isThrottled(uid: number): Promise<boolean> {
    return Promise.resolve(this.throttled.has(uid));
  }
}
