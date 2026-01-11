// pages/api/locations/byLocation.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { locationId } = req.query;
  
  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Missing locationId' });
  }

  if (req.method === 'GET') {
    return await getLocation(req, res, locationId);
  } else if (req.method === 'PATCH') {
    return await updateLocation(req, res, locationId);
  } else {
    res.setHeader('Allow', ['GET', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getLocation(req: NextApiRequest, res: NextApiResponse, locationId: string) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const location = await db.collection('locations').findOne({ locationId });
    
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }
    
    res.status(200).json({
      _id: location._id,
      locationId: location.locationId,
      name: location.business?.name || location.name, // ✅ Prefer business name
      businessName: location.business?.name, // ✅ Add explicit businessName field
      phone: location.phone,
      email: location.email,
      website: location.website,
      address: location.address,
      city: location.city,
      state: location.state,
      postalCode: location.postalCode,
      country: location.country,
      timezone: location.timezone,
      business: location.business || {},
      social: location.social || {},
      settings: location.settings || {},
      branding: location.branding || null,
      pipelines: (location.pipelines || []).map(pipeline => ({
        ...pipeline,
        ghlPipelineId: pipeline.ghlPipelineId || pipeline.id
      })),
      calendars: location.calendars || [],
      termsAndConditions: location.termsAndConditions || '',
      emailTemplates: location.emailTemplates || {
        contractSigned: null,
        quoteSent: null,
        invoiceSent: null
      },
      companyInfo: location.companyInfo || {},
      pipelineSettings: location.pipelineSettings || {
        projectsPipelines: [],
        quotesPipelines: [],
        defaultProjectsPipelineId: '',
        defaultQuotesPipelineId: ''
      },
      calendarSettings: location.calendarSettings || {
        projectsCalendars: [],
        quotesCalendars: [],
        displayCalendars: [],
        defaultProjectsCalendarId: '',
        defaultQuotesCalendarId: ''
      },
      smsPhoneNumbers: location.smsPhoneNumbers || [],
      emailSettings: location.emailSettings || {},
      businessHours: location.businessHours || {},
      saaSPlanData: location.saaSPlanData || null,
      saasPlan: location.saasPlan ? {
        seat: location?.saasPlan?.seat || 0
      } : undefined,
      subscriptionStatus: location.subscriptionStatus || null,
      subscriptionUpdatedAt: location.subscriptionUpdatedAt || null,
      stripeCustomerId: location.stripeCustomerId || null,
      stripeSubscriptionId: location.stripeSubscriptionId || null,
      isOnboardingComplete: location.isOnboardingComplete || false,
      isOnboardingRestarting: location.isOnboardingRestarting || false,
    });
  } catch (err) {
    console.error('❌ Failed to fetch location by locationId:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateLocation(req: NextApiRequest, res: NextApiResponse, locationId: string) {
  try {
    const { 
      termsAndConditions, 
      branding, 
      emailTemplates,
      companyInfo,
      ...otherUpdates 
    } = req.body;
    
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const updateData: any = {
      updatedAt: new Date().toISOString(),
    };
    
    if (termsAndConditions !== undefined) updateData.termsAndConditions = termsAndConditions;
    if (branding !== undefined) updateData.branding = branding;
    if (emailTemplates !== undefined) updateData.emailTemplates = emailTemplates;
    if (companyInfo !== undefined) updateData.companyInfo = companyInfo;
    
    // Handle any other updates
    Object.keys(otherUpdates).forEach(key => {
      if (otherUpdates[key] !== undefined) {
        updateData[key] = otherUpdates[key];
      }
    });
    
    const result = await db.collection('locations').updateOne(
      { locationId },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }
    
    return res.status(200).json({ success: true });
    
  } catch (err) {
    console.error('❌ Failed to update location:', err);
    res.status(500).json({ error: 'Server error' });
  }
}