import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const now = new Date();
    if (isNaN(now.getTime())) return res.status(500).json({ error: 'Date invalide' });

    const dd = String(now.getUTCDate()).padStart(2, '0');
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = now.getUTCFullYear();

    const datePrefix = `${dd}${mm}${yyyy}`;
    const likePattern = `CMD-${datePrefix}-%`;

    const { data, error } = await supabase
      .from('orders')
      .select('numero_cmd')
      .ilike('numero_cmd', likePattern);

    if (error) throw error;

    let maxCount = 0;
    if (data.length > 0) {
      data.forEach(order => {
        const lastPart = parseInt(order.numero_cmd.split('-')[2], 10);
        if (!isNaN(lastPart) && lastPart > maxCount) maxCount = lastPart;
      });
    }

    const formattedCount = String(maxCount + 1).padStart(3, '0');
    const newOrderId = `CMD-${datePrefix}-${formattedCount}`;

    res.status(200).json({ orderId: newOrderId });

  } catch (err) {
    console.error('Erreur orderManager API:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la génération du numéro de commande' });
  }
}
