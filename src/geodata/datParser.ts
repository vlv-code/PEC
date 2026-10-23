/**
 * Pure TypeScript Protobuf Wire Format Decoder & Geodata Subsystem
 *
 * Implements decoding for:
 * - geosite.dat (GeoSiteList -> GeoSite -> Domain)
 * - geoip.dat (GeoIPList -> GeoIP -> CIDR)
 * - Plaintext domain/CIDR lists (.txt, .list)
 *
 * No external dependencies (no protobufjs, no grpc, no external binaries).
 */

export interface GeoSiteDomain {
  type: string;
  value: string;
}

export interface GeoSiteEntry {
  tag: string;
  domains: GeoSiteDomain[];
}

export interface GeoIpCidr {
  ip: string;
  prefix: number;
}

export interface GeoIpEntry {
  countryCode: string;
  cidrs: GeoIpCidr[];
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * Reads a protobuf varint from buf starting at offset up to maxOffset.
 * Uses arithmetic to avoid 32-bit bitwise overflow for large varints.
 */
function readVarint(
  buf: Uint8Array,
  offset: number,
  maxOffset: number
): { value: number; newOffset: number } | null {
  let result = 0;
  let multiplier = 1;
  let cur = offset;
  let count = 0;

  while (cur < maxOffset && cur < buf.length) {
    const byte = buf[cur++];
    count++;
    result += (byte & 0x7f) * multiplier;
    multiplier *= 128;

    if ((byte & 0x80) === 0) {
      return { value: result, newOffset: cur };
    }
    if (count >= 10) {
      // Protobuf varints are at most 10 bytes
      return null;
    }
  }
  return null;
}

interface DecodedField {
  fieldNumber: number;
  wireType: number;
  varint?: number;
  data?: Uint8Array;
}

/**
 * Generator yielding protobuf fields from a buffer slice.
 * Defensively skips wire types 1 (64-bit) and 5 (32-bit),
 * and terminates safely on truncated data or unknown wire types.
 */
function* readFields(buf: Uint8Array, start: number, end: number): Generator<DecodedField> {
  let cur = start;
  const max = Math.min(end, buf.length);

  while (cur < max) {
    const tagRes = readVarint(buf, cur, max);
    if (!tagRes || tagRes.newOffset <= cur) {
      break;
    }
    cur = tagRes.newOffset;
    const tag = tagRes.value;
    const wireType = tag & 0x07;
    const fieldNumber = Math.floor(tag / 8);

    if (fieldNumber === 0) {
      break;
    }

    if (wireType === 0) {
      // Varint
      const valRes = readVarint(buf, cur, max);
      if (!valRes || valRes.newOffset <= cur) {
        break;
      }
      cur = valRes.newOffset;
      yield { fieldNumber, wireType, varint: valRes.value };
    } else if (wireType === 2) {
      // Length-delimited
      const lenRes = readVarint(buf, cur, max);
      if (!lenRes || lenRes.newOffset <= cur) {
        break;
      }
      cur = lenRes.newOffset;
      const length = lenRes.value;
      if (length < 0 || cur + length > max) {
        break;
      }
      const data = buf.subarray(cur, cur + length);
      cur += length;
      yield { fieldNumber, wireType, data };
    } else if (wireType === 1) {
      // 64-bit fixed
      if (cur + 8 > max) break;
      cur += 8;
    } else if (wireType === 5) {
      // 32-bit fixed
      if (cur + 4 > max) break;
      cur += 4;
    } else {
      // Unknown wire type or deprecated group (wire 3/4)
      break;
    }
  }
}

/**
 * Formats a 4-byte buffer slice as an IPv4 dot-decimal string.
 */
function formatIpv4(bytes: Uint8Array): string {
  if (bytes.length !== 4) return "";
  return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
}

/**
 * Formats a 16-byte buffer slice as an RFC 5952 canonical IPv6 string with :: compression.
 */
function formatIpv6(bytes: Uint8Array): string {
  if (bytes.length !== 16) return "";
  const words: number[] = [];
  for (let i = 0; i < 16; i += 2) {
    words.push((bytes[i] << 8) | bytes[i + 1]);
  }

  // Find longest run of consecutive 0s
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < words.length; i++) {
    if (words[i] === 0) {
      if (curStart === -1) {
        curStart = i;
        curLen = 1;
      } else {
        curLen++;
      }
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen >= 2) {
    const left = words.slice(0, bestStart).map((w) => w.toString(16)).join(":");
    const right = words.slice(bestStart + bestLen).map((w) => w.toString(16)).join(":");
    if (!left && !right) {
      return "::";
    }
    if (!left) {
      return `::${right}`;
    }
    if (!right) {
      return `${left}::`;
    }
    return `${left}::${right}`;
  }

  return words.map((w) => w.toString(16)).join(":");
}

/**
 * Maps geosite.dat protobuf Domain.Type enum value to domain type string.
 * 0 = Plain, 1 = Regex, 2 = RootDomain, 3 = Full
 */
function mapDomainType(type: number): string {
  switch (type) {
    case 0:
      return "Plain";
    case 1:
      return "Regex";
    case 2:
      return "RootDomain";
    case 3:
      return "Full";
    default:
      return "Plain";
  }
}

/**
 * Parses a binary geosite.dat buffer into a Map of uppercase tags to GeoSite entries.
 */
export function parseGeoSite(buffer: Buffer): Map<string, GeoSiteEntry> {
  const result = new Map<string, GeoSiteEntry>();
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return result;
  }

