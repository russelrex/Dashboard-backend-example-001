const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// MongoDB connection - use the same pattern as the working script
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

console.log('Using MongoDB URI:', MONGODB_URI.substring(0, 20) + '...');

async function cleanupOrphanedData() {
  let client;
  
  try {
    console.log('🔄 Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    console.log('✅ Connected to MongoDB');
    console.log('🧹 Starting data cleanup...\n');
    
    const db = client.db('lpai');
    
    // 1. Find all deleted contacts
    const deletedContacts = await db.collection('contacts')
      .find({ deletedAt: { $exists: true } })
      .project({ _id: 1 })
      .toArray();
    
    const deletedContactIds = deletedContacts.map(c => c._id.toString());
    console.log(`Found ${deletedContactIds.length} deleted contacts`);
    
    // 2. Find all active contacts for validation
    const activeContacts = await db.collection('contacts')
      .find({ deletedAt: { $exists: false } })
      .project({ _id: 1 })
      .toArray();
    
    const activeContactIds = new Set(activeContacts.map(c => c._id.toString()));
    console.log(`Found ${activeContactIds.size} active contacts\n`);
    
    // 3. Clean up projects with deleted or non-existent contacts
    console.log('📁 Checking projects...');
    const projectsResult = await db.collection('projects').updateMany(
      {
        contactId: { $exists: true, $ne: null },
        status: { $ne: 'deleted' },
        $or: [
          { contactId: { $in: deletedContactIds } },
          { contactDeleted: { $exists: false } }
        ]
      },
      [
        {
          $set: {
            contactDeleted: {
              $cond: {
                if: { $in: ['$contactId', deletedContactIds] },
                then: true,
                else: {
                  $not: { $in: ['$contactId', Array.from(activeContactIds)] }
                }
              }
            },
            contactDeletedAt: {
              $cond: {
                if: { $or: [
                  { $in: ['$contactId', deletedContactIds] },
                  { $not: { $in: ['$contactId', Array.from(activeContactIds)] } }
                ]},
                then: new Date(),
                else: '$contactDeletedAt'
              }
            },
            updatedAt: new Date()
          }
        }
      ]
    );
    console.log(`✅ Updated ${projectsResult.modifiedCount} projects with orphaned contacts`);
    
    // 4. Clean up quotes with deleted or non-existent contacts
    console.log('\n💰 Checking quotes...');
    const quotesResult = await db.collection('quotes').updateMany(
      {
        contactId: { $exists: true, $ne: null },
        status: { $ne: 'deleted' },
        $or: [
          { contactId: { $in: deletedContactIds } },
          { contactDeleted: { $exists: false } }
        ]
      },
      [
        {
          $set: {
            contactDeleted: {
              $cond: {
                if: { $in: ['$contactId', deletedContactIds] },
                then: true,
                else: {
                  $not: { $in: ['$contactId', Array.from(activeContactIds)] }
                }
              }
            },
            contactDeletedAt: {
              $cond: {
                if: { $or: [
                  { $in: ['$contactId', deletedContactIds] },
                  { $not: { $in: ['$contactId', Array.from(activeContactIds)] } }
                ]},
                then: new Date(),
                else: '$contactDeletedAt'
              }
            },
            updatedAt: new Date()
          }
        }
      ]
    );
    console.log(`✅ Updated ${quotesResult.modifiedCount} quotes with orphaned contacts`);
    
    // 5. Report on data that needs attention
    console.log('\n📊 Data Health Report:');
    
    const orphanedProjects = await db.collection('projects').countDocuments({
      contactDeleted: true,
      status: { $ne: 'deleted' }
    });
    
    const orphanedQuotes = await db.collection('quotes').countDocuments({
      contactDeleted: true,
      status: { $ne: 'deleted' }
    });
    
    console.log(`- ${orphanedProjects} active projects with deleted contacts`);
    console.log(`- ${orphanedQuotes} active quotes with deleted contacts`);
    
    // 6. Create indexes for better query performance
    console.log('\n🔧 Creating indexes for better performance...');
    
    try {
      await db.collection('projects').createIndex({ contactId: 1, status: 1 });
      await db.collection('projects').createIndex({ contactDeleted: 1 });
      console.log('✅ Created index on projects.contactId and projects.status');
      console.log('✅ Created index on projects.contactDeleted');
    } catch (e) {
      console.log('ℹ️  Project indexes already exist');
    }
    
    try {
      await db.collection('quotes').createIndex({ contactId: 1, status: 1 });
      await db.collection('quotes').createIndex({ contactDeleted: 1 });
      console.log('✅ Created index on quotes.contactId and quotes.status');
      console.log('✅ Created index on quotes.contactDeleted');
    } catch (e) {
      console.log('ℹ️  Quote indexes already exist');
    }
    
    // 7. Show specific examples of orphaned data
    console.log('\n📋 Sample orphaned records:');
    
    const sampleOrphanedProjects = await db.collection('projects')
      .find({ contactDeleted: true, status: { $ne: 'deleted' } })
      .limit(3)
      .project({ _id: 1, title: 1, contactId: 1, status: 1 })
      .toArray();
    
    if (sampleOrphanedProjects.length > 0) {
      console.log('\nOrphaned Projects:');
      sampleOrphanedProjects.forEach(p => {
        console.log(`  - ${p.title || 'Untitled'} (ID: ${p._id}, Contact: ${p.contactId})`);
      });
    }
    
    const sampleOrphanedQuotes = await db.collection('quotes')
      .find({ contactDeleted: true, status: { $ne: 'deleted' } })
      .limit(3)
      .project({ _id: 1, title: 1, contactId: 1, status: 1 })
      .toArray();
    
    if (sampleOrphanedQuotes.length > 0) {
      console.log('\nOrphaned Quotes:');
      sampleOrphanedQuotes.forEach(q => {
        console.log(`  - ${q.title || 'Untitled'} (ID: ${q._id}, Contact: ${q.contactId})`);
      });
    }
    
    console.log('\n🎉 Cleanup completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\n👋 MongoDB connection closed');
    }
  }
}

// Run the cleanup
console.log('🚀 LPai Orphaned Data Cleanup Script');
console.log('====================================\n');

cleanupOrphanedData()
  .then(() => {
    console.log('\n✅ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });