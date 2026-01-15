
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'development';

console.log('🌱 Seeding local database...\n');

const getDbName = () => {
  // Check if DATABASE_NAME is explicitly set
  if (process.env.DATABASE_NAME) {
    return process.env.DATABASE_NAME;
  }
  
  // Extract database name from connection string
  const uri = process.env.MONGODB_URI || process.env.LOCAL_MONGODB_URI;
  if (uri) {
    try {
      const url = new URL(uri);
      const dbName = url.pathname?.slice(1); // Remove leading slash
      if (dbName) {
        return dbName;
      }
    } catch (e) {
      // If URL parsing fails, try regex extraction
      const match = uri.match(/\/\/(?:[^\/]+)\/([^?]+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  }
  
  // Fallback to default based on NODE_ENV
  return process.env.NODE_ENV === 'development' ? 'local' : 'lpai';
};

const connectToDatabase = async () => {
  // Prefer MONGODB_URI if set, otherwise use LOCAL_MONGODB_URI
  const uri = process.env.MONGODB_URI || process.env.LOCAL_MONGODB_URI || 'mongodb://localhost:27017/local';
  
  if (!uri) {
    throw new Error('⚠️ Database URI is missing in environment variables. Please set MONGODB_URI or LOCAL_MONGODB_URI');
  }
  
  console.log(`🔗 Connecting to: ${uri.replace(/\/\/.*@/, '//***@')}`);
  const client = new MongoClient(uri);
  await client.connect();
  return client;
};

const generateMockUser = async () => ({
  _id: new ObjectId(),
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'User',
  hashedPassword: await bcrypt.hash('password', 10),
  role: 'admin',
  isActive: true,
  ghlUserId: 'mock_ghl_user_123',
  locationId: 'mock_location_123',
  permissions: ['admin', 'users', 'contacts', 'projects', 'quotes', 'templates', 'settings'],
  preferences: {
    notifications: true,
    defaultCalendarView: 'week',
    theme: 'system',
    timezone: 'America/Los_Angeles'
  },
  createdAt: new Date(),
  updatedAt: new Date()
});

const generateMockLocation = (userId) => ({
  _id: new ObjectId(),
  locationId: 'mock_location_123', // GHL location ID
  name: 'Demo Company',
  apiKey: 'mock_api_key_encrypted',
  ghlAccountId: 'mock_account_123',
  branding: {
    logo: '',
    primaryColor: '#2563eb',
    secondaryColor: '#1e40af',
    phone: '+1 (555) 123-4567',
    email: 'contact@democompany.com',
    website: 'https://democompany.com',
    address: '123 Main Street, Demo City, CA 90210',
    establishedYear: '2020',
    warrantyYears: '5'
  },
  pipelines: [{
    id: 'mock_pipeline_1',
    name: 'Sales Pipeline',
    stages: [
      { id: 'lead', name: 'Lead', position: 1 },
      { id: 'qualified', name: 'Qualified', position: 2 },
      { id: 'proposal', name: 'Proposal Sent', position: 3 },
      { id: 'closed_won', name: 'Closed Won', position: 4 },
      { id: 'closed_lost', name: 'Closed Lost', position: 5 }
    ]
  }],
  calendars: [],
  ghlCustomFields: {
    project_title: 'project_title_field_id',
    quote_number: 'quote_number_field_id',
    signed_date: 'signed_date_field_id'
  },
  termsAndConditions: 'Standard terms and conditions for {companyName}. Work will be performed according to industry standards.',
  emailTemplates: {
    contractSigned: null,
    quoteSent: null,
    invoiceSent: null,
    appointmentReminder: null
  },
  features: {
    paymentsEnabled: true,
    invoicingEnabled: true,
    webQuotesEnabled: true,
    smsEnabled: true
  },
  subscription: {
    plan: 'pro',
    status: 'active',
    trialEndDate: null,
    billingCycle: 'monthly'
  },
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
});

const generateMockContacts = (locationId) => [
  {
    _id: new ObjectId(),
    firstName: 'John',
    lastName: 'Smith',
    email: 'john.smith@email.com',
    phone: '+1 (555) 234-5678',
    address: '456 Oak Avenue, Demo City, CA 90211',
    locationId,
    notes: 'Interested in kitchen renovation. Prefers high-end materials.',
    tags: ['customer', 'residential'],
    source: 'website',
    ghlContactId: 'mock_contact_1',
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    updatedAt: new Date()
  },
  {
    _id: new ObjectId(),
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: 'sarah.johnson@email.com',
    phone: '+1 (555) 345-6789',
    address: '789 Pine Street, Demo City, CA 90212',
    locationId,
    notes: 'Commercial property manager. Looking for ongoing maintenance contracts.',
    tags: ['prospect', 'commercial'],
    source: 'referral',
    ghlContactId: 'mock_contact_2',
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
    updatedAt: new Date()
  }
];

const generateMockProjects = (locationId, contacts) => [
  {
    _id: new ObjectId(),
    title: 'Kitchen Renovation',
    status: 'open',
    contactId: contacts[0]._id.toString(),
    locationId: locationId,
    userId: null,
    quoteId: null,
    pipelineId: 'mock_pipeline_1',
    pipelineStageId: 'qualified',
    scopeOfWork: 'Complete kitchen remodel including cabinets, countertops, and appliances. Replace flooring and update electrical as needed.',
    products: ['Custom Kitchen Cabinets', 'Granite Countertops', 'Kitchen Appliances Package'],
    monetaryValue: 25000,
    milestones: [
      {
        id: 'demo',
        title: 'Demolition',
        completed: false,
        completedAt: null,
        createdAt: new Date()
      },
      {
        id: 'install',
        title: 'Installation',
        completed: false,
        completedAt: null,
        createdAt: new Date()
      }
    ],
    photos: [],
    documents: [],
    timeline: [
      {
        id: 'created',
        event: 'Project Created',
        description: 'Initial kitchen renovation project created',
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        userId: null
      }
    ],
    customFields: {},
    ghlOpportunityId: 'mock_opportunity_1',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    updatedAt: new Date(),
    deletedAt: null,
    signedDate: null
  },
  {
    _id: new ObjectId(),
    title: 'Office Building Maintenance',
    status: 'won',
    contactId: contacts[1]._id.toString(),
    locationId: locationId,
    userId: null,
    quoteId: null,
    pipelineId: 'mock_pipeline_1',
    pipelineStageId: 'closed_won',
    scopeOfWork: 'Monthly maintenance contract for commercial office building including HVAC, electrical, and general repairs.',
    products: ['Monthly Maintenance Contract', 'Emergency Repair Services'],
    monetaryValue: 15000,
    milestones: [
      {
        id: 'contract',
        title: 'Contract Signed',
        completed: true,
        completedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      }
    ],
    photos: [],
    documents: [],
    timeline: [
      {
        id: 'created',
        event: 'Project Created',
        description: 'Commercial maintenance contract project created',
        timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        userId: null
      },
      {
        id: 'won',
        event: 'Status Changed',
        description: 'Project status changed to Won',
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        userId: null
      }
    ],
    customFields: {},
    ghlOpportunityId: 'mock_opportunity_2',
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(),
    deletedAt: null,
    signedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
  }
];

const generateMockQuotes = (locationId, projects) => [
  {
    _id: new ObjectId(),
    locationId,
    projectId: projects[0]._id,
    quoteNumber: 'Q-2024-001',
    title: 'Kitchen Renovation Quote',
    status: 'approved',
    totalAmount: 25000,
    items: [
      {
        description: 'Custom Kitchen Cabinets',
        quantity: 1,
        unitPrice: 12000,
        total: 12000
      },
      {
        description: 'Granite Countertops',
        quantity: 45, // sq ft
        unitPrice: 120,
        total: 5400
      },
      {
        description: 'Kitchen Appliances Package',
        quantity: 1,
        unitPrice: 7600,
        total: 7600
      }
    ],
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    updatedAt: new Date()
  }
];

const generateMockTemplates = (locationId) => [
  {
    _id: "template_modern_hvac_001",
    isGlobal: true,
    locationId: null,
    name: "Modern HVAC Professional",
    description: "Clean, modern layout perfect for HVAC and climate control projects with emphasis on energy efficiency",
    category: "hvac",
    preview: "❄️",
    isDefault: false,
    styling: {
        primaryColor: "#059669",
        accentColor: "#dc2626",
        fontFamily: "system",
        layout: "modern"
    },
    companyOverrides: {
        name: null,
        logo: "❄️",
        tagline: "Keeping you comfortable year-round since 2010",
        phone: null,
        email: null,
        address: null,
        establishedYear: "2010",
        warrantyYears: "3"
    },
    tabs: [
        {
            id: "tab_1",
            title: "About {companyName}",
            icon: "🏢",
            enabled: true,
            order: 1,
            blocks: [
                {
                    id: "block_1",
                    type: "hero",
                    position: 1,
                    content: {
                        title: "Your Trusted HVAC Experts",
                        subtitle: "{companyTagline}",
                        icon: "❄️"
                    }
                },
                {
                    id: "block_2",
                    type: "benefit_cards",
                    position: 2,
                    content: {
                        cards: [
                            {
                                icon: "⚡",
                                title: "Energy Efficient Solutions",
                                subtitle: "Save on Energy Bills",
                                description: "Our modern HVAC systems reduce energy consumption by up to 40% while maintaining perfect comfort levels."
                            },
                            {
                                icon: "🛡️",
                                title: "{warrantyYears}-Year Comprehensive Warranty",
                                subtitle: "Complete Peace of Mind",
                                description: "Full warranty coverage on all equipment and installation work with 24/7 emergency service support."
                            },
                            {
                                icon: "🏆",
                                title: "Licensed & Certified",
                                subtitle: "Professional Excellence",
                                description: "EPA certified technicians with {experienceYears} years of experience in residential and commercial HVAC."
                            }
                        ]
                    }
                },
                {
                    id: "block_3",
                    type: "contact_info",
                    position: 3,
                    content: {
                        title: "Get In Touch",
                        items: [
                            {
                                icon: "📞",
                                label: "24/7 Emergency Service",
                                value: "{phone}"
                            },
                            {
                                icon: "✉️",
                                label: "Email",
                                value: "{email}"
                            },
                            {
                                icon: "📍",
                                label: "Service Area",
                                value: "{address}"
                            }
                        ]
                    }
                }
            ]
        },
        {
            id: "tab_2",
            title: "Your Investment",
            icon: "💰",
            enabled: true,
            order: 5,
            blocks: [
                {
                    id: "block_4",
                    type: "quote_header",
                    position: 1,
                    content: {
                        title: "Investment Proposal #{quoteNumber}",
                        subtitle: "{projectTitle}",
                        customerLabel: "Prepared for: {customerName}"
                    }
                },
                {
                    id: "block_5",
                    type: "quote_breakdown",
                    position: 2,
                    content: {
                        title: "Investment Breakdown",
                        labels: {
                            subtotal: "Subtotal",
                            tax: "Tax",
                            total: "Total Investment",
                            quantity: "Qty",
                            sectionTotal: "Section Total"
                        }
                    }
                },
                {
                    id: "block_6",
                    type: "terms_section",
                    position: 3,
                    content: {
                        title: "Investment Terms",
                        content: "{termsAndConditions}"
                    }
                }
            ]
        },
        {
            id: "tab_3",
            title: "Installation Process",
            icon: "🔧",
            enabled: true,
            order: 2,
            blocks: [
                {
                    id: "block_7",
                    type: "hero",
                    position: 1,
                    content: {
                        title: "Professional Installation Process",
                        subtitle: "From consultation to comfort, we handle everything",
                        icon: "🔧"
                    }
                },
                {
                    id: "block_8",
                    type: "process_steps",
                    position: 2,
                    content: {
                        steps: [
                            {
                                stepNumber: 1,
                                title: "System Assessment",
                                time: "Day 1",
                                description: "Comprehensive evaluation of your current system and home energy requirements"
                            },
                            {
                                stepNumber: 2,
                                title: "Custom Design",
                                time: "Day 2-3",
                                description: "Engineering the perfect HVAC solution tailored to your home's unique needs"
                            },
                            {
                                stepNumber: 3,
                                title: "Professional Installation",
                                time: "Day 4-5",
                                description: "Expert installation by certified technicians with minimal disruption to your routine"
                            },
                            {
                                stepNumber: 4,
                                title: "System Testing & Training",
                                time: "Day 6",
                                description: "Complete system testing and homeowner training on optimal operation"
                            },
                            {
                                stepNumber: 5,
                                title: "Ongoing Support",
                                time: "Ongoing",
                                description: "Regular maintenance scheduling and 24/7 emergency service availability"
                            }
                        ]
                    }
                }
            ]
        },
        {
            id: "tab_4",
            title: "Equipment & Warranty",
            icon: "🛡️",
            enabled: true,
            order: 3,
            blocks: [
                {
                    id: "block_9",
                    type: "hero",
                    position: 1,
                    content: {
                        title: "Premium Equipment & Protection",
                        subtitle: "Industry-leading brands with comprehensive warranty coverage",
                        icon: "🛡️"
                    }
                },
                {
                    id: "block_10",
                    type: "warranty_cards",
                    position: 2,
                    content: {
                        cards: [
                            {
                                icon: "❄️",
                                title: "Equipment Warranty",
                                subtitle: "Manufacturer Coverage",
                                description: "Up to 10-year manufacturer warranty on all major components including compressors and heat exchangers"
                            },
                            {
                                icon: "🔧",
                                title: "Installation Warranty",
                                subtitle: "{warrantyYears}-Year Labor Guarantee",
                                description: "Complete installation workmanship warranty covering all labor and installation components"
                            },
                            {
                                icon: "🚨",
                                title: "24/7 Emergency Service",
                                subtitle: "Always Available",
                                description: "Priority emergency service for warranty customers with same-day response guarantee"
                            }
                        ]
                    }
                },
                {
                    id: "block_11",
                    type: "service_list",
                    position: 3,
                    content: {
                        title: "What's Included in Your {warrantyYears}-Year Protection Plan",
                        items: [
                            "✅ All major equipment components covered",
                            "✅ Installation workmanship guarantee",
                            "✅ Annual preventive maintenance visits",
                            "✅ Priority scheduling for service calls",
                            "✅ 24/7 emergency service hotline",
                            "✅ Refrigerant leak protection",
                            "✅ Thermostat and control system coverage",
                            "✅ Transferable warranty (increases home value)"
                        ]
                    }
                }
            ]
        },
        {
            id: "tab_5",
            title: "Project Specifications",
            icon: "📋",
            enabled: true,
            order: 4,
            blocks: [
                {
                    id: "block_12",
                    type: "hero",
                    position: 1,
                    content: {
                        title: "Technical Specifications",
                        subtitle: "Detailed scope of work and equipment specifications",
                        icon: "📋"
                    }
                },
                {
                    id: "block_13",
                    type: "scope_list",
                    position: 2,
                    content: {
                        title: "Scope of Work",
                        items: [
                            "🔹 Complete HVAC system design and installation",
                            "🔹 Ductwork modification and optimization",
                            "🔹 Electrical connections and safety shutoffs",
                            "🔹 Thermostat and control system setup",
                            "🔹 System commissioning and performance testing",
                            "🔹 Indoor air quality assessment and improvement"
                        ]
                    }
                },
                {
                    id: "block_14",
                    type: "specifications",
                    position: 3,
                    content: {
                        specs: [
                            {
                                title: "Equipment Specifications",
                                items: [
                                    "• High-efficiency condensing unit",
                                    "• Variable speed air handler",
                                    "• MERV 13 filtration system",
                                    "• Smart thermostat with WiFi"
                                ]
                            },
                            {
                                title: "Project Timeline",
                                items: [
                                    "• Assessment: 1 day",
                                    "• Installation: 2-3 days",
                                    "• Testing & commissioning: 1 day",
                                    "• Total project duration: 4-5 days"
                                ]
                            }
                        ]
                    }
                },
                {
                    id: "block_15",
                    type: "text_section",
                    position: 4,
                    content: {
                        title: "Permits & Code Compliance",
                        content: "All work will be performed in accordance with local building codes and manufacturer specifications. We handle all permit applications and coordinate required inspections to ensure your new HVAC system meets all safety and efficiency standards."
                    }
                }
            ]
        }
    ],
    createdAt: new Date("2025-05-27T20:30:00.000Z"),
    updatedAt: new Date("2025-05-27T20:30:00.000Z"),
    createdBy: "system",
    messaging: {
        quoteAcceptedMessage: {
            title: "Welcome to Comfort Excellence! ❄️",
            message: "Your HVAC investment proposal has been accepted - thank you for trusting us with your comfort!",
            subtitle: "We've sent a signature link to your email. Once signed, we'll schedule your professional assessment and begin creating your perfect climate solution.",
            buttonText: "Excellent Choice!",
            celebrationEmoji: "❄️",
            nextSteps: [
                "Sign the digital agreement via email",
                "Schedule your system assessment",
                "Receive your custom installation plan",
                "Enjoy year-round comfort soon!"
            ]
        }
    }
  },
  {
    _id: "template_professional_plumbing_001",
    isGlobal: true,
    name: "MDB - Professional Plumbing Proposal",
    description: "Clean, professional layout perfect for residential plumbing projects",
    category: "plumbing",
    preview: "🔧",
    isDefault: true,
    styling: {
        primaryColor: "#2E86AB",
        accentColor: "#A23B72",
        fontFamily: "system",
        layout: "standard"
    },
    companyOverrides: {
        name: null,
        logo: "🔧",
        tagline: "Your trusted plumbing experts since 1995",
        phone: null,
        email: null,
        address: null,
        establishedYear: "1995",
        warrantyYears: "5"
    },
    tabs: [
        {
            id: "tab_1",
            title: "Why Choose {companyName}",
            icon: "🏠",
            enabled: true,
            order: 1,
            blocks: [
                {
                    id: "block_1",
                    type: "hero",
                    position: 1,
                    content: {
                        title: "Why Choose {companyName}",
                        subtitle: "{companyTagline}",
                        icon: "{companyLogo}"
                    }
                },
                {
                    id: "block_2",
                    type: "benefit_cards",
                    position: 2,
                    content: {
                        cards: [
                            {
                                icon: "🏆",
                                title: "Expert Craftsmanship",
                                subtitle: "Professional Excellence",
                                description: "Professional plumbing solutions with over {experienceYears} years of experience in residential and commercial projects."
                            },
                            {
                                icon: "⚡",
                                title: "Fast & Reliable",
                                subtitle: "Quick Response",
                                description: "Quick response times and efficient installations that minimize disruption to your daily routine."
                            },
                            {
                                icon: "🛡️",
                                title: "{warrantyYears}-Year Warranty",
                                subtitle: "Complete Protection",
                                description: "Comprehensive warranty covering all materials and labor for complete peace of mind."
                            }
                        ]
                    }
                },
                {
                    id: "block_3",
                    type: "contact_info",
                    position: 3,
                    content: {
                        title: "Contact Information",
                        items: [
                            {
                                icon: "📞",
                                label: "Phone",
                                value: "{phone}"
                            },
                            {
                                icon: "✉️",
                                label: "Email",
                                value: "{email}"
                            },
                            {
                                icon: "📍",
                                label: "Address",
                                value: "{address}"
                            }
                        ]
                    }
                }
            ]
        },
        {
            id: "tab_2",
            title: "Your Quote Details",
            icon: "💰",
            enabled: true,
            order: 5,
            blocks: [
                {
                    id: "block_4",
                    type: "quote_header",
                    position: 1,
                    content: {
                        title: "Quote #{quoteNumber}",
                        subtitle: "{projectTitle}",
                        customerLabel: "Prepared for: {customerName}"
                    }
                },
                {
                    id: "block_5",
                    type: "quote_breakdown",
                    position: 2,
                    content: {
                        title: "Pricing Breakdown",
                        labels: {
                            subtotal: "Subtotal",
                            tax: "Tax",
                            total: "Total",
                            quantity: "Qty",
                            sectionTotal: "Section Total"
                        }
                    }
                },
                {
                    id: "block_6",
                    type: "terms_section",
                    position: 3,
                    content: {
                        title: "Terms & Conditions",
                        content: "{termsAndConditions}"
                    }
                }
            ]
        },
        {
            id: "tab_3",
            title: "Our Process",
            icon: "⚙️",
            enabled: true,
            order: 2,
            blocks: [
                {
                    id: "block_7",
                    type: "hero",
                    position: 1,
                    content: {
                        title: "The {companyName} Process",
                        subtitle: "From consultation to completion, we guide you through every step",
                        icon: "⚙️"
                    }
                },
                {
                    id: "block_8",
                    type: "process_steps",
                    position: 2,
                    content: {
                        steps: [
                            {
                                stepNumber: 1,
                                title: "Initial Consultation",
                                time: "1-2 days",
                                description: "Free in-home assessment and detailed quote preparation"
                            },
                            {
                                stepNumber: 2,
                                title: "Project Planning",
                                time: "3-5 days",
                                description: "Permit acquisition and material ordering"
                            },
                            {
                                stepNumber: 3,
                                title: "Installation Begins",
                                time: "1-3 days",
                                description: "Professional installation by certified technicians"
                            },
                            {
                                stepNumber: 4,
                                title: "Quality Inspection",
                                time: "1 day",
                                description: "Thorough testing and final walkthrough"
                            },
                            {
                                stepNumber: 5,
                                title: "Project Complete",
                                time: "Same day",
                                description: "Final cleanup and warranty activation"
                            }
                        ]
                    }
                }
            ]
        },
        {
            id: "tab_4",
            title: "Warranty & Service",
            icon: "🛡️",
            enabled: true,
            order: 3,
            blocks: [
                {
                    id: "block_9",
                    type: "hero",
                    position: 1,
                    content: {
                        title: "{warrantyYears}-Year Peace of Mind",
                        subtitle: "Comprehensive protection for your investment",
                        icon: "🛡️"
                    }
                },
                {
                    id: "block_10",
                    type: "warranty_cards",
                    position: 2,
                    content: {
                        cards: [
                            {
                                icon: "🔧",
                                title: "Materials Warranty",
                                subtitle: "Manufacturer & Installation",
                                description: "All fixtures and materials covered against defects and installation issues"
                            },
                            {
                                icon: "👨‍🔧",
                                title: "Labor Warranty",
                                subtitle: "Workmanship Guarantee",
                                description: "Professional installation work guaranteed for the full warranty period"
                            },
                            {
                                icon: "🚨",
                                title: "Emergency Service",
                                subtitle: "24/7 Support",
                                description: "Priority emergency service for warranty-covered issues"
                            }
                        ]
                    }
                },
                {
                    id: "block_11",
                    type: "service_list",
                    position: 3,
                    content: {
                        title: "What's Included in Your {warrantyYears}-Year Warranty",
                        items: [
                            "✅ All fixtures and fittings",
                            "✅ Installation workmanship",
                            "✅ Water damage protection",
                            "✅ Free annual inspections",
                            "✅ Priority scheduling for service calls",
                            "✅ Transferable warranty (if home is sold)"
                        ]
                    }
                }
            ]
        },
        {
            id: "tab_5",
            title: "Project Details",
            icon: "📋",
            enabled: true,
            order: 4,
            blocks: [
                {
                    id: "block_12",
                    type: "hero",
                    position: 1,
                    content: {
                        title: "Project Specifications",
                        subtitle: "Technical details and scope of work",
                        icon: "📋"
                    }
                },
                {
                    id: "block_13",
                    type: "scope_list",
                    position: 2,
                    content: {
                        title: "Scope of Work",
                        items: [
                            "🔹 Kitchen sink and faucet replacement",
                            "🔹 Master bathroom vanity installation",
                            "🔹 Shower system upgrade with modern fixtures",
                            "🔹 Water line routing and connections",
                            "🔹 Drain line installation and testing",
                            "🔹 Pressure testing and system certification"
                        ]
                    }
                },
                {
                    id: "block_14",
                    type: "specifications",
                    position: 3,
                    content: {
                        specs: [
                            {
                                title: "Materials Used",
                                items: [
                                    "• Premium PEX tubing",
                                    "• Brass fittings and valves",
                                    "• Code-compliant fixtures"
                                ]
                            },
                            {
                                title: "Timeline",
                                items: [
                                    "• Start: Within 1 week",
                                    "• Duration: 2-3 days",
                                    "• Completion: Full testing"
                                ]
                            }
                        ]
                    }
                },
                {
                    id: "block_15",
                    type: "text_section",
                    position: 4,
                    content: {
                        title: "Permits & Compliance",
                        content: "All work will be performed to local building codes and permit requirements. We handle all permit applications and inspections to ensure your project meets all safety and regulatory standards."
                    }
                }
            ]
        }
    ],
    createdAt: new Date("2025-05-26T00:00:00.000Z"),
    updatedAt: new Date("2025-05-26T00:00:00.000Z"),
    createdBy: "system",
    messaging: {
        quoteAcceptedMessage: {
            title: "Thank You for Choosing {companyName}! 🔧",
            message: "Your plumbing project quote has been successfully accepted.",
            subtitle: "A signature link has been sent to your email. Please check your inbox and complete the digital signature to get started!",
            buttonText: "Perfect, Let's Get Started!",
            celebrationEmoji: "🔧",
            nextSteps: [
                "Check your email for the signature link",
                "Complete the digital signature",
                "We'll contact you within 24 hours to schedule",
                "Professional installation begins soon!"
            ]
        }
    }
  }
];

// Pipelines are now included in the location object

async function seedDatabase() {
  let client;
  try {
    client = await connectToDatabase();
    const db = client.db(getDbName());
    
    console.log(`📊 Connected to database: ${getDbName()}`);
    
    // Clear existing data
    console.log('🧹 Clearing existing data...');
    const collections = ['users', 'locations', 'contacts', 'projects', 'quotes', 'templates'];
    for (const collection of collections) {
      await db.collection(collection).deleteMany({});
    }
    
    // Create admin user
    console.log('👤 Creating admin user...');
    const adminUser = await generateMockUser();
    await db.collection('users').insertOne(adminUser);
    
    // Create location
    console.log('🏢 Creating demo location...');
    const location = generateMockLocation(adminUser._id);
    await db.collection('locations').insertOne(location);
    
    // Update user with location (use string locationId, not ObjectId)
    await db.collection('users').updateOne(
      { _id: adminUser._id },
      { $set: { locationId: location.locationId } }
    );
    
    // Create contacts
    console.log('📇 Creating demo contacts...');
    const contacts = generateMockContacts(location.locationId);
    await db.collection('contacts').insertMany(contacts);
    
    // Create projects
    console.log('🏗️ Creating demo projects...');
    const projects = generateMockProjects(location.locationId, contacts);
    await db.collection('projects').insertMany(projects);
    
    // Create quotes
    console.log('💰 Creating demo quotes...');
    const quotes = generateMockQuotes(location.locationId, projects);
    await db.collection('quotes').insertMany(quotes);
    
    // Create templates
    console.log('📄 Creating demo templates...');
    const templates = generateMockTemplates(location.locationId);
    await db.collection('templates').insertMany(templates);
    
    // Pipelines are included in location object - no separate collection needed
    
    // Create indexes for better performance
    console.log('📚 Creating database indexes...');
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('locations').createIndex({ ghlLocationId: 1 });
    await db.collection('contacts').createIndex({ locationId: 1, email: 1 });
    await db.collection('projects').createIndex({ locationId: 1, contactId: 1 });
    await db.collection('quotes').createIndex({ locationId: 1, projectId: 1 });
    
    console.log('\n✅ Database seeded successfully!');
    console.log('\n📋 Login Credentials:');
    console.log('   Email: admin@example.com');
    console.log('   Password: password');
    console.log('\n📊 Seeded Data:');
    console.log(`   • 1 Admin User`);
    console.log(`   • 1 Demo Location`);
    console.log(`   • ${contacts.length} Demo Contacts`);
    console.log(`   • ${projects.length} Demo Projects`);
    console.log(`   • ${quotes.length} Demo Quotes`);
    console.log(`   • ${templates.length} Demo Templates`);
    console.log(`   • 1 Sales Pipeline (in location)`);
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
    process.exit(0);
  }
}

// Run the seeder
seedDatabase(); 