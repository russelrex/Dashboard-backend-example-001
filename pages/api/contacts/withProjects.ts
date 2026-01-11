// lpai-backend/pages/api/contacts/withProjects.ts
// FIXED: URL decode JSON params before parsing to handle encoded arrays

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

// Helper function to safely parse JSON with URL decoding
function safeJsonParse(value: string | string[] | undefined): any[] {
  if (!value) return [];
  
  try {
    // Handle string or array input
    const stringValue = Array.isArray(value) ? value[0] : value;
    
    // URL decode first, then JSON parse
    const decoded = decodeURIComponent(stringValue);
    const parsed = JSON.parse(decoded);
    
    // Ensure we return an array
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[API] Failed to parse JSON param:', value, error);
    return [];
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const locationId = req.query.locationId as string;
  if (!locationId) {
    return res.status(400).json({ error: 'Missing locationId' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Build MongoDB query with filters
    const contactQuery: any = { locationId, deletedAt: { $exists: false } };

    // Parse filter parameters from query string with URL decoding
    const {
      tagFilters,
      excludeTagFilters,
      statusFilters,
      sourceFilters,
      typeFilters,
      assignedToFilters,
      companyFilters,
      filterMode,
      autoHideLeads,
      hideUnassigned,
      showAllByDefault,
      search  // NEW: Add search parameter
    } = req.query;

    // FIXED: Use safe JSON parsing with URL decoding
    const parsedTagFilters = safeJsonParse(tagFilters);
    const parsedExcludeTagFilters = safeJsonParse(excludeTagFilters);
    const parsedStatusFilters = safeJsonParse(statusFilters);
    const parsedSourceFilters = safeJsonParse(sourceFilters);
    const parsedTypeFilters = safeJsonParse(typeFilters);
    const parsedAssignedToFilters = safeJsonParse(assignedToFilters);
    const parsedCompanyFilters = safeJsonParse(companyFilters);

    // Check if any filters are active
    const hasActiveFilters = (
      parsedTagFilters.length > 0 ||
      parsedExcludeTagFilters.length > 0 ||
      parsedStatusFilters.length > 0 ||
      parsedSourceFilters.length > 0 ||
      parsedTypeFilters.length > 0 ||
      parsedAssignedToFilters.length > 0 ||
      parsedCompanyFilters.length > 0 ||
      autoHideLeads === 'true' ||
      hideUnassigned === 'true'
    );

    // If showAllByDefault is false and no filters are active, return empty
    if (showAllByDefault === 'false' && !hasActiveFilters) {
      return res.status(200).json([]);
    }

    // Apply filters only if they exist
    if (hasActiveFilters) {
      const filterConditions: any[] = [];

      // Tag filters (required tags)
      if (parsedTagFilters.length > 0) {
        if (filterMode === 'strict') {
          // All tags must be present
          filterConditions.push({ tags: { $all: parsedTagFilters } });
        } else {
          // Any tag can be present (inclusive)
          filterConditions.push({ tags: { $in: parsedTagFilters } });
        }
      }

      // Exclude tag filters
      if (parsedExcludeTagFilters.length > 0) {
        filterConditions.push({ tags: { $nin: parsedExcludeTagFilters } });
      }

      // Status filters
      if (parsedStatusFilters.length > 0) {
        filterConditions.push({ status: { $in: parsedStatusFilters } });
      }

      // Source filters
      if (parsedSourceFilters.length > 0) {
        filterConditions.push({ source: { $in: parsedSourceFilters } });
      }

      // Type filters
      if (parsedTypeFilters.length > 0) {
        filterConditions.push({ type: { $in: parsedTypeFilters } });
      }

      // Assigned to filters
      if (parsedAssignedToFilters.length > 0) {
        filterConditions.push({ assignedTo: { $in: parsedAssignedToFilters } });
      }

      // Company filters
      if (parsedCompanyFilters.length > 0) {
        filterConditions.push({ companyName: { $in: parsedCompanyFilters } });
      }

      // Auto-hide leads
      if (autoHideLeads === 'true') {
        filterConditions.push({ type: { $ne: 'lead' } });
      }

      // Hide unassigned
      if (hideUnassigned === 'true') {
        filterConditions.push({ 
          assignedTo: { $exists: true, $nin: [null, ''] } 
        });
      }

      // Apply all filter conditions
      if (filterConditions.length > 0) {
        if (filterMode === 'strict') {
          // AND logic - all conditions must be true
          contactQuery.$and = filterConditions;
        } else {
          // OR logic - any condition can be true (for multiple filters of same type)
          // But within same filter type, use AND
          contactQuery.$and = filterConditions;
        }
      }
    }

    // Add search functionality if search param provided
    if (search && typeof search === 'string' && search.trim()) {
      const searchTerm = search.trim();
      
      // Use text search if text index exists, otherwise use regex
      if (searchTerm.length > 0) {
        const searchConditions = [
          { phone: { $regex: searchTerm, $options: 'i' } },
          { email: { $regex: searchTerm, $options: 'i' } },
          { firstName: { $regex: searchTerm, $options: 'i' } },
          { lastName: { $regex: searchTerm, $options: 'i' } },
          { companyName: { $regex: searchTerm, $options: 'i' } }
        ];
        
        // If we already have filter conditions, combine them with search
        if (contactQuery.$and) {
          contactQuery.$and.push({ $or: searchConditions });
        } else {
          contactQuery.$or = searchConditions;
        }
      }
    }

    console.log('[Contacts API] Query:', JSON.stringify(contactQuery, null, 2));
    console.log('[Contacts API] Parsed filters:', {
      tagFilters: parsedTagFilters,
      excludeTagFilters: parsedExcludeTagFilters,
      statusFilters: parsedStatusFilters,
      sourceFilters: parsedSourceFilters,
      typeFilters: parsedTypeFilters,
      assignedToFilters: parsedAssignedToFilters,
      companyFilters: parsedCompanyFilters,
    });

    // Execute optimized query
    const contacts = await db
      .collection('contacts')
      .find(contactQuery)
      .sort({ createdAt: -1 })
      .toArray();

    console.log(`[Contacts API] Found ${contacts.length} contacts after filtering`);

    // Only fetch projects for the filtered contacts (much more efficient)
    if (contacts.length === 0) {
      return res.status(200).json([]);
    }

    const contactIds = contacts.map((c) => c._id.toString());

    const projects = await db
      .collection('projects')
      .find({ locationId, contactId: { $in: contactIds } })
      .toArray();

    const grouped = projects.reduce((acc: any, p) => {
      const cid = p.contactId.toString();
      if (!acc[cid]) acc[cid] = [];
      acc[cid].push(p);
      return acc;
    }, {});

    const enriched = contacts.map((c) => ({
      ...c,
      projects: grouped[c._id.toString()] || [],
    }));

    return res.status(200).json(enriched);
  } catch (err) {
    console.error('❌ Failed to load contacts with projects', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}