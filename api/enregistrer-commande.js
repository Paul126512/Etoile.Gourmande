import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  const { name, email, panierPizzas, panierBoissons, panierBurgers, panierDesserts, panierBaseCremes, panierTacos } = req.body;

  if (!name || !email) {
    return res.status(400).json({ message: 'Nom et email obligatoires.' });
  }

  // Récupérer tous les paniers, s'assurer que ce sont des tableaux
  const produits = [
    ...(Array.isArray(panierPizzas) ? panierPizzas : []),
    ...(Array.isArray(panierBoissons) ? panierBoissons : []),
    ...(Array.isArray(panierBurgers) ? panierBurgers : []),
    ...(Array.isArray(panierDesserts) ? panierDesserts : []),
    ...(Array.isArray(panierBaseCremes) ? panierBaseCremes : []),
    ...(Array.isArray(panierTacos) ? panierTacos : []),
  ];

  if (produits.length === 0) {
    return res.status(400).json({ message: 'Votre panier est vide.' });
  }

  // Calcul du total en centimes
  let totalCents = 0;
  for (const item of produits) {
    const prix = parseFloat(item.prix);
    const quantite = parseInt(item.quantite || 1, 10);

    if (isNaN(prix) || prix < 0 || isNaN(quantite) || quantite <= 0) {
      return res.status(400).json({ message: `Données invalides dans le panier pour l'article ${item.nom || 'inconnu'}.` });
    }

    totalCents += Math.round(prix * quantite * 100);
  }

  if (totalCents <= 0) {
    return res.status(400).json({ message: 'Le total doit être supérieur à zéro.' });
  }

  try {
    // Rechercher ou créer client Supabase
    let { data: client, error } = await supabase
      .from('clients')
      .select('id')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!client) {
      const { data: newClient, error: errInsert } = await supabase
        .from('clients')
        .insert([{ name, email }])
        .select('id')
        .single();

      if (errInsert) throw errInsert;
      client = newClient;
    }

    // Préparer les items Stripe
    const lineItems = produits.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: `${item.nom} ${item.taille ? `(${item.taille})` : ''}`,
          description: item.description || '',
          images: item.image ? [item.image] : ['https://via.placeholder.com/150?text=Produit'],
        },
        unit_amount: Math.round(parseFloat(item.prix) * 100),
      },
      quantity: parseInt(item.quantite || 1, 10),
    }));

    // Créer session Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/cancel.html`,
      customer_email: email,
      metadata: { client_id: client.id },
    });

    // Enregistrer la commande dans Supabase
    const { error: orderError } = await supabase
      .from('orders')
      .insert([{
        client_id: client.id,
        email,
        produits,
        total_price: totalCents / 100,
        status: 'awaiting_payment',
        stripe_session_id: session.id,
        quantity: produits.reduce((acc, i) => acc + (parseInt(i.quantite || 1, 10)), 0),
      }]);

    if (orderError) throw orderError;

    return res.status(200).json({ sessionId: session.id });

  } catch (err) {
    console.error('Erreur:', err);
    return res.status(500).json({ message: 'Erreur serveur lors du traitement de la commande.' });
  }
}
