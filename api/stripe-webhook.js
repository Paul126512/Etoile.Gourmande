import { buffer } from 'micro';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Méthode non autorisée');
  }

  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Erreur de vérification Stripe Webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ⚠️ Paiement réussi ?
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Récupération de l'ID session Stripe
    const sessionId = session.id;

    // Mettre à jour la commande dans Supabase
    const { error } = await supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('stripe_session_id', sessionId);

    if (error) {
      console.error('Erreur mise à jour Supabase:', error);
      return res.status(500).send('Erreur serveur');
    }

    console.log('Commande marquée completed ✅');
  }

  res.status(200).send('Webhook reçu');
}
