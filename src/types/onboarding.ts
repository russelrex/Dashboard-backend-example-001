// src/types/onboarding.ts
// TypeScript interfaces for onboarding system

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface ClientInfo {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  website?: string;
  address: Address;
}

export interface Timeline {
  startDate: Date;
  estimatedCompletion: Date;
  actualCompletion?: Date;
}

export interface OnboardClient {
  _id?: string;
  locationId: string;
  clientInfo: ClientInfo;
  packageType: 'basic' | 'premium' | 'enterprise';
  timeline: Timeline;
  status: 'pending' | 'in_progress' | 'completed' | 'on_hold';
  assignedTeam: string[];
  notes?: string;
  metadata: {
    priority: 'low' | 'medium' | 'high';
    tags: string[];
    source?: string;
    salesRep?: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PhaseProgress {
  completedTasks: number;
  totalTasks: number;
  percentage: number;
  status: 'pending' | 'in_progress' | 'completed';
  startDate?: Date;
  completionDate?: Date;
}

export interface OnboardProgress {
  _id?: string;
  locationId: string;
  completedTaskIds: string[];
  phaseProgress: {
    [key: string]: PhaseProgress;
  };
  overallProgress: number;
  currentPhase: number;
  lastUpdated: Date;
  updatedBy?: string;
  milestones: Array<{
    phaseId: number;
    completedAt: Date;
    completedBy?: string;
  }>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TaskLog {
  _id?: string;
  locationId: string;
  taskId: string;
  action: 'completed' | 'uncompleted';
  timestamp: Date;
  userId?: string;
  userName?: string;
  notes?: string;
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  estimatedDuration: string;
  dependencies: string[];
  assignedRole?: string;
  required: boolean;
  category?: string;
  order?: number;
  phase?: number;
}

export interface PhaseTemplate {
  id: number;
  title: string;
  description: string;
  estimatedDuration: string;
  teamMembers: string[];
  tasks: TaskTemplate[];
}

export interface OnboardTemplate {
  _id?: string;
  packageType: 'basic' | 'premium' | 'enterprise';
  name: string;
  description?: string;
  totalTasks: number;
  estimatedDuration: string;
  phases: PhaseTemplate[];
  isActive: boolean;
  version: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OnboardAnalytics {
  _id?: string;
  date: Date;
  period: 'daily' | 'weekly' | 'monthly';
  metrics: {
    totalClients: number;
    newClients: number;
    completedOnboarding: number;
    activeOnboarding: number;
    averageCompletionTime: number;
    taskCompletionRate: {
      [key: string]: number;
    };
    packageTypeDistribution: {
      basic: number;
      premium: number;
      enterprise: number;
    };
  };
  createdAt?: Date;
  updatedAt?: Date;
}

// Request/Response interfaces
export interface CreateClientRequest {
  locationId: string;
  clientInfo: ClientInfo;
  packageType: 'basic' | 'premium' | 'enterprise';
  timeline: {
    startDate: string;
    estimatedCompletion: string;
  };
  assignedTeam: string[];
  notes?: string;
  metadata?: {
    priority?: 'low' | 'medium' | 'high';
    tags?: string[];
    source?: string;
    salesRep?: string;
  };
}

export interface UpdateClientRequest {
  clientInfo?: Partial<ClientInfo>;
  packageType?: 'basic' | 'premium' | 'enterprise';
  timeline?: Partial<{
    startDate: string;
    estimatedCompletion: string;
    actualCompletion: string;
  }>;
  status?: 'pending' | 'in_progress' | 'completed' | 'on_hold';
  assignedTeam?: string[];
  notes?: string;
  metadata?: Partial<{
    priority: 'low' | 'medium' | 'high';
    tags: string[];
    source: string;
    salesRep: string;
  }>;
}

export interface CompleteTaskRequest {
  locationId: string;
  taskId: string;
  userId?: string;
  userName?: string;
  notes?: string;
}

export interface ClientsQuery {
  page?: string;
  limit?: string;
  search?: string;
  status?: string;
  packageType?: string;
  priority?: string;
  assignedTeam?: string;
}

export interface ProgressQuery {
  page?: string;
  limit?: string;
  locationId?: string;
  currentPhase?: string;
  overallProgress?: string;
} 

// Task Requirements System Types
export interface FileRequirement {
  acceptedFileTypes: string[];
  maxFileSize: number;
  maxFiles: number;
  description?: string;
  examples?: string[];
}

export interface TextRequirement {
  question: string;
  maxLength?: number;
  isRequired: boolean;
}

export interface CreatedBy {
  userId: string;
  userName: string;
  role: string;
}

export interface TaskRequirement {
  _id?: string;
  taskId: string;
  locationId?: string;
  agencyId: string;
  title: string;
  description: string;
  type: 'file_upload' | 'text_input';
  priority: 'low' | 'medium' | 'high' | 'critical';
  fileRequirement?: FileRequirement;
  textRequirement?: TextRequirement;
  status: 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'completed';
  isRequired: boolean;
  dueDate?: Date;
  createdBy: CreatedBy;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadedFile {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedAt: Date;
}

export interface ResponseData {
  files?: UploadedFile[];
  answer?: string;
}

export interface SubmittedBy {
  userId: string;
  userName: string;
  email: string;
}

export interface AgencyFeedback {
  status: 'approved' | 'rejected';
  comments?: string;
  reviewedBy: {
    userId: string;
    userName: string;
  };
  reviewedAt: Date;
}

export interface RequirementResponse {
  _id?: string;
  requirementId: string;
  locationId: string;
  taskId: string;
  responseType: 'file_upload' | 'text_input';
  responseData: ResponseData;
  notes?: string;
  status: 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'completed';
  submittedAt?: Date;
  submittedBy?: SubmittedBy;
  agencyFeedback?: AgencyFeedback;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageAttachment {
  name: string;
  url: string;
  type: string;
}

export interface RequirementMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: 'agency_admin' | 'location_admin' | 'client';
  message: string;
  attachments?: MessageAttachment[];
  timestamp: Date;
  isRead: boolean;
}

export interface RequirementCommunication {
  _id?: string;
  requirementId: string;
  locationId: string;
  messages: RequirementMessage[];
  createdAt: Date;
  updatedAt: Date;
}

// Request/Response types for API
export interface CreateRequirementRequest {
  taskId: string;
  locationId?: string;
  agencyId?: string;
  title: string;
  description: string;
  type: 'file_upload' | 'text_input';
  priority: 'low' | 'medium' | 'high' | 'critical';
  isRequired?: boolean;
  dueDate?: string;
  fileRequirement?: FileRequirement;
  textRequirement?: TextRequirement;
  createdBy?: CreatedBy;
}

export interface SubmitResponseRequest {
  requirementId: string;
  responseData: ResponseData;
  notes?: string;
  submittedBy?: SubmittedBy;
} 