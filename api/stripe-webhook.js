import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const config = {
  api: {
    bodyParser: false,  // IMPORTANT pour récupérer le raw body
  },
};

export default async function handler(req, res) {
  console.log('Webhook handler démarré');

  // 1. Méthode POST uniquement
  if (req.method !== 'POST') {
    console.warn('⚠️ Méthode non autorisée:', req.method);
    return res.status(405).end('Method Not Allowed');
  }

  // 2. Récupérer la signature Stripe dans le header
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.error('⚠️ Pas de signature Stripe dans les headers');
    return res.status(400).end('Missing Stripe signature');
  }
  console.log('Signature Stripe reçue:', sig);

  // 3. Lire le corps brut (raw body)
  let buf;
  try {
    buf = await buffer(req);
    console.log('Buffer brut reçu, taille:', buf.length);
    if (buf.length === 0) {
      console.warn('⚠️ Buffer vide reçu !');
      return res.status(400).end('Empty request body');
    }
  } catch (err) {
    console.error('Erreur lecture buffer:', err);
    return res.status(400).end('Invalid request body');
  }

  // 4. Vérifier signature webhook Stripe
  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET.trim());
    console.log('Webhook Stripe validé:', event.type);
  } catch (err) {
    console.error('⚠️ Signature webhook invalide:', err.message);
    console.log('Payload brut:', buf.toString('utf8'));
    return res.status(400).end(`Webhook Error: ${err.message}`);
  }

  // 5. Gérer l'événement
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Session Stripe ID:', session.id);

    if (session.payment_status !== 'paid') {
      console.log(`Paiement non finalisé pour session ${session.id}, status: ${session.payment_status}`);
      return res.status(200).end('Paiement non finalisé');
    }

    // 6. Récupérer la commande dans Supabase
    let order;
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('stripe_session_id', session.id)
        .maybeSingle();

      if (error) {
        console.error('Erreur récupération commande:', error);
        return res.status(500).end('Erreur récupération commande');
      }

      order = data;
    } catch (e) {
      console.error('Erreur dans la récupération de la commande:', e);
      return res.status(500).end('Erreur serveur');
    }

    if (!order) {
      console.warn(`Commande non trouvée pour session Stripe ${session.id}`);
      return res.status(404).end('Commande non trouvée pour cette session Stripe');
    }

    console.log('Commande trouvée:', order);

    // 7. Mettre à jour la commande en statut "completed"
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('stripe_session_id', session.id);

    if (updateError) {
      console.error('Erreur mise à jour commande Supabase:', updateError);
      return res.status(500).end('Erreur mise à jour commande');
    }

    console.log(`Commande Stripe session ${session.id} mise à jour en "completed" ✅`);
    return res.status(200).end('Commande mise à jour');
  } else {
    console.log('Événement Stripe ignoré:', event.type);
    return res.status(200).end('Événement ignoré');
  }
}
