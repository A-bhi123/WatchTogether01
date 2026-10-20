// Ek IP se ek email par galat password ki koshishein gino. 5 galat ke baad 15 min ruko.
// (Memory mein hai: backend restart par saaf. Bade production mein Redis use hota hai.)
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

const failures = new Map(); // "ip|email" -> { count, firstAt }

function keyFor(ip, email) {
  return `${ip}|${String(email).trim().toLowerCase()}`;
}

// Kitne minute baad dobara koshish kar sakte ho (0 = koi rok nahi)
function isBlocked(ip, email) {
  const key = keyFor(ip, email);
  const entry = failures.get(key);
  if (!entry) return 0;

  const elapsed = Date.now() - entry.firstAt;
  if (elapsed > WINDOW_MS) {
    failures.delete(key);
    return 0;
  }
  if (entry.count < MAX_FAILURES) return 0;
  return Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 60000));
}

function recordFailure(ip, email) {
  const key = keyFor(ip, email);
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearFailures(ip, email) {
  failures.delete(keyFor(ip, email));
}

// Purani entries saaf karte raho, taaki memory na bhare
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failures) {
    if (now - entry.firstAt > WINDOW_MS) failures.delete(key);
  }
}, 10 * 60 * 1000).unref();

module.exports = { isBlocked, recordFailure, clearFailures };