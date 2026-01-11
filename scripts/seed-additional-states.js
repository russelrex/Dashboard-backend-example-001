const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// MongoDB connection - use the same pattern as the working script
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

console.log('Using MongoDB URI:', MONGODB_URI.substring(0, 20) + '...');

async function seedAdditionalStates() {
  let client;
  
  try {
    console.log('🔄 Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    console.log('✅ Connected to MongoDB');
    console.log('🌱 Starting additional states template seeding...\n');
    
    const db = client.db('lpai');
    
    // Check existing templates
    const existingCount = await db.collection('labor_templates').countDocuments({ active: true });
    console.log(`Found ${existingCount} existing active templates`);
    
    // Define additional state templates
    const templates = [
      {
        name: "Idaho Labor Laws 2024",
        description: "Idaho state labor law requirements",
        jurisdiction: "US-ID",
        category: "state",
        effectiveDate: new Date("2024-01-01"),
        expiryDate: null,
        rules: {
          overtime: {
            weeklyThreshold: 40,
            dailyThreshold: null,
            multiplier: 1.5,
            doubleTimeThreshold: null,
            doubleTimeMultiplier: 2.0,
            calculateDaily: false
          },
          breaks: {
            paidBreaks: [],
            mealBreaks: [] // Idaho has no state-mandated break requirements
          },
          minimumWage: {
            standard: 7.25, // Federal minimum
            tipped: 3.35,
            youth: 4.25, // Under 20 for first 90 days
            effectiveDate: new Date("2009-07-24")
          },
          mileage: {
            reimbursementRate: 0.67,
            requiresReceipts: false,
            mandatory: false,
            categories: [
              { type: "business", rate: 0.67, taxable: false }
            ]
          },
          scheduling: {
            minimumShiftLength: 0,
            splitShiftPremium: 0,
            callInPay: 0,
            advanceNoticeRequired: 0
          },
          pto: {
            accrualRate: 0, // No state requirement
            maxAccrual: 0,
            carryOver: false,
            payoutOnTermination: false
          },
          sick: {
            accrualRate: 0, // No state requirement
            carryOver: false,
            payoutOnTermination: false
          },
          finalPay: {
            voluntary: "next regular payday or within 10 days",
            involuntary: "next regular payday or within 48 hours if requested",
            includesPTO: false,
            penalty: "none specified"
          }
        },
        tags: ["idaho", "state-law", "2024", "federal-minimum"],
        metadata: {
          source: "Idaho Department of Labor",
          lastReviewedDate: new Date(),
          references: [
            {
              title: "Idaho Labor Laws",
              url: "https://www.labor.idaho.gov/",
              section: "Title 44"
            }
          ]
        },
        isOfficial: true,
        active: true,
        version: 1
      },
      {
        name: "Colorado Labor Laws 2024",
        description: "Colorado state labor law requirements - progressive labor protections",
        jurisdiction: "US-CO",
        category: "state",
        effectiveDate: new Date("2024-01-01"),
        expiryDate: null,
        rules: {
          overtime: {
            weeklyThreshold: 40,
            dailyThreshold: 12,
            multiplier: 1.5,
            doubleTimeThreshold: null,
            doubleTimeMultiplier: 2.0,
            calculateDaily: true,
            agriculturalExemption: true
          },
          breaks: {
            paidBreaks: [
              {
                afterHours: 2,
                duration: 10,
                isPaid: true,
                mandatory: true,
                perHours: 4 // One 10-min break per 4 hours
              }
            ],
            mealBreaks: [
              {
                afterHours: 5,
                duration: 30,
                isPaid: false,
                mandatory: true,
                uninterrupted: true,
                onPremiseAllowed: false
              }
            ]
          },
          minimumWage: {
            standard: 14.42, // 2024 rate
            tipped: 11.40, // Must still reach $14.42 with tips
            localMinimums: {
              denver: 18.29
            },
            effectiveDate: new Date("2024-01-01")
          },
          mileage: {
            reimbursementRate: 0.67,
            requiresReceipts: false,
            mandatory: true, // Colorado requires reimbursement
            categories: [
              { type: "business", rate: 0.67, taxable: false }
            ]
          },
          scheduling: {
            minimumShiftLength: 0,
            splitShiftPremium: 0,
            callInPay: 0,
            advanceNoticeRequired: 0,
            predictiveScheduling: false
          },
          pto: {
            accrualRate: 0.0333, // 1 hour per 30 worked (paid sick leave)
            maxAccrual: 48,
            carryOver: true,
            payoutOnTermination: false,
            waitingPeriod: 0
          },
          sick: {
            accrualRate: 0.0333, // Colorado Healthy Families and Workplaces Act
            maxAccrual: 48,
            maxUsagePerYear: 48,
            carryOver: true,
            payoutOnTermination: false,
            reasons: ["illness", "injury", "domestic violence", "public health emergency"]
          },
          finalPay: {
            voluntary: "next regular payday",
            involuntary: "immediately or within 6 hours if accounting office closed",
            includesPTO: true,
            penalty: "up to 10 days wages or actual damages"
          }
        },
        tags: ["colorado", "state-law", "2024", "employee-protective", "paid-sick-leave"],
        metadata: {
          source: "Colorado Department of Labor and Employment",
          lastReviewedDate: new Date(),
          references: [
            {
              title: "Colorado Overtime and Minimum Pay Standards Order (COMPS)",
              url: "https://cdle.colorado.gov/wage-and-hour-law/comps",
              section: "7 CCR 1103-1"
            }
          ]
        },
        isOfficial: true,
        active: true,
        version: 1
      },
      {
        name: "Oklahoma Labor Laws 2024",
        description: "Oklahoma state labor law requirements",
        jurisdiction: "US-OK",
        category: "state",
        effectiveDate: new Date("2024-01-01"),
        expiryDate: null,
        rules: {
          overtime: {
            weeklyThreshold: 40,
            dailyThreshold: null,
            multiplier: 1.5,
            doubleTimeThreshold: null,
            doubleTimeMultiplier: 2.0,
            calculateDaily: false
          },
          breaks: {
            paidBreaks: [],
            mealBreaks: [
              {
                afterHours: 0, // Required for minors under 16
                duration: 30,
                isPaid: false,
                mandatory: true,
                forMinorsOnly: true,
                perHours: 5 // One per 5 continuous hours
              }
            ]
          },
          minimumWage: {
            standard: 7.25, // Federal minimum (OK has state min of $2.00 for small employers)
            tipped: 2.13,
            smallEmployer: 2.00, // Employers with < 10 FT employees or < $100k gross sales
            effectiveDate: new Date("2009-07-24")
          },
          mileage: {
            reimbursementRate: 0.67,
            requiresReceipts: false,
            mandatory: false,
            categories: [
              { type: "business", rate: 0.67, taxable: false }
            ]
          },
          scheduling: {
            minimumShiftLength: 0,
            splitShiftPremium: 0,
            callInPay: 0,
            advanceNoticeRequired: 0
          },
          pto: {
            accrualRate: 0, // No state requirement
            maxAccrual: 0,
            carryOver: false,
            payoutOnTermination: false
          },
          sick: {
            accrualRate: 0, // No state requirement
            carryOver: false,
            payoutOnTermination: false
          },
          finalPay: {
            voluntary: "next regular payday",
            involuntary: "next regular payday",
            includesPTO: false,
            penalty: "2% of unpaid wages per day up to amount owed"
          }
        },
        tags: ["oklahoma", "state-law", "2024", "minimal-requirements"],
        metadata: {
          source: "Oklahoma Department of Labor",
          lastReviewedDate: new Date(),
          references: [
            {
              title: "Oklahoma Labor Laws",
              url: "https://oklahoma.gov/odol.html",
              section: "Title 40"
            }
          ]
        },
        isOfficial: true,
        active: true,
        version: 1
      },
      {
        name: "Texas Labor Laws 2024 (Enhanced)",
        description: "Texas state labor law requirements with additional details",
        jurisdiction: "US-TX",
        category: "state",
        effectiveDate: new Date("2024-01-01"),
        expiryDate: null,
        rules: {
          overtime: {
            weeklyThreshold: 40,
            dailyThreshold: null,
            multiplier: 1.5,
            doubleTimeThreshold: null,
            doubleTimeMultiplier: 2.0,
            calculateDaily: false,
            exemptions: ["executive", "administrative", "professional", "outside sales", "computer"]
          },
          breaks: {
            paidBreaks: [],
            mealBreaks: [] // No state requirement, follows federal
          },
          minimumWage: {
            standard: 7.25,
            tipped: 2.13,
            student: 6.16, // 85% for full-time students
            effectiveDate: new Date("2009-07-24")
          },
          mileage: {
            reimbursementRate: 0.67,
            requiresReceipts: false,
            mandatory: false, // Not required by state law
            categories: [
              { type: "business", rate: 0.67, taxable: false }
            ]
          },
          scheduling: {
            minimumShiftLength: 0,
            splitShiftPremium: 0,
            callInPay: 0,
            advanceNoticeRequired: 0,
            rightToRest: 0 // No mandatory time between shifts
          },
          pto: {
            accrualRate: 0, // No state requirement
            maxAccrual: 0,
            carryOver: false,
            payoutOnTermination: false // Depends on company policy
          },
          sick: {
            accrualRate: 0, // No state requirement
            carryOver: false,
            payoutOnTermination: false,
            familyLeave: false // No state family leave law
          },
          finalPay: {
            voluntary: "within 6 days",
            involuntary: "within 6 days",
            includesPTO: false, // Based on company policy
            penalty: "entitled to wages until paid, up to 60 days"
          },
          payroll: {
            frequency: "at least monthly",
            method: ["cash", "check", "direct deposit"],
            statementRequired: true,
            deductionsAllowed: ["taxes", "court ordered", "written authorization"]
          }
        },
        tags: ["texas", "state-law", "2024", "federal-minimum", "employer-friendly"],
        metadata: {
          source: "Texas Workforce Commission",
          lastReviewedDate: new Date(),
          references: [
            {
              title: "Texas Payday Law",
              url: "https://www.twc.texas.gov/jobseekers/texas-payday-law",
              section: "Chapter 61"
            },
            {
              title: "Texas Minimum Wage Act",
              url: "https://www.twc.texas.gov/jobseekers/texas-minimum-wage-law",
              section: "Chapter 62"
            }
          ]
        },
        isOfficial: true,
        active: true,
        version: 2
      }
    ];
    
    // Process templates
    console.log(`\n📝 Processing ${templates.length} additional state templates...`);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    
    for (const template of templates) {
      try {
        const existing = await db.collection('labor_templates').findOne({
          jurisdiction: template.jurisdiction,
          active: true
        });
        
        if (existing && !process.argv.includes('--force')) {
          console.log(`⏭️  Skipping ${template.name} - already exists`);
          skipped++;
          continue;
        }
        
        if (existing && process.argv.includes('--force')) {
          // Deactivate existing
          await db.collection('labor_templates').updateOne(
            { _id: existing._id },
            { 
              $set: { 
                active: false,
                deactivatedAt: new Date(),
                deactivatedBy: 'system-seeder'
              } 
            }
          );
          console.log(`🔄 Deactivated old version of ${template.name}`);
        }
        
        // Insert new template
        const result = await db.collection('labor_templates').insertOne({
          ...template,
          _id: new ObjectId(),
          createdBy: 'system-seeder',
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        if (existing) {
          console.log(`✅ Updated template: ${template.name}`);
          updated++;
        } else {
          console.log(`✅ Created template: ${template.name}`);
          created++;
        }
        
      } catch (error) {
        console.error(`❌ Error processing ${template.name}:`, error.message);
      }
    }
    
    // Summary report
    console.log('\n📊 Seeding Summary:');
    console.log(`  - Created: ${created} templates`);
    console.log(`  - Updated: ${updated} templates`);
    console.log(`  - Skipped: ${skipped} templates`);
    
    const totalActive = await db.collection('labor_templates').countDocuments({ active: true });
    console.log(`  - Total active templates: ${totalActive}`);
    
    // Show all state templates
    console.log('\n📋 All state templates in database:');
    const stateTemplates = await db.collection('labor_templates')
      .find({ active: true, category: 'state' })
      .sort({ jurisdiction: 1 })
      .project({ name: 1, jurisdiction: 1, 'rules.minimumWage.standard': 1 })
      .toArray();
    
    stateTemplates.forEach(s => {
      const minWage = s.rules?.minimumWage?.standard || 'N/A';
      console.log(`  - ${s.jurisdiction}: ${s.name} (Min wage: $${minWage})`);
    });
    
    console.log('\n🎉 Additional state templates seeding completed!');
    
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\n👋 MongoDB connection closed');
    }
  }
}

// Run the seeder
console.log('🚀 LPai Additional States Labor Templates Seeder');
console.log('===============================================\n');

seedAdditionalStates()
  .then(() => {
    console.log('\n✅ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });