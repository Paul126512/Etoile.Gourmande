# 🥖 Boulangerie L'Etoile Gourmande

Bienvenue dans le projet web de la **Boulangerie  L'Etoile Gourmande**, une boulangerie artisanale et moderne qui propose bien plus que du pain ! Au menu :  
🍕 Pizzas, 🥪 Paninis, 🍔 Burgers, 🌮 Tacos… à commander facilement en ligne et a venir chercher en boutique !

## 🧁 À propos

Ce site web est en cours de développement pour permettre aux clients de **commander en ligne** les produits proposés par la boulangerie, directement depuis leur téléphone ou leur ordinateur.

### 🎯 Objectifs du projet :

- Offrir une expérience fluide de **commande en ligne**.
- Mettre à disposition une interface claire pour consulter les produits.
- Gérer les **commandes** et les **numéros de suivi** côté serveur.
- Préparer une structure scalable pour l’intégration future de paiements (Stripe, PayPal...).

---

## 🧑‍🍳 Fonctionnalités prévues

- Page d’accueil conviviale avec les **catégories de produits**.
- Panier interactif avec total dynamique.
- Système de commande avec génération de numéro unique.
- Paiement en ligne (en cours d'intégration).
- 
🔁 Serveur Commandes
Responsable de l'enregistrement et du traitement des commandes passées. Il inclut plusieurs fichiers clés :

session : gestion des sessions utilisateur.

checkout.js : processus de validation du panier.

contact.js : prise en charge des informations de contact client.

create-checkout-session.js : création de sessions Stripe.

create-client.js : gestion des clients dans la base de données.

enregistrer-commande.js : logique d'enregistrement des commandes.

orderManager.js : logique métier liée à la gestion des commandes.

orders.js : API ou route de récupération des commandes.

speedReport.js : mesures ou rapports de performance.

stripe-webhook.js : écoute des événements Stripe (paiement, remboursement, etc).

🔢 Serveur Numéros
Ce serveur est dédié à la génération et la gestion des numéros de commande :

Génération UUID ou numéros incrémentaux.

Utilisé pour garantir l’unicité et la traçabilité des commandes entre service

---

## 🧰 Stack Technique

- **Frontend** : HTML, CSS, JavaScript
- **Backend** : Node.js (Express)
- **Base de données** : JSON local / SupaBase
- **Paiement** : Stripe 
- **Déploiement** : https://l-etoile-gourmande.vercel.app

---