  try {
    for (const field of readFields(buffer, 0, buffer.length)) {
      if (field.fieldNumber === 1 && field.wireType === 2 && field.data) {
        // GeoSiteList entry = GeoSite message
        let countryCode = "";
        const domains: GeoSiteDomain[] = [];

        for (const siteField of readFields(field.data, 0, field.data.length)) {
          if (siteField.fieldNumber === 1 && siteField.wireType === 2 && siteField.data) {
            countryCode = utf8Decoder.decode(siteField.data).trim();
          } else if (siteField.fieldNumber === 2 && siteField.wireType === 2 && siteField.data) {
            // Domain message
            let domainType = 0;
            let domainValue = "";

            for (const domainField of readFields(siteField.data, 0, siteField.data.length)) {
              if (
                domainField.fieldNumber === 1 &&
                domainField.wireType === 0 &&
                domainField.varint !== undefined
              ) {
                domainType = domainField.varint;
              } else if (
                domainField.fieldNumber === 2 &&
                domainField.wireType === 2 &&
                domainField.data
              ) {
                domainValue = utf8Decoder.decode(domainField.data).trim();
              }
            }

            if (domainValue) {
              domains.push({
                type: mapDomainType(domainType),
                value: domainValue,
              });
            }
          }
        }

        if (countryCode) {
          const tag = countryCode.toUpperCase();
          const existing = result.get(tag);
          if (existing) {
            existing.domains.push(...domains);
          } else {
            result.set(tag, { tag, domains });
          }
        }
      }
    }
  } catch {
    // Corrupted or truncated buffer: return whatever was safely parsed
  }

  return result;
}

/**
 * Parses a binary geoip.dat buffer into a Map of uppercase country codes to GeoIP entries.
 */
export function parseGeoIp(buffer: Buffer): Map<string, GeoIpEntry> {
  const result = new Map<string, GeoIpEntry>();
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return result;
  }

  try {
    for (const field of readFields(buffer, 0, buffer.length)) {
      if (field.fieldNumber === 1 && field.wireType === 2 && field.data) {
        // GeoIPList entry = GeoIP message
        let countryCode = "";
        const cidrs: GeoIpCidr[] = [];

        for (const ipField of readFields(field.data, 0, field.data.length)) {
          if (ipField.fieldNumber === 1 && ipField.wireType === 2 && ipField.data) {
            countryCode = utf8Decoder.decode(ipField.data).trim();
          } else if (ipField.fieldNumber === 2 && ipField.wireType === 2 && ipField.data) {
            // CIDR message
            let rawIp: Uint8Array | null = null;
            let prefix = 0;
            let hasPrefix = false;

            for (const cidrField of readFields(ipField.data, 0, ipField.data.length)) {
              if (cidrField.fieldNumber === 1 && cidrField.wireType === 2 && cidrField.data) {
                rawIp = cidrField.data;
              } else if (
                cidrField.fieldNumber === 2 &&
                cidrField.wireType === 0 &&
                cidrField.varint !== undefined
              ) {
                prefix = cidrField.varint;
                hasPrefix = true;
              }
            }

            if (rawIp) {
              let ipStr = "";
              if (rawIp.length === 4) {
                ipStr = formatIpv4(rawIp);
                if (!hasPrefix) prefix = 32;
              } else if (rawIp.length === 16) {
                ipStr = formatIpv6(rawIp);
                if (!hasPrefix) prefix = 128;
              }

              if (ipStr) {
                cidrs.push({ ip: ipStr, prefix });
              }
            }
          }
        }

        if (countryCode) {
          const codeUpper = countryCode.toUpperCase();
          const existing = result.get(codeUpper);
          if (existing) {
            existing.cidrs.push(...cidrs);
          } else {
            result.set(codeUpper, { countryCode: codeUpper, cidrs });
          }
        }
      }
    }
  } catch {
    // Corrupted or truncated buffer: return whatever was safely parsed
  }

  return result;
}

/**
 * Parses a plaintext list of domains or CIDRs.
 * Trims whitespace, removes lines starting with '#' or '//',
 * strips trailing '# inline comments', and filters out empty lines.
 */
export function parsePlaintextList(content: string): string[] {
  if (!content || typeof content !== "string") {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const result: string[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("//")) continue;

    const hashIdx = line.indexOf("#");
    if (hashIdx !== -1) {
      line = line.slice(0, hashIdx).trim();
    }
    if (!line) continue;

    result.push(line);
  }

  return result;
}
