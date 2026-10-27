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

export function getCertsDir(): string {
  return process.env.CODE_SIGN_DIR
    ? path.resolve(process.env.CODE_SIGN_DIR)
    : path.resolve("./data/certs");
}

export function getPfxPath(): string {
  return process.env.CODE_SIGN_PFX_PATH
    ? path.resolve(process.env.CODE_SIGN_PFX_PATH)
    : path.join(getCertsDir(), "code_signing.pfx");
}

export function getConfigPath(): string {
  return path.join(getCertsDir(), "code_signing.json");
}

export const CERTS_DIR = getCertsDir();
export const PFX_PATH = getPfxPath();
export const CONFIG_PATH = getConfigPath();

export function getEncryptionKey(): Buffer {
  if (process.env.CODE_SIGN_MASTER_KEY && process.env.CODE_SIGN_MASTER_KEY.trim().length > 0) {
    return crypto.createHash("sha256").update(process.env.CODE_SIGN_MASTER_KEY).digest();
  }

  const certsDir = getCertsDir();
  const keyPath = path.join(certsDir, ".code_sign_master_key");

  if (fs.existsSync(keyPath)) {
    try {
      const existing = fs.readFileSync(keyPath);
      if (existing.length === 32) {
        return existing;
      }
      if (existing.length > 0) {
        return crypto.createHash("sha256").update(existing).digest();
      }
      throw new Error("Master key file is empty (0 bytes)");
    } catch (err) {
      throw new Error(`[CodeSign] Failed to read existing master key file at ${keyPath}: ${err}`);
    }
  }

  // Generate a new 32-byte secret and store with mode 0o600
  try {
    if (!fs.existsSync(certsDir)) {
      fs.mkdirSync(certsDir, { recursive: true, mode: 0o700 });
    }
    const secret = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, secret, { mode: 0o600 });
    return secret;
  } catch (err) {
    throw new Error(`[CodeSign] Failed to generate/store master key at ${keyPath}: ${err}`);
  }
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
    const certsDir = getCertsDir();
    const randomSuffix = crypto.randomBytes(8).toString("hex");
    const tmpPfx = path.join(certsDir, `tmp_${Date.now()}_${randomSuffix}.pfx`);
    if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmpPfx, pfxBuffer, { mode: 0o600 });
    try {
      const out = child_process.execFileSync(
        "openssl",
        ["pkcs12", "-in", tmpPfx, "-nodes", "-passin", "env:PFX_PASS", "-nokeys"],
        {
          windowsHide: true,
          timeout: 5000,
          env: { ...process.env, PFX_PASS: password },
          stdio: ["ignore", "pipe", "pipe"],
        }
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
      if (fs.existsSync(tmpPfx)) {
        try { fs.unlinkSync(tmpPfx); } catch {}
      }
    }
  } catch {}

  // Strategy 3: On Windows with certutil
  if (process.platform === "win32") {
    let tmpPfx = "";
    let tmpPassFile = "";
    try {
      const certsDir = getCertsDir();
      const randomSuffix = crypto.randomBytes(8).toString("hex");
      if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true, mode: 0o700 });
      tmpPfx = path.join(certsDir, `tmp_${Date.now()}_${randomSuffix}.pfx`);
      fs.writeFileSync(tmpPfx, pfxBuffer, { mode: 0o600 });

      const certutilArgs = ["-dump"];
      if (password) {
        const passSuffix = crypto.randomBytes(8).toString("hex");
        tmpPassFile = path.join(certsDir, `tmp_pass_${Date.now()}_${passSuffix}.txt`);
        fs.writeFileSync(tmpPassFile, password, { mode: 0o600 });
        certutilArgs.push("-p", `@${tmpPassFile}`);
      }
      certutilArgs.push(tmpPfx);

      try {
        const out = child_process.execFileSync(
          "certutil",
          certutilArgs,
          {
            windowsHide: true,
            timeout: 5000,
            env: { ...process.env, PFX_PASS: password },
            stdio: ["ignore", "pipe", "pipe"],
          }
        ).toString("utf8");

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
        if (tmpPassFile && fs.existsSync(tmpPassFile)) {
          try { fs.unlinkSync(tmpPassFile); } catch {}
        }
      }

      // Fallback on Windows: PowerShell with env:PFX_PASS (securely reads password from env without CLI leakage)
      try {
        const psCmd = `
          $c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('${tmpPfx.replace(/'/g, "''")}', $env:PFX_PASS)
          [PSCustomObject]@{
            Subject = $c.Subject
            Issuer = $c.Issuer
            NotBefore = $c.NotBefore.ToString('o')
            NotAfter = $c.NotAfter.ToString('o')
            Thumbprint = $c.Thumbprint
          } | ConvertTo-Json
        `;
        const psOut = child_process.execFileSync(
          "powershell",
          ["-NoProfile", "-Command", psCmd],
          {
            windowsHide: true,
            timeout: 5000,
            env: { ...process.env, PFX_PASS: password },
            stdio: ["ignore", "pipe", "pipe"],
          }
        ).toString("utf8");
        const parsed = JSON.parse(psOut);
        if (parsed.Subject || parsed.Thumbprint) {
          return {
            subject: parsed.Subject || "Enterprise Code Signing Certificate",
            issuer: parsed.Issuer || "Internal CA",
            validFrom: parsed.NotBefore || new Date().toISOString(),
            validTo: parsed.NotAfter || new Date(Date.now() + 365 * 86400000).toISOString(),
            thumbprint: parsed.Thumbprint ? parsed.Thumbprint.replace(/\s+/g, "").toUpperCase() : "",
          };
        }
      } catch {}
    } catch {} finally {
      if (tmpPassFile && fs.existsSync(tmpPassFile)) {
        try { fs.unlinkSync(tmpPassFile); } catch {}
      }
      if (tmpPfx && fs.existsSync(tmpPfx)) {
        try { fs.unlinkSync(tmpPfx); } catch {}
      }
    }
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
  const certsDir = getCertsDir();
  const pfxPath = getPfxPath();
  const configPath = getConfigPath();

  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(pfxPath, pfxBuffer, { mode: 0o600 });

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

  fs.writeFileSync(configPath, JSON.stringify(stored, null, 2), { mode: 0o600 });

  return getCertificateStatus();
}

