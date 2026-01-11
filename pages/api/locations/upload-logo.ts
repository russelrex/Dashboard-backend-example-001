/**
 * File: upload-logo.ts
 * Purpose: Upload company logos - EXACT COPY OF PROJECT PHOTOS PATTERN
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, locationId, cloudflareId } = req.body;

    // STEP 1: Get upload URL (EXACT SAME AS PROJECT PHOTOS)
    if (action === 'get-upload-url') {
      if (!locationId) {
        return res.status(400).json({ error: 'Missing locationId' });
      }

      const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/images/v1/direct_upload`);
      url.searchParams.append('requireSignedURLs', 'false');
      
      const cfResponse = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CF_API_TOKEN}`
        }
      });
      
      const cfData = await cfResponse.json();
      
      if (!cfData.success) {
        console.error('[Cloudflare] Error:', cfData.errors);
        return res.status(500).json({ error: 'Failed to get upload URL' });
      }
      
      console.log(`✅ [Logo] Got Cloudflare upload URL for location ${locationId}`);
      
      return res.status(200).json({
        uploadURL: cfData.result.uploadURL,
        imageId: cfData.result.id
      });
    }

    // STEP 2: Save uploaded image reference (EXACT SAME AS PROJECT PHOTOS)
    if (action === 'save-upload') {
      if (!locationId || !cloudflareId) {
        return res.status(400).json({ error: 'Missing locationId or cloudflareId' });
      }

      // EXACT SAME DELIVERY HASH AND VARIANT AS PROJECT PHOTOS
      const CF_DELIVERY_HASH = '4hDzQEaOi54scrgmdmfdaQ';
      const logoUrl = `https://imagedelivery.net/${CF_DELIVERY_HASH}/${cloudflareId}/public`;

      const client = await clientPromise;
      const db = client.db(getDbName());
      
      await db.collection('locations').updateOne(
        { locationId: locationId },
        { 
          $set: { 
            'company.logoUrl': logoUrl,
            'company.cloudflareImageId': cloudflareId,
            updatedAt: new Date()
          } 
        }
      );

      console.log(`✅ [Logo] Saved logo for location ${locationId}`);

      return res.status(200).json({
        success: true,
        logoUrl,
        cloudflareId,
      });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error: any) {
    console.error('[Logo] Upload error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process upload',
    });
  }
}