// src/utils/sync/syncLocationDetails.ts
import axios from 'axios';
import { Db } from 'mongodb';
import { getAuthHeader } from '../ghlAuth';

const DEFAULT_TERMS_AND_CONDITIONS = `Terms and Conditions:
1. Acceptance of Estimate:
By signing this Agreement, Customer acknowledges acceptance of the terms, scope of work, and pricing as detailed in the estimate provided by {companyName}.

2. Deposit and Scheduling:
Scheduling and commencement of the project are contingent upon full payment of the determined deposit amount. No work will be scheduled or initiated until the deposit has been received in full by {companyName}.

3. Final Payment:
Full payment of the remaining project balance is due immediately upon project completion and receipt of the final invoice. Payment must be made on site.

4. Payment Terms:
{companyName} does not offer billing and does not finance projects. Customer is responsible for ensuring that full payment is available at the time of project completion.

5. Changes to Scope:
Any changes to the agreed-upon scope of work, whether additions or deletions, must be documented in writing and may require a revised estimate or a change order.

6. Removal of Line Items:
If any line item from the estimate is not desired by the Customer, it may be deducted from the final scope. The deduction will apply only to the direct cost of the removed item and will not alter the overall pricing structure or affect discounts on the remaining work.

7. Unknown Site Conditions:
Pricing for tie-ins to existing systems is subject to revision pending discovery of existing conditions. Any necessary adjustments will be documented and approved through a change order.

8. Warranty:
{companyName} provides a warranty on workmanship for a period specified in the contract. This warranty does not cover issues arising from customer misuse, normal wear and tear, or acts of nature.

9. Liability:
{companyName} maintains appropriate insurance coverage. However, {companyName} is not responsible for any pre-existing conditions or damages not caused by our work.

10. Cancellation:
If Customer cancels the project after signing, the deposit is non-refundable as it covers administrative costs and reserved scheduling.

Acknowledgment and Acceptance:
By signing below, Customer agrees to the terms of this Agreement and authorizes {companyName} to proceed with the work as outlined.`;

export async function syncLocationDetails(db: Db, location: any) {
  const startTime = Date.now();
  console.log(`[Sync Location Details] Starting for ${location.locationId}`);

  try {
    // Get auth header (OAuth or API key)
    const auth = await getAuthHeader(location);
    
    // Fetch location details from GHL
    const response = await axios.get(
      `https://services.leadconnectorhq.com/locations/${location.locationId}`,
      {
        headers: {
          'Authorization': auth.header,
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      }
    );

    const locationData = response.data.location || response.data;
    console.log(`[Sync Location Details] Fetched data for: ${locationData.name}`);

    // Map GHL fields to our schema
    const updateData = {
      // Basic Information
      name: locationData.name || location.name,
      address: locationData.address || '',
      city: locationData.city || '',
      state: locationData.state || '',
      country: locationData.country || 'US',
      postalCode: locationData.postalCode || '',
      
      // Contact Information
      email: locationData.email || '',
      phone: locationData.phone || '',
      website: locationData.website || '',
      
      // Business Details
      business: {
        name: locationData.business?.name || locationData.name,
        address: locationData.business?.address || locationData.address || '',
        city: locationData.business?.city || locationData.city || '',
        state: locationData.business?.state || locationData.state || '',
        country: locationData.business?.country || locationData.country || 'US',
        postalCode: locationData.business?.postalCode || locationData.postalCode || '',
        website: locationData.business?.website || locationData.website || '',
        timezone: locationData.business?.timezone || locationData.timezone || 'America/Chicago',
        logoUrl: locationData.business?.logoUrl || locationData.logoUrl || '',
        email: locationData.business?.email || locationData.email || ''
      },
      
      // Settings
      timezone: locationData.timezone || 'America/Chicago',
      settings: locationData.settings || {},
      social: locationData.social || {},
      
      // Integration Details
      companyId: locationData.companyId || location.companyId,
      
      // Sync Metadata
      lastDetailSync: new Date(),
      updatedAt: new Date()
    };

    // Handle settings object
    if (locationData.settings) {
      updateData.settings = {
        allowDuplicateContact: locationData.settings.allowDuplicateContact || false,
        allowDuplicateOpportunity: locationData.settings.allowDuplicateOpportunity || false,
        allowFacebookNameMerge: locationData.settings.allowFacebookNameMerge || false,
        disableContactTimezone: locationData.settings.disableContactTimezone || false,
        contactUniqueIdentifiers: locationData.settings.contactUniqueIdentifiers || ['email', 'phone'],
        ...locationData.settings
      };
    }

    // Handle social links
    if (locationData.social) {
      updateData.social = {
        facebookUrl: locationData.social.facebookUrl || '',
        googlePlus: locationData.social.googlePlus || '',
        linkedIn: locationData.social.linkedIn || '',
        foursquare: locationData.social.foursquare || '',
        twitter: locationData.social.twitter || '',
        yelp: locationData.social.yelp || '',
        instagram: locationData.social.instagram || '',
        youtube: locationData.social.youtube || '',
        pinterest: locationData.social.pinterest || '',
        blogRss: locationData.social.blogRss || '',
        googlePlacesId: locationData.social.googlePlacesId || ''
      };
    }

    // Add default terms and conditions if missing
    if (!location.termsAndConditions) {
      updateData.termsAndConditions = DEFAULT_TERMS_AND_CONDITIONS.replace(/{companyName}/g, updateData.name || location.name || 'Our Company');
      console.log(`[Sync Location Details] Added default terms and conditions for ${location.locationId}`);
    }

    // Update location in database
    const result = await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: updateData }
    );

    const duration = Date.now() - startTime;
    console.log(`[Sync Location Details] Completed in ${duration}ms`);

    return {
      updated: result.modifiedCount > 0,
      locationName: updateData.name,
      fieldsUpdated: Object.keys(updateData).length,
      duration: `${duration}ms`
    };

  } catch (error: any) {
    console.error(`[Sync Location Details] Error:`, error.response?.data || error.message);
    
    // If it's a 404, the location might not exist in GHL
    if (error.response?.status === 404) {
      throw new Error('Location not found in GHL');
    }
    
    // If it's a 401, auth might be invalid
    if (error.response?.status === 401) {
      throw new Error('Authentication failed - invalid token or API key');
    }
    
    throw error;
  }
}