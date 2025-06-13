import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  try {
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
      console.log('Buffer brut reçu, taille:', buf.length);
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
      console.log('Session Stripe ID:', session.id);

      if (session.payment_status !== 'paid') {
        console.log(`Paiement non finalisé pour session ${session.id}, status: ${session.payment_status}`);
        return res.status(200).send('Paiement non finalisé');
      }

      // Utiliser maybeSingle() pour éviter erreur si pas trouvé
      const { data: order, error: fetchError } = await supabase
        .from('orders')
        .select('*')
        .eq('stripe_session_id', session.id)
        .maybeSingle();

      if (fetchError) {
        console.error('Erreur récupération commande:', fetchError);
        return res.status(500).send('Erreur récupération commande');
      }

      if (!order) {
        console.warn(`Commande non trouvée pour session Stripe ${session.id}`);
        // Ici tu peux choisir de créer la commande, ou juste retourner 404
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

      console.log(`Commande Stripe session ${session.id} mise à jour en "completed" ✅`);
      return res.status(200).send('Commande mise à jour');
    } else {
      console.log('Événement Stripe ignoré:', event.type);
      return res.status(200).send('Événement ignoré');
    }
  } catch (err) {
    console.error('Erreur globale inattendue:', err);
    return res.status(500).send('Erreur serveur inattendue');
  }
}
