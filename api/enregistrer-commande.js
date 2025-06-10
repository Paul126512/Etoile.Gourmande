// api/enregistrer-commande.js

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Initialisation de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Utilisez SUPABASE_KEY ou SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialisation de Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = new Stripe(stripeSecretKey);

// URL de votre site (pour les redirections Stripe)
const siteUrl = process.env.SITE_URL;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée.' });
    }

    const { name, email, panierPizzas, panierBoissons } = req.body;

    if (!name || !email || !panierPizzas || !panierBoissons) {
        return res.status(400).json({ message: 'Données de commande incomplètes.' });
    }

    // Combine all cart items into a single array
    // Vous avez déjà le panier complet dans le localStorage sur le client,
    // mais ici on le reconstitue à partir de ce que le client a envoyé,
    // ce qui est une bonne pratique de sécurité.
    const produits = [...panierPizzas, ...panierBoissons];

    // Calcul du prix total côté serveur (pour la sécurité)
    let totalCents = 0;
    produits.forEach(item => {
        // Assurez-vous que le prix de l'article est bien un nombre
        const prixItem = parseFloat(item.prix);
        const quantiteItem = parseInt(item.quantite || 1, 10);
        if (isNaN(prixItem) || isNaN(quantiteItem)) {
            console.error(`Invalid item price or quantity: ${JSON.stringify(item)}`);
            throw new Error('Prix ou quantité d\'article invalide.');
        }
        totalCents += Math.round(prixItem * quantiteItem * 100); // Prix en centimes
    });

    if (totalCents <= 0) {
        return res.status(400).json({ message: 'Le total de la commande doit être supérieur à zéro.' });
    }

    let client_id;

    try {
        // 1. Chercher ou créer le client
        let { data: clientData, error: clientError } = await supabase
            .from('clients')
            .select('id')
            .eq('email', email)
            .single();

        if (clientError && clientError.code !== 'PGRST116') { // PGRST116 = ligne non trouvée
            console.error('Supabase client lookup error:', clientError);
            throw new Error('Failed to lookup client: ' + clientError.message);
        }

        if (!clientData) {
            // Client non trouvé, le créer
            const { data: newClientData, error: newClientError } = await supabase
                .from('clients')
                .insert([{ name, email }])
                .select('id')
                .single();

            if (newClientError) {
                console.error('Supabase client insert error:', newClientError);
                throw new Error('Failed to create client: ' + newClientError.message);
            }
            client_id = newClientData.id;
        } else {
            client_id = clientData.id;
        }

        // 2. Créer une session Stripe Checkout
        const lineItems = produits.map(item => ({
            price_data: {
                currency: 'eur',
                product_data: {
                    name: `${item.nom} ${item.taille ? `(${item.taille})` : ''}`,
                    // Ajoutez ici une description des suppléments si pertinent pour Stripe
                    description: item.supplements && item.supplements.length > 0
                        ? `Suppléments: ${item.supplements.map(s => s.nom).join(', ')}`
                        : item.description,
                    images: [item.image || 'https://via.placeholder.com/150'] // URL d'image pour Stripe
                },
                unit_amount: Math.round(parseFloat(item.prix) * 100), // Prix unitaire en centimes
            },
            quantity: item.quantite || 1,
        }));

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${siteUrl}/cancel.html`,
            customer_email: email, // Pré-remplir l'email du client
            metadata: {
                client_id: client_id,
                // Stockez tous les produits JSON dans les metadata si vous le souhaitez
                // Ou mieux, dans la base de données comme on va le faire ci-dessous
            },
        });

        // 3. Enregistrer la commande dans la base de données
        const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .insert([
                {
                    client_id: client_id,
                    email: email,
                    // Utiliser la colonne 'produits' pour stocker tous les articles combinés
                    // Assurez-vous que 'produits' est de type JSONB dans Supabase
                    produits: produits, // <--- C'est la ligne clé modifiée
                    total_price: totalCents / 100, // Stocker le prix en €
                    status: 'awaiting_payment', // Le statut initial
                    stripe_session_id: session.id,
                    quantity: produits.reduce((sum, item) => sum + (item.quantite || 1), 0), // Quantité totale d'articles
                }
            ])
            .select()
            .single();

        if (orderError) {
            console.error('Supabase order insert error:', orderError);
            throw new Error('Failed to create order: ' + orderError.message);
        }

        return res.status(200).json({ sessionId: session.id });

    } catch (error) {
        console.error('API Error:', error.message);
        return res.status(500).json({ message: `Erreur lors du traitement de la commande : ${error.message}` });
    }
}
