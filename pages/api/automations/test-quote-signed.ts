import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const client = await clientPromise;
  const db = client.db('lpai');
  
  try {
    // Create test data
    const contact = {
      _id: new ObjectId(),
      locationId: '5OuaTrizW5wkZMI1xtvX',
      firstName: 'Test',
      lastName: 'Quote',
      fullName: 'Test Quote',
      email: 'test@quote.com',
      phone: '5555553333'
    };
    
    const project = {
      _id: new ObjectId(),
      locationId: '5OuaTrizW5wkZMI1xtvX',
      contactId: contact._id.toString(),
      pipelineId: '9cGrqJIQlofiY1Ehj8xf',
      pipelineStageId: 'cb72a0ac-2462-4e9c-8450-54865d02038e',
      name: 'Test Quote Project',
      status: 'active'
    };
    
    const quote = {
      _id: new ObjectId(),
      projectId: project._id.toString(),
      contactId: contact._id.toString(),
      locationId: '5OuaTrizW5wkZMI1xtvX',
      total: 5000,
      depositAmount: 0, // No deposit for testing
      status: 'signed'
    };
    
    // Insert test data
    await db.collection('projects').insertOne(project);
    await db.collection('quotes').insertOne(quote);
    
    // Trigger quote-signed event
    const event = {
      type: 'quote-signed',
      locationId: '5OuaTrizW5wkZMI1xtvX',
      data: {
        quote: {
          _id: quote._id,
          projectId: project._id.toString(),
          total: quote.total,
          depositAmount: quote.depositAmount
        },
        project: {
          _id: project._id,
          pipelineId: project.pipelineId,
          pipelineStageId: project.pipelineStageId
        },
        contact: contact
      }
    };
    
    // Call automation execute
    const response = await fetch('http://localhost:3000/api/automations/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    
    const result = await response.json();
    
    // Check if project was transitioned
    const updatedProject = await db.collection('projects').findOne({ _id: project._id });
    
    // Cleanup
    await db.collection('projects').deleteOne({ _id: project._id });
    await db.collection('quotes').deleteOne({ _id: quote._id });
    
    return res.json({
      success: true,
      testData: { contactId: contact._id, projectId: project._id, quoteId: quote._id },
      automationResult: result,
      projectTransitioned: updatedProject?.pipelineId === 'aaSTiFRrEPvGYXR9uw85'
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return res.status(500).json({ error: error.message });
  }
}
