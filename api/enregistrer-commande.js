import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const ALLOWED_ORIGINS = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'https://etoile-gourmande-one.vercel.app'
];

export default async function handler(req, res) {
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

  const {
    client, pizzas, boissons, burgers, desserts,
    menus, bagels, tacos, pates, sandwitchs_froids, salades
    // On exclut volontairement les suppléments ici
  } = req.body;

  if (!client || !client.name || !client.email) {
    return res.status(400).json({ message: 'Nom et email obligatoires.' });
  }

  const { name, email } = client;

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Adresse email invalide.' });
  }

  // On regroupe tous les produits
  const produits = [
    ...(Array.isArray(pizzas) ? pizzas : []),
    ...(Array.isArray(burgers) ? burgers : []),
    ...(Array.isArray(bagels) ? bagels : []),
    ...(Array.isArray(menus) ? menus : []),
    ...(Array.isArray(boissons) ? boissons : []),
    ...(Array.isArray(desserts) ? desserts : []),
    ...(Array.isArray(tacos) ? tacos : []),
    ...(Array.isArray(sandwitchs_froids) ? sandwitchs_froids : []),
    ...(Array.isArray(salades) ? salades : []),
    ...(Array.isArray(pates) ? pates : []),
    // Pas les suppléments ici
  ];

  if (produits.length === 0) {
    return res.status(400).json({ message: 'Votre panier est vide.' });
  }

  // Calcul du total (prix incluant suppléments dans item.prix)
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
    // Recherche client en base
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

    // Génération numéro commande du jour
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

    // Préparation des lineItems Stripe sans suppléments
// Préparation des lineItems Stripe (affichage des suppléments en description)
const lineItems = produits.map(item => {
  const quantiteProduit = parseInt(item.quantite || 1, 10);
  let description = item.description || '';

  // Ajout des suppléments à la description SEULEMENT
  if (item.supplements?.length > 0) {
    description += (description ? '\n\n' : '') + 'Suppléments inclus :';
    description += item.supplements.map(sup => 
      `\n• ${sup.nom}`
    ).join('');
  }

return {
  price_data: {
    currency: 'eur',
    product_data: {
      name: `${item.nom}${item.taille ? ` (${item.taille})` : ''}`.trim(),
      images: item.image 
        ? [resizeImageUrl(item.image, 400, 400)] // Fonction de redimensionnement (exemple)
        : ['https://etoile-gourmande.fr/placeholder-400x400.jpg'], // Image par défaut carrée
      description: [
        item.description,
        item.supplements?.length > 0 && 'Suppléments :',
        ...(item.supplements?.map(s => `• ${s.nom}`) || [])
      ].filter(Boolean).join('\n') || undefined,
    },
    unit_amount: Math.round(item.prix * 100),
  },
  quantity: quantiteProduit,
};
    

    // Création session Stripe
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

    // Sauvegarde commande dans Supabase, avec produits + suppléments pour affichage
    const { error: orderError } = await supabase
      .from('orders')
      .insert([{
        numero_cmd,
        client_id: existingClient.id,
        email,
        name,
        produits, // contient produits avec leurs suppléments pour l’affichage après
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
