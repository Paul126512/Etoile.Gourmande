import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Initialisation avec vérification des variables d'environnement
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  throw new Error('Supabase credentials are missing');
}
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Stripe secret key is missing');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // Log d'entrée
  console.log('[API] Requête reçue:', {
    method: req.method,
    headers: req.headers,
    body: req.body
  });

  try {
    // Vérification méthode HTTP
    if (req.method !== 'POST') {
      console.warn('[API] Méthode non autorisée:', req.method);
      return res.status(405).json({ 
        error: 'Méthode non autorisée',
        allowed_methods: ['POST']
      });
    }

    // Validation du corps de la requête
    if (!req.body || typeof req.body !== 'object') {
      console.error('[API] Corps de requête invalide');
      return res.status(400).json({ 
        error: 'Le corps de la requête doit être un objet JSON'
      });
    }

    // Destructuration avec valeurs par défaut
    const {
      name = '',
      email = '',
      panierPizzas = [],
      panierBoissons = [],
      panierBurgers = [],
      panierDesserts = [],
      panierBaseCremes = [],
      panierTacos = [],
      panierBagels = [],
      panierMenus = []
    } = req.body;

    // Validation des champs obligatoires
    if (!name.trim() || !email.trim()) {
      console.error('[API] Champs obligatoires manquants', { name, email });
      return res.status(400).json({ 
        error: 'Nom et email sont obligatoires',
        received: { name, email }
      });
    }

    // Validation email simple
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error('[API] Email invalide:', email);
      return res.status(400).json({ 
        error: 'Format email invalide'
      });
    }

    // Construction du tableau des produits avec validation
    const produits = [
      ...validateProducts(panierPizzas, 'pizza'),
      ...validateProducts(panierBoissons, 'boisson'),
      ...validateProducts(panierBurgers, 'burger'),
      ...validateProducts(panierDesserts, 'dessert'),
      ...validateProducts(panierBaseCremes, 'basecreme'),
      ...validateProducts(panierTacos, 'tacos'),
      ...validateProducts(panierBagels, 'bagel'),
      ...validateProducts(panierMenus, 'menu')
    ];

    if (produits.length === 0) {
      console.error('[API] Panier vide');
      return res.status(400).json({ 
        error: 'Le panier est vide',
        received: req.body
      });
    }

    // Calcul du total avec validation
    let totalCents = 0;
    for (const item of produits) {
      const prix = parseFloat(item.prix);
      const quantite = parseInt(item.quantite || 1, 10);

      if (isNaN(prix) {
        console.error('[API] Prix invalide:', item.prix);
        return res.status(400).json({ 
          error: `Prix invalide pour l'article ${item.nom || 'inconnu'}`,
          item
        });
      }

      if (isNaN(quantite) {
        console.error('[API] Quantité invalide:', item.quantite);
        return res.status(400).json({ 
          error: `Quantité invalide pour l'article ${item.nom || 'inconnu'}`,
          item
        });
      }

      totalCents += Math.round(prix * quantite * 100);
    }

    if (totalCents <= 0) {
      console.error('[API] Total invalide:', totalCents);
      return res.status(400).json({ 
        error: 'Le total doit être supérieur à zéro',
        total: totalCents / 100
      });
    }

    // Gestion du client dans Supabase
    let client;
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id')
        .eq('email', email)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (!data) {
        console.log('[Supabase] Création nouveau client');
        const { data: newClient, error: insertError } = await supabase
          .from('clients')
          .insert([{ name, email }])
          .select('id')
          .single();

        if (insertError) throw insertError;
        client = newClient;
      } else {
        client = data;
      }
    } catch (supabaseError) {
      console.error('[Supabase] Erreur:', supabaseError);
      throw new Error('Erreur de gestion du client');
    }

    // Préparation des items Stripe
    const lineItems = produits.map(item => {
      const baseItem = {
        price_data: {
          currency: 'eur',
          product_data: {
            name: item.nom,
            images: item.image ? [item.image] : ['https://via.placeholder.com/150?text=Produit']
          },
          unit_amount: Math.round(parseFloat(item.prix) * 100),
        },
        quantity: parseInt(item.quantite || 1, 10),
      };

      // Personnalisation pour les menus
      if (item.type === 'menu') {
        baseItem.price_data.product_data.description = [
          `Burger: ${item.options.burger}`,
          `Accompagnement: ${item.options.accompagnement === 'frites' ? 'Frites' : `Dessert (${item.options.dessert})`}`,
          `Boisson: ${item.options.boisson}`
        ].join(' | ');
      }

      return baseItem;
    });

    // Création de la session Stripe
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: `${process.env.SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_URL}/cancel.html`,
        customer_email: email,
        metadata: { 
          client_id: client.id,
          menu_details: JSON.stringify(
            produits
              .filter(p => p.type === 'menu')
              .map(m => ({
                burger: m.options.burger,
                accompagnement: m.options.accompagnement,
                dessert: m.options.dessert,
                boisson: m.options.boisson
              }))
          )
        },
      });
    } catch (stripeError) {
      console.error('[Stripe] Erreur:', stripeError);
      throw new Error('Erreur de création de session de paiement');
    }

    // Enregistrement de la commande
    try {
      const { error: orderError } = await supabase
        .from('orders')
        .insert([{
          client_id: client.id,
          email,
          produits,
          menu_details: produits
            .filter(p => p.type === 'menu')
            .map(m => ({
              burger: m.options.burger,
              accompagnement: m.options.accompagnement,
              dessert: m.options.dessert,
              boisson: m.options.boisson
            })),
          total_price: totalCents / 100,
          status: 'awaiting_payment',
          stripe_session_id: session.id,
          quantity: produits.reduce((acc, i) => acc + (parseInt(i.quantite || 1, 10)), 0),
        }]);

      if (orderError) throw orderError;
    } catch (orderError) {
      console.error('[Supabase] Erreur commande:', orderError);
      throw new Error('Erreur enregistrement commande');
    }

    console.log('[API] Commande traitée avec succès');
    return res.status(200).json({ 
      sessionId: session.id,
      success: true
    });

  } catch (error) {
    console.error('[API] Erreur globale:', error);
    return res.status(500).json({ 
      error: 'Erreur serveur',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Fonction de validation des produits
function validateProducts(items, expectedType) {
  if (!Array.isArray(items)) {
    console.warn(`[Validation] ${expectedType} n'est pas un tableau`);
    return [];
  }

  return items.map(item => {
    // Validation basique de la structure
    if (typeof item !== 'object' || item === null) {
      console.warn('[Validation] Produit invalide (non objet)', item);
      return null;
    }

    // Vérification du type
    if (item.type && item.type !== expectedType) {
      console.warn(`[Validation] Type inattendu: ${item.type} (attendu: ${expectedType})`);
    }

    return {
      ...item,
      type: expectedType,
      prix: parseFloat(item.prix || 0),
      quantite: parseInt(item.quantite || 1, 10)
    };
  }).filter(Boolean); // Filtre les éléments null
}
