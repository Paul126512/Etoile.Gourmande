import { createClient } from '@supabase/supabase-js';

// Variables d'environnement (à configurer dans Vercel)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Fonction pour générer un code aléatoire unique (ex: 6 caractères alphanumériques)
function generateUniqueCode(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { prenom } = req.body;

  if (!prenom || prenom.trim() === '') {
    return res.status(400).json({ error: 'Prénom requis' });
  }

  try {
    // Générer un code unique
    let codeUnique = generateUniqueCode();

    // Vérifier si ce code existe déjà
    let tries = 0;
    const maxTries = 5;
    while (tries < maxTries) {
      const { data, error } = await supabase
        .from('clients')
        .select('code_unique')
        .eq('code_unique', codeUnique)
        .single();

      if (error && error.code !== 'PGRST116') { // Not found = normal
        throw error;
      }

      if (!data) break; // Code unique trouvé

      // Sinon, générer un nouveau code
      codeUnique = generateUniqueCode();
      tries++;
    }

    if (tries === maxTries) {
      return res.status(500).json({ error: 'Impossible de générer un code unique, réessayez plus tard.' });
    }

    // Insérer dans la table 'clients'
    const { data, error } = await supabase
      .from('clients')
      .insert([{ prenom: prenom.trim(), code_unique: codeUnique }])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({ id: data.id, code: data.code_unique });
  } catch (error) {
    console.error('Erreur API create-client:', error);
    return res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
}
