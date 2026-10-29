import { describe, expect, it } from 'vitest';
import { InvalidSendHourError, SendHour } from '../../../../src/domain/sync/SendHour.js';

describe('SendHour', () => {
  it('should_accept_midnight_and_the_last_hour_of_the_day', () => {
    expect(SendHour.parse(0).value).toBe(0);
    expect(SendHour.parse(23).value).toBe(23);
  });

  it('should_refuse_an_hour_just_outside_the_day', () => {
    expect(() => SendHour.parse(-1)).toThrow(InvalidSendHourError);
    expect(() => SendHour.parse(24)).toThrow(InvalidSendHourError);
  });

  it('should_refuse_a_fractional_hour_and_name_it_in_the_error', () => {
    expect(() => SendHour.parse(2.5)).toThrow('invalid send hour 2.5: expected 0 to 23');
  });

  it('should_default_to_two_in_the_morning', () => {
    expect(SendHour.default().value).toBe(2);
  });

  it('should_have_come_only_at_its_own_hour', () => {
    const hour = SendHour.parse(3);

    expect(hour.hasCome(3)).toBe(true);
    expect(hour.hasCome(4)).toBe(false);
  });

  it('should_compare_by_value', () => {
    expect(SendHour.parse(3).equals(SendHour.parse(3))).toBe(true);
    expect(SendHour.parse(3).equals(SendHour.parse(4))).toBe(false);
  });
});
