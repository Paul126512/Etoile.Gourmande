// api/enregistrer-commande.js

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// --- Initialisation des clients API ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const siteUrl = process.env.SITE_URL;

if (!supabaseUrl) {
    console.error('ERREUR DE CONFIGURATION: La variable d\'environnement SUPABASE_URL n\'est pas définie.');
}
if (!supabaseKey) {
    console.error('ERREUR DE CONFIGURATION: La variable d\'environnement SUPABASE_KEY n\'est pas définie.');
}
if (!stripeSecretKey) {
    console.error('ERREUR DE CONFIGURATION: La variable d\'environnement STRIPE_SECRET_KEY n\'est pas définie.');
}
if (!siteUrl) {
    console.warn('ATTENTION: La variable d\'environnement SITE_URL n\'est pas définie. Les redirections Stripe pourraient ne pas fonctionner correctement.');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const stripe = new Stripe(stripeSecretKey);

// --- Handler de la fonction Serverless ---
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée. Seules les requêtes POST sont acceptées.' });
    }

    // --- MODIFICATION ICI : AJOUT DE panierBurgers et potentiellement d'autres paniers ---
    const { name, email, panierPizzas, panierBoissons, panierBurgers, panierDesserts, panierBaseCremes } = req.body;

    // Validation des données d'entrée minimales
    if (!name || !email) {
        return res.status(400).json({ message: 'Le nom et l\'email sont obligatoires.' });
    }

    // --- MODIFICATION ICI : S'assurer que tous les paniers sont bien des tableaux ---
    // Et les initialiser à un tableau vide si undefined, pour éviter les erreurs .isArray()
    const safePanierPizzas = Array.isArray(panierPizzas) ? panierPizzas : [];
    const safePanierBoissons = Array.isArray(panierBoissons) ? panierBoissons : [];
    const safePanierBurgers = Array.isArray(panierBurgers) ? panierBurgers : [];
    const safePanierDesserts = Array.isArray(panierDesserts) ? panierDesserts : []; // Exemple pour les desserts
    const safePanierBaseCremes = Array.isArray(panierBaseCremes) ? panierBaseCremes : []; // Exemple pour les bases crèmes


    // Combiner tous les articles du panier en un seul tableau `produits`
    // --- MODIFICATION ICI : INCLUSION DE TOUS LES PANIERS ---
    const produits = [
        ...safePanierPizzas,
        ...safePanierBoissons,
        ...safePanierBurgers,
        ...safePanierDesserts, // Inclure les desserts
        ...safePanierBaseCremes // Inclure les bases crèmes
    ];

    // Si le panier est vide après combinaison, retourner une erreur
    if (produits.length === 0) {
        return res.status(400).json({ message: 'Votre panier est vide. Veuillez ajouter des articles pour passer commande.' });
    }

    // Calcul du prix total côté serveur (pour la sécurité et la fiabilité)
    let totalCents = 0;
    for (const item of produits) {
        const prixItem = parseFloat(item.prix);
        const quantiteItem = parseInt(item.quantite || 1, 10);

        if (isNaN(prixItem) || prixItem < 0) {
            console.error(`Erreur: Prix d'article invalide ou manquant: ${JSON.stringify(item)}`);
            return res.status(400).json({ message: `Prix invalide pour l'article ${item.nom || 'inconnu'}. Veuillez vérifier le panier.` });
        }
        if (isNaN(quantiteItem) || quantiteItem <= 0) {
            console.error(`Erreur: Quantité d'article invalide ou manquante: ${JSON.stringify(item)}`);
            return res.status(400).json({ message: `Quantité invalide pour l'article ${item.nom || 'inconnu'}. Veuillez vérifier le panier.` });
        }
        totalCents += Math.round(prixItem * quantiteItem * 100);
    }

    if (totalCents <= 0) {
        return res.status(400).json({ message: 'Le total de la commande doit être supérieur à zéro.' });
    }

    let client_id;

    try {
        // --- 1. Chercher ou créer le client dans Supabase ---
        let { data: clientData, error: clientLookupError } = await supabase
            .from('clients')
            .select('id')
            .eq('email', email)
            .single();

        if (clientLookupError && clientLookupError.code !== 'PGRST116') {
            console.error('Erreur Supabase lors de la recherche du client:', clientLookupError);
            throw new Error(`Échec de la recherche du client : ${clientLookupError.message}`);
        }

        if (!clientData) {
            const { data: newClientData, error: newClientError } = await supabase
                .from('clients')
                .insert([{ name, email }])
                .select('id')
                .single();

            if (newClientError) {
                console.error('Erreur Supabase lors de la création du client:', newClientError);
                throw new Error(`Échec de la création du client : ${newClientError.message}`);
            }
            client_id = newClientData.id;
        } else {
            client_id = clientData.id;
        }

        // --- 2. Créer une session Stripe Checkout ---
        const lineItems = produits.map(item => {
            const productData = {
                name: `${item.nom} ${item.taille ? `(${item.taille})` : ''}`,
                images: [item.image || 'https://via.placeholder.com/150?text=Produit'],
            };

            if (item.description && item.description.trim() !== '') {
                productData.description = item.description;
            } else if (item.supplements && item.supplements.length > 0) {
                productData.description = `Suppléments: ${item.supplements.map(s => s.nom).join(', ')}`;
            }

            return {
                price_data: {
                    currency: 'eur',
                    product_data: productData,
                    unit_amount: Math.round(parseFloat(item.prix) * 100),
                },
                quantity: parseInt(item.quantite || 1, 10),
            };
        });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${siteUrl}/cancel.html`,
            customer_email: email,
            metadata: {
                client_id: client_id,
            },
        });

        // --- 3. Enregistrer la commande dans la base de données Supabase ---
        const { data: orderData, error: orderInsertError } = await supabase
            .from('orders')
            .insert([
                {
                    client_id: client_id,
                    email: email,
                    produits: produits,
                    total_price: totalCents / 100,
                    status: 'awaiting_payment',
                    stripe_session_id: session.id,
                    quantity: produits.reduce((sum, item) => sum + (parseInt(item.quantite || 1, 10)), 0),
                }
            ])
            .select()
            .single();

        if (orderInsertError) {
            console.error('Erreur Supabase lors de l\'insertion de la commande:', orderInsertError);
            throw new Error(`Échec de la création de la commande : ${orderInsertError.message}`);
        }

        return res.status(200).json({ sessionId: session.id });

    } catch (error) {
        console.error('Erreur détaillée dans la fonction enregistrer-commande:', error);

        let clientErrorMessage = 'Une erreur inattendue est survenue lors du traitement de votre commande.';
        if (error.type === 'StripeCardError' || error.type === 'StripeInvalidRequestError') {
            clientErrorMessage = `Erreur de paiement : ${error.raw.message || error.message}`;
        } else if (error instanceof Error) {
            clientErrorMessage = `Erreur interne du serveur : ${error.message}`;
        }

        return res.status(500).json({ message: clientErrorMessage });
    }
}
