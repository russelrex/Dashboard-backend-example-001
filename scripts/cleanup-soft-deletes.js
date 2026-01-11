// scripts/cleanup-soft-deletes.js
// Run this to handle existing soft-deleted records

const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// MongoDB connection - use the same pattern as the working script
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

console.log('Using MongoDB URI:', MONGODB_URI.substring(0, 20) + '...');

async function cleanupSoftDeletes() {
 let client;
 
 try {
   console.log('🔄 Connecting to MongoDB...');
   client = new MongoClient(MONGODB_URI);
   await client.connect();
   
   console.log('✅ Connected to MongoDB');
   console.log('🧹 Starting soft delete cleanup...\n');
   
   const db = client.db('lpai');
   
   // Find all soft-deleted contacts
   const deletedContacts = await db.collection('contacts').find({
     deletedAt: { $exists: true }
   }).toArray();
   
   console.log(`Found ${deletedContacts.length} soft-deleted contacts\n`);
   
   // Group by location for auth efficiency
   const contactsByLocation = {};
   deletedContacts.forEach(contact => {
     if (!contactsByLocation[contact.locationId]) {
       contactsByLocation[contact.locationId] = [];
     }
     contactsByLocation[contact.locationId].push(contact);
   });
   
   // Process each location
   for (const [locationId, contacts] of Object.entries(contactsByLocation)) {
     console.log(`\n📍 Processing location ${locationId} (${contacts.length} contacts)`);
     
     // Get auth for this location
     const location = await db.collection('locations').findOne({ locationId });
     if (!location?.ghlOAuth?.accessToken) {
       console.log('⚠️  No GHL auth found for location, skipping GHL deletion');
       continue;
     }
     
     // Process each contact
     for (const contact of contacts) {
       console.log(`\n👤 Processing ${contact.firstName} ${contact.lastName} (${contact._id})`);
       
       // Calculate days since deletion
       const deletedAt = new Date(contact.deletedAt);
       const daysSinceDeleted = Math.floor((Date.now() - deletedAt.getTime()) / (1000 * 60 * 60 * 24));
       console.log(`   Deleted ${daysSinceDeleted} days ago`);
       
       // 1. Delete from GHL if still exists
       if (contact.ghlContactId) {
         try {
           await axios.delete(
             `https://services.leadconnectorhq.com/contacts/${contact.ghlContactId}`,
             {
               headers: {
                 Authorization: `Bearer ${location.ghlOAuth.accessToken}`,
                 Version: '2021-07-28',
               }
             }
           );
           console.log(`   ✅ Deleted from GHL`);
         } catch (error) {
           if (error.response?.status === 404) {
             console.log(`   ℹ️  Already deleted from GHL`);
           } else {
             console.log(`   ❌ GHL delete failed:`, error.response?.data?.message || error.message);
           }
         }
       }
       
       // 2. Check if ready for permanent deletion (>30 days)
       if (daysSinceDeleted >= 30) {
         // Permanently delete from MongoDB
         await db.collection('contacts').deleteOne({ _id: contact._id });
         console.log(`   🗑️  PERMANENTLY DELETED from database`);
         
         // Also delete related data
         await db.collection('projects').deleteMany({ contactId: contact._id.toString() });
         await db.collection('quotes').deleteMany({ contactId: contact._id.toString() });
         await db.collection('notes').deleteMany({ contactId: contact._id.toString() });
         await db.collection('appointments').deleteMany({ contactId: contact._id.toString() });
         console.log(`   🗑️  Deleted all related data`);
       } else {
         console.log(`   ⏳ Keeping in database (${30 - daysSinceDeleted} days until permanent deletion)`);
       }
     }
   }
   
   // Also process soft-deleted projects
   console.log('\n\n📁 Processing soft-deleted projects...');
   const deletedProjects = await db.collection('projects').find({
     deletedAt: { $exists: true }
   }).toArray();
   
   console.log(`Found ${deletedProjects.length} soft-deleted projects`);
   
   // Process each project
   for (const project of deletedProjects) {
     const deletedAt = new Date(project.deletedAt);
     const daysSinceDeleted = Math.floor((Date.now() - deletedAt.getTime()) / (1000 * 60 * 60 * 24));
     
     console.log(`\n📁 Processing project: ${project.title} (${project._id})`);
     console.log(`   Deleted ${daysSinceDeleted} days ago`);
     
     // Delete from GHL if it has an opportunity ID
     if (project.ghlOpportunityId && project.locationId) {
       const location = await db.collection('locations').findOne({ locationId: project.locationId });
       if (location?.ghlOAuth?.accessToken) {
         try {
           await axios.delete(
             `https://services.leadconnectorhq.com/opportunities/${project.ghlOpportunityId}`,
             {
               headers: {
                 Authorization: `Bearer ${location.ghlOAuth.accessToken}`,
                 Version: '2021-07-28',
               }
             }
           );
           console.log(`   ✅ Deleted opportunity from GHL`);
         } catch (error) {
           if (error.response?.status === 404) {
             console.log(`   ℹ️  Already deleted from GHL`);
           } else {
             console.log(`   ❌ GHL delete failed:`, error.response?.data?.message || error.message);
           }
         }
       }
     }
     
     // Permanently delete if >30 days
     if (daysSinceDeleted >= 30) {
       await db.collection('projects').deleteOne({ _id: project._id });
       console.log(`   🗑️  PERMANENTLY DELETED from database`);
     } else {
       console.log(`   ⏳ Keeping in database (${30 - daysSinceDeleted} days until permanent deletion)`);
     }
   }
   
   console.log('\n\n✅ Cleanup complete!');
   
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
console.log('🚀 LPai Soft Delete Cleanup Script');
console.log('==================================\n');

cleanupSoftDeletes()
 .then(() => {
   console.log('\n✅ All done!');
   process.exit(0);
 })
 .catch(error => {
   console.error('\n❌ Fatal error:', error);
   process.exit(1);
 });