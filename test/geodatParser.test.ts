import test from "node:test";
import assert from "node:assert/strict";
import { parseGeoSite, parseGeoIp, parsePlaintextList } from "../src/geodata/datParser.js";

// Helper to write a protobuf varint into a buffer
function encodeVarint(val: number): Buffer {
  const bytes: number[] = [];
  let current = val;
  while (current > 0x7f) {
    bytes.push((current & 0x7f) | 0x80);
    current >>>= 7;
  }
  bytes.push(current & 0x7f);
  return Buffer.from(bytes);
}

// Helper to encode length-delimited field (tag wire_type 2)
function encodeLengthDelimited(fieldNum: number, data: Buffer): Buffer {
  const tag = (fieldNum << 3) | 2;
  return Buffer.concat([encodeVarint(tag), encodeVarint(data.length), data]);
}

test("parsePlaintextList trims, ignores comments and empty lines", () => {
  const text = `
    # Comment line
    // Another comment line
    yandex.ru
    *.google.com # inline comment
    
    192.168.1.0/24
    sub.domain.org # another inline comment
  `;
  const result = parsePlaintextList(text);
  assert.deepEqual(result, ["yandex.ru", "*.google.com", "192.168.1.0/24", "sub.domain.org"]);
});

test("parsePlaintextList handles empty, null or undefined input gracefully", () => {
  assert.deepEqual(parsePlaintextList(""), []);
  assert.deepEqual(parsePlaintextList(null as any), []);
  assert.deepEqual(parsePlaintextList(undefined as any), []);
  assert.deepEqual(parsePlaintextList("   \n# all comments\n   "), []);
});

test("parseGeoSite correctly parses synthesized GeoSiteList protobuf buffer with all domain types", () => {
  // Domain 1: Plain (0) -> example.com
  const domain1 = Buffer.concat([
    encodeVarint((1 << 3) | 0), // type = 0 (Plain)
    encodeVarint(0),
    encodeLengthDelimited(2, Buffer.from("example.com", "utf-8")),
  ]);

  // Domain 2: Regex (1) -> ^.*\\.org$
  const domain2 = Buffer.concat([
    encodeVarint((1 << 3) | 0), // type = 1 (Regex)
    encodeVarint(1),
    encodeLengthDelimited(2, Buffer.from("^.*\\.org$", "utf-8")),
  ]);

  // Domain 3: RootDomain (2) -> google.com
  const domain3 = Buffer.concat([
    encodeVarint((1 << 3) | 0), // type = 2 (RootDomain)
    encodeVarint(2),
    encodeLengthDelimited(2, Buffer.from("google.com", "utf-8")),
  ]);

  // Domain 4: Full (3) -> full.match.net
  const domain4 = Buffer.concat([
    encodeVarint((1 << 3) | 0), // type = 3 (Full)
    encodeVarint(3),
    encodeLengthDelimited(2, Buffer.from("full.match.net", "utf-8")),
  ]);

  // GeoSite 1: lowercase tag 'ru' (should normalize to uppercase 'RU')
  const geoSite1 = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from("ru", "utf-8")),
    encodeLengthDelimited(2, domain1),
    encodeLengthDelimited(2, domain2),
  ]);

  // GeoSite 2: tag 'google'
  const geoSite2 = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from("google", "utf-8")),
    encodeLengthDelimited(2, domain3),
    encodeLengthDelimited(2, domain4),
  ]);

  // GeoSiteList containing both sites
  const geoSiteList = Buffer.concat([
    encodeLengthDelimited(1, geoSite1),
    encodeLengthDelimited(1, geoSite2),
  ]);

  const parsed = parseGeoSite(geoSiteList);
  assert.equal(parsed.size, 2);

  // Check RU
  assert.ok(parsed.has("RU"), "Must normalize tag to uppercase RU");
  const ruSite = parsed.get("RU")!;
  assert.equal(ruSite.tag, "RU");
  assert.equal(ruSite.domains.length, 2);
  assert.deepEqual(ruSite.domains[0], { type: "Plain", value: "example.com" });
  assert.deepEqual(ruSite.domains[1], { type: "Regex", value: "^.*\\.org$" });

  // Check GOOGLE
  assert.ok(parsed.has("GOOGLE"), "Must normalize tag to uppercase GOOGLE");
  const googleSite = parsed.get("GOOGLE")!;
  assert.equal(googleSite.tag, "GOOGLE");
  assert.equal(googleSite.domains.length, 2);
  assert.deepEqual(googleSite.domains[0], { type: "RootDomain", value: "google.com" });
  assert.deepEqual(googleSite.domains[1], { type: "Full", value: "full.match.net" });
});

