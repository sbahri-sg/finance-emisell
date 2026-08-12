import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
const scrypt = promisify(scryptCallback)

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64) as Buffer
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm,saltHex,hashHex] = stored.split('$')
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false
  const actual = await scrypt(password,Buffer.from(saltHex,'hex'),64) as Buffer
  const expected = Buffer.from(hashHex,'hex')
  return actual.length===expected.length && timingSafeEqual(actual,expected)
}
export function newSessionToken(){ return randomBytes(32).toString('base64url') }
export function tokenHash(token:string){ return createHash('sha256').update(token).digest('hex') }
