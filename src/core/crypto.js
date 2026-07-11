/* Generic authenticated-encryption envelope — AES-GCM 256 + PBKDF2/SHA-256.
   Portable: knows nothing about the app. Pass any JSON-serialisable value in,
   get a self-describing envelope out; decrypt reverses it. A wrong passphrase or
   any tampering fails the GCM auth tag and throws — no separate integrity check
   is needed. Runs on the Web Crypto API (Chromium/Electron renderer). */

const SUBTLE = globalThis.crypto && globalThis.crypto.subtle;

const PBKDF2_ITERATIONS = 250000; // stored per-envelope, so this can rise later
const PBKDF2_HASH = "SHA-256";
const SALT_BYTES = 16;
const IV_BYTES = 12; // 96-bit nonce — the AES-GCM standard
const KEY_BITS = 256;

const ENVELOPE_FORMAT = "kpbak";
const ENVELOPE_VERSION = 1;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/* ── base64 <-> bytes (chunked, safe for multi-MB payloads) ── */

function bytesToB64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function b64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ── PBKDF2 → AES-GCM key ── */

async function deriveKey(passphrase, salt, iterations) {
  const baseKey = await SUBTLE.importKey(
    "raw",
    textEncoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return SUBTLE.deriveKey(
    { name: "PBKDF2", hash: PBKDF2_HASH, salt, iterations },
    baseKey,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

export function isCryptoAvailable() {
  return !!(SUBTLE && globalThis.crypto?.getRandomValues);
}

/**
 * Encrypt a JSON-serialisable value under a passphrase.
 * @returns {Promise<object>} a self-describing .kpbak envelope (all binary as base64)
 */
export async function encryptJSON(data, passphrase) {
  if (!isCryptoAvailable()) throw new Error("Secure encryption is unavailable in this environment.");
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("A passphrase is required.");
  }

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);

  const plaintext = textEncoder.encode(JSON.stringify(data));
  const ciphertext = await SUBTLE.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return {
    format: ENVELOPE_FORMAT,
    v: ENVELOPE_VERSION,
    kdf: { name: "PBKDF2", hash: PBKDF2_HASH, salt: bytesToB64(salt), iter: PBKDF2_ITERATIONS },
    cipher: { name: "AES-GCM", iv: bytesToB64(iv) },
    ct: bytesToB64(ciphertext),
  };
}

/**
 * Decrypt a .kpbak envelope produced by encryptJSON.
 * Throws a friendly Error on wrong passphrase, tampering, or corruption.
 */
export async function decryptJSON(envelope, passphrase) {
  if (!isCryptoAvailable()) throw new Error("Secure encryption is unavailable in this environment.");
  if (!envelope || typeof envelope !== "object" || envelope.format !== ENVELOPE_FORMAT) {
    throw new Error("This is not a valid backup file.");
  }
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("A passphrase is required.");
  }

  const kdf = envelope.kdf || {};
  const cipher = envelope.cipher || {};
  let salt, iv, ciphertext;
  try {
    salt = b64ToBytes(kdf.salt);
    iv = b64ToBytes(cipher.iv);
    ciphertext = b64ToBytes(envelope.ct);
  } catch {
    throw new Error("Backup file is corrupt or malformed.");
  }

  const iterations = Number(kdf.iter) || PBKDF2_ITERATIONS;
  const key = await deriveKey(passphrase, salt, iterations);

  let plainBuffer;
  try {
    plainBuffer = await SUBTLE.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    // Wrong passphrase or altered bytes — GCM auth tag rejected the data.
    throw new Error("Incorrect passphrase, or the backup has been altered.");
  }

  try {
    return JSON.parse(textDecoder.decode(plainBuffer));
  } catch {
    throw new Error("Backup decrypted, but its contents were unreadable.");
  }
}
