import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifrado de los datos más delicados que guarda la tienda: el número fiscal
 * (SSN/ITIN) y la cuenta bancaria de quien cobra una nómina o una comisión.
 *
 * Decisiones (y por qué):
 *  · AES-256-GCM: cifra y además AUTENTICA. Si alguien edita un byte en la
 *    base de datos, el descifrado falla en vez de devolver basura silenciosa.
 *  · La clave NO vive en la base: sale de `PAYROLL_ENCRYPTION_KEY` (32 bytes en
 *    base64 o hex). Quien se lleve un volcado de la base no se lleva los datos.
 *  · Formato guardado: `v1.<iv>.<tag>.<texto cifrado>` en base64url. El prefijo
 *    de versión permite rotar algoritmo o clave sin adivinar qué es cada fila.
 *  · Un IV aleatorio por cifrado (nunca reutilizado), como exige GCM.
 *  · `fingerprint` permite comparar dos valores (¿es la misma cuenta?) sin
 *    descifrar: HMAC-SHA-256 truncado con la misma clave.
 *
 * Sin clave configurada no se guarda nada: `encryptSecret` lanza
 * `payroll_key_missing` y la ruta responde 503. Es deliberado — guardar un SSN
 * en claro «mientras tanto» es exactamente lo que no se puede hacer.
 */

const VERSION = "v1";
const b64 = (b: Buffer): string => b.toString("base64url");
const unb64 = (s: string): Buffer => Buffer.from(s, "base64url");

/** La clave de 32 bytes, de `PAYROLL_ENCRYPTION_KEY` (base64 o hex). */
export function payrollKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = (env.PAYROLL_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

/** ¿Se puede guardar un dato bancario en este despliegue? */
export const canStoreSecrets = (env: NodeJS.ProcessEnv = process.env): boolean => payrollKey(env) !== null;

/** Una clave nueva lista para pegar en la variable de entorno (para la guía de alta). */
export const generateSecretKey = (): string => randomBytes(32).toString("base64");

export function encryptSecret(plain: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = payrollKey(env);
  if (!key) throw new Error("payroll_key_missing");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(body)].join(".");
}

/**
 * Descifra lo guardado. Devuelve null si no hay clave, el formato no es el
 * nuestro o el dato fue alterado: quien llama decide qué hacer, pero nunca
 * recibe un valor en el que no se pueda confiar.
 */
export function decryptSecret(stored: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = payrollKey(env);
  if (!key || !stored) return null;
  const parts = String(stored).split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, unb64(parts[1]));
    decipher.setAuthTag(unb64(parts[2]));
    return Buffer.concat([decipher.update(unb64(parts[3])), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Huella estable de un valor: sirve para comparar sin descifrar ni mostrar. */
export function fingerprint(plain: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = payrollKey(env);
  if (!key) return null;
  return createHash("sha256").update(key).update("|").update(plain).digest("base64url").slice(0, 22);
}

/** Comparación de huellas en tiempo constante. */
export function sameFingerprint(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
