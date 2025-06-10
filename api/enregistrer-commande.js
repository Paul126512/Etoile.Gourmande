// api/enregistrer-commande.js

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// --- Initialisation des clients API ---
// Vérifiez si les variables d'environnement sont définies
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Utilisez SUPABASE_KEY ou SUPABASE_SERVICE_ROLE_KEY
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const siteUrl = process.env.SITE_URL;

// IMPORTANT : Assurez-vous que ces variables sont bien définies dans les paramètres de votre projet Vercel
// Si elles ne le sont pas, le script s'arrêtera ici lors du démarrage de la fonction.
if (!supabaseUrl) {
    console.error('ERREUR DE CONFIGURATION: La variable d\'environnement SUPABASE_URL n\'est pas définie.');
    // Vous pouvez choisir de forcer la sortie ou de laisser l'erreur être attrapée plus tard.
    // Pour une fonction serverless, souvent, une erreur au top-level peut causer un crash au déploiement ou au runtime.
}
if (!supabaseKey) {
    console.error('ERREUR DE CONFIGURATION: La variable d\'environnement SUPABASE_KEY n\'est pas définie.');
}
if (!stripeSecretKey) {
    console.error('ERREUR DE CONFIGURATION: La variable d\'environnement STRIPE_SECRET_KEY n\'est pas définie.');
}
if (!siteUrl) {
    console.warn('ATTENTION: La variable d\'environnement SITE_URL n\'est pas définie. Les redirections Stripe pourraient ne pas fonctionner correctement.');
    // Si SITE_URL n'est pas critique pour le fonctionnement (ex: juste pour des logs), on peut laisser un avertissement.
    // Si c'est critique (ce qui est le cas pour Stripe), assurez-vous de la définir.
}

// Initialisation de Supabase et Stripe avec les variables d'environnement
// Ces lignes peuvent crasher si les clés ne sont pas définies, d'où les vérifications ci-dessus.
const supabase = createClient(supabaseUrl, supabaseKey);
const stripe = new Stripe(stripeSecretKey);

