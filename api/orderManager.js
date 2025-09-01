import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const now = new Date();
    if (isNaN(now.getTime())) return res.status(500).json({ error: 'Date invalide' });

    const dd = String(now.getUTCDate()).padStart(2, '0');
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = now.getUTCFullYear();
    const datePrefix = `${dd}${mm}${yyyy}`;

    // Récupérer toutes les commandes du jour
    const likePattern = `CMD-${datePrefix}-%`;
    const { data: existingOrders, error } = await supabase
      .from('orders')
      .select('numero_cmd')
      .ilike('numero_cmd', likePattern);

    if (error) throw error;

    // Crée une liste des numéros existants pour ce jour
    const usedNumbers = new Set();
    if (existingOrders && existingOrders.length > 0) {
      existingOrders.forEach(order => {
        const parts = order.numero_cmd.split('-');
        const lastPart = parseInt(parts[2], 10);
        if (!isNaN(lastPart)) usedNumbers.add(lastPart);
      });
    }

    // Cherche le plus petit numéro disponible
    let newCount = 1;
    while (usedNumbers.has(newCount)) {
      newCount++;
    }

    const formattedCount = String(newCount).padStart(3, '0');
    const newOrderId = `CMD-${datePrefix}-${formattedCount}`;

    return res.status(200).json({ orderId: newOrderId });
  } catch (err) {
    console.error('Erreur orderManager API:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la génération du numéro de commande' });
  }
}
