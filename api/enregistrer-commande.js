import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const allowedOrigins = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'https://etoile-gourmande-one.vercel.app'
];

export default async function handler(req, res) {
  // Gestion CORS
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Réponse à la requête prévol OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // On accepte uniquement POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  const { client, pizzas, boissons, burgers, desserts, supplements, menus, bagels, tacos } = req.body;

  if (!client || !client.name || !client.email) {
    return res.status(400).json({ message: 'Nom et email obligatoires.' });
  }

  const { name, email } = client;

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Adresse email invalide.' });
  }

  const produits = [
    ...(Array.isArray(pizzas) ? pizzas : []),
    ...(Array.isArray(burgers) ? burgers : []),
    ...(Array.isArray(bagels) ? bagels : []),
    ...(Array.isArray(menus) ? menus : []),
    ...(Array.isArray(boissons) ? boissons : []),
    ...(Array.isArray(desserts) ? desserts : []),
    ...(Array.isArray(tacos) ? tacos : [])
  ];

  if (produits.length === 0) {
    return res.status(400).json({ message: 'Votre panier est vide.' });
  }

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
    // Vérifie si le client existe déjà
    let { data: existingClient, error } = await supabase
      .from('clients')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;

    if (!existingClient) {
      const { data: newClient, error: insertError } = await supabase
        .from('clients')
        .insert([{ name, email }])
        .select('id')
        .single();

      if (insertError) throw insertError;

      existingClient = newClient;
    }

    // Génération du numéro de commande unique avec compteur incrémental par jour
    const now = new Date();

    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();

    const dateDebut = `${year}-${month}-${day}T00:00:00Z`;
    const dateFin = `${year}-${month}-${day}T23:59:59Z`;

    const { count, error: countError } = await supabase
      .from('orders')
      .select('numero_cmd', { count: 'exact', head: true })
      .gte('created_at', dateDebut)
      .lte('created_at', dateFin);

    if (countError) throw countError;

    const compteur = String((count || 0) + 1).padStart(3, '0');
    const numero_cmd = `CMD-${day}${month}${year}-${compteur}`;

    console.log('Numéro de commande généré :', numero_cmd);

    const lineItems = [];

    for (const item of produits) {
      const quantiteProduit = parseInt(item.quantite || 1, 10);

      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${item.nom} ${item.taille ? `(${item.taille})` : ''}`.trim(),
            images: item.image ? [item.image] : ['https://via.placeholder.com/150?text=Produit'],
            description: item.description || undefined,
          },
          unit_amount: Math.round(parseFloat(item.prix) * 100),
        },
        quantity: quantiteProduit,
      });

      if (Array.isArray(item.supplements) && item.supplements.length > 0) {
        for (const supp of item.supplements) {
          const quantiteSupp = supp.quantite ? parseInt(supp.quantite, 10) : quantiteProduit;
          lineItems.push({
            price_data: {
              currency: 'eur',
              product_data: {
                name: `Supplément : ${supp.nom || 'supplément'}`,
              },
              unit_amount: Math.round(parseFloat(supp.prix || 0) * 100),
            },
            quantity: quantiteSupp,
          });
        }
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/cancel.html`,
      customer_email: email,
      metadata: {
        client_id: existingClient.id,
        numero_cmd
      }
    });

    const { error: orderError } = await supabase
      .from('orders')
      .insert([{
        numero_cmd,
        client_id: existingClient.id,
        email,
        name,
        produits,
        total_price: totalCents / 100,
        status: 'awaiting_payment',
        stripe_session_id: session.id,
        quantity: produits.reduce((acc, i) => acc + (parseInt(i.quantite || 1, 10)), 0),
      }]);

    if (orderError) throw orderError;

    return res.status(200).json({ paymentUrl: session.url, numero_cmd });

  } catch (err) {
    console.error('Erreur:', err);
    return res.status(500).json({
      message: 'Erreur serveur lors du traitement de la commande.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
}
