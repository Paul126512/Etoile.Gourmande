// pages/api/stripe-webhook.js
import { buffer } from 'micro';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Désactive le parsing automatique pour les webhooks
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf.toString(), sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Erreur signature webhook Stripe:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Vérifie le type d'événement Stripe
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email;
    const total = session.amount_total / 100; // converti en euros

    console.log(`Paiement réussi pour ${email}, total ${total}€`);

    // Met à jour la commande correspondante dans Supabase
    const { data, error } = await supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('email', email)
      .eq('total_price', total);
      .eq('numero_cmd', numero_cmd);

    
    if (error) console.error('Erreur mise à jour commande:', error);
    else console.log('Commande mise à jour:', data);
  }

  res.status(200).json({ received: true });
}

