const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_KEY;  // bien SUPABASE_KEY comme dans Vercel

export default async function handler(req, res) {
  console.log('API contact appelée');

  if (req.method !== 'POST') {
    console.log('Méthode non autorisée:', req.method);
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  if (!RECAPTCHA_SECRET || !SUPABASE_URL || !SUPABASE_API_KEY) {
    console.log('Config serveur incorrecte:', { RECAPTCHA_SECRET, SUPABASE_URL, SUPABASE_API_KEY });
    return res.status(500).json({ error: 'Configuration serveur incorrecte.' });
  }

  const { name, email, subject, message, recaptchaToken } = req.body;
  console.log('Données reçues:', req.body);

  if (!name || !email || !subject || !message || !recaptchaToken) {
    console.log('Champs manquants:', { name, email, subject, message, recaptchaToken });
    return res.status(400).json({ error: 'Champs manquants.' });
  }

  // Vérification reCAPTCHA
  const verifyURL = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET}&response=${recaptchaToken}`;

  let captchaData;
  try {
    const captchaRes = await fetch(verifyURL, { method: 'POST' });
    captchaData = await captchaRes.json();
    console.log('Résultat reCAPTCHA:', captchaData);
  } catch (err) {
    console.log('Erreur vérification reCAPTCHA:', err);
    return res.status(500).json({ error: 'Erreur lors de la vérification reCAPTCHA.' });
  }

  if (!captchaData.success || captchaData.score < 0.5) {
    console.log('reCAPTCHA échoué ou score trop bas:', captchaData);
    return res.status(403).json({ error: 'Échec du reCAPTCHA (score trop bas ou échec).' });
  }

  // Envoi à Supabase
  try {
    const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/contact_messages`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_API_KEY,
        'Authorization': `Bearer ${SUPABASE_API_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ name, email, subject, message }),
    });

    const supabaseData = await supabaseRes.json();
    console.log('Réponse Supabase:', supabaseRes.status, supabaseData);

    if (!supabaseRes.ok) {
      return res.status(500).json({ error: 'Erreur Supabase', details: supabaseData });
    }

    return res.status(200).json({ success: true, data: supabaseData });
  } catch (err) {
    console.log('Erreur connexion Supabase:', err);
    return res.status(500).json({ error: 'Erreur lors de la connexion à Supabase.' });
  }
}
