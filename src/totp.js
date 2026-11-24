// Codes à 6 chiffres des apps d'authentification (TOTP, RFC 6238 : SHA-1, 30 secondes).
// Port de Sources/CubeWidget/Telegram/TOTP.swift.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of clean) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('Clé invalide');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function code(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

const counterAt = (ms) => Math.floor(ms / 1000 / 30);

/** Le code est celui de la période actuelle, ou d'une voisine (horloge du téléphone un peu décalée). */
function verify(secret, input, now = Date.now(), tolerance = 1) {
  const typed = String(input || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return false;
  const c = counterAt(now);
  for (let d = -tolerance; d <= tolerance; d++) {
    const expected = code(secret, c + d);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(typed))) return true;
  }
  return false;
}

const newSecret = () => base32Encode(crypto.randomBytes(20));

const otpauthURL = (secret, account) =>
  `otpauth://totp/${encodeURIComponent('Cube Hub:' + account)}?secret=${secret}&issuer=${encodeURIComponent('Cube Hub')}&algorithm=SHA1&digits=6&period=30`;

module.exports = { newSecret, verify, code, counterAt, otpauthURL, base32Encode, base32Decode };
