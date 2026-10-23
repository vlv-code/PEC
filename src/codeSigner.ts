import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import child_process from "node:child_process";

export interface CertificateMetadata {
  hasCertificate: boolean;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  thumbprint?: string;
  type: "commercial" | "internal";
  timestampUrl?: string;
}

interface StoredCertificateConfig extends CertificateMetadata {
  encryptedPassword?: string;
  iv?: string;
  tag?: string;
}

const CERTS_DIR = process.env.CODE_SIGN_DIR
  ? path.resolve(process.env.CODE_SIGN_DIR)
  : path.resolve("./data/certs");

const PFX_PATH = process.env.CODE_SIGN_PFX_PATH
  ? path.resolve(process.env.CODE_SIGN_PFX_PATH)
  : path.join(CERTS_DIR, "code_signing.pfx");

const CONFIG_PATH = path.join(CERTS_DIR, "code_signing.json");

function getEncryptionKey(): Buffer {
  const masterSecret = process.env.ADMIN_TOKEN || "pec-default-code-sign-master-key-seed";
  return crypto.createHash("sha256").update(masterSecret).digest();
}

function encryptPassword(password: string): { encryptedPassword: string; iv: string; tag: string } {
  if (!password) {
    return { encryptedPassword: "", iv: "", tag: "" };
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(password, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag().toString("base64");
  return {
    encryptedPassword: encrypted,
    iv: iv.toString("base64"),
    tag,
  };
}

function decryptPassword(config: StoredCertificateConfig): string {
  if (!config.encryptedPassword || !config.iv || !config.tag) {
    return "";
  }
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(config.iv, "base64");
    const tag = Buffer.from(config.tag, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(config.encryptedPassword, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.warn("[CodeSign] Failed to decrypt certificate password:", err);
    return "";
  }
}

export function extractCertificateMetadata(
  pfxBuffer: Buffer,
  password = ""
): {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  thumbprint: string;
} {
  // Strategy 1: Search for embedded DER X.509 certificate and parse with Node.js crypto.X509Certificate
  try {
    // In PKCS#12, an unencrypted certBag contains the DER X.509 certificate.
    // Common sequence starts with 30 82 .. .. 30 82 (Certificate sequence)
    // We scan for SEQUENCE tag and try constructing X509Certificate
    for (let i = 0; i < pfxBuffer.length - 100; i++) {
      if (pfxBuffer[i] === 0x30 && pfxBuffer[i + 1] === 0x82) {
        const len = (pfxBuffer[i + 2] << 8) | pfxBuffer[i + 3];
        const totalLen = len + 4;
        if (totalLen <= pfxBuffer.length - i && totalLen > 200) {
          try {
            const candidate = pfxBuffer.subarray(i, i + totalLen);
            const x509 = new crypto.X509Certificate(candidate);
            if (x509.subject) {
              return {
                subject: x509.subject,
                issuer: x509.issuer,
                validFrom: x509.validFrom,
                validTo: x509.validTo,
                thumbprint: x509.fingerprint256.replace(/:/g, "").toUpperCase(),
              };
            }
          } catch {}
        }
      }
    }
  } catch {}

  // Strategy 2: If openssl CLI is available (standard on Linux/Docker)
  try {
    const tmpPfx = path.join(CERTS_DIR, `tmp_${Date.now()}.pfx`);
    if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });
    fs.writeFileSync(tmpPfx, pfxBuffer);
    try {
      const out = child_process.execSync(
        `openssl pkcs12 -in "${tmpPfx}" -nodes -passin pass:"${password.replace(/"/g, '\\"')}" -nokeys 2>&1`,
        { windowsHide: true, timeout: 5000 }
      ).toString("utf8");

      const certMatch = out.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
      if (certMatch) {
        const x509 = new crypto.X509Certificate(certMatch[0]);
        return {
          subject: x509.subject,
          issuer: x509.issuer,
          validFrom: x509.validFrom,
          validTo: x509.validTo,
          thumbprint: x509.fingerprint256.replace(/:/g, "").toUpperCase(),
        };
      }
    } finally {
      if (fs.existsSync(tmpPfx)) fs.unlinkSync(tmpPfx);
    }
  } catch {}

  // Strategy 3: On Windows with certutil
  if (process.platform === "win32") {
    try {
      const tmpPfx = path.join(CERTS_DIR, `tmp_${Date.now()}.pfx`);
      if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });
      fs.writeFileSync(tmpPfx, pfxBuffer);
      try {
        const cmd = `certutil -dump -p "${password.replace(/"/g, '""')}" "${tmpPfx}"`;
        const out = child_process.execSync(cmd, { windowsHide: true, timeout: 5000 }).toString("utf8");

        const subjectMatch = out.match(/Subject:\s*([^\r\n]+)/i);
        const issuerMatch = out.match(/Issuer:\s*([^\r\n]+)/i);
        const notAfterMatch = out.match(/NotAfter:\s*([^\r\n]+)/i);
        const notBeforeMatch = out.match(/NotBefore:\s*([^\r\n]+)/i);
        const hashMatch = out.match(/Cert Hash\(sha1\):\s*([a-f0-9\s]+)/i);

        if (subjectMatch || hashMatch) {
          return {
            subject: subjectMatch ? subjectMatch[1].trim() : "Enterprise Code Signing Certificate",
            issuer: issuerMatch ? issuerMatch[1].trim() : "Internal CA",
            validFrom: notBeforeMatch ? notBeforeMatch[1].trim() : new Date().toISOString(),
            validTo: notAfterMatch ? notAfterMatch[1].trim() : new Date(Date.now() + 365 * 86400000).toISOString(),
            thumbprint: hashMatch ? hashMatch[1].replace(/\s+/g, "").toUpperCase() : "",
          };
        }
      } finally {
        if (fs.existsSync(tmpPfx)) fs.unlinkSync(tmpPfx);
      }
    } catch {}
  }

  // Fallback defaults
  const sha256 = crypto.createHash("sha256").update(pfxBuffer).digest("hex").toUpperCase();
  return {
    subject: "Enterprise Code Signing Certificate",
    issuer: "Corporate Certificate Authority",
    validFrom: new Date().toISOString(),
    validTo: new Date(Date.now() + 365 * 86400000).toISOString(),
    thumbprint: sha256,
  };
}

