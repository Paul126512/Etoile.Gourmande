// api/orders.js
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // requis pour Railway, Supabase, etc.
  },
});

export default async function handler(req, res) {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({ error: 'Email requis' });
  }

  try {
    const clientRes = await pool.query(
      'SELECT stripe_session_id FROM clients WHERE email = $1 LIMIT 1',
      [email]
    );

    if (clientRes.rows.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    const sessionId = clientRes.rows[0].stripe_session_id;

    const ordersRes = await pool.query(
      'SELECT * FROM commandes WHERE stripe_session_id = $1',
      [sessionId]
    );

    res.status(200).json(ordersRes.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}
