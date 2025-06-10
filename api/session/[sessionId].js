import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Initialise Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialise Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID manquant' });
  }

  try {
    // Récupérer la session Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Récupérer les line items
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
      limit: 100,
      expand: ['data.price.product'],
    });
    session.line_items = lineItems;

    // Prépare les données à insérer dans Supabase
    const clientData = {
      email: session.customer_details?.email || null,
      prenom: session.customer_details?.name ? session.customer_details.name.split(' ')[0] : null,
      nom: session.customer_details?.name ? session.customer_details.name.split(' ').slice(1).join(' ') : null,
      montant: session.amount_total / 100, // en euros si c’est en centimes
      stripe_session_id: session.id,
      created_at: new Date().toISOString(),
    };

    // Insert dans Supabase (table 'clients')
    const { data, error } = await supabase
      .from('clients')
      .insert([clientData]);

    if (error) {
      console.error('Erreur insertion Supabase:', error);
      return res.status(500).json({ error: 'Erreur insertion base de données' });
    }

    return res.status(200).json({ stripeSession: session, clientData: data });
  } catch (error) {
    console.error('Erreur récupération session Stripe:', error);
    return res.status(500).json({ error: 'Erreur récupération session Stripe' });
  }
}
