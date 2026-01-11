// Contact-related interfaces for GHL API integration

export interface DndSettings {
  Call?: { enabled?: boolean; message?: string };
  Email?: { enabled?: boolean; message?: string };
  SMS?: { enabled?: boolean; message?: string };
  WhatsApp?: { enabled?: boolean; message?: string };
  GMB?: { enabled?: boolean; message?: string };
  FB?: { enabled?: boolean; message?: string };
}

export interface InboundDndSettings {
  all?: { enabled?: boolean };
}

// Custom field types based on GHL API
export interface TextField {
  id: string;
  key?: string;
  field_value: string;
}

export interface LargeTextField {
  id: string;
  key?: string;
  field_value: string;
}

export interface SingleSelectField {
  id: string;
  key?: string;
  field_value: string;
}

export interface RadioField {
  id: string;
  key?: string;
  field_value: string;
}

export interface NumericField {
  id: string;
  key?: string;
  field_value: number;
}

export interface MonetoryField {
  id: string;
  key?: string;
  field_value: number;
}

export interface CheckboxField {
  id: string;
  key?: string;
  field_value: boolean;
}

export interface MultiSelectField {
  id: string;
  key?: string;
  field_value: string[];
}

export interface FileField {
  id: string;
  key?: string;
  field_value: string; // URL or file reference
}

export type CustomField =
  | TextField
  | LargeTextField
  | SingleSelectField
  | RadioField
  | NumericField
  | MonetoryField
  | CheckboxField
  | MultiSelectField
  | FileField;

export interface CreateContactRequest {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  locationId: string; // required
  gender?: string;
  phone?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string;
  website?: string | null;
  timezone?: string | null;
  dnd?: boolean;
  dndSettings?: DndSettings;
  inboundDndSettings?: InboundDndSettings;
  tags?: string[];
  customFields?: CustomField[];
  source?: string;
  country?: string;
  companyName?: string | null;
  assignedTo?: string; // User's Id
}

export interface GHLContactResponse {
  id: string;
  locationId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  companyName?: string;
  website?: string;
  timezone?: string;
  dnd?: boolean;
  dndSettings?: DndSettings;
  inboundDndSettings?: InboundDndSettings;
  tags?: string[];
  customFields?: CustomField[];
  source?: string;
  assignedTo?: string;
  dateAdded?: string;
  dateUpdated?: string;
}

