const crypto = require('crypto');

// Prefix se pata chalta hai ki text encrypted hai. Purane messages (bina prefix) plain text hi padhe jate hain.
const PREFIX = 'enc1:';

function getKey() {
  const hex = process.env.MESSAGE_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('MESSAGE_ENCRYPTION_KEY is missing or invalid. It must be 64 hex characters in backend/.env');
  }
  return Buffer.from(hex, 'hex');
}

function assertKeyConfigured() {
  getKey();
}

function encryptMessage(plainText) {
  const iv = crypto.randomBytes(12); // har message ka naya random IV
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // tamper detect karne ke liye
  return PREFIX + [iv, tag, encrypted].map((part) => part.toString('base64')).join(':');
}

function decryptMessage(stored) {
  if (!stored || !stored.startsWith(PREFIX)) return stored; // plain ya khaali (deleted) message
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

function safeDecrypt(stored) {
  try {
    return decryptMessage(stored);
  } catch {
    return '[Message could not be decrypted]';
  }
}

module.exports = { assertKeyConfigured, encryptMessage, safeDecrypt };