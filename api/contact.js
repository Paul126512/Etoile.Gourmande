// /api/contact.js

import fetch from 'node-fetch';

const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { name, email, subject, message, recaptchaToken } = req.body;

  // ✅ Vérifie reCAPTCHA
  const verifyURL = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET}&response=${recaptchaToken}`;
  const captchaRes = await fetch(verifyURL, { method: 'POST' });
  const captchaData = await captchaRes.json();

  if (!captchaData.success || captchaData.score < 0.5) {
    return res.status(403).json({ error: 'Échec du reCAPTCHA (score trop bas ou échec).' });
  }

  // ✅ Envoie les données à Supabase
  const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/contact_messages`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_API_KEY,
      'Authorization': `Bearer ${SUPABASE_API_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ name, email, subject, message })
  });

  const supabaseData = await supabaseRes.json();

  if (!supabaseRes.ok) {
    return res.status(500).json({ error: 'Erreur Supabase', details: supabaseData });
  }

  return res.status(200).json({ success: true, data: supabaseData });
}
