import { describe, expect, it } from 'vitest';
import { testing } from './fetch-remote';

const { isPrivateAddress, parseIpv6 } = testing;

describe('isPrivateAddress', () => {
  it('blocks IPv4 ranges that are not public internet destinations', () => {
    for (const ip of [
      '0.0.0.0',
      '10.1.2.3',
      '127.0.0.1',
      '100.64.0.1',
      '169.254.169.254', // cloud instance metadata
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '93.184.216.34']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('blocks IPv6 loopback, unique-local, link-local and multicast', () => {
    for (const ip of ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('applies the IPv4 rules to IPv4-mapped addresses', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('allows public IPv6', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('blocks anything it cannot parse', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });
});

describe('parseIpv6', () => {
  it('expands compressed forms to 16 bytes', () => {
    expect(parseIpv6('::1')).toEqual([...new Array(15).fill(0), 1]);
    expect(parseIpv6('2001:db8::1')).toEqual([
      0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it('expands a full-length address', () => {
    expect(parseIpv6('2606:4700:4700:0000:0000:0000:0000:1111')).toEqual([
      0x26, 0x06, 0x47, 0x00, 0x47, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0x11, 0x11,
    ]);
  });

  it('handles a trailing dotted quad', () => {
    expect(parseIpv6('::ffff:192.168.0.1')).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 192, 168, 0, 1,
    ]);
  });

  it('rejects malformed literals', () => {
    expect(parseIpv6('2001::db8::1')).toBeNull();
    expect(parseIpv6('gggg::1')).toBeNull();
    expect(parseIpv6('2001:db8:1')).toBeNull();
  });
});
