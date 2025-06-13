import { buffer } from 'micro';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const config = {
  api: {
    bodyParser: false, // nécessaire pour récupérer le buffer brut de la requête
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);

  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️ Signature webhook invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // On ne traite que l'événement checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Vérifier que le paiement est bien payé
    if (session.payment_status === 'paid') {
      try {
        const { error } = await supabase
          .from('orders')
          .update({ status: 'completed' })
          .eq('stripe_session_id', session.id);

        if (error) {
          console.error('Erreur mise à jour commande Supabase:', error);
          return res.status(500).send('Erreur mise à jour commande');
        }

        console.log(`Commande Stripe session ${session.id} marquée comme completed ✅`);
      } catch (err) {
        console.error('Erreur interne:', err);
        return res.status(500).send('Erreur serveur interne');
      }
    } else {
      console.log(`Paiement non finalisé pour session ${session.id}, status: ${session.payment_status}`);
    }
  }

  res.status(200).send('Webhook reçu');
}
