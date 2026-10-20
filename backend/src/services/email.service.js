require('dotenv').config();

// User ko dikhane layak error. errorHandler isse jaisa hai waisa bhejta hai
function emailError() {
  const err = new Error('Could not send the email. Please try again in a moment.');
  err.expose = true;
  err.status = 502;
  return err;
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.EMAIL_FROM;
  const fromName = process.env.EMAIL_FROM_NAME || 'WatchTogether';

  if (!apiKey || !fromEmail) {
    // Ye hamari (developer ki) galti hai, user ko iska andar ka text nahi dikhate
    throw new Error('Email service not configured: check BREVO_API_KEY and EMAIL_FROM in .env');
  }

  let response;
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(15000), // Brevo 15 sec mein na bole to login request latki na rahe
    });
  } catch (err) {
    console.error('Brevo request failed:', err.message);
    throw emailError();
  }

  if (!response.ok) {
    const details = await response.text();
    console.error('Brevo API error:', response.status, details);
    throw emailError();
  }
}

async function sendOtpEmail(to, otp, purposeLabel, expiresInMinutes) {
  await sendEmail({
    to,
    subject: `Your WatchTogether OTP: ${otp}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 420px; margin: auto;">
        <h2>WatchTogether</h2>
        <p>Your OTP for <strong>${purposeLabel}</strong> is:</p>
        <p style="font-size: 32px; letter-spacing: 6px; font-weight: bold;">${otp}</p>
        <p>This OTP expires in ${expiresInMinutes} minutes. Do not share it with anyone.</p>
      </div>
    `,
  });
}

module.exports = { sendEmail, sendOtpEmail };