import crypto from "node:crypto";
import { timingSafeEqualString } from "./middleware/security.js";

export function signPacUrlParams(
  profileId: string,
  secret: string,
  expiresInSec: number = 86400
): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const data = `${profileId}.${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return { exp, sig };
}

export function verifyPacUrlParams(
  profileId: string,
  expStr: string,
  sig: string,
  secret: string
): { valid: boolean; reason?: string } {
  if (!expStr || !sig) {
    return { valid: false, reason: "MISSING_SIGNATURE_OR_EXPIRY" };
  }
  const exp = parseInt(expStr, 10);
  if (isNaN(exp)) {
    return { valid: false, reason: "INVALID_EXPIRATION" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (now > exp) {
    return { valid: false, reason: "EXPIRED" };
  }
  const expectedSig = crypto.createHmac("sha256", secret).update(`${profileId}.${exp}`).digest("hex");
  if (!timingSafeEqualString(sig, expectedSig)) {
    return { valid: false, reason: "INVALID_SIGNATURE" };
  }
  return { valid: true };
}
