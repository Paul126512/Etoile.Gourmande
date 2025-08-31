import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { prenom, email, panierPizzas, panierBoissons } = req.body;

    // 1️⃣ Générer le numero_cmd
    const orderResponse = await fetch(`${process.env.NEXT_PUBLIC_URL}/api/orderManager`);
    const { orderId: numero_cmd } = await orderResponse.json();

    // 2️⃣ Créer line_items
    const line_items = [];

    for (const pizza of panierPizzas) {
      let nomPizza = pizza.nom;
      let prixTotal = pizza.prix;

      if (pizza.supplements?.length > 0) {
        const supList = pizza.supplements.map(s => `${s.nom} (+${s.prix.toFixed(2)}€)`).join(', ');
        nomPizza += ` - Suppléments: ${supList}`;
        prixTotal += pizza.supplements.reduce((acc, s) => acc + s.prix, 0);
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

    // 3️⃣ Créer la session Stripe avec metadata
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_URL}/success.html`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL}/cancel.html`,
      customer_email: email,
      metadata: { numero_cmd }, // <- important !
    });

    // 4️⃣ Insérer la commande dans Supabase
    await supabase.from('orders').insert([{
      client_id: prenom,
      email,
      produits: [...panierPizzas, ...panierBoissons],
      total_price: line_items.reduce((acc, i) => acc + (i.price_data.unit_amount / 100) * i.quantity, 0),
      status: 'awaiting_payment',
      numero_cmd,
      created_at: new Date(),
    }]);

    res.status(200).json({ sessionId: session.id });

  } catch (err) {
    console.error('Erreur create-checkout-session:', err);
    res.status(500).json({ error: 'Erreur lors de la création de la session' });
  }
}