test("parseGeoIp correctly parses synthesized GeoIPList protobuf buffer with IPv4 and IPv6", () => {
  // CIDR 1: IPv4 192.168.1.0/24
  const ip4Bytes = Buffer.from([192, 168, 1, 0]);
  const cidr1 = Buffer.concat([
    encodeLengthDelimited(1, ip4Bytes),
    encodeVarint((2 << 3) | 0), // prefix tag
    encodeVarint(24),
  ]);

  // CIDR 2: IPv6 2001:db8::/32
  const ip6Bytes = Buffer.from([
    0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0
  ]);
  const cidr2 = Buffer.concat([
    encodeLengthDelimited(1, ip6Bytes),
    encodeVarint((2 << 3) | 0),
    encodeVarint(32),
  ]);

  // GeoIP: country_code = 'ru'
  const geoIpMsg = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from("ru", "utf-8")),
    encodeLengthDelimited(2, cidr1),
    encodeLengthDelimited(2, cidr2),
  ]);

  const geoIpList = encodeLengthDelimited(1, geoIpMsg);
  const parsed = parseGeoIp(geoIpList);

  assert.ok(parsed.has("RU"), "Must contain normalized uppercase RU code");
  const ruIp = parsed.get("RU")!;
  assert.equal(ruIp.countryCode, "RU");
  assert.equal(ruIp.cidrs.length, 2);
  assert.deepEqual(ruIp.cidrs[0], { ip: "192.168.1.0", prefix: 24 });
  assert.deepEqual(ruIp.cidrs[1], { ip: "2001:db8::", prefix: 32 });
});

test("parseGeoSite handles empty, non-buffer, and corrupted inputs without throwing", () => {
  assert.equal(parseGeoSite(null as any).size, 0);
  assert.equal(parseGeoSite(undefined as any).size, 0);
  assert.equal(parseGeoSite(Buffer.alloc(0)).size, 0);

  // Corrupted buffer: random invalid bytes
  const corrupted = Buffer.from([0xff, 0xff, 0xff, 0x7f, 0x02, 0x10]);
  assert.doesNotThrow(() => {
    const res = parseGeoSite(corrupted);
    assert.ok(res instanceof Map);
  });

  // Truncated buffer: says 100 bytes length but only 2 bytes exist
  const truncated = Buffer.concat([
    encodeVarint((1 << 3) | 2),
    encodeVarint(100),
    Buffer.from([0x01, 0x02]),
  ]);
  assert.doesNotThrow(() => {
    const res = parseGeoSite(truncated);
    assert.ok(res instanceof Map);
  });
});

test("parseGeoIp handles empty, non-buffer, and corrupted inputs without throwing", () => {
  assert.equal(parseGeoIp(null as any).size, 0);
  assert.equal(parseGeoIp(undefined as any).size, 0);
  assert.equal(parseGeoIp(Buffer.alloc(0)).size, 0);

  // Truncated buffer
  const truncated = Buffer.concat([
    encodeVarint((1 << 3) | 2),
    encodeVarint(50),
    Buffer.from("invalid truncated"),
  ]);
  assert.doesNotThrow(() => {
    const res = parseGeoIp(truncated);
    assert.ok(res instanceof Map);
  });
});

