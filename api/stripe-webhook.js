import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const config = {
  api: {
    bodyParser: false, // ⚠️ Obligatoire pour Stripe
  },
};

// ✅ Génère un préfixe de date fiable JJMMAAAA
function getDatePrefix() {
  const now = new Date();
  if (isNaN(now.getTime())) {
    console.error("Date invalide:", now);
    return "00000000";
  }
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

export default async function handler(req, res) {
  console.log('📩 Webhook Stripe reçu');

  // 1. Vérification méthode
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  // 2. Vérification signature
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.error('⚠️ Pas de signature Stripe');
    return res.status(400).end('Missing Stripe signature');
  }

  // 3. Lecture du corps brut
  let event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET.trim());
    console.log('✅ Webhook Stripe validé:', event.type);
  } catch (err) {
    console.error('❌ Signature webhook invalide:', err.message);
    return res.status(400).end(`Webhook Error: ${err.message}`);
  }

  // 4. Répondre rapidement à Stripe (avant traitement long)
  res.status(200).end('ok');

  // 5. Traiter en arrière-plan
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('💳 Session Stripe:', session.id);

    if (session.payment_status !== 'paid') {
      console.log(`⚠️ Paiement non finalisé: ${session.payment_status}`);
      return;
    }

    try {
      // Récupération de la commande dans Supabase
      const { data: order, error } = await supabase
        .from('orders')
        .select('*')
        .eq('stripe_session_id', session.id)
        .maybeSingle();

      if (error) {
        console.error('❌ Erreur récupération commande:', error);
        return;
      }
      if (!order) {
        console.warn(`⚠️ Pas de commande pour session ${session.id}`);
        return;
      }

      console.log('📝 Commande trouvée:', order);

      // Champs à mettre à jour
      const updatedFields = { status: 'completed' };

      // Fallback si numero_cmd est absent ou invalide
      if (!order.numero_cmd || order.numero_cmd.includes("NaN")) {
        const datePrefix = getDatePrefix();
        updatedFields.numero_cmd = `CMD-${datePrefix}-001`;
        console.log('🔄 Numero_cmd régénéré:', updatedFields.numero_cmd);
      }

      // Mise à jour Supabase
      const { error: updateError } = await supabase
        .from('orders')
        .update(updatedFields)
        .eq('stripe_session_id', session.id);

      if (updateError) {
        console.error('❌ Erreur mise à jour commande:', updateError);
        return;
      }

      console.log(`✅ Commande ${session.id} mise à jour en "completed"`);
    } catch (e) {
      console.error('❌ Erreur traitement commande:', e);
    }
  } else {
    console.log('ℹ️ Événement Stripe ignoré:', event.type);
  }
}
