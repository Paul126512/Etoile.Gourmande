import { buffer } from 'micro';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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
  let event;

  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Signature Stripe invalide :', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // ✅ Vérification stricte du paiement
      if (session.payment_status === 'paid') {
        const sessionId = session.id;

        // 🔍 Debug : log le sessionId
        console.log('🔍 Session Stripe ID:', sessionId);

        // ✅ Mise à jour dans Supabase
        const { error } = await supabase
          .from('orders')
          .update({ status: 'completed' })
          .eq('stripe_session_id', sessionId);

        if (error) {
          console.error('❌ Erreur Supabase:', error);
          return res.status(500).send('Erreur Supabase lors de la mise à jour');
        }

        console.log('✅ Commande mise à jour avec succès');
      } else {
        console.warn('⚠️ Paiement non payé:', session.payment_status);
      }
    }

    return res.status(200).send('✅ Webhook reçu');
  } catch (err) {
    console.error('❌ Erreur inattendue dans le webhook :', err);
    return res.status(500).send('Erreur serveur');
  }
}