test("parser safely skips wire types 1 (64-bit) and 5 (32-bit fixed)", () => {
  // Synthesize GeoSite with unknown field 3 (wire 1, 8 bytes) and unknown field 4 (wire 5, 4 bytes)
  const wire1Field = Buffer.concat([
    encodeVarint((3 << 3) | 1), // field 3, wire 1
    Buffer.alloc(8, 0xaa),
  ]);
  const wire5Field = Buffer.concat([
    encodeVarint((4 << 3) | 5), // field 4, wire 5
    Buffer.alloc(4, 0xbb),
  ]);

  const domain = Buffer.concat([
    wire1Field,
    encodeVarint((1 << 3) | 0),
    encodeVarint(0), // Plain
    wire5Field,
    encodeLengthDelimited(2, Buffer.from("skip-test.com", "utf-8")),
  ]);

  const geoSite = Buffer.concat([
    wire5Field,
    encodeLengthDelimited(1, Buffer.from("TEST", "utf-8")),
    wire1Field,
    encodeLengthDelimited(2, domain),
  ]);

  const list = encodeLengthDelimited(1, geoSite);
  const parsed = parseGeoSite(list);

  assert.ok(parsed.has("TEST"));
  assert.equal(parsed.get("TEST")!.domains.length, 1);
  assert.equal(parsed.get("TEST")!.domains[0].value, "skip-test.com");
});

test("parser merges multiple GeoSite and GeoIP entries with identical tags", () => {
  // Two GeoSite entries for "RU"
  const d1 = Buffer.concat([
    encodeVarint((1 << 3) | 0), encodeVarint(0),
    encodeLengthDelimited(2, Buffer.from("site1.ru", "utf-8")),
  ]);
  const s1 = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from("RU", "utf-8")),
    encodeLengthDelimited(2, d1),
  ]);

  const d2 = Buffer.concat([
    encodeVarint((1 << 3) | 0), encodeVarint(0),
    encodeLengthDelimited(2, Buffer.from("site2.ru", "utf-8")),
  ]);
  const s2 = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from("ru", "utf-8")), // lowercase ru
    encodeLengthDelimited(2, d2),
  ]);

  const siteList = Buffer.concat([
    encodeLengthDelimited(1, s1),
    encodeLengthDelimited(1, s2),
  ]);

  const parsedSites = parseGeoSite(siteList);
  assert.equal(parsedSites.size, 1);
  assert.equal(parsedSites.get("RU")!.domains.length, 2);

  // Two GeoIP entries for "US"
  const c1 = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from([1, 1, 1, 1])),
    encodeVarint((2 << 3) | 0), encodeVarint(32),
  ]);
  const ip1 = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from("US", "utf-8")),
    encodeLengthDelimited(2, c1),
  ]);

  const c2 = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from([8, 8, 8, 8])),
    encodeVarint((2 << 3) | 0), encodeVarint(32),
  ]);
  const ip2 = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from("us", "utf-8")),
    encodeLengthDelimited(2, c2),
  ]);

  const ipList = Buffer.concat([
    encodeLengthDelimited(1, ip1),
    encodeLengthDelimited(1, ip2),
  ]);

  const parsedIps = parseGeoIp(ipList);
  assert.equal(parsedIps.size, 1);
  assert.equal(parsedIps.get("US")!.cidrs.length, 2);
});

test("parseGeoIp handles IPv6 edge cases and default prefixes", () => {
  // IPv6 loopback ::1 with default prefix (should default to 128)
  const loopbackBytes = Buffer.alloc(16, 0);
  loopbackBytes[15] = 1;

  const cidrLoopback = encodeLengthDelimited(1, loopbackBytes); // no prefix field provided

  // IPv4 10.0.0.1 with default prefix (should default to 32)
  const ip4Bytes = Buffer.from([10, 0, 0, 1]);
  const cidrIp4 = encodeLengthDelimited(1, ip4Bytes);

  const geoIpMsg = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from("LOCAL", "utf-8")),
    encodeLengthDelimited(2, cidrLoopback),
    encodeLengthDelimited(2, cidrIp4),
  ]);

  const parsed = parseGeoIp(encodeLengthDelimited(1, geoIpMsg));
  assert.ok(parsed.has("LOCAL"));
  const local = parsed.get("LOCAL")!;
  assert.equal(local.cidrs.length, 2);
  assert.equal(local.cidrs[0].ip, "::1");
  assert.equal(local.cidrs[0].prefix, 128);
  assert.equal(local.cidrs[1].ip, "10.0.0.1");
  assert.equal(local.cidrs[1].prefix, 32);
});
