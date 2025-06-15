import express from 'express';
import { speedInsights } from '@vercel/speed-insights';

const app = express();
const port = 3000;

app.get('/api/speed-report', async (req, res) => {
  try {
    const url = req.query.url || 'https://etoile-gourmande-one.vercel.app/';
    const strategy = req.query.strategy || 'mobile';  // 'mobile' ou 'desktop'

    if (!['mobile', 'desktop'].includes(strategy)) {
      return res.status(400).json({ error: 'Strategy doit être "mobile" ou "desktop"' });
    }

    const report = await speedInsights(url, { strategy });
    res.json(report);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la récupération du rapport' });
  }
});

app.listen(port, () => {
  console.log(`Serveur lancé sur http://localhost:${port}`);
});
