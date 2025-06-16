import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // clé serveur
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();

    const datePrefix = `${dd}${mm}${yyyy}`; // ex: 16062025

    // Récupérer le numéro max des commandes du jour
    // Exemple : CMD-16062025-005 -> on veut récupérer le 5

    // Filtrer tous les numero_cmd qui commencent par 'CMD-DDMMYYYY-'
    const likePattern = `CMD-${datePrefix}-%`;

    const { data, error } = await supabase
      .from('orders')
      .select('numero_cmd')
      .ilike('numero_cmd', likePattern);

    if (error) {
      throw error;
    }

    // Extraire les numéros de commandes et récupérer la plus grande valeur du suffixe
    let maxCount = 0;
    data.forEach(order => {
      const numero = order.numero_cmd;
      // Extrait la partie après le dernier tiret
      const parts = numero.split('-');
      const lastPart = parts[parts.length - 1];
      const count = parseInt(lastPart, 10);
      if (!isNaN(count) && count > maxCount) maxCount = count;
    });

    const newCount = maxCount + 1;
    const formattedCount = String(newCount).padStart(3, '0'); // 3 chiffres

    const newOrderId = `CMD-${datePrefix}-${formattedCount}`;

    return res.status(200).json({ orderId: newOrderId });

  } catch (err) {
    console.error('Erreur orderManager API:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la génération du numéro de commande' });
  }
}
