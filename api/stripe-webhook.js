import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const config = {
  api: {
    bodyParser: false, // nécessaire pour récupérer le buffer brut de la requête
  },
};

// Fonction pour récupérer le buffer brut sans dépendance externe
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.log('⚠️ Méthode non autorisée:', req.method);
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.error('⚠️ Pas de signature Stripe dans les headers');
    return res.status(400).send('Missing Stripe signature');
  }

  let buf;
  try {
    buf = await getRawBody(req);
  } catch (err) {
    console.error('Erreur lecture buffer:', err);
    return res.status(400).send('Invalid request body');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('Webhook Stripe reçu:', event.type);
  } catch (err) {
    console.error('⚠️ Signature webhook invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Session Stripe:', session.id);

    if (session.payment_status !== 'paid') {
      console.log(`Paiement non finalisé pour session ${session.id}, status: ${session.payment_status}`);
      return res.status(200).send('Paiement non finalisé');
    }

    try {
      const { data: order, error: fetchError } = await supabase
        .from('orders')
        .select('*')
        .eq('stripe_session_id', session.id)
        .single();

      if (fetchError) {
        console.error('Erreur récupération commande avant update:', fetchError);
        return res.status(404).send('Commande non trouvée pour cette session Stripe');
      }

      console.log('Commande trouvée:', order);

      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: 'completed' })
        .eq('stripe_session_id', session.id);

      if (updateError) {
        console.error('Erreur mise à jour commande Supabase:', updateError);
        return res.status(500).send('Erreur mise à jour commande');
      }

      console.log(`Commande Stripe session ${session.id} marquée comme completed ✅`);
      return res.status(200).send('Commande mise à jour');

    } catch (err) {
      console.error('Erreur interne lors du traitement du webhook:', err);
      return res.status(500).send('Erreur serveur interne');
    }
  } else {
    console.log('Événement Stripe ignoré:', event.type);
    res.status(200).send('Événement ignoré');
  }
}
