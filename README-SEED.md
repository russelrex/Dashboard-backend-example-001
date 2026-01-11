# Database Seeding Guide

This guide explains how to use the database seeding functionality for local development.

## Quick Start

```bash
yarn seed:local
```

## What it does

The `yarn seed:local` command will:

1. **Connect** to your local MongoDB instance (`mongodb://localhost:27017/local`)
2. **Clear** all existing data in the local database
3. **Create** essential collections with mock data that **match your documented schema**:
   - `users` - Admin user for authentication (with `hashedPassword`)
   - `locations` - Demo company/location (with embedded pipelines)
   - `contacts` - Sample customer contacts
   - `projects` - Demo projects with proper status and pipeline stages
   - `quotes` - Sample quotes and estimates
   - `templates` - Default document templates
4. **Setup** database indexes for optimal performance

## Schema-Compliant Data

The seed data now follows your documented database schema from `docs/DATABASE_SCHEMA.md`:

### User Collection
- ✅ `hashedPassword` (not `password`)
- ✅ Proper `permissions` array
- ✅ `preferences` object with user settings

### Location Collection  
- ✅ `locationId` (GHL location ID)
- ✅ `branding` object with company details
- ✅ `pipelines` array embedded in location
- ✅ `features` object with feature flags
- ✅ `subscription` details

### Projects Collection
- ✅ Proper status values (`open`, `won`)
- ✅ `pipelineId` and `pipelineStageId`
- ✅ `scopeOfWork` and `monetaryValue`
- ✅ `milestones`, `timeline` arrays
- ✅ `customFields` object

### Contacts Collection
- ✅ Single `address` string (not object)
- ✅ `notes` field for additional info
- ✅ Proper field ordering per schema

## Login Credentials

After seeding, you can log in with:

- **Email**: `admin@example.com`
- **Password**: `password` (stored as `hashedPassword` with bcrypt)

## Environment Requirements

The seed command automatically:
- Sets `NODE_ENV=development` to use local database
- Uses `LOCAL_MONGODB_URI=mongodb://localhost:27017/local` 
- Creates database named `local`

## Sample Data Created

### Admin User
- Full admin permissions (`admin`, `users`, `contacts`, `projects`, `quotes`, `templates`, `settings`)
- User preferences (notifications, calendar view, theme, timezone)
- Properly hashed password using bcrypt

### Demo Company (Location)
- Complete business profile with branding
- Embedded sales pipeline with 5 stages
- Feature flags enabled (payments, invoicing, web quotes, SMS)
- Subscription settings (pro plan, active status)

### Mock Data
- **2 Contacts**: John Smith (residential) and Sarah Johnson (commercial)
- **2 Projects**: Kitchen renovation (open) and office maintenance (won)
- **1 Quote**: Detailed quote for kitchen renovation ($25,000)
- **2 Templates**: Service agreement and maintenance checklist

## Database Structure

```
local/
├── users (1 document)       # Admin user with hashedPassword
├── locations (1 document)   # Demo company with embedded pipeline
├── contacts (2 documents)   # Sample customers with notes
├── projects (2 documents)   # Projects with milestones & timeline
├── quotes (1 document)      # Sample quote with line items
└── templates (2 documents)  # Document templates
```

## Schema Compliance

✅ **Field Names**: All field names match `docs/DATABASE_SCHEMA.md`  
✅ **Data Types**: Proper ObjectId references and data types  
✅ **Relationships**: Correct foreign key relationships  
✅ **Indexes**: Performance indexes created automatically  

## Indexes Created

- `users.email` (unique)
- `locations.ghlLocationId` 
- `contacts.locationId + email`
- `projects.locationId + contactId`
- `quotes.locationId + projectId`

## Verification

Check seeded data with proper field names:

```bash
# Verify user with hashedPassword
mongosh mongodb://localhost:27017/local --eval "db.users.findOne({}, {email: 1, hashedPassword: 1, permissions: 1})"

# Check location with embedded pipeline
mongosh mongodb://localhost:27017/local --eval "db.locations.findOne({}, {locationId: 1, pipelines: 1, features: 1})"

# Verify projects with proper schema
mongosh mongodb://localhost:27017/local --eval "db.projects.find({}, {title: 1, status: 1, pipelineStageId: 1, monetaryValue: 1})"
```

## Commands

```bash
# Main seed command (now points to schema-compliant version)
yarn seed:local

# Legacy seed command (old TypeScript version)
yarn seed
```

## Troubleshooting

### MongoDB Not Running
```bash
sudo systemctl start mongod
```

### Connection Issues
Ensure MongoDB is listening on localhost:27017:
```bash
mongosh mongodb://localhost:27017 --eval "db.runCommand('ping')"
```

### Schema Validation
The seed data is designed to match your documented schema. If you encounter field name mismatches:
1. Check `docs/DATABASE_SCHEMA.md` for the correct field names
2. Update your application code to use schema-compliant field names
3. Re-run the seed command

### Clear Database
To start fresh, just run `yarn seed:local` again - it automatically clears existing data.

## Production Note

⚠️ **Warning**: This seed command is designed for local development only. It will:
- Force `NODE_ENV=development`
- Connect to local MongoDB (`local` database)
- Never affect production data

The command safely isolates local development data from production systems. 