export function getCertificateStatus(): CertificateMetadata {
  const pfxPath = getPfxPath();
  const configPath = getConfigPath();

  if (process.env.CODE_SIGN_PFX_PATH && fs.existsSync(process.env.CODE_SIGN_PFX_PATH)) {
    return {
      hasCertificate: true,
      subject: process.env.CODE_SIGN_SUBJECT || "Environment Code Signing Certificate",
      issuer: process.env.CODE_SIGN_ISSUER || "Corporate CA",
      type: (process.env.CODE_SIGN_TYPE as "commercial" | "internal") || "commercial",
      timestampUrl: process.env.CODE_SIGN_TIMESTAMP_URL || "http://timestamp.digicert.com",
    };
  }

  if (fs.existsSync(configPath) && fs.existsSync(pfxPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
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
  const pfxPath = getPfxPath();
  const configPath = getConfigPath();
  let removed = false;
  if (fs.existsSync(pfxPath)) {
    try {
      fs.unlinkSync(pfxPath);
      removed = true;
    } catch {}
  }
  if (fs.existsSync(configPath)) {
    try {
      fs.unlinkSync(configPath);
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

  let pfxFile = getPfxPath();
  let password = "";
  let tsUrl = status.timestampUrl || "";

  if (process.env.CODE_SIGN_PFX_PATH && fs.existsSync(process.env.CODE_SIGN_PFX_PATH)) {
    pfxFile = process.env.CODE_SIGN_PFX_PATH;
    password = process.env.CODE_SIGN_PASSWORD || process.env.PFX_PASS || "";
  } else if (fs.existsSync(getConfigPath())) {
    try {
      const raw = fs.readFileSync(getConfigPath(), "utf8");
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
    child_process.execFileSync("osslsigncode", ["--version"], { windowsHide: true, stdio: "ignore" });
    hasOsslsigncode = true;
  } catch {}

  // Check for signtool (Windows)
  let hasSigntool = false;
  if (isWin) {
    try {
      child_process.execFileSync("signtool.exe", ["/?"], { windowsHide: true, stdio: "ignore" });
      hasSigntool = true;
    } catch {}
  }

  if (!hasOsslsigncode && !hasSigntool) {
    console.warn(
      `[CodeSign] Neither osslsigncode nor signtool.exe is installed. Skipping signing for: ${path.basename(targetPath)}`
    );
    return false;
  }

  let tmpPassFile = "";
  let signedTmp = "";
  try {
    const certsDir = getCertsDir();
    if (password) {
      const passSuffix = crypto.randomBytes(8).toString("hex");
      tmpPassFile = path.join(certsDir, `tmp_pass_${Date.now()}_${passSuffix}.txt`);
      fs.writeFileSync(tmpPassFile, password, { mode: 0o600 });
    }

    if (hasOsslsigncode) {
      signedTmp = `${targetPath}.${crypto.randomBytes(8).toString("hex")}.signed`;
      const signArgs: string[] = ["sign", "-pkcs12", pfxFile];
      if (tmpPassFile) {
        signArgs.push("-readpass", tmpPassFile);
      }
      signArgs.push("-h", "sha256");
      if (tsUrl) {
        signArgs.push("-ts", tsUrl);
      }
      signArgs.push("-in", targetPath, "-out", signedTmp);
      child_process.execFileSync("osslsigncode", signArgs, {
        windowsHide: true,
        env: { ...process.env, PFX_PASS: password },
        stdio: "pipe",
      });
      if (fs.existsSync(signedTmp) && fs.statSync(signedTmp).size > 0) {
        fs.copyFileSync(signedTmp, targetPath);
        fs.unlinkSync(signedTmp);
        signedTmp = "";
        return true;
      }
    } else if (hasSigntool) {
      const signArgs: string[] = ["sign", "/f", pfxFile];
      if (tmpPassFile) {
        signArgs.push("/pfile", tmpPassFile);
      }
      signArgs.push("/fd", "sha256");
      if (tsUrl) {
        signArgs.push("/tr", tsUrl, "/td", "sha256");
      }
      signArgs.push(targetPath);
      child_process.execFileSync("signtool.exe", signArgs, {
        windowsHide: true,
        env: { ...process.env, PFX_PASS: password },
        stdio: "pipe",
      });
      return true;
    }
  } catch (err: any) {
    console.warn(`[CodeSign] Failed to sign ${path.basename(targetPath)}:`, err?.message || err);
    return false;
  } finally {
    if (tmpPassFile && fs.existsSync(tmpPassFile)) {
      try { fs.unlinkSync(tmpPassFile); } catch {}
    }
    if (signedTmp && fs.existsSync(signedTmp)) {
      try { fs.unlinkSync(signedTmp); } catch {}
    }
  }

  return false;
}
