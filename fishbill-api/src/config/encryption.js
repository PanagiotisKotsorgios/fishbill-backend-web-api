const CryptoJS = require('crypto-js');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'change_this_32_char_hex_key_here';

/**
 * Encrypt a plaintext string to a hex-encoded ciphertext.
 * @param {string} text - plaintext to encrypt
 * @returns {string} hex-encoded ciphertext
 */
function encrypt(text) {
  if (text === null || text === undefined) return null;
  const ciphertext = CryptoJS.AES.encrypt(String(text), ENCRYPTION_KEY);
  return ciphertext.toString(CryptoJS.enc.Hex);
}

/**
 * Decrypt a hex-encoded ciphertext back to plaintext.
 * @param {string} encrypted - hex-encoded ciphertext produced by encrypt()
 * @returns {string} decrypted plaintext
 */
function decrypt(encrypted) {
  if (encrypted === null || encrypted === undefined) return null;
  try {
    const ciphertext = CryptoJS.enc.Hex.parse(encrypted);
    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext,
    });
    const bytes = CryptoJS.AES.decrypt(cipherParams, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    console.error('[Encryption] Decryption failed:', err.message);
    return null;
  }
}

module.exports = { encrypt, decrypt };
