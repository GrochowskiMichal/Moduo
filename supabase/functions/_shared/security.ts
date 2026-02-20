const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

export function isHostAllowed(host: string): boolean {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return false;
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
  return /^[a-z0-9.-]+$/.test(trimmed);
}

export function validatePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function getAesKeyRaw(): Uint8Array {
  const key = Deno.env.get("EMAIL_SECRET_KEY");
  if (!key) throw new Error("Missing EMAIL_SECRET_KEY");
  const cleaned = key.trim();
  if (cleaned.length < 32) throw new Error("EMAIL_SECRET_KEY must be at least 32 chars");
  return new TextEncoder().encode(cleaned.slice(0, 32));
}

async function getAesKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", getAesKeyRaw(), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function encryptSecret(value: string): Promise<string> {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
  return `${bytesToBase64(iv)}:${bytesToBase64(cipher)}`;
}