// --- Handler de la fonction Serverless ---
export default async function handler(req, res) {
    // S'assurer que la requête est une méthode POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée. Seules les requêtes POST sont acceptées.' });
    }

    const { name, email, panierPizzas, panierBoissons } = req.body;

    // Validation des données d'entrée minimales
    if (!name || !email) {
        return res.status(400).json({ message: 'Le nom et l\'email sont obligatoires.' });
    }
    // Assurez-vous que panierPizzas et panierBoissons sont bien des tableaux, même s'ils sont vides
    if (!Array.isArray(panierPizzas) || !Array.isArray(panierBoissons)) {
        return res.status(400).json({ message: 'Les données du panier sont mal formatées. Attendu des tableaux pour panierPizzas et panierBoissons.' });
    }

    // Combiner tous les articles du panier en un seul tableau `produits`
    const produits = [...panierPizzas, ...panierBoissons];

    // Si le panier est vide après combinaison, retourner une erreur
    if (produits.length === 0) {
        return res.status(400).json({ message: 'Votre panier est vide. Veuillez ajouter des articles pour passer commande.' });
    }

    // Calcul du prix total côté serveur (pour la sécurité et la fiabilité)
    let totalCents = 0;
    for (const item of produits) {
        const prixItem = parseFloat(item.prix);
        const quantiteItem = parseInt(item.quantite || 1, 10); // Default quantity to 1 if not present

        // Vérification robuste des valeurs numériques et positives
        if (isNaN(prixItem) || prixItem < 0) {
            console.error(`Erreur: Prix d'article invalide ou manquant: ${JSON.stringify(item)}`);
            return res.status(400).json({ message: `Prix invalide pour l'article ${item.nom || 'inconnu'}. Veuillez vérifier le panier.` });
        }
        if (isNaN(quantiteItem) || quantiteItem <= 0) {
            console.error(`Erreur: Quantité d'article invalide ou manquante: ${JSON.stringify(item)}`);
            return res.status(400).json({ message: `Quantité invalide pour l'article ${item.nom || 'inconnu'}. Veuillez vérifier le panier.` });
        }
        totalCents += Math.round(prixItem * quantiteItem * 100); // Prix en centimes
    }

    if (totalCents <= 0) {
        // Cela ne devrait pas arriver si les vérifications précédentes ont fonctionné, mais c'est une sécurité
        return res.status(400).json({ message: 'Le total de la commande doit être supérieur à zéro.' });
    }

    let client_id; // Variable pour stocker l'ID du client Supabase

    try {
        // --- 1. Chercher ou créer le client dans Supabase ---
        let { data: clientData, error: clientLookupError } = await supabase
            .from('clients')
            .select('id')
            .eq('email', email)
            .single();

        // PGRST116 est le code d'erreur de PostgREST pour "ligne non trouvée"
        if (clientLookupError && clientLookupError.code !== 'PGRST116') {
            console.error('Erreur Supabase lors de la recherche du client:', clientLookupError);
            throw new Error(`Échec de la recherche du client : ${clientLookupError.message}`);
        }

        if (!clientData) {
            // Client non trouvé, le créer
            const { data: newClientData, error: newClientError } = await supabase
                .from('clients')
                .insert([{ name, email }])
                .select('id')
                .single();

            if (newClientError) {
                console.error('Erreur Supabase lors de la création du client:', newClientError);
                throw new Error(`Échec de la création du client : ${newClientError.message}`);
            }
            client_id = newClientData.id; // Récupérer l'ID du nouveau client
        } else {
            client_id = clientData.id; // Utiliser l'ID du client existant
        }

        // --- 2. Créer une session Stripe Checkout ---
        const lineItems = produits.map(item => {
            const productData = {
                name: `${item.nom} ${item.taille ? `(${item.taille})` : ''}`,
                images: [item.image || 'https://via.placeholder.com/150?text=Produit'], // Image de fallback
            };

            // Ajouter la description SEULEMENT si elle existe et n'est pas vide
            // Sinon, tenter d'ajouter une description basée sur les suppléments
            if (item.description && item.description.trim() !== '') {
                productData.description = item.description;
            } else if (item.supplements && item.supplements.length > 0) {
                 productData.description = `Suppléments: ${item.supplements.map(s => s.nom).join(', ')}`;
            }

            return {
                price_data: {
                    currency: 'eur',
                    product_data: productData,
                    unit_amount: Math.round(parseFloat(item.prix) * 100), // Prix unitaire en centimes
                },
                quantity: parseInt(item.quantite || 1, 10), // Quantité de l'article
            };
        });

        // Tenter de créer la session Stripe
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
                    // Stocke tous les articles du panier dans la colonne 'produits' (doit être JSONB)
                    produits: produits, // Assurez-vous que 'produits' est de type JSONB dans Supabase
                    total_price: totalCents / 100, // Stocke le prix en euros
                    status: 'awaiting_payment', // Statut initial de la commande
                    stripe_session_id: session.id, // ID de session Stripe
                    quantity: produits.reduce((sum, item) => sum + (parseInt(item.quantite || 1, 10)), 0), // Quantité totale d'articles
                }
            ])
            .select() // Pour récupérer les données insérées (comme l'ID de la commande)
            .single(); // S'attendre à une seule ligne retournée

        if (orderInsertError) {
            console.error('Erreur Supabase lors de l\'insertion de la commande:', orderInsertError);
            throw new Error(`Échec de la création de la commande : ${orderInsertError.message}`);
        }

        // Retourner l'ID de session Stripe au client
        return res.status(200).json({ sessionId: session.id });

    } catch (error) {
        // Gérer toutes les erreurs qui pourraient survenir dans le bloc try
        console.error('Erreur détaillée dans la fonction enregistrer-commande:', error); // Log l'objet 'error' complet

        let clientErrorMessage = 'Une erreur inattendue est survenue lors du traitement de votre commande.';
        if (error.type === 'StripeCardError' || error.type === 'StripeInvalidRequestError') {
            // Erreurs spécifiques de Stripe avec un message convivial
            clientErrorMessage = `Erreur de paiement : ${error.raw.message || error.message}`;
        } else if (error instanceof Error) {
            // Autres erreurs JavaScript standard
            clientErrorMessage = `Erreur interne du serveur : ${error.message}`;
        }

        // Toujours renvoyer une erreur 500 pour le serveur, avec un message clair pour le client
        return res.status(500).json({ message: clientErrorMessage });
    }
}
