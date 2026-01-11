// src/services/radarBackendService.ts
// Complete Radar service for backend operations (using secret key)

// Note: Redis caching is disabled since Redis is not set up in this backend
// const redis = null;

interface RadarGeocodeResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  country: string;
  countryCode: string;
  state?: string;
  stateCode?: string;
  postalCode?: string;
  city?: string;
  borough?: string;
  county?: string;
  neighborhood?: string;
  street?: string;
  number?: string;
  confidence: 'exact' | 'interpolated' | 'fallback';
  addressLabel?: string;
  placeLabel?: string;
}

interface RouteResult {
  distance: number;
  distanceText: string;
  duration: number;
  durationText: string;
  durationMinutes: number;
}

class RadarBackendService {
  private secretKey: string;
  private baseUrl = 'https://api.radar.io/v1';
  private cachePrefix = 'radar:';
  private cacheTTL = 86400; // 24 hours
  
  constructor() {
    this.secretKey = process.env.RADAR_SECRET_KEY || '';
    
    if (!this.secretKey) {
      console.error('[RadarBackendService] ❌ No secret key configured!');
      console.error('[RadarBackendService] Add RADAR_SECRET_KEY to your .env.local');
    } else {
      console.log('[RadarBackendService] ✅ Initialized with secret key');
    }
  }

