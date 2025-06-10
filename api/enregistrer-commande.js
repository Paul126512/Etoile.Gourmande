import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,  // Your Supabase project URL
  process.env.SUPABASE_KEY   // Your Supabase public/anonymous key
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { name, email, panierPizzas = [], panierBoissons = [] } = req.body;

  // Validation renforcée
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Le nom doit contenir au moins 2 caractères' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }
  if (panierPizzas.length === 0 && panierBoissons.length === 0) {
    return res.status(400).json({ error: 'Le panier est vide' });
  }

  // Calcul des totaux
  const totalQuantity = [...panierPizzas, ...panierBoissons]
    .reduce((acc, item) => acc + (item.quantite || 1), 0);

  const totalPrix = [...panierPizzas, ...panierBoissons]
    .reduce((acc, item) => acc + ((item.prix || 0) * (item.quantite || 1)), 0);

  try {
    // Recherche du client existant
    let { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('email', email)
      .single();

    if (clientError && clientError.code !== 'PGRST116') throw clientError;

    // Si client non trouvé, création d'un nouveau client
    if (!client) {
      const { data: newClient, error: insertError } = await supabase
        .from('clients')
        .insert([{ name, email }])
        .select('id')
        .single();

      if (insertError) throw insertError;
      client = newClient;
    }

    // Création de la commande
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([{
        client_id: client.id,
        pizzas: panierPizzas,
        boissons: panierBoissons,
        quantity: totalQuantity,
        prix: totalPrix,
        email,
        status: 'pending'
      }])
      .select('id')
      .single();

    if (orderError) throw orderError;

    // Création session Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Commande #${order.id}`,
          },
          unit_amount: Math.round(totalPrix * 100), // en centimes
        },
        quantity: 1,
      }],
      customer_email: email,
      success_url: `${process.env.SITE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/cancel`,
      metadata: {
        order_id: order.id,
        client_id: client.id,
      },
    });

    // Mise à jour de la commande avec l'id session Stripe
    const { error: updateError } = await supabase
      .from('orders')
      .update({ stripe_session_id: session.id })
      .eq('id', order.id);

    if (updateError) throw updateError;

    return res.status(200).json({ sessionId: session.id });

  } catch (error) {
    console.error('Erreur:', error);
    return res.status(500).json({
      error: 'Erreur serveur',
      details: error.message || error.toString(),
    });
  }
}
