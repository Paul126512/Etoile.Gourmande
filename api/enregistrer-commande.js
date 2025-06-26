import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Fonction pour redimensionner les URLs d'images
function resizeImageUrl(url, width = 400, height = 400) {
  if (!url) return null;
  if (url.includes('cloudinary.com')) {
    return url.replace('/upload/', `/upload/w_${width},h_${height},c_fill/`);
  }
  return url;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const ALLOWED_ORIGINS = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'https://etoile-gourmande-one.vercel.app'
];

export default async function handler(req, res) {
  // Gestion des CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  // Extraction des données
  const { client, pizzas, boissons, burgers, desserts, menus, bagels, tacos, pates, sandwitchs_froids, sandwitchs_chauds, salades } = req.body;

  // Validation des données client
  if (!client || !client.name || !client.email) {
    return res.status(400).json({ message: 'Nom et email obligatoires.' });
  }

  const { name, email } = client;
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Adresse email invalide.' });
  }

  // Regroupement des produits
  const produits = [
    ...(Array.isArray(pizzas) ? pizzas : []),
    ...(Array.isArray(burgers) ? burgers : []),
    ...(Array.isArray(bagels) ? bagels : []),
    ...(Array.isArray(menus) ? menus : []),
    ...(Array.isArray(boissons) ? boissons : []),
    ...(Array.isArray(desserts) ? desserts : []),
    ...(Array.isArray(tacos) ? tacos : []),
    ...(Array.isArray(sandwitchs_froids) ? sandwitchs_froids : []),
    ...(Array.isArray(sandwitchs_chauds) ? sandwitchs_chauds : []),
    ...(Array.isArray(salades) ? salades : []),
    ...(Array.isArray(pates) ? pates : [])
  ];

  if (produits.length === 0) {
    return res.status(400).json({ message: 'Votre panier est vide.' });
  }

  // Calcul du total
  let totalCents = 0;
  for (const item of produits) {
    const prix = parseFloat(item.prix);
    const quantite = parseInt(item.quantite || 1, 10);

    if (isNaN(prix) || prix < 0 || isNaN(quantite) || quantite <= 0) {
      return res.status(400).json({ message: `Données invalides pour ${item.nom || 'un article'}.` });
    }
    totalCents += Math.round(prix * quantite * 100);
  }

  if (totalCents <= 0) {
    return res.status(400).json({ message: 'Total invalide.' });
  }

  try {
    // Gestion du client
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

    // Génération du numéro de commande
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T00:00:00Z`)
      .lte('created_at', `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T23:59:59Z`);

    const numero_cmd = `CMD-${dateStr.slice(6, 8)}${dateStr.slice(4, 6)}${dateStr.slice(0, 4)}-${String((count || 0) + 1).padStart(3, '0')}`;

    // Préparation des articles pour Stripe
    const lineItems = produits.map(item => {
      const description = [
        item.description,
        ...(item.supplements?.map(s => `• ${s.nom}`) || [])
      ].filter(Boolean).join('\n') || undefined;

      return {
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${item.nom}${item.taille ? ` (${item.taille})` : ''}`.trim(),
            images: item.image ? [resizeImageUrl(item.image)] : [],
            description,
          },
          unit_amount: Math.round(item.prix * 100),
        },
        quantity: parseInt(item.quantite || 1, 10),
      };
    });

    // Création de la session Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
     cancel_url: `${process.env.SITE_URL}/cancel.html`,
      customer_email: email,
      metadata: { client_id: existingClient.id, numero_cmd },
      shipping_address_collection: { allowed_countries: ['FR'] },
    });

    // Sauvegarde de la commande
    const { error: orderError } = await supabase.from('orders').insert({
      numero_cmd,
      client_id: existingClient.id,
      email,
      name,
      produits,
      total_price: totalCents / 100,
      status: 'awaiting_payment',
      stripe_session_id: session.id,
    });

    if (orderError) throw orderError;

    return res.status(200).json({ paymentUrl: session.url, numero_cmd });

  } catch (err) {
    console.error('Erreur:', err);
    return res.status(500).json({
      message: 'Erreur lors du traitement de la commande',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
}
