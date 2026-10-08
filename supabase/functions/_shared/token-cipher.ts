// AES-256-GCM tokens, matching the desktop keychain uploader:
// key = SHA-256(secret + ":" + userId), blob = base64(12-byte nonce || ciphertext+tag).

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(secret: string, userId: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${secret}:${userId}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(
  plaintext: string,
  secret: string,
  userId: string,
): Promise<string> {
  const key = await deriveKey(secret, userId);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(plaintext)),
  );
  const blob = new Uint8Array(nonce.length + cipher.length);
  blob.set(nonce, 0);
  blob.set(cipher, nonce.length);
  return bytesToB64(blob);
}

export async function decryptToken(
  encoded: string,
  secret: string,
  userId: string,
): Promise<string> {
  const key = await deriveKey(secret, userId);
  const raw = b64ToBytes(encoded);
  const nonce = raw.slice(0, 12);
  const data = raw.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, data);
  return new TextDecoder().decode(plain);
}
