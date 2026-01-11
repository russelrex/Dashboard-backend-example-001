const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// MongoDB connection - use the same pattern as the working script
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

console.log('Using MongoDB URI:', MONGODB_URI.substring(0, 20) + '...');

async function seedLaborTemplates() {
  let client;
  
  try {
    console.log('🔄 Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    console.log('✅ Connected to MongoDB');
    console.log('🌱 Starting labor template seeding...\n');
    
    const db = client.db('lpai');
    
    // Check if templates already exist
    const existingCount = await db.collection('labor_templates').countDocuments({ active: true });
    console.log(`Found ${existingCount} existing active templates`);
    
    if (existingCount > 0 && !process.argv.includes('--force')) {
      console.log('\n⚠️  Templates already exist. Use --force to override.');
      console.log('   Example: node scripts/seed-labor-templates.js --force');
      return;
    }
    
    // Create indexes
    console.log('\n🔧 Creating indexes...');
    try {
      await db.collection('labor_templates').createIndex({ jurisdiction: 1, name: 1 });
      await db.collection('labor_templates').createIndex({ category: 1, active: 1 });
      await db.collection('labor_templates').createIndex({ tags: 1 });
      await db.collection('labor_templates').createIndex({ effectiveDate: -1 });
      console.log('✅ Indexes created successfully');
    } catch (e) {
      console.log('ℹ️  Some indexes already exist');
    }
    
    // Define templates
    const templates = [
      {
        name: "Federal Labor Standards",
        description: "U.S. Federal labor law baseline requirements under FLSA",
        jurisdiction: "US-Federal",
        category: "federal",
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
            mealBreaks: []
          },
          minimumWage: {
            standard: 7.25,
            tipped: 2.13,
            youth: 4.25,
            training: 7.25,
            effectiveDate: new Date("2009-07-24")
          },
          mileage: {
            reimbursementRate: 0.67,
            requiresReceipts: false,
            categories: [
              { type: "business", rate: 0.67, taxable: false },
              { type: "medical", rate: 0.21, taxable: false },
              { type: "moving", rate: 0.21, taxable: false },
              { type: "charitable", rate: 0.14, taxable: false }
            ]
          },
          scheduling: {
            minimumShiftLength: 0,
            splitShiftPremium: 0,
            callInPay: 0,
            advanceNoticeRequired: 0
          },
          pto: {
            accrualRate: 0,
            maxAccrual: 0,
            carryOver: false,
            payoutOnTermination: false
          },
          finalPay: {
            timeframe: "next regular payday",
            includesPTO: false
          }
        },
        tags: ["federal", "flsa", "baseline", "2024"],
        metadata: {
          source: "U.S. Department of Labor",
          lastReviewedDate: new Date(),
          references: [
            {
              title: "Fair Labor Standards Act",
              url: "https://www.dol.gov/agencies/whd/flsa",
              section: "29 USC Chapter 8"
            }
          ]
        },
        isOfficial: true,
        active: true,
        version: 1
      },
      {
        name: "California Labor Laws 2024",
        description: "California state labor law requirements - one of the most employee-protective states",
        jurisdiction: "US-CA",
        category: "state",
        effectiveDate: new Date("2024-01-01"),
        expiryDate: null,
        rules: {
          overtime: {
            weeklyThreshold: 40,
            dailyThreshold: 8,
            multiplier: 1.5,
            doubleTimeThreshold: 12,
            doubleTimeMultiplier: 2.0,
            calculateDaily: true,
            seventhDayRule: true,
            alternativeWorkweek: {
              allowed: true,
              maxHoursBeforeOT: 10,
              requiresElection: true
            }
          },
          breaks: {
            paidBreaks: [
              {
                afterHours: 3.5,
                duration: 10,
                isPaid: true,
                mandatory: true,
                penalty: 1
              },
              {
                afterHours: 6,
                duration: 10,
                isPaid: true,
                mandatory: true,
                penalty: 1
              },
              {
                afterHours: 10,
                duration: 10,
                isPaid: true,
                mandatory: true,
                penalty: 1
              }
            ],
            mealBreaks: [
              {
                afterHours: 5,
                duration: 30,
                isPaid: false,
                mandatory: true,
                penalty: 1,
                canBeWaived: true,
                waiverConditions: "If workday is 6 hours or less and employee agrees"
              },
              {
                afterHours: 10,
                duration: 30,
                isPaid: false,
                mandatory: true,
                penalty: 1,
                canBeWaived: true,
                waiverConditions: "If workday is 12 hours or less and first meal was not waived"
              }
            ]
          },
          minimumWage: {
            standard: 16.00,
            tipped: 16.00,
            learners: 15.20,
            effectiveDate: new Date("2024-01-01")
          },
          mileage: {
            reimbursementRate: 0.67,
            requiresReceipts: false,
            mandatory: true,
            categories: [
              { type: "business", rate: 0.67, taxable: false }
            ]
          },
          scheduling: {
            minimumShiftLength: 2,
            splitShiftPremium: 16.00,
            callInPay: 2,
            reportingTimePay: 2,
            advanceNoticeRequired: 0
          },
          pto: {
            accrualRate: 0.0333,
            maxAccrual: 48,
            carryOver: true,
            payoutOnTermination: true,
            waitingPeriod: 90
          },
          sick: {
            accrualRate: 0.0333,
            maxAccrual: 48,
            maxUsagePerYear: 24,
            carryOver: true,
            payoutOnTermination: false
          },
          finalPay: {
            voluntary: "within 72 hours",
            involuntary: "immediately",
            includesPTO: true,
            penalty: "daily wages for each day late"
          }
        },
        tags: ["california", "state-law", "2024", "employee-protective"],
        metadata: {
          source: "California DIR",
          lastReviewedDate: new Date(),
          references: [
            {
              title: "California Labor Code",
              url: "https://www.dir.ca.gov/dlse/",
              section: "Multiple sections"
            }
          ]
        },
        isOfficial: true,
        active: true,
        version: 1
      },
      {
        name: "New York Labor Laws 2024",
        description: "New York state labor law requirements",
        jurisdiction: "US-NY",
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
            spreadOfHours: 10,
            residentialEmployees: {
              threshold: 44,
              livein: true
            }
          },
          breaks: {
            paidBreaks: [],
            mealBreaks: [
              {
                afterHours: 6,
                duration: 30,
                isPaid: false,
                mandatory: true,
                timing: "between 11am and 2pm for shifts starting before 11am"
              }
            ]
          },
          minimumWage: {
            standard: 15.00,
            upstate: 14.20,
            tipped: {
              food_service: 10.00,
              service: 12.50
            },
            effectiveDate: new Date("2024-01-01")
          },
          mileage: {
            reimbursementRate: 0.67,
            requiresReceipts: false,
            categories: [
              { type: "business", rate: 0.67, taxable: false }
            ]
          },
          scheduling: {
            minimumShiftLength: 4,
            splitShiftPremium: 0,
            callInPay: 4,
            advanceNoticeRequired: 0
          },
          pto: {
            accrualRate: 0.0192,
            maxAccrual: 40,
            carryOver: true,
            payoutOnTermination: false
          },
          finalPay: {
            timeframe: "next regular payday",
            includesPTO: false
          }
        },
        tags: ["new-york", "state-law", "2024"],
        metadata: {
          source: "New York Department of Labor",
          lastReviewedDate: new Date(),
          references: [
            {
              title: "New York Labor Law",
              url: "https://dol.ny.gov/",
              section: "Article 19"
            }
          ]
        },
        isOfficial: true,
        active: true,
        version: 1
      },
      {
        name: "Texas Labor Laws 2024",
        description: "Texas state labor law requirements - follows federal minimums",
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
            calculateDaily: false
          },
          breaks: {
            paidBreaks: [],
            mealBreaks: []
          },
          minimumWage: {
            standard: 7.25,
            tipped: 2.13,
            effectiveDate: new Date("2009-07-24")
          },
          mileage: {
            reimbursementRate: 0.67,
            requiresReceipts: false,
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
            accrualRate: 0,
            maxAccrual: 0,
            carryOver: false,
            payoutOnTermination: false
          },
          finalPay: {
            voluntary: "within 6 days",
            involuntary: "within 6 days",
            includesPTO: false
          }
        },
        tags: ["texas", "state-law", "2024", "federal-minimum"],
        metadata: {
          source: "Texas Workforce Commission",
          lastReviewedDate: new Date(),
          references: [
            {
              title: "Texas Payday Law",
              url: "https://www.twc.texas.gov/jobseekers/texas-payday-law",
              section: "Chapter 61"
            }
          ]
        },
        isOfficial: true,
        active: true,
        version: 1
      },
      {
        name: "Florida Labor Laws 2024",
        description: "Florida state labor law requirements",
        jurisdiction: "US-FL",
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
            mealBreaks: []
          },
          minimumWage: {
            standard: 12.00,
            tipped: 8.98,
            effectiveDate: new Date("2023-09-30")
          },
          mileage: {
            reimbursementRate: 0.67,
            requiresReceipts: false,
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
            accrualRate: 0,
            maxAccrual: 0,
            carryOver: false,
            payoutOnTermination: false
          },
          finalPay: {
            timeframe: "next regular payday",
            includesPTO: false
          }
        },
        tags: ["florida", "state-law", "2024"],
        metadata: {
          source: "Florida Department of Economic Opportunity",
          lastReviewedDate: new Date(),
          references: [
            {
              title: "Florida Minimum Wage",
              url: "https://floridajobs.org/",
              section: "Article X, Section 24"
            }
          ]
        },
        isOfficial: true,
        active: true,
        version: 1
      }
    ];
    
    // Process templates
    console.log(`\n📝 Processing ${templates.length} templates...`);
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
    
    // Show sample templates
    console.log('\n📋 Sample templates in database:');
    const samples = await db.collection('labor_templates')
      .find({ active: true })
      .limit(5)
      .project({ name: 1, jurisdiction: 1, category: 1 })
      .toArray();
    
    samples.forEach(s => {
      console.log(`  - ${s.name} (${s.jurisdiction}) [${s.category}]`);
    });
    
    console.log('\n🎉 Labor template seeding completed successfully!');
    
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
console.log('🚀 LPai Labor Templates Seeder Script');
console.log('=====================================\n');

seedLaborTemplates()
  .then(() => {
    console.log('\n✅ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });