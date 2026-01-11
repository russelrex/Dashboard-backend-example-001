export interface DynamicCreateLocationRequest {
  companyName: string;
  email: string;
  phone: string;
  locationId?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  timezone?: string;
  website?: string;
  business?: any;
  companyId?: string;
  appInstalled?: boolean;
  hasCompanyOAuth?: boolean;
  businessHours?: any;
  settings?: any;
  social?: any;
  saaSPlanData?: {
    platform: string;
    planId: string;              
    stripeProductId?: string;     
    stripePriceId: string;
    stripeSubscriptionId: string;       
    name: string;              
    description?: string;      
    basePrice: number;     
    baseSeats: number;        
    additionalSeatCount: number;      
    seatCount?: number;
    billingInterval: 'month' | 'year';
    trialEndsAt?: string;
    currentPeriodEnd?: string;
    status: 'active' | 'past_due' | 'canceled' | 'trialing';
    createdAt: string;
    updatedAt: string;
  };
  prospectInfo?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  twilio?: any;
  mailgun?: any;
  snapshotId?: string;
  [key: string]: any;
}

export interface GHLBusinessInfo {
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  website: string;
  timezone: string;
  logoUrl: string;
  email: string;
}

export interface GHLSocialInfo {
  facebookUrl: string;
  googlePlus: string;
  linkedIn: string;
  foursquare: string;
  twitter: string;
  yelp: string;
  instagram: string;
  youtube: string;
  pinterest: string;
  blogRss: string;
  googlePlacesId: string;
}

export interface GHLCrmSettings {
  deSyncOwners: boolean;
  syncFollowers: {
    contact: boolean;
    opportunity: boolean;
  };
}

export interface GHLTwilioRebilling {
  markup: number;
  enabled: boolean;
}

export interface GHLSaaSSettings {
  saasMode: string;
  twilioRebilling: GHLTwilioRebilling;
  providerLocationId: string;
  contactId: string;
}

export interface GHLLocationSettings {
  allowDuplicateContact: boolean;
  allowDuplicateOpportunity: boolean;
  allowFacebookNameMerge: boolean;
  disableContactTimezone: boolean;
  contactUniqueIdentifiers: string[];
  crmSettings: GHLCrmSettings;
  saasSettings: GHLSaaSSettings;
}

export interface GHLPermissions {
  dashboardStatsEnabled: boolean;
  funnelsEnabled: boolean;
  phoneCallEnabled: boolean;
  formsEnabled: boolean;
  textToPayEnabled: boolean;
  gmbMessagingEnabled: boolean;
  htmlBuilderEnabled: boolean;
  contactsEnabled: boolean;
  tagsEnabled: boolean;
  botServiceEnabled: boolean;
  websitesEnabled: boolean;
  appointmentsEnabled: boolean;
  proposalsEnabled: boolean;
  webChatEnabled: boolean;
  facebookMessengerEnabled: boolean;
  affiliateManagerEnabled: boolean;
  gmbCallTrackingEnabled: boolean;
  marketingEnabled: boolean;
  emailBuilderEnabled: boolean;
  attributionsReportingEnabled: boolean;
  triggerLinksEnabled: boolean;
  membershipEnabled: boolean;
  settingsEnabled: boolean;
  surveysEnabled: boolean;
  opportunitiesEnabled: boolean;
  reviewsEnabled: boolean;
  smsEmailTemplatesEnabled: boolean;
  facebookAdsReportingEnabled: boolean;
  adManagerEnabled: boolean;
  bloggingEnabled: boolean;
  workflowsEnabled: boolean;
  campaignsEnabled: boolean;
  conversationsEnabled: boolean;
  adwordsReportingEnabled: boolean;
  bulkRequestsEnabled: boolean;
  agentReportingEnabled: boolean;
  triggersEnabled: boolean;
}

export interface GHLLocationData {
  id: string;
  companyId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  website: string;
  timezone: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  logoUrl: string;
  automaticMobileAppInvite: boolean;
  business: GHLBusinessInfo;
  social: GHLSocialInfo;
  settings: GHLLocationSettings;
  dateAdded: string;
  domain: string;
  currency: string;
  isAgencySubAccount: any;
  defaultEmailService: string;
  permissions: GHLPermissions;
  snapshotId: string;
}

export interface GHLGetLocationResponse {
  location: GHLLocationData;
  traceId: string;
} 