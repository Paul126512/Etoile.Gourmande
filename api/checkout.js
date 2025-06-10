import React from 'react';

export default function Checkout() {
  const handleCheckout = async () => {
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pizzas: [
            { nom: "Margherita", prix: 8, quantite: 2, supplements: [], image: "url_image" }
          ],
          boissons: [
            { nom: "Coca", prix: 2, quantite: 3 }
          ],
        }),
      });

      const data = await response.json();

      if (data.sessionId) {
        // Redirection vers Stripe Checkout
        window.location.href = `https://checkout.stripe.com/pay/${data.sessionId}`;
      } else {
        console.error('Erreur:', data.error);
      }
    } catch (err) {
      console.error('Erreur fetch:', err);
    }
  };

  return (
    <div>
      <h1>Page de paiement</h1>
      <button onClick={handleCheckout}>Payer</button>
    </div>
  );
}
