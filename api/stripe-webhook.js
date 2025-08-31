import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Génère le préfixe date JJMMAAAA
function getDatePrefix() {
 const now = new Date();
const dd = String(now.getUTCDate()).padStart(2, '0');
const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
const yyyy = String(now.getUTCFullYear());
return `${dd}${mm}${yyyy}`;

}

// Génère un numero_cmd unique pour le jour
async function generateOrderNumber() {
  const datePrefix = getDatePrefix();
  const likePattern = `CMD-${datePrefix}-%`;

  const { data, error } = await supabase
    .from('orders')
    .select('numero_cmd')
    .ilike('numero_cmd', likePattern);

  if (error) {
    console.error('Erreur récupération commandes:', error);
    return `CMD-${datePrefix}-001`; // fallback sûr
  }

  let maxCount = 0;
  if (data && data.length > 0) {
    data.forEach(order => {
      const parts = order.numero_cmd.split('-');
      const lastPart = parts[parts.length - 1];
      const count = parseInt(lastPart, 10);
      if (!isNaN(count) && count > maxCount) maxCount = count;
    });
  }

  const newCount = maxCount + 1;
  const formattedCount = String(newCount).padStart(3, '0');

  return `CMD-${datePrefix}-${formattedCount}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { client_id, email, name, produits, total_price, status } = req.body;

    if (!client_id || !email || !produits || !total_price) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // Permet de passer un statut depuis le front ou utiliser awaiting_payment par défaut
    const orderStatus = status || 'awaiting_payment';

    // Crée le numero_cmd uniquement pour une nouvelle commande
    const numero_cmd = await generateOrderNumber();

    const { data, error } = await supabase
      .from('orders')
      .insert([{
        client_id,
        email,
        name,
        produits,
        total_price,
        status: orderStatus,
        numero_cmd,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) {
      console.error('Erreur création commande:', error);
      return res.status(500).json({ error: 'Erreur serveur création commande' });
    }

    return res.status(200).json({ order: data });

  } catch (err) {
    console.error('Erreur endpoint création commande:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

