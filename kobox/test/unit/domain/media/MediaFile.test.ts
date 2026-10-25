import { describe, expect, it } from 'vitest';
import { MediaFile, MediaPath } from '../../../../src/domain/media/MediaFile.js';
import { Username } from '../../../../src/domain/user/Username.js';

function file(name: string): MediaFile {
  return MediaFile.record({
    username: Username.parse('alice'),
    path: MediaPath.parse(`films/${name}`),
    sizeBytes: 1,
    indexedAt: '2026-10-25 12:00:00',
  });
}

describe('how a downloaded file can be watched', () => {
  it.each(['a.mp4', 'a.M4V', 'a.webm', 'a.ogv'])('should_play_%s_in_the_browser', (name) => {
    expect(file(name).playback).toBe('in-browser');
  });

  // browsers do not open these containers (nor, mostly, their AC3 sound): a
  // player would show a black rectangle, so the page says to download them
  it.each(['a.mkv', 'a.avi', 'a.ts', 'a.mov', 'a.wmv'])('should_offer_%s_to_download', (name) => {
    expect(file(name).playback).toBe('download-only');
  });

  it.each(['a.nfo', 'a.srt', 'a', 'a.zip'])('should_not_take_%s_for_a_video', (name) => {
    expect(file(name).playback).toBe('not-a-video');
  });
});
