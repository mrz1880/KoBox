import { describe, expect, it } from 'vitest';
import { DirectUrl } from '../../../../src/domain/ddl/DirectUrl.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { DownloadGid } from '../../../../src/domain/ddl/DownloadGid.js';
import { FilehosterLink } from '../../../../src/domain/ddl/FilehosterLink.js';

describe('FilehosterLink', () => {
  it('should_accept_an_http_or_https_link', () => {
    expect(FilehosterLink.parse('https://1fichier.example/abc').value).toBe(
      'https://1fichier.example/abc',
    );
    expect(FilehosterLink.parse('http://host.example/f/xyz').value).toBe('http://host.example/f/xyz');
  });

  it('should_reject_a_non_url', () => {
    expect(() => FilehosterLink.parse('not a url')).toThrow();
  });

  it('should_reject_a_non_http_scheme', () => {
    expect(() => FilehosterLink.parse('ftp://host.example/f')).toThrow();
  });
});

describe('DirectUrl', () => {
  it('should_accept_an_https_url', () => {
    expect(DirectUrl.parse('https://cdn.example/file.mkv').value).toBe('https://cdn.example/file.mkv');
  });

  it('should_accept_a_plain_http_url', () => {
    // AllDebrid's docs show http direct links; rejecting them would fail real unlocks
    expect(DirectUrl.parse('http://cdn.example/file.mkv').value).toBe('http://cdn.example/file.mkv');
  });

  it('should_reject_a_non_http_scheme', () => {
    expect(() => DirectUrl.parse('ftp://cdn.example/file.mkv')).toThrow();
  });
});

describe('Label', () => {
  it('should_parse_the_known_categories', () => {
    expect(Label.parse('films').value).toBe('films');
    expect(Label.parse('series').value).toBe('series');
  });

  it('should_accept_any_folder_the_member_actually_has', () => {
    // the closed films|series enum is gone: a member syncs whatever folders
    // they created, and must be able to download into the same ones
    expect(Label.parse('Divers').value).toBe('Divers');
    expect(Label.parse('Documentaires').value).toBe('Documentaires');
  });
});

describe('DownloadGid', () => {
  it('should_accept_a_16_hex_aria2_gid', () => {
    expect(DownloadGid.parse('2089b05ecca3d829').value).toBe('2089b05ecca3d829');
  });

  it('should_reject_a_malformed_gid', () => {
    expect(() => DownloadGid.parse('nothex')).toThrow();
    expect(() => DownloadGid.parse('2089b05ecca3d8')).toThrow();
  });
});
