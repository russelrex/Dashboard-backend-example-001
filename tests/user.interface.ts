// tests/user.interface.ts
import { ObjectId } from 'mongodb';

export interface UserPermissions {
  adwordsReportingEnabled: boolean;
  affiliateManagerEnabled: boolean;
  agencyViewEnabled: boolean;
  appointmentsEnabled: boolean;
  assignedDataOnly: boolean;
  attributionsReportingEnabled: boolean;
  bulkRequestsEnabled: boolean;
  campaignsEnabled: boolean;
  campaignsReadOnly: boolean;
  cancelSubscriptionEnabled: boolean;
  communitiesEnabled: boolean;
  contactsEnabled: boolean;
  conversationsEnabled: boolean;
  dashboardStatsEnabled: boolean;
  facebookAdsReportingEnabled: boolean;
  funnelsEnabled: boolean;
  invoiceEnabled: boolean;
  leadValueEnabled: boolean;
  marketingEnabled: boolean;
  membershipEnabled: boolean;
  onlineListingsEnabled: boolean;
  opportunitiesEnabled: boolean;
  paymentsEnabled: boolean;
  phoneCallEnabled: boolean;
  recordPaymentEnabled: boolean;
  refundsEnabled: boolean;
  reviewsEnabled: boolean;
  settingsEnabled: boolean;
  socialPlanner: boolean;
  tagsEnabled: boolean;
  triggersEnabled: boolean;
  websitesEnabled: boolean;
  workflowsEnabled: boolean;
  bloggingEnabled: boolean;
  contentAiEnabled: boolean;
}

export interface User {
  _id?: ObjectId;
  locationId: string;
  email: string;
  firstName: string;
  lastName?: string;
  type: string;
  role: string;
  permissions: UserPermissions;
  phone?: string;
  avatar?: string;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  lastLogin?: Date;
  timezone?: string;
  language?: string;
  isTest?: boolean;
  processedBy?: string;
  // Setup fields for new user onboarding
  setupToken?: string;
  setupTokenExpiry?: Date;
  needsSetup?: boolean;
}

// Simplified interface for testing - only requires essential fields
export interface CreateUserRequest {
  locationId: string;
  email: string;
  firstName: string;
  lastName?: string;
} 