import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors()); // Autorise ton front à accéder au serveur

// ⚙️ Config à adapter
const RECAPTCHA_SECRET = '6Lcr1FsrAAAAAAKKRZ19ENcg6xvjKeuwr4WPNb1z';
const SUPABASE_URL = 'https://hawlnecxjfdhgnbltovh.supabase.co';
const SUPABASE_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhhd2xuZWN4amZkaGduYmx0b3ZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTU2NDU1NywiZXhwIjoyMDY1MTQwNTU3fQ.h4OYrYA4K8lMYuvYLoE6rOpUgaAn-H4r-om1Jd23gsA'; // Prends la clé "service role", pas la "anon" ici

app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message, recaptchaToken } = req.body;

  // ✅ Vérifie reCAPTCHA v3
  const verifyURL = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET}&response=${recaptchaToken}`;
  const captchaRes = await fetch(verifyURL, { method: 'POST' });
  const captchaData = await captchaRes.json();

  if (!captchaData.success || captchaData.score < 0.5) {
    return res.status(403).json({ error: 'Échec du reCAPTCHA (bot détecté ou score trop bas).' });
  }

  // ✅ Envoie à Supabase (via REST API)
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
    return res.status(500).json({ error: 'Erreur lors de l\'enregistrement dans Supabase.', details: supabaseData });
  }

  res.status(200).json({ success: true, data: supabaseData });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur backend en écoute sur http://localhost:${PORT}`);
});
