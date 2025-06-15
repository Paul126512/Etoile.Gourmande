// api/orders.js
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

export default async function handler(req, res) {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({ error: 'Email requis' });
  }

  try {
    const ordersRes = await pool.query(
      'SELECT * FROM orders WHERE email = $1 ORDER BY created_at DESC',
      [email]
    );

    if (ordersRes.rows.length === 0) {
      return res.status(404).json({ error: 'Aucune commande trouvée pour cet email.' });
    }

    res.status(200).json(ordersRes.rows);
  } catch (error) {
    console.error('Erreur lors de la récupération des commandes :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}
