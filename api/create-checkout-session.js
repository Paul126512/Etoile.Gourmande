import { createClient } from '@supabase/supabase-js';
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Fonction pour générer le numero_cmd
async function generateOrderNumber() {
  const now = new Date();
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getUTCFullYear());
  const datePrefix = `${dd}${mm}${yyyy}`;

  const { data } = await supabase
    .from('orders')
    .select('numero_cmd')
    .ilike('numero_cmd', `CMD-${datePrefix}-%`);

  let maxCount = 0;
  if (data && data.length > 0) {
    data.forEach(order => {
      const parts = order.numero_cmd.split('-');
      const count = parseInt(parts[2], 10);
      if (!isNaN(count) && count > maxCount) maxCount = count;
    });
  }

  const newCount = String(maxCount + 1).padStart(3, '0');
  return `CMD-${datePrefix}-${newCount}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { prenom, email, panierPizzas, panierBoissons } = req.body;

  try {
    const numero_cmd = await generateOrderNumber(); // <- génération du numero_cmd

    const line_items = [];

    // Ajouter les pizzas
    for (const pizza of panierPizzas) {
      let nomPizza = pizza.nom;
      let prixTotal = pizza.prix;

      if (pizza.supplements && pizza.supplements.length > 0) {
        const supList = pizza.supplements.map(s => `${s.nom} (+${s.prix.toFixed(2)}€)`).join(', ');
        nomPizza += ` - Suppléments: ${supList}`;
        const prixSupp = pizza.supplements.reduce((acc, s) => acc + s.prix, 0);
        prixTotal += prixSupp;
      }

      line_items.push({
        price_data: {
          currency: 'eur',
          product_data: { name: nomPizza },
          unit_amount: Math.round(prixTotal * 100),
        },
        quantity: 1,
      });
    }

    // Ajouter les boissons
    for (const boisson of panierBoissons) {
      line_items.push({
        price_data: {
          currency: 'eur',
          product_data: { name: boisson.nom },
          unit_amount: Math.round(boisson.prix * 100),
        },
        quantity: boisson.quantite,
      });
    }

    const successUrl = 'https://l-etoile-gourmande.vercel.app/success.html';
    const cancelUrl = 'https://l-etoile-gourmande.vercel.app/cancel.html';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email,
      metadata: { numero_cmd }, // <- numéro de commande ajouté ici
    });

    res.status(200).json({ sessionId: session.id, numero_cmd }); // renvoyer numero_cmd pour le front si besoin
  } catch (error) {
    console.error('Stripe Error:', error);
    res.status(400).json({ error: 'Erreur lors de la création de la session Stripe' });
  }
}
