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

## Fonctionnalités

- Page d’accueil conviviale avec les **catégories de produits**.
- Panier interactif avec total dynamique.
- Système de commande avec génération de numéro unique.
- Paiement en ligne (en cours d'intégration).
- 🗂️ Fichiers du Serveur Commandes
-  session – Gestion des sessions utilisateur

🛒 checkout.js – Traitement du panier et du processus de commande

📇 contact.js – Enregistrement des informations de contact

💳 create-checkout-session.js – Création d’une session Stripe pour le paiement

🧾 create-client.js – Ajout ou mise à jour du client dans la base

📝 enregistrer-commande.js – Sauvegarde complète de la commande

⚙️ orderManager.js – Logique métier pour la gestion des commandes

📦 orders.js – Accès aux commandes (API / routes)

🚀 speedReport.js – Suivi des performances
---

## 🧰 Stack Technique

- **Frontend** : HTML, CSS, JavaScript
- **Backend** : Node.js (Express)
- **Base de données** : JSON local / SupaBase
- **Paiement** : Stripe 
- **Déploiement** : https://etoile-gourmande-one.vercel.app/

---


