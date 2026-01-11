// Test all automations systematically
// Run: curl http://localhost:3000/api/automations/test-all

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const client = await clientPromise;
  const db = client.db('lpai');
  const results = [];

  try {
    // Test 1: Contact Assignment
    console.log('\n📊 TEST 1: Contact Assignment');
    const contactId = new ObjectId();
    const assignEvent = {
      type: 'contact-assigned',
      locationId: '5OuaTrizW5wkZMI1xtvX',
      contactId: contactId.toString(),
      assignedTo: 'DQ8BgAn3Ohwzo7T1b6OF', // Michael's ghlUserId
      data: {
        contact: {
          _id: contactId,
          fullName: 'Test Contact',
          assignedTo: 'DQ8BgAn3Ohwzo7T1b6OF'
        }
      }
    };
    
    const test1 = await fetch('http://localhost:3000/api/automations/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assignEvent)
    });
    results.push({ test: 'contact-assigned', status: test1.status, body: await test1.json() });

    // Test 2: Project Created
    console.log('\n📊 TEST 2: Project Created');
    const projectEvent = {
      type: 'project-created',
      locationId: '5OuaTrizW5wkZMI1xtvX',
      data: {
        project: {
          _id: new ObjectId(),
          serviceType: 'Roof Replacement',
          assignedUserId: 'DQ8BgAn3Ohwzo7T1b6OF'
        },
        contact: {
          _id: contactId,
          name: 'Test Contact',
          firstName: 'Test'
        }
      }
    };
    
    const test2 = await fetch('http://localhost:3000/api/automations/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projectEvent)
    });
    results.push({ test: 'project-created', status: test2.status, body: await test2.json() });

    // Test 3: Quote Signed (should trigger deposit flow)
    console.log('\n📊 TEST 3: Quote Signed');
    const quoteEvent = {
      type: 'quote-signed',
      locationId: '5OuaTrizW5wkZMI1xtvX',
      data: {
        quote: {
          _id: new ObjectId(),
          projectId: new ObjectId(),
          total: 5000,
          depositAmount: 1000
        },
        project: {
          _id: new ObjectId(),
          pipelineId: '9cGrqJIQlofiY1Ehj8xf',
          pipelineStageId: 'cb72a0ac-2462-4e9c-8450-54865d02038e'
        },
        contact: {
          _id: contactId,
          name: 'Test Contact',
          phone: '5555551234'
        }
      }
    };
    
    const test3 = await fetch('http://localhost:3000/api/automations/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quoteEvent)
    });
    results.push({ test: 'quote-signed', status: test3.status, body: await test3.json() });

    // Check what rules were found
    const rules = await db.collection('automation_rules').find({
      locationId: '5OuaTrizW5wkZMI1xtvX',
      isActive: true
    }).toArray();

    return res.json({
      success: true,
      totalRules: rules.length,
      testResults: results,
      ruleTypes: [...new Set(rules.map(r => r.trigger?.type))].sort()
    });

  } catch (error) {
    console.error('Test error:', error);
    return res.status(500).json({ error: error.message });
  }
}