export function saveCertificate(
  pfxBuffer: Buffer,
  password = "",
  type: "commercial" | "internal" = "commercial",
  timestampUrl?: string
): CertificateMetadata {
  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(PFX_PATH, pfxBuffer, { mode: 0o600 });

  const meta = extractCertificateMetadata(pfxBuffer, password);
  const enc = encryptPassword(password);

  const stored: StoredCertificateConfig = {
    hasCertificate: true,
    subject: meta.subject,
    issuer: meta.issuer,
    validFrom: meta.validFrom,
    validTo: meta.validTo,
    thumbprint: meta.thumbprint,
    type,
    timestampUrl: timestampUrl || (type === "commercial" ? "http://timestamp.digicert.com" : ""),
    encryptedPassword: enc.encryptedPassword,
    iv: enc.iv,
    tag: enc.tag,
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2), { mode: 0o600 });

  return getCertificateStatus();
}

export function getCertificateStatus(): CertificateMetadata {
  if (process.env.CODE_SIGN_PFX_PATH && fs.existsSync(process.env.CODE_SIGN_PFX_PATH)) {
    return {
      hasCertificate: true,
      subject: process.env.CODE_SIGN_SUBJECT || "Environment Code Signing Certificate",
      issuer: process.env.CODE_SIGN_ISSUER || "Corporate CA",
      type: (process.env.CODE_SIGN_TYPE as "commercial" | "internal") || "commercial",
      timestampUrl: process.env.CODE_SIGN_TIMESTAMP_URL || "http://timestamp.digicert.com",
    };
  }

  if (fs.existsSync(CONFIG_PATH) && fs.existsSync(PFX_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, "utf8");
      const parsed: StoredCertificateConfig = JSON.parse(raw);
      return {
        hasCertificate: true,
        subject: parsed.subject,
        issuer: parsed.issuer,
        validFrom: parsed.validFrom,
        validTo: parsed.validTo,
        thumbprint: parsed.thumbprint,
        type: parsed.type || "commercial",
        timestampUrl: parsed.timestampUrl,
      };
    } catch {}
  }

  return {
    hasCertificate: false,
    type: "commercial",
  };
}