  /**
   * Geocode an address string to get coordinates and components
   * Perfect for processing addresses when creating contacts
   */
  async geocodeAddress(address: string, options: { forceRefresh?: boolean } = {}): Promise<RadarGeocodeResult | null> {
    if (!this.secretKey) {
      console.error('[RadarBackendService] No secret key available');
      return null;
    }

    if (!address) {
      return null;
    }

    // Cache disabled - Redis not set up in this backend
    // const cacheKey = `${this.cachePrefix}geocode:${address.toLowerCase().replace(/\s+/g, '-')}`;
    // if (!options.forceRefresh && redis) {
    //   try {
    //     const cached = await redis.get(cacheKey);
    //     if (cached) {
    //       console.log('[RadarBackendService] Cache hit for:', address);
    //       return JSON.parse(cached);
    //     }
    //   } catch (error) {
    //     console.error('[RadarBackendService] Cache read error:', error);
    //   }
    // }

    try {
      const response = await fetch(
        `${this.baseUrl}/geocode/forward?query=${encodeURIComponent(address)}`,
        {
          headers: {
            'Authorization': this.secretKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[RadarBackendService] Geocode error:', response.status, errorText);
        return null;
      }

      const data = await response.json();
      
      if (data.addresses && data.addresses.length > 0) {
        const result = data.addresses[0];
        
        // Cache disabled - Redis not set up in this backend
        // if (redis) {
        //   try {
        //     await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(result));
        //   } catch (error) {
        //     console.error('[RadarBackendService] Cache write error:', error);
        //   }
        // }
        
        return result;
      }
      
      return null;
    } catch (error) {
      console.error('[RadarBackendService] Geocode error:', error);
      return null;
    }
  }

  /**
   * Validate and enhance address with multiple attempts
   * This is the smart geocoding that tries variations
   */
  async validateAddress(address: string, contact?: any): Promise<{
    success: boolean;
    latitude?: number;
    longitude?: number;
    formattedAddress?: string;
    confidence?: string;
    addressLabel?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    originalAddress: string;
    geocodedAddress?: string;
    error?: string;
  }> {
    const variations = this._generateAddressVariations(address, contact);
    
    console.log('[RadarBackendService] Trying address variations:', variations);
    
    for (const variant of variations) {
      try {
        const result = await this.geocodeAddress(variant);
        if (result && (result.confidence === 'exact' || result.confidence === 'interpolated')) {
          return {
            success: true,
            latitude: result.latitude,
            longitude: result.longitude,
            formattedAddress: result.formattedAddress,
            confidence: result.confidence,
            addressLabel: result.addressLabel,
            city: result.city,
            state: result.state || result.stateCode,
            postalCode: result.postalCode,
            country: result.country || result.countryCode,
            originalAddress: address,
            geocodedAddress: variant
          };
        }
      } catch (error) {
        console.log(`[RadarBackendService] Failed to geocode variant: ${variant}`);
        continue;
      }
    }

    return {
      success: false,
      error: 'Unable to validate address after trying all variations',
      originalAddress: address
    };
  }

  /**
   * Generate address variations for better geocoding
   */
  private _generateAddressVariations(address: string, contact?: any): string[] {
    const variations = [];
    
    // 1. Original address
    variations.push(address);
    
    // 2. Normalized address
    const normalized = this._normalizeAddress(address);
    if (normalized !== address) {
      variations.push(normalized);
    }
    
    // 3. With contact info
    if (contact) {
      let fullAddress = address;
      const hasCity = address.toLowerCase().includes(contact.city?.toLowerCase() || '');
      const hasState = address.toLowerCase().includes(contact.state?.toLowerCase() || '');
      
      if (contact.city && !hasCity) {
        fullAddress += `, ${contact.city}`;
      }
      if (contact.state && !hasState) {
        fullAddress += `, ${contact.state}`;
      }
      if (contact.postalCode && !address.includes(contact.postalCode)) {
        fullAddress += ` ${contact.postalCode}`;
      }
      
      if (fullAddress !== address) {
        variations.push(this._normalizeAddress(fullAddress));
      }
    }
    
    // 4. Without suite numbers
    const withoutUnit = address.replace(/,?\s*(STE|Suite|Unit|Apt|#)\s*\w+/gi, '').trim();
    if (withoutUnit !== address) {
      variations.push(this._normalizeAddress(withoutUnit));
    }
    
    // 5. With USA appended (helps with ambiguous addresses)
    if (!address.toLowerCase().includes('usa') && !address.toLowerCase().includes('united states')) {
      const bestVariation = variations[Math.min(2, variations.length - 1)];
      variations.push(`${bestVariation}, USA`);
    }
    
    // Remove duplicates
    return [...new Set(variations)];
  }

  /**
   * Normalize address for better geocoding
   */
  private _normalizeAddress(address: string): string {
    if (!address) return '';
    
    const replacements: Record<string, string> = {
      ' Rd': ' Road',
      ' St': ' Street',
      ' Ave': ' Avenue',
      ' Blvd': ' Boulevard',
      ' Dr': ' Drive',
      ' Ln': ' Lane',
      ' Ct': ' Court',
      ' Pl': ' Place',
      ' Pkwy': ' Parkway',
      ' Hwy': ' Highway',
      ' E ': ' East ',
      ' W ': ' West ',
      ' N ': ' North ',
      ' S ': ' South ',
      ', Co ': ', CO ',
      ', co ': ', CO ',
      ', Id ': ', ID ',
      ', id ': ', ID ',
      ', Ca ': ', CA ',
      ', ca ': ', CA ',
      ', Tx ': ', TX ',
      ', tx ': ', TX ',
    };
    
    let normalized = address;
    Object.entries(replacements).forEach(([find, replace]) => {
      normalized = normalized.replace(new RegExp(find, 'gi'), replace);
    });
    
    // Capitalize first letter of each word
    normalized = normalized.replace(/\b\w/g, char => char.toUpperCase());
    
    // Remove extra spaces
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized;
  }

  /**
   * Reverse geocode coordinates to get address
   */
  async reverseGeocode(lat: number, lng: number): Promise<RadarGeocodeResult | null> {
    if (!this.secretKey) {
      return null;
    }

    // Cache disabled - Redis not set up in this backend
    // const cacheKey = `${this.cachePrefix}reverse:${lat.toFixed(6)},${lng.toFixed(6)}`;
    // if (redis) {
    //   try {
    //     const cached = await redis.get(cacheKey);
    //     if (cached) {
    //       return JSON.parse(cached);
    //     }
    //   } catch (error) {
    //     console.error('[RadarBackendService] Cache read error:', error);
    //   }
    // }

    try {
      const response = await fetch(
        `${this.baseUrl}/geocode/reverse?coordinates=${lat},${lng}`,
        {
          headers: {
            'Authorization': this.secretKey,
          },
        }
      );

      if (!response.ok) {
        console.error('[RadarBackendService] Reverse geocode error:', response.status);
        return null;
      }

      const data = await response.json();
      
      if (data.addresses && data.addresses.length > 0) {
        const result = data.addresses[0];
        
        // Cache disabled - Redis not set up in this backend
        // if (redis) {
        //   try {
        //     await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(result));
        //   } catch (error) {
        //     console.error('[RadarBackendService] Cache write error:', error);
        //   }
        // }
        
        return result;
      }
      
      return null;
    } catch (error) {
      console.error('[RadarBackendService] Reverse geocode error:', error);
      return null;
    }
  }

  /**
   * Calculate route distance and duration between two points
   */
  async calculateRoute(
    origin: { latitude: number; longitude: number },
    destination: { latitude: number; longitude: number },
    options: { mode?: string; units?: string } = {}
  ): Promise<RouteResult | null> {
    const { mode = 'car', units = 'imperial' } = options;

    if (!this.secretKey) {
      console.error('[RadarBackendService] No secret key for route calculation');
      return null;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/route/distance?` + 
        `origin=${origin.latitude},${origin.longitude}` +
        `&destination=${destination.latitude},${destination.longitude}` +
        `&modes=${mode}&units=${units}`,
        {
          headers: {
            'Authorization': this.secretKey,
          },
        }
      );

      if (!response.ok) {
        console.error('[RadarBackendService] Route calculation error:', response.status);
        return null;
      }

      const data = await response.json();
      
      if (data.routes && data.routes[mode]) {
        const route = data.routes[mode];
        return {
          distance: route.distance.value,
          distanceText: route.distance.text,
          duration: route.duration.value,
          durationText: route.duration.text,
          durationMinutes: Math.ceil(route.duration.value / 60)
        };
      }

      return null;
    } catch (error) {
      console.error('[RadarBackendService] Route calculation error:', error);
      return null;
    }
  }

  /**
   * Validate and standardize an address
   * Returns properly formatted address components for GHL
   */
  async standardizeAddress(address: string): Promise<{
    address1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  } | null> {
    const geocoded = await this.geocodeAddress(address);
    
    if (!geocoded) {
      // Fallback to simple parsing
      return this.parseAddressFallback(address);
    }

    return {
      address1: [geocoded.number, geocoded.street].filter(Boolean).join(' ') || geocoded.formattedAddress,
      city: geocoded.city || '',
      state: geocoded.stateCode || geocoded.state || '',
      postalCode: geocoded.postalCode || '',
      country: geocoded.countryCode || 'US',
      coordinates: {
        lat: geocoded.latitude,
        lng: geocoded.longitude,
      },
    };
  }

  /**
   * Simple address parser as fallback
   */
  private parseAddressFallback(address: string) {
    const parts = address.split(',').map(p => p.trim());
    
    if (parts.length >= 3) {
      // Try to parse "street, city, state zip"
      const stateZipMatch = parts[2].match(/([A-Z]{2})\s+(\d{5}(-\d{4})?)/);
      
      return {
        address1: parts[0],
        city: parts[1],
        state: stateZipMatch ? stateZipMatch[1] : parts[2].split(' ')[0],
        postalCode: stateZipMatch ? stateZipMatch[2] : parts[2].split(' ')[1] || '',
        country: 'US',
      };
    }
    
    // Can't parse it well, just put it all in address1
    return {
      address1: address,
      city: '',
      state: '',
      postalCode: '',
      country: 'US',
    };
  }

  /**
   * Calculate distance between two points (Haversine formula)
   * Useful when you don't need full routing, just straight-line distance
   */
  calculateDistance(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number }
  ): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRad(point2.lat - point1.lat);
    const dLng = this.toRad(point2.lng - point1.lng);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(point1.lat)) * Math.cos(this.toRad(point2.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c; // Distance in miles
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Search for places near a location
   */
  async searchPlaces(
    query: string, 
    near?: { latitude: number; longitude: number },
    options: { categories?: string[]; limit?: number; radius?: number } = {}
  ): Promise<any[]> {
    if (!this.secretKey) {
      return [];
    }

    const { categories = [], limit = 10, radius = 1000 } = options;

    try {
      let url = `${this.baseUrl}/search/places?query=${encodeURIComponent(query)}&limit=${limit}`;
      
      if (near) {
        url += `&near=${near.latitude},${near.longitude}&radius=${radius}`;
      }
      
      if (categories.length > 0) {
        url += `&categories=${categories.join(',')}`;
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': this.secretKey,
        },
      });

      if (!response.ok) {
        console.error('[RadarBackendService] Place search error:', response.status);
        return [];
      }

      const data = await response.json();
      return data.places || [];
    } catch (error) {
      console.error('[RadarBackendService] Place search error:', error);
      return [];
    }
  }
}

export const radarBackendService = new RadarBackendService();