const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { prenom, email, panierPizzas, panierBoissons } = req.body;

  try {
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
          product_data: {
            name: nomPizza,
          },
          unit_amount: Math.round(prixTotal * 100), // en centimes
        },
        quantity: 1,
      });
    }

    // Ajouter les boissons
    for (const boisson of panierBoissons) {
      line_items.push({
        price_data: {
          currency: 'eur',
          product_data: {
            name: boisson.nom,
          },
          unit_amount: Math.round(boisson.prix * 100),
        },
        quantity: boisson.quantite,
      });
    }

    const successUrl = 'https://l-etoile-gourmande.vercel.app/success.html';
    const cancelUrl = 'https://l-etoile-gourmande.vercel.app/cancel.html';

    // Logs pour vérifier les URLs et line_items
    console.log('Success URL:', successUrl);
    console.log('Cancel URL:', cancelUrl);
    console.log('Line items:', JSON.stringify(line_items, null, 2));

    // Test avec URLs simples (remplace successUrl et cancelUrl par ceci pour tester)
//    const testSuccessUrl = 'https://example.com/success';
//    const testCancelUrl = 'https://example.com/cancel';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: successUrl, // remplace par testSuccessUrl pour tester
      cancel_url: cancelUrl,   // remplace par testCancelUrl pour tester
      customer_email: email,
    });

    res.status(200).json({ sessionId: session.id });
  } catch (error) {
    console.error('Stripe Error:', error);
    res.status(400).json({ error: 'Erreur lors de la création de la session Stripe' });
  }
}