export function deleteCertificate(): boolean {
  let removed = false;
  if (fs.existsSync(PFX_PATH)) {
    try {
      fs.unlinkSync(PFX_PATH);
      removed = true;
    } catch {}
  }
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      fs.unlinkSync(CONFIG_PATH);
      removed = true;
    } catch {}
  }
  return removed;
}

export function signBinary(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const status = getCertificateStatus();
  if (!status.hasCertificate) {
    return false;
  }

  let pfxFile = PFX_PATH;
  let password = "";
  let tsUrl = status.timestampUrl || "";

  if (process.env.CODE_SIGN_PFX_PATH && fs.existsSync(process.env.CODE_SIGN_PFX_PATH)) {
    pfxFile = process.env.CODE_SIGN_PFX_PATH;
    password = process.env.CODE_SIGN_PASSWORD || "";
  } else if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, "utf8");
      const parsed: StoredCertificateConfig = JSON.parse(raw);
      password = decryptPassword(parsed);
      if (parsed.timestampUrl !== undefined) {
        tsUrl = parsed.timestampUrl;
      }
    } catch {}
  }

  const isWin = process.platform === "win32";

  // Check for osslsigncode (Linux / Docker or Windows)
  let hasOsslsigncode = false;
  try {
    child_process.execSync("osslsigncode --version", { windowsHide: true, stdio: "ignore" });
    hasOsslsigncode = true;
  } catch {}

  // Check for signtool (Windows)
  let hasSigntool = false;
  if (isWin) {
    try {
      child_process.execSync("signtool.exe /?", { windowsHide: true, stdio: "ignore" });
      hasSigntool = true;
    } catch {}
  }

  if (!hasOsslsigncode && !hasSigntool) {
    console.warn(
      `[CodeSign] Neither osslsigncode nor signtool.exe is installed. Skipping signing for: ${path.basename(targetPath)}`
    );
    return false;
  }

  try {
    if (hasOsslsigncode) {
      const signedTmp = `${targetPath}.signed`;
      const tsArgs = tsUrl ? `-ts "${tsUrl}"` : "";
      const passArgs = password ? `-pass "${password.replace(/"/g, '\\"')}"` : "";
      const cmd = `osslsigncode sign -pkcs12 "${pfxFile}" ${passArgs} -h sha256 ${tsArgs} -in "${targetPath}" -out "${signedTmp}"`;
      child_process.execSync(cmd, { windowsHide: true, stdio: "pipe" });
      if (fs.existsSync(signedTmp) && fs.statSync(signedTmp).size > 0) {
        fs.copyFileSync(signedTmp, targetPath);
        fs.unlinkSync(signedTmp);
        return true;
      }
    } else if (hasSigntool) {
      const tsArgs = tsUrl ? `/tr "${tsUrl}" /td sha256` : "";
      const passArgs = password ? `/p "${password.replace(/"/g, '""')}"` : "";
      const cmd = `signtool.exe sign /f "${pfxFile}" ${passArgs} /fd sha256 ${tsArgs} "${targetPath}"`;
      child_process.execSync(cmd, { windowsHide: true, stdio: "pipe" });
      return true;
    }
  } catch (err: any) {
    console.warn(`[CodeSign] Failed to sign ${path.basename(targetPath)}:`, err?.message || err);
    return false;
  }

  return false;
}
