/**
 * Utility for semantic version comparison adhering to SemVer 2.0.0 specification.
 */

function parseVersion(v: string): { parts: number[]; pre?: string[] } {
  const clean = String(v || "").trim().replace(/^[vV]/, "");
  // SemVer 2.0.0: Build metadata MUST be ignored when determining version precedence
  const withoutBuild = clean.split("+")[0];
  const [base, ...preRest] = withoutBuild.split("-");
  const preRaw = preRest.join("-").trim();
  const parts = base.split(".").map((n) => {
    const num = parseInt(n, 10);
    return isNaN(num) ? 0 : num;
  });
  const pre = preRaw ? preRaw.split(".").filter(Boolean) : undefined;
  return { parts, pre };
}

/**
 * Compare two semver strings (v1, v2) adhering to SemVer 2.0.0 precedence rules.
 * Returns:
 *   1 if v1 > v2 (v1 is newer)
 *  -1 if v1 < v2 (v2 is newer)
 *   0 if v1 === v2
 */
export function compareSemver(v1: string, v2: string): number {
  const p1 = parseVersion(v1);
  const p2 = parseVersion(v2);

  const maxLen = Math.max(p1.parts.length, p2.parts.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const num1 = p1.parts[i] || 0;
    const num2 = p2.parts[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  // Pre-release versions have lower precedence than normal versions (Item 9)
  if (!p1.pre && p2.pre) return 1;
  if (p1.pre && !p2.pre) return -1;

  // Both have pre-release versions (Item 11)
  if (p1.pre && p2.pre) {
    const minPreLen = Math.min(p1.pre.length, p2.pre.length);
    for (let i = 0; i < minPreLen; i++) {
      const id1 = p1.pre[i];
      const id2 = p2.pre[i];
      if (id1 === id2) continue;

      const isNum1 = /^\d+$/.test(id1);
      const isNum2 = /^\d+$/.test(id2);

      // Identifiers consisting of only digits are compared numerically
      if (isNum1 && isNum2) {
        const n1 = parseInt(id1, 10);
        const n2 = parseInt(id2, 10);
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
      } else if (isNum1 && !isNum2) {
        // Numeric identifiers always have lower precedence than non-numeric
        return -1;
      } else if (!isNum1 && isNum2) {
        return 1;
      } else {
        // Identifiers with letters or hyphens are compared lexically in ASCII sort order
        if (id1 > id2) return 1;
        if (id1 < id2) return -1;
      }
    }
    // A larger set of pre-release fields has a higher precedence than a smaller set
    if (p1.pre.length > p2.pre.length) return 1;
    if (p1.pre.length < p2.pre.length) return -1;
  }

  return 0;
}

/**
 * Returns true if `candidate` is strictly newer than `current`.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  if (!candidate || !candidate.trim()) return false;
  if (!current || !current.trim()) return true;
  return compareSemver(candidate, current) > 0;
}
