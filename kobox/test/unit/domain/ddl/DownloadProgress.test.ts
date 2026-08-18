import { describe, expect, it } from 'vitest';
import { DownloadProgress } from '../../../../src/domain/ddl/DownloadProgress.js';

describe('DownloadProgress', () => {
  it('should_say_how_far_along_a_download_is', () => {
    const progress = DownloadProgress.of(250, 1000);

    expect(progress?.percent).toBe(25);
  });

  it('should_refuse_to_invent_a_percentage_before_the_size_is_known', () => {
    // aria2 reports totalLength 0 until it has the headers. Rendering that as
    // 0% is a lie of a different kind: it says "started, nothing done" when the
    // truth is "we do not know yet".
    expect(DownloadProgress.of(0, 0)).toBeUndefined();
  });

  it('should_never_read_past_the_end', () => {
    // aria2 can briefly report a completed length above the total on the last
    // piece; a 103% bar is how people learn to distrust a bar
    expect(DownloadProgress.of(1100, 1000)?.percent).toBe(100);
  });

  it('should_round_to_something_a_person_reads_rather_than_computes', () => {
    expect(DownloadProgress.of(333, 1000)?.percent).toBe(33);
  });
});
