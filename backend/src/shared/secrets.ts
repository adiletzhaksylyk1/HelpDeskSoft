import crypto from "node:crypto";
import { getEnvConfig } from "../config/env.js";
function key(): Buffer {
  const env = getEnvConfig();
  return env.SECRET_ENCRYPTION_KEY
    ? Buffer.from(env.SECRET_ENCRYPTION_KEY, "hex")
    : crypto.createHash("sha256").update(env.JWT_SECRET).digest();
}
export function encryptSecret(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "enc",
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}
export function decryptSecret(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("enc:v1:")) return value ?? null; // Legacy migration compatibility.
  const [, , iv, tag, ciphertext] = value.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
