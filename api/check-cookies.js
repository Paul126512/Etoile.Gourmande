// api/check-cookies.js (ou .ts selon ton setup)

export default function handler(req, res) {
  // Récupérer le header 'cookie'
  const cookieHeader = req.headers.cookie || '';

  // Parser manuellement le cookie cookiePreferences
  const cookies = Object.fromEntries(
    cookieHeader
      .split(';')
      .map(c => c.trim().split('='))
  );

  let prefs = null;

  if (cookies.cookiePreferences) {
    try {
      prefs = JSON.parse(decodeURIComponent(cookies.cookiePreferences));
    } catch (e) {
      console.error('Erreur parsing cookiePreferences', e);
    }
  }

  res.status(200).json({ prefs });
}
