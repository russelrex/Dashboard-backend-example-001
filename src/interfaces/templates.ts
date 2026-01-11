// Template-related interfaces for API filtering and data structures

export interface TemplateFilters {
  category?: string;
  isGlobal?: boolean;
  locationId?: string;
  isDefault?: boolean;
}

export interface Template {
  _id: string;
  name: string;
  category: string;
  locationId?: string;
  isGlobal: boolean;
  isDefault?: boolean;
  isActive: boolean;
  tabs?: TemplateTab[];
  sections?: TemplateSection[];
  content?: string;
  description?: string;
  tags?: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  sourceTemplateId?: string; // For copied templates
}

export interface TemplateTab {
  id: string;
  title: string;
  icon: string;
  enabled: boolean;
  order: number;
  blocks: TemplateBlock[];
}

export interface TemplateSection {
  id: string;
  title: string;
  enabled: boolean;
  order: number;
  content: string;
  type: 'text' | 'html' | 'markdown';
}

export interface TemplateBlock {
  id: string;
  type: string;
  content: any;
  order: number;
  enabled: boolean;
}

export interface TemplateResponse {
  success: boolean;
  data: Template[];
  total?: number;
  message?: string;
}

export interface GetTemplatesResponse {
  success: boolean;
  data?: Template[];
  error?: string;
}

export interface CreateTemplateRequest {
  name: string;
  category: string;
  description?: string;
  content?: string;
  tabs?: TemplateTab[];
  sections?: TemplateSection[];
  tags?: string[];
  isDefault?: boolean;
}

export interface UpdateTemplateRequest {
  name?: string;
  category?: string;
  description?: string;
  content?: string;
  tabs?: TemplateTab[];
  sections?: TemplateSection[];
  tags?: string[];
  isDefault?: boolean;
  isActive?: boolean;
}
