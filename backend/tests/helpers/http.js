// supertest ke jawab se cookie nikalne ke chhote helper
function setCookieLines(res) {
  return res.headers['set-cookie'] || [];
}

// Poori Set-Cookie line (HttpOnly, SameSite wagairah dekhne ke liye). Ek naam kai baar aaye to aakhri
function cookieLine(res, name) {
  const matches = setCookieLines(res).filter((line) => line.startsWith(`${name}=`));
  return matches.length ? matches[matches.length - 1] : null;
}

// "name=value" jo agli request ke Cookie header mein bheja ja sake
function cookiePair(res, name) {
  const line = cookieLine(res, name);
  return line ? line.split(';')[0] : null;
}

module.exports = { cookieLine, cookiePair };