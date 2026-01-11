// pages/api/admin/refresh-company-tokens.js
const clientPromise = require('../../../src/lib/mongodb');
const { getDbName } = require('../../../src/lib/mongodb');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { companyId, adminKey } = req.body;
  
  if (!companyId) {
    return res.status(400).json({ error: 'Company ID required' });
  }

  // Optional: Add some basic security
  if (adminKey !== 'your-secret-admin-key') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Just call the existing refresh endpoint
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/oauth/refresh-token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: companyId,
          entityType: 'company'
        })
      }
    );

    const result = await response.json();
    
    return res.status(response.status).json(result);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

module.exports = handler;