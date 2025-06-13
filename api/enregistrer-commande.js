import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Initialisation avec vérification
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey || !stripeKey) {
  throw new Error('Configuration manquante');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const stripe = new Stripe(stripeKey);

export default async function handler(req, res) {
  // Vérification méthode HTTP
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    // Destructuration sécurisée
    const body = req.body || {};
    const { name, email, ...paniers } = body;

    // Validation minimale
    if (!name || !email) {
      return res.status(400).json({ error: 'Nom et email requis' });
    }

    // Fusion des paniers
    const produits = Object.values(paniers).flat().filter(Boolean);

    if (produits.length === 0) {
      return res.status(400).json({ error: 'Panier vide' });
    }

    // Calcul du total
    const total = produits.reduce((sum, item) => {
      const prix = Number(item.prix) || 0;
      const quantite = Number(item.quantite) || 1;
      return sum + (prix * quantite);
    }, 0);

    // Gestion client
    let client = await supabase
      .from('clients')
      .select('id')
      .eq('email', email)
      .single();

    if (!client.data) {
      client = await supabase
        .from('clients')
        .insert([{ name, email }])
        .select('id')
        .single();
    }

    // Préparation items Stripe
    const lineItems = produits.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.nom || 'Article sans nom',
          ...(item.type === 'menu' && {
            description: `Menu: ${item.options?.burger || ''} + ${item.options?.accompagnement || ''}`
          })
        },
        unit_amount: Math.round((item.prix || 0) * 100)
      },
      quantity: item.quantite || 1
    }));

    // Session Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/success.html`,
      cancel_url: `${process.env.SITE_URL}/cart.html`,
      customer_email: email,
      metadata: {
        client_id: client.data.id
      }
    });

    // Enregistrement commande
    await supabase.from('orders').insert({
      client_id: client.data.id,
      email,
      produits,
      total_price: total,
      stripe_session_id: session.id,
      status: 'pending'
    });

    return res.json({ id: session.id });

  } catch (err) {
    console.error('Erreur API:', err);
    return res.status(500).json({ 
      error: 'Erreur interne',
      ...(process.env.NODE_ENV === 'development' && { details: err.message })
    });
  }
}
