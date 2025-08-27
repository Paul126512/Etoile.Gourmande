if (event.type === 'checkout.session.completed') {
  const session = event.data.object;

  // Répond vite à Stripe
  res.status(200).end('ok');

  // Puis traite ta commande en arrière-plan
  (async () => {
    try {
      const { data: order } = await supabase
        .from('orders')
        .select('*')
        .eq('stripe_session_id', session.id)
        .maybeSingle();

      if (order) {
        await supabase
          .from('orders')
          .update({ status: 'completed' })
          .eq('stripe_session_id', session.id);

        console.log(`✅ Commande ${session.id} mise à jour en arrière-plan`);
      }
    } catch (err) {
      console.error("❌ Erreur maj commande:", err);
    }
  })();
  return;
}
