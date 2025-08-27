import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const config = {
  api: {
    bodyParser: false, // IMPORTANT pour récupérer le raw body
  },
};

// ✅ Fonction utilitaire pour générer un préfixe de date JJMMAAAA
function getDatePrefix() {
  const now = new Date();
  if (isNaN(now.getTime())) {
    console.error("Date invalide:", now);
    return "00000000"; // fallback en cas de bug
  }
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

export default async function handler(req, res) {
  console.log('📩 Webhook Stripe reçu');

  // 1. Méthode POST uniquement
  if (req.method !== 'POST') {
    console.warn('⚠️ Méthode non autorisée:', req.method);
    return res.status(405).end('Method Not Allowed');
  }

  // 2. Signature Stripe
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.error('⚠️ Pas de signature Stripe dans les headers');
    return res.status(400).end('Missing Stripe signature');
  }

  // 3. Lire le corps brut
  let buf;
  try {
    buf = await buffer(req);
    console.log('📦 Buffer brut reçu, taille:', buf.length);
    if (buf.length === 0) {
      return res.status(400).end('Empty request body');
    }
  } catch (err) {
    console.error('Erreur lecture buffer:', err);
    return res.status(400).end('Invalid request body');
  }

  // 4. Vérifier la signature webhook Stripe
  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET.trim());
    console.log('✅ Webhook Stripe validé:', event.type);
  } catch (err) {
    console.error('❌ Signature webhook invalide:', err.message);
    return res.status(400).end(`Webhook Error: ${err.message}`);
  }

  // 5. Gestion de l'événement checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('💳 Session Stripe ID:', session.id);

    if (session.payment_status !== 'paid') {
      console.log(`⚠️ Paiement non finalisé pour session ${session.id}, status: ${session.payment_status}`);
      return res.status(200).end('Paiement non finalisé');
    }

    try {
      // Récupérer la commande associée dans Supabase
      const { data: order, error } = await supabase
        .from('orders')
        .select('*')
        .eq('stripe_session_id', session.id)
        .maybeSingle();

      if (error) {
        console.error('❌ Erreur récupération commande:', error);
        return res.status(500).end('Erreur récupération commande');
      }

      if (!order) {
        console.warn(`⚠️ Commande non trouvée pour session Stripe ${session.id}`);
        return res.status(404).end('Commande non trouvée');
      }

      console.log('📝 Commande trouvée:', order);

      // (Optionnel) régénérer numero_cmd si absent ou invalide
      let updatedFields = { status: 'completed' };
      if (!order.numero_cmd || order.numero_cmd.includes("NaN")) {
        const datePrefix = getDatePrefix();
        updatedFields.numero_cmd = `CMD-${datePrefix}-001`;
        console.log('🔄 Numero_cmd régénéré:', updatedFields.numero_cmd);
      }

      // Mettre à jour la commande
      const { error: updateError } = await supabase
        .from('orders')
        .update(updatedFields)
        .eq('stripe_session_id', session.id);

      if (updateError) {
        console.error('❌ Erreur mise à jour commande Supabase:', updateError);
        return res.status(500).end('Erreur mise à jour commande');
      }

      console.log(`✅ Commande ${session.id} mise à jour en "completed"`);
      return res.status(200).end('Commande mise à jour');
    } catch (e) {
      console.error('❌ Erreur dans la gestion de la commande:', e);
      return res.status(500).end('Erreur serveur');
    }
  }

  // 6. Autres événements ignorés
  console.log('ℹ️ Événement Stripe ignoré:', event.type);
  return res.status(200).end('Événement ignoré');
}
