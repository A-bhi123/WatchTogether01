// Bahut aam passwords (chhoti si list, asli app mein badi list use hoti hai)
const COMMON_PASSWORDS = new Set([
  'password1', 'password123', 'qwerty123', 'abc12345', 'admin123', 'welcome1',
  'iloveyou1', 'letmein123', 'test1234', 'india123', '12345678a', 'a1234567',
]);

// Sahi ho to null, nahi to user ke liye saaf message
function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  // bcrypt 72 byte ke baad ka hissa chup-chaap kaat deta hai, isliye isse zyada nahi lete
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password is too long (maximum 72 bytes).';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'This password is too common. Please choose a different one.';
  }
  return null;
}

module.exports = { validatePassword };