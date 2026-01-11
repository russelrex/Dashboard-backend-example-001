// tests/location.interface.ts
import { ObjectId } from 'mongodb';

export interface LocationBusiness {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  website?: string;
  timezone?: string;
  logoUrl?: string;
  email?: string;
}

export interface LocationSettings {
  allowDuplicateContact: boolean;
  allowDuplicateOpportunity: boolean;
  allowFacebookNameMerge: boolean;
  disableContactTimezone?: boolean;
  contactUniqueIdentifiers?: string[];
  crmSettings?: {
    deSyncOwners?: boolean;
    syncFollowers?: {
      contact?: boolean;
      opportunity?: boolean;
    };
  };
  saasSettings?: {
    saasMode?: string;
    twilioRebilling?: {
      enabled?: boolean;
      markup?: number;
    };
  };
}

export interface LocationSocial {
  facebookUrl?: string;
  googlePlus?: string;
  linkedIn?: string;
  foursquare?: string;
  twitter?: string;
  yelp?: string;
  instagram?: string;
  youtube?: string;
  pinterest?: string;
  blogRss?: string;
  googlePlacesId?: string;
}

export interface Location {
  _id?: ObjectId;
  locationId?: string;
  address?: string | null;
  appInstalled?: boolean;
  business?: LocationBusiness;
  city?: string | null;
  companyId?: string;
  companyName: string;
  country?: string | null;
  createdAt?: Date;
  email: string;
  name?: string;
  phone: string;
  postalCode?: string | null;
  settings: LocationSettings;
  social?: LocationSocial;
  state?: string | null;
  timezone?: string | null;
  updatedAt?: Date;
  website?: string | null;
  hasCompanyOAuth?: boolean;
  businessHours?: any | null;
  lastWebhookUpdate?: Date;
  processedBy?: string;
  webhookId?: string;
  isTest?: boolean;
}

export interface CreateLocationRequest {
  locationId?: string;
  companyId?: string;
  companyName: string;
  email: string;
  phone: string;
  settings: LocationSettings;
  name?: string;
  business?: LocationBusiness;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  timezone?: string;
  website?: string;
  social?: Partial<LocationSocial>;
  appInstalled?: boolean;
  hasCompanyOAuth?: boolean;
  businessHours?: any;
} 