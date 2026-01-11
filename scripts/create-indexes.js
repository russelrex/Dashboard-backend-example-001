const { MongoClient } = require('mongodb');

// MongoDB connection string - update this with your actual connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/lpai';

async function createIndexes() {
  let client;
  
  try {
    console.log('Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    console.log('Connected to MongoDB successfully');
    
    const db = client.db();
    const collection = db.collection('local_pipelines');
    
    console.log('Creating indexes for local_pipelines collection...');
    
    // Create index on locationId
    console.log('Creating index: { locationId: 1 }');
    await collection.createIndex({ locationId: 1 });
    console.log('✓ Index created: { locationId: 1 }');
    
    // Create compound index on locationId and isActive
    console.log('Creating index: { locationId: 1, isActive: 1 }');
    await collection.createIndex({ locationId: 1, isActive: 1 });
    console.log('✓ Index created: { locationId: 1, isActive: 1 }');
    
    // List all indexes to verify
    console.log('\nVerifying indexes...');
    const indexes = await collection.indexes();
    console.log('Current indexes on local_pipelines collection:');
    indexes.forEach((index, i) => {
      console.log(`${i + 1}. ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    console.log('\n✅ All indexes created successfully!');
    
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Run the script
createIndexes()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  }); 