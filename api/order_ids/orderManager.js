// api/orderManager.js
import fs from 'fs';
import path from 'path';

const ORDERS_DIR = './order_ids';

if (!fs.existsSync(ORDERS_DIR)) {
  fs.mkdirSync(ORDERS_DIR);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const dateKey = `${dd}-${mm}-${yyyy}`;
  const filePath = path.join(ORDERS_DIR, `${dateKey}.txt`);

  let count = 1;

  if (fs.existsSync(filePath)) {
    const fileData = fs.readFileSync(filePath, 'utf-8');
    count = parseInt(fileData) + 1;
  }

  fs.writeFileSync(filePath, count.toString(), 'utf-8');

  const formatted = String(count).padStart(3, '0');
  const orderId = `CMD-${dd}/${mm}/${yyyy}-${formatted}`;

  res.status(200).json({ orderId });
}
