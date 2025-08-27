import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const config = {
  api: {
    bodyParser: false, // nécessaire pour Stripe
  },
};

// Fonction pour générer le préfixe de date JJMMAAAA
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
  // Vérifie la méthode POST
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.error('Pas de signature Stripe');
    return res.status(400).end('Missing Stripe signature');
  }

  let event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET.trim());
  } catch (err) {
    console.error('Signature webhook invalide:', err.message);
    return res.status(400).end(`Webhook Error: ${err.message}`);
  }

  // Répond rapidement à Stripe
  res.status(200).end('ok');

  // Traite en arrière-plan
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    (async () => {
      try {
        const { data: order, error } = await supabase
          .from('orders')
          .select('*')
          .eq('stripe_session_id', session.id)
          .maybeSingle();

        if (error) {
          console.error('Erreur récupération commande:', error);
          return;
        }

        if (!order) {
          console.warn(`Commande non trouvée pour session ${session.id}`);
          return;
        }

        const updatedFields = { status: 'completed' };

        // Si numero_cmd absent ou invalide, régénère
        if (!order.numero_cmd || order.numero_cmd.includes("NaN")) {
          const datePrefix = getDatePrefix();
          updatedFields.numero_cmd = `CMD-${datePrefix}-001`;
        }

        const { error: updateError } = await supabase
          .from('orders')
          .update(updatedFields)
          .eq('stripe_session_id', session.id);

        if (updateError) {
          console.error('Erreur mise à jour commande:', updateError);
          return;
        }

        console.log(`Commande ${session.id} mise à jour en arrière-plan`);
      } catch (err) {
        console.error('Erreur traitement commande:', err);
      }
    })();
  }
}
