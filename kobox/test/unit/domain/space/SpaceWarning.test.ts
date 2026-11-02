import { describe, expect, it } from 'vitest';
import type { AutomaticCleanup } from '../../../../src/domain/space/AutomaticCleanup.js';
import type { QuotaPressure } from '../../../../src/domain/space/QuotaPressure.js';
import { SpaceWarning } from '../../../../src/domain/space/SpaceWarning.js';

describe('SpaceWarning', () => {
  it.each<[boolean, QuotaPressure, { warned: boolean; send: boolean }]>([
    // past the critical line for the first time in this climb: warn, once
    [false, 'critical', { warned: true, send: true }],
    // still past it an hour later: already told
    [true, 'critical', { warned: true, send: false }],
    // between the two lines nothing changes, so hovering around the critical
    // line does not mail the member every other hour
    [true, 'filling', { warned: true, send: false }],
    [false, 'filling', { warned: false, send: false }],
    // back under the filling line: the next climb warns again
    [true, 'relaxed', { warned: false, send: false }],
    [false, 'relaxed', { warned: false, send: false }],
  ])('should_go_from_warned_%s_at_%s_to_%o', (warned, pressure, next) => {
    expect(SpaceWarning.after(warned, pressure)).toEqual(next);
  });

  // a member mailed past the line who then lets KoBox clean expects it to act
  // at the next pass, not after their next climb
  it.each<[boolean, AutomaticCleanup, boolean]>([
    [true, 'sentOnly', false],
    [true, 'sentOrSeeded', false],
    // turning it off must not mail the member again for the same climb
    [true, 'off', true],
    [false, 'off', false],
  ])('should_go_from_warned_%s_to_%s_once_the_member_chooses_%s', (warned, automatic, next) => {
    expect(SpaceWarning.afterChoosing(warned, automatic)).toBe(next);
  });
});
