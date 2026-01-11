import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// Helper function to geocode an address using Radar
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    console.log('[ETA API] Geocoding address:', address);
    
    const response = await axios.get('https://api.radar.io/v1/geocode/forward', {
      params: {
        query: address
      },
      headers: {
        'Authorization': process.env.RADAR_SECRET_KEY
      }
    });

    if (response.data?.addresses && response.data.addresses.length > 0) {
      const result = response.data.addresses[0];
      console.log('[ETA API] Geocoded to:', result.latitude, result.longitude);
      return {
        lat: result.latitude,
        lng: result.longitude
      };
    }

    console.log('[ETA API] No geocoding results found');
    return null;
  } catch (error: any) {
    console.error('[ETA API] Geocoding error:', error.message);
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ✅ ADD CORS HEADERS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { origin, destination } = req.body;

  console.log('[ETA API] Request received:', { origin, destination });

  if (!origin || !destination) {
    console.log('[ETA API] Missing origin or destination');
    return res.status(400).json({ error: 'Missing origin or destination' });
  }

  try {
    // Convert origin to coordinates if it's an address string
    let originCoords: { lat: number; lng: number };
    if (typeof origin === 'string') {
      const geocoded = await geocodeAddress(origin);
      if (!geocoded) {
        console.log('[ETA API] Failed to geocode origin address');
        return res.status(200).json({
          success: false,
          error: 'Could not find origin location',
          duration: null,
          distance: null,
          trafficCondition: null
        });
      }
      originCoords = geocoded;
    } else {
      originCoords = origin;
    }

    // Convert destination to coordinates if it's an address string
    let destinationCoords: { lat: number; lng: number };
    if (typeof destination === 'string') {
      const geocoded = await geocodeAddress(destination);
      if (!geocoded) {
        console.log('[ETA API] Failed to geocode destination address');
        return res.status(200).json({
          success: false,
          error: 'Could not find destination location',
          duration: null,
          distance: null,
          trafficCondition: null
        });
      }
      destinationCoords = geocoded;
    } else {
      destinationCoords = destination;
    }

    // Format as "lat,lng" strings for Radar
    const originStr = `${originCoords.lat},${originCoords.lng}`;
    const destinationStr = `${destinationCoords.lat},${destinationCoords.lng}`;

    console.log('[ETA API] Using Radar Distance API:', { originStr, destinationStr });

    // Use Radar Distance API
    const radarUrl = 'https://api.radar.io/v1/route/distance';
    const radarResponse = await axios.get(radarUrl, {
      params: {
        origin: originStr,
        destination: destinationStr,
        modes: 'car',
        units: 'imperial' // miles
      },
      headers: {
        'Authorization': process.env.RADAR_SECRET_KEY
      }
    });

    console.log('[ETA API] Radar distance response:', radarResponse.data);

    if (radarResponse.data && radarResponse.data.routes && radarResponse.data.routes.car) {
      const route = radarResponse.data.routes.car;
      
      // ✅ ADD THESE LINES:
      console.log('[ETA API] Raw values from Radar:', {
        durationValue: route.duration.value,
        durationUnit: route.duration.unit,
        distanceValue: route.distance.value,
        distanceUnit: route.distance.unit
      });

      // ✅ ADD THIS LINE:
      console.log('[ETA API] Full Radar route data:', JSON.stringify(radarResponse.data.routes.car, null, 2));
      
      // Radar returns duration in MINUTES and distance in METERS (despite units='imperial')
      const durationMinutes = Math.ceil(route.duration.value);

      // Parse distance from text since Radar's value field is broken
      let distanceMiles: number;
      if (route.distance.text) {
        // Extract number from text like "45.8 mi"
        const match = route.distance.text.match(/[\d.]+/);
        distanceMiles = match ? Math.round(parseFloat(match[0])) : 0;
      } else {
        // Fallback to conversion (even though it's wrong)
        const distanceMeters = route.distance.value;
        distanceMiles = Math.round(distanceMeters * 0.000621371);
      }
      
      console.log('[ETA API] ✅ Success - Duration:', durationMinutes, 'min, Distance:', distanceMiles, 'mi');
      
      return res.status(200).json({
        success: true,
        duration: durationMinutes,
        distance: distanceMiles,
        trafficCondition: 'normal',
        durationInTraffic: durationMinutes
      });
    }
    
    console.log('[ETA API] Radar returned no routes');
    return res.status(200).json({
      success: false,
      error: 'Unable to calculate route',
      duration: null,
      distance: null,
      trafficCondition: null
    });

  } catch (error: any) {
    console.error('[ETA API] Error:', error.message || error);
    console.error('[ETA API] Error response:', error.response?.data);
    
    return res.status(200).json({
      success: false,
      error: 'Route calculation service unavailable',
      duration: null,
      distance: null,
      trafficCondition: null
    });
  }
}