// api/enregistrer-commande.js

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// --- Initialisation des clients API ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Utilisez SUPABASE_KEY ou SUPABASE_SERVICE_ROLE_KEY
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const siteUrl = process.env.SITE_URL;

// IMPORTANT : Assurez-vous que ces variables sont bien définies dans les paramètres de votre projet Vercel
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

    // Le frontend doit envoyer 'panier' comme un tableau unifié d'articles
    // Chaque article du panier doit contenir au minimum 'id' (de votre table `produits`), 'quantite', 'taille' et 'supplements'
    const { name, email, panier } = req.body; 

    if (!name || !email) {
        return res.status(400).json({ message: 'Le nom et l\'email sont obligatoires.' });
    }
    
    // Validation du panier : doit être un tableau non vide d'objets
    if (!Array.isArray(panier) || panier.length === 0) {
        return res.status(400).json({ message: 'Votre panier est vide ou mal formaté. Veuillez ajouter des articles pour passer commande.' });
    }

    let totalCents = 0;
    let produitsPourBDD = []; // Ce tableau contiendra les données optimisées pour Supabase
    let lineItems = []; // Ce tableau contiendra les données détaillées pour Stripe

    try {
        // --- 1. Récupérer les détails complets des produits depuis la BDD (sécurité et cohérence) ---
        // Extrait tous les IDs uniques des produits du panier envoyé par le client
        const productIds = [...new Set(panier.map(item => item.id))];

        // Récupère les détails de ces produits depuis votre table 'produits' dans Supabase
        const { data: produitsDB, error: produitsDBError } = await supabase
            .from('produits') // Assurez-vous que c'est le nom de votre table de produits
            .select('id, nom, prix_de_base, type, description, image_url') // Sélectionnez les infos nécessaires
            .in('id', productIds);

        if (produitsDBError) {
            console.error('Erreur Supabase lors de la récupération des produits:', produitsDBError);
            throw new Error('Échec de la récupération des détails des produits depuis la base de données.');
        }

        // Crée une Map pour un accès rapide aux détails du produit par ID
        const produitsMap = new Map(produitsDB.map(p => [p.id, p]));

        // --- 2. Parcourir le panier, calculer le total, et construire les données pour Stripe et Supabase ---
        for (const itemClient of panier) {
            const produitDetails = produitsMap.get(itemClient.id);

            // Vérifie si le produit existe bien dans votre base de données de produits
            if (!produitDetails) {
                console.error(`Produit avec l'ID ${itemClient.id} non trouvé en base de données.`);
                return res.status(400).json({ message: `Article inconnu dans le panier : ${itemClient.id}.` });
            }

            const prixBaseItem = parseFloat(produitDetails.prix_de_base);
            const quantiteItem = parseInt(itemClient.quantite || 1, 10);
            
            // Calcul du prix total de l'article incluant les suppléments
            const prixSupplements = itemClient.supplements ? itemClient.supplements.reduce((sum, s) => sum + parseFloat(s.prix || 0), 0) : 0;
            const prixUnitaireTotalAvecOptions = prixBaseItem + prixSupplements;

            // Vérifications de validité des prix et quantités
            if (isNaN(prixUnitaireTotalAvecOptions) || prixUnitaireTotalAvecOptions < 0) {
                console.error(`Erreur: Prix total calculé invalide pour l'article: ${JSON.stringify(itemClient)}`);
                return res.status(400).json({ message: `Prix invalide pour l'article ${produitDetails.nom || 'inconnu'}. Veuillez vérifier le panier.` });
            }
            if (isNaN(quantiteItem) || quantiteItem <= 0) {
                console.error(`Erreur: Quantité d'article invalide ou manquante: ${JSON.stringify(itemClient)}`);
                return res.status(400).json({ message: `Quantité invalide pour l'article ${produitDetails.nom || 'inconnu'}. Veuillez vérifier le panier.` });
            }

            totalCents += Math.round(prixUnitaireTotalAvecOptions * quantiteItem * 100);

            // --- Préparer les données pour Stripe (plus détaillées) ---
            const productDataForStripe = {
                name: `${produitDetails.nom} ${itemClient.taille ? `(${itemClient.taille})` : ''}`,
                images: [produitDetails.image_url || 'https://via.placeholder.com/150?text=Produit'], // Fallback image
            };
            let itemDescription = produitDetails.description || '';
            if (itemClient.supplements && itemClient.supplements.length > 0) {
                const supplementsNoms = itemClient.supplements.map(s => s.nom).join(', ');
                itemDescription += (itemDescription ? ' - ' : '') + `Suppléments: ${supplementsNoms}`;
            }
            if (itemDescription.trim() !== '') {
                productDataForStripe.description = itemDescription;
            }

            lineItems.push({
                price_data: {
                    currency: 'eur',
                    product_data: productDataForStripe,
                    unit_amount: Math.round(prixUnitaireTotalAvecOptions * 100), // Prix unitaire final en centimes
                },
                quantity: quantiteItem,
            });

            // --- Préparer les données pour la colonne `produits` de la table `orders` (minimaliste) ---
            produitsPourBDD.push({
                id_produit: itemClient.id, // L'ID du produit depuis votre table `produits`
                quantite: quantiteItem,
                options: { // Objet pour regrouper les options spécifiques à cette commande
                    taille: itemClient.taille || null,
                    // Si vos suppléments ont des IDs stables, vous pourriez ne stocker que leurs IDs ici
                    // ou un objet léger si vous avez besoin du nom ou prix du supplément pour l'historique
                    supplements: itemClient.supplements ? itemClient.supplements.map(s => ({ id: s.id, nom: s.nom, prix: s.prix })) : [] 
                },
                // TRÈS IMPORTANT : Le prix exact de cet article (avec options) au moment de la commande
                prix_unitaire_commande: prixUnitaireTotalAvecOptions 
            });
        }

        if (totalCents <= 0) {
            return res.status(400).json({ message: 'Le total de la commande est de zéro après calcul. Veuillez vérifier le panier.' });
        }

        // --- (Reste de la logique : Recherche/Création du client - inchangée) ---
        let client_id; 
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

        // --- 3. Créer une session Stripe Checkout (utilisant les lineItems préparés) ---
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems, // Ce tableau est formaté pour Stripe
            mode: 'payment',
            success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${siteUrl}/cancel.html`,
            customer_email: email,
            metadata: {
                client_id: client_id,
            },
        });

        // --- 4. Enregistrer la commande dans la base de données Supabase ---
        const { data: orderData, error: orderInsertError } = await supabase
            .from('orders')
            .insert([
                {
                    client_id: client_id,
                    email: email,
                    produits: produitsPourBDD, // <--- C'est ici que nous utilisons le tableau optimisé pour la BDD
                    total_price: totalCents / 100, // Prix en euros
                    status: 'awaiting_payment',
                    stripe_session_id: session.id,
                    quantity: produitsPourBDD.reduce((sum, item) => sum + item.quantite, 0), // Quantité totale
                }
            ])
            .select()
            .single();

        if (orderInsertError) {
            console.error('Erreur Supabase lors de l\'insertion de la commande:', orderInsertError);
            throw new Error(`Échec de la création de la commande : ${orderInsertError.message}`);
        }

        // Retourner l'ID de session Stripe au client
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
