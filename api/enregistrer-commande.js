import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Ensure environment variables are loaded and accessible.
// For Vercel, these are set in Project Settings -> Environment Variables.
// For local development, use a .env file.

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_KEY; // Using a clearer name for the service role key

// Validate essential environment variables at the top level
if (!supabaseUrl) {
  console.error('SUPABASE_URL environment variable is not set.');
  // In a real application, you might want to exit or throw an error here if this is critical.
}
if (!supabaseAnonKey && !supabaseServiceKey) {
  console.error('Neither SUPABASE_ANON_KEY nor SUPABASE_KEY environment variable is set.');
  // This is the direct cause of 'supabaseKey is required' error
}
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY environment variable is not set.');
}
if (!process.env.SITE_URL) {
  console.error('SITE_URL environment variable is not set.');
}


// Initialize Supabase client
// Prioritize the service role key for backend operations if available,
// otherwise fall back to the anonymous key.
const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseAnonKey
);

// Initialize Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  // Good practice: specify an API version to avoid breaking changes
  // You can find the latest stable API version in your Stripe dashboard
  apiVersion: '2024-06-10', // Example: Use the date you developed against
});

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed', message: 'Only POST requests are supported.' });
  }

  const { name, email, panierPizzas = [], panierBoissons = [] } = req.body;

  // --- Input Validation ---
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Invalid Input', message: 'Name must be a string with at least 2 characters.' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid Input', message: 'A valid email address is required.' });
  }
  if (panierPizzas.length === 0 && panierBoissons.length === 0) {
    return res.status(400).json({ error: 'Invalid Input', message: 'The cart is empty. Please add items to your order.' });
  }

  try {
    // --- Calculate Totals ---
    const allItems = [...panierPizzas, ...panierBoissons];

    const totalQuantity = allItems.reduce((acc, item) => {
      // Ensure quantity is a safe number
      const quantity = typeof item.quantite === 'number' && !isNaN(item.quantite) ? item.quantite : 1;
      return acc + quantity;
    }, 0);

    const totalPrix = allItems.reduce((acc, item) => {
      // Ensure price is a safe number before calculation
      const price = typeof item.prix === 'number' && !isNaN(item.prix) ? item.prix : 0;
      const quantity = typeof item.quantite === 'number' && !isNaN(item.quantite) ? item.quantite : 1;
      return acc + (price * quantity);
    }, 0);

    // --- Client Management (Supabase) ---
    let client;
    const { data: existingClient, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('email', email)
      .single();

    // PGRST116 is the code for 'No rows found' when using .single()
    if (clientError && clientError.code !== 'PGRST116') {
      console.error('Supabase client lookup error:', clientError);
      throw new Error(`Failed to lookup client: ${clientError.message}`);
    }

    if (existingClient) {
      client = existingClient;
    } else {
      // Create a new client if not found
      const { data: newClient, error: insertError } = await supabase
        .from('clients')
        .insert([{ name, email }])
        .select('id')
        .single();

      if (insertError) {
        console.error('Supabase client insert error:', insertError);
        throw new Error(`Failed to create new client: ${insertError.message}`);
      }
      client = newClient;
    }

    // --- Order Creation (Supabase) ---
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([{
        client_id: client.id,
        pizzas: panierPizzas,
        boissons: panierBoissons,
        quantity: totalQuantity,
        prix: totalPrix,
        email, // Storing email directly on order for easier access, even if client_id exists
        status: 'pending' // Initial status
      }])
      .select('id')
      .single();

    if (orderError) {
      console.error('Supabase order creation error:', orderError);
      throw new Error(`Failed to create order: ${orderError.message}`);
    }

    // --- Stripe Checkout Session Creation ---
    const lineItems = allItems.map(item => {
      const productName = item.nom || `Produit #${item.id || Math.random().toString(36).substring(7)}`;
      const productDescription = item.description || `Quantité: ${item.quantite || 1}`;
      
      // Crucial fix: Ensure item.prix is a number before multiplication and rounding
      // Use parseFloat to handle string numbers, and default to 0 if invalid
      const parsedPrice = parseFloat(item.prix);
      const safePrice = isNaN(parsedPrice) ? 0 : parsedPrice;
      const safeQuantity = typeof item.quantite === 'number' && !isNaN(item.quantite) ? item.quantite : 1;

      // Stripe unit_amount must be an integer in cents
      const unitAmountInCents = Math.round(safePrice * 100);

      // Log to debug exact values going to Stripe
      // console.log(`Item: ${productName}, Price: ${safePrice}, Quantity: ${safeQuantity}, Unit Amount (cents): ${unitAmountInCents}`);

      return {
        price_data: {
          currency: 'eur',
          product_data: {
            name: productName,
            description: productDescription,
            // You can add images here if you have them: images: [item.imageUrl],
          },
          unit_amount: unitAmountInCents,
        },
        quantity: safeQuantity,
      };
    });

    // Basic check to prevent Stripe errors if for some reason lineItems is empty
    if (lineItems.length === 0) {
      throw new Error('No valid line items were generated for Stripe. Cart might contain invalid item data.');
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: lineItems,
      customer_email: email, // Pre-fill customer email
      success_url: `${process.env.SITE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/cancel`,
      metadata: {
        order_id: order.id,
        client_id: client.id,
      },
    });

    // --- Update Order with Stripe Session ID (Supabase) ---
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        stripe_session_id: session.id,
        status: 'awaiting_payment' // Update status after session creation
      })
      .eq('id', order.id);

    if (updateError) {
      console.error('Supabase order update error:', updateError);
      throw new Error(`Failed to update order with Stripe session ID: ${updateError.message}`);
    }

    // --- Success Response ---
    return res.status(200).json({ sessionId: session.id });

  } catch (error) {
    // --- Centralized Error Handling ---
    console.error('Serverless Function Error:', error);

    // Provide more specific error messages based on the type of error
    let errorMessage = 'An unexpected server error occurred.';
    let statusCode = 500;

    if (error.message.includes('Supabase') || error.message.includes('Failed')) {
      errorMessage = error.message; // Use the specific error message from the thrown error
    } else if (error.type === 'StripeCardError' || error.type === 'StripeRateLimitError') {
      errorMessage = `Stripe error: ${error.message}`;
      statusCode = 400; // Client-side error for Stripe issues
    } else if (error instanceof TypeError) { // e.g., if a crucial variable is undefined
        errorMessage = `Data processing error: ${error.message}`;
        statusCode = 400;
    }


    return res.status(statusCode).json({
      error: 'Server Error',
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined, // Include stack only in dev
    });
  }
}
