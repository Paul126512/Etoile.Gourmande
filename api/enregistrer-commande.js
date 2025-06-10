// api/enregistrer-commande.js

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// --- Initialisation des clients API ---
// Vérifiez si les variables d'environnement sont définies
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Utilisez SUPABASE_KEY ou SUPABASE_SERVICE_ROLE_KEY
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const siteUrl = process.env.SITE_URL;

if (!supabaseUrl || !supabaseKey) {
    console.error('Erreur: SUPABASE_URL ou SUPABASE_KEY non définies.');
    // Dans un environnement de production, vous pourriez vouloir crasher ou loguer différemment
    // Pour Vercel, une erreur au top-level comme celle-ci pourrait causer un build failure ou runtime error
    // Si la fonction est déjà lancée, elle continuera jusqu'à son premier appel à Supabase
}

if (!stripeSecretKey) {
    console.error('Erreur: STRIPE_SECRET_KEY non définie.');
}

if (!siteUrl) {
    console.warn('Attention: SITE_URL non définie. Les redirections Stripe pourraient ne pas fonctionner correctement.');
    // Définissez une URL par défaut pour éviter un crash si vous ne la mettez pas toujours.
    // Pour le développement local, ce serait 'http://localhost:3000'
    // Pour Vercel, l'URL de votre déploiement.
}

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
    // Note: panierPizzas et panierBoissons peuvent être vides mais doivent exister comme tableaux
    if (!Array.isArray(panierPizzas) || !Array.isArray(panierBoissons)) {
        return res.status(400).json({ message: 'Les données du panier sont mal formatées.' });
    }

    // Combiner tous les articles du panier en un seul tableau `produits`
    const produits = [...panierPizzas, ...panierBoissons];

    // Si le panier est vide après combinaison, retourner une erreur
    if (produits.length === 0) {
        return res.status(400).json({ message: 'Votre panier est vide. Veuillez ajouter des articles pour passer commande.' });
    }

    // Calcul du prix total côté serveur pour la sécurité et la fiabilité
    let totalCents = 0;
    for (const item of produits) {
        const prixItem = parseFloat(item.prix);
        const quantiteItem = parseInt(item.quantite || 1, 10);

        // Vérification robuste des valeurs numériques
        if (isNaN(prixItem) || prixItem < 0) {
            console.error(`Erreur: Prix d'article invalide ou manquant: ${JSON.stringify(item)}`);
            return res.status(400).json({ message: `Prix invalide pour l'article ${item.nom || 'inconnu'}.` });
        }
        if (isNaN(quantiteItem) || quantiteItem <= 0) {
            console.error(`Erreur: Quantité d'article invalide ou manquante: ${JSON.stringify(item)}`);
            return res.status(400).json({ message: `Quantité invalide pour l'article ${item.nom || 'inconnu'}.` });
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
       // ... (code précédent) ...

        // 2. Créer une session Stripe Checkout
        const lineItems = produits.map(item => {
            // Créer un objet product_data de manière conditionnelle
            const productData = {
                name: `${item.nom} ${item.taille ? `(${item.taille})` : ''}`,
                images: [item.image || 'https://via.placeholder.com/150?text=Produit'],
            };

            // Ajouter la description SEULEMENT si elle existe et n'est pas vide
            if (item.description && item.description.trim() !== '') {
                productData.description = item.description;
            }
            // Si vous voulez inclure les suppléments dans la description, assurez-vous qu'elle ne soit pas vide
            else if (item.supplements && item.supplements.length > 0) {
                 productData.description = `Suppléments : ${item.supplements.map(s => s.nom).join(', ')}`;
            }

            return {
                price_data: {
                    currency: 'eur',
                    product_data: productData, // Utilisez l'objet productData construit
                    unit_amount: Math.round(parseFloat(item.prix) * 100),
                },
                quantity: parseInt(item.quantite || 1, 10),
            };
        });

// ... (reste du code) ...

        // --- 3. Enregistrer la commande dans la base de données Supabase ---
        const { data: orderData, error: orderInsertError } = await supabase
            .from('orders')
            .insert([
                {
                    client_id: client_id,
                    email: email,
                    // Stocke tous les articles du panier dans la colonne 'produits' (doit être JSONB)
                    produits: produits, // <--- C'est la ligne clé pour votre colonne 'produits'
                    total_price: totalCents / 100, // Stocke le prix en euros
                    status: 'awaiting_payment', // Statut initial de la commande
                    stripe_session_id: session.id,
                    // Calcul de la quantité totale d'articles (pas de la valeur monétaire)
                    quantity: produits.reduce((sum, item) => sum + (parseInt(item.quantite || 1, 10)), 0),
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
        console.error('Erreur dans la fonction enregistrer-commande:', error);
        return res.status(500).json({ message: `Erreur interne du serveur: ${error.message}` });
    }
}
