/**
 * File: createPipelineCalendarRecordsAndMapAutomations.ts
 * Purpose: Create MongoDB pipeline/calendar records and map automation templates after full sync
 * Author: LPai Team
 * Last Modified: 2025-09-12
 * Dependencies: MongoDB, location pipelines/calendars data
 */

import { ObjectId } from 'mongodb';
import { publishAblyEvent } from '../ably/publishEvent';

export async function createPipelineCalendarRecordsAndMapAutomations(db: any, locationId: string) {
  console.log(`[Pipeline/Calendar Mapping] Starting for location: ${locationId}`);
  
  // Pipeline and calendar records are now created during sync, not here
  let automationsMapped = 0;
  let locationSettingsUpdated = false;
  
  try {
    // 1. Get the location with its synced pipelines and calendars
    const location = await db.collection('locations').findOne({ locationId });
    if (!location) {
      throw new Error(`Location not found: ${locationId}`);
    }

    const { pipelines = [], calendars = [] } = location;
    console.log(`[Pipeline/Calendar Mapping] Found ${pipelines.length} pipelines and ${calendars.length} calendars`);
    console.log(`[Pipeline/Calendar Mapping] Pipelines:`, pipelines.map(p => `${p.name} (${p.id})`));
    console.log(`[Pipeline/Calendar Mapping] Calendars:`, calendars.map(c => `${c.name} (${c.id})`));

    // RESET location settings on reinstall to prevent duplicates
    await db.collection('locations').updateOne(
      { locationId },
      {
        $set: {
          pipelineSettings: {
            projectsPipelines: [],
            quotesPipelines: [],
            stageIcons: {},
            updatedAt: new Date()
          },
          calendarSettings: {
            projectsCalendars: [],
            quotesCalendars: [],
            displayCalendars: [],
            updatedAt: new Date()
          }
        }
      }
    );
    
    console.log(`[Pipeline/Calendar Mapping] Reset location settings to prevent duplicates`);

    // 2. Pipeline and calendar records are now created during sync (Steps 2-3)
    // So we can skip that part and focus on location settings and automation mapping
    console.log(`[Pipeline/Calendar Mapping] Pipeline/calendar records already created during sync`);

    // 3. ENHANCED location settings categorization
    const activePipelines = pipelines.filter(p => p.stages && p.stages.length > 0);
    const activeCalendars = calendars.filter(c => c.id && c.name); // Just check they have basic properties
    
    console.log(`[Pipeline/Calendar Mapping] Active pipelines: ${activePipelines.length}, Active calendars: ${activeCalendars.length}`);

    // STRICT WHITELIST - Only allow our exact 3 calendars and 2 pipelines
    const ALLOWED_PIPELINE_NAMES = ['Active Jobs', 'Quoting'];
    const ALLOWED_CALENDAR_NAMES = ['Customer Walk-Thru', 'Field Work', 'Quote Calendar'];
    
    console.log(`[Pipeline/Calendar Mapping] STRICT WHITELIST MODE - Only allowing specific names`);
    console.log(`[Pipeline/Calendar Mapping] Allowed pipelines: ${ALLOWED_PIPELINE_NAMES.join(', ')}`);
    console.log(`[Pipeline/Calendar Mapping] Allowed calendars: ${ALLOWED_CALENDAR_NAMES.join(', ')}`);
    
    // Filter to only allowed pipelines
    const allowedPipelines = pipelines.filter(p => ALLOWED_PIPELINE_NAMES.includes(p.name));
    const allowedCalendars = calendars.filter(c => ALLOWED_CALENDAR_NAMES.includes(c.name));
    
    console.log(`[Pipeline/Calendar Mapping] Found ${allowedPipelines.length}/${pipelines.length} allowed pipelines`);
    console.log(`[Pipeline/Calendar Mapping] Found ${allowedCalendars.length}/${calendars.length} allowed calendars`);
    
    // Strict categorization by exact name
    const quotesPipelines = [];
    const projectsPipelines = [];
    const quotesCalendars = [];
    const projectsCalendars = [];
    
    for (const pipeline of allowedPipelines) {
      if (pipeline.name === 'Quoting' || pipeline.name === 'Estimates') {
        quotesPipelines.push(pipeline.id);
        console.log(`[Pipeline/Calendar Mapping] Added "${pipeline.name}" to quotesPipelines`);
      } else if (pipeline.name === 'Active Jobs') {
        projectsPipelines.push(pipeline.id);
        console.log(`[Pipeline/Calendar Mapping] Added "${pipeline.name}" to projectsPipelines`);
      }
    }
    
    for (const calendar of allowedCalendars) {
      if (calendar.name === 'Quote Calendar') {
        quotesCalendars.push(calendar.id);
        console.log(`[Pipeline/Calendar Mapping] Added "${calendar.name}" to quotesCalendars`);
      } else if (calendar.name === 'Customer Walk-Thru' || calendar.name === 'Field Work') {
        projectsCalendars.push(calendar.id);
        console.log(`[Pipeline/Calendar Mapping] Added "${calendar.name}" to projectsCalendars`);
      }
    }
    
    // Display calendars should ONLY be our 3 allowed calendars
    const displayCalendars = allowedCalendars.map(c => c.id);
    
    console.log(`[Pipeline/Calendar Mapping] FINAL STRICT RESULTS:`);
    console.log(`  - Quotes: ${quotesPipelines.length} pipelines, ${quotesCalendars.length} calendars`);
    console.log(`  - Projects: ${projectsPipelines.length} pipelines, ${projectsCalendars.length} calendars`);
    console.log(`  - Display: ${displayCalendars.length} calendars (ONLY our 3)`);
    
    // Log any rejected items
    const rejectedPipelines = pipelines.filter(p => !ALLOWED_PIPELINE_NAMES.includes(p.name));
    const rejectedCalendars = calendars.filter(c => !ALLOWED_CALENDAR_NAMES.includes(c.name));
    
    if (rejectedPipelines.length > 0) {
      console.log(`[Pipeline/Calendar Mapping] REJECTED ${rejectedPipelines.length} pipelines: ${rejectedPipelines.map(p => p.name).join(', ')}`);
    }
    
    if (rejectedCalendars.length > 0) {
      console.log(`[Pipeline/Calendar Mapping] REJECTED ${rejectedCalendars.length} calendars: ${rejectedCalendars.map(c => c.name).join(', ')}`);
    }

    // Create stage icons mapping based on stage names
    const stageIcons = {};
    for (const pipeline of allowedPipelines) {
      for (const stage of pipeline.stages || []) {
        const iconKey = `${pipeline.id}-${stage.id}`;
        const stageName = stage.name.toLowerCase();
        
        if (stageName.includes('pending') || stageName.includes('created') || stageName.includes('new')) {
          stageIcons[iconKey] = 'add-circle-outline';
        } else if (stageName.includes('scheduled') || stageName.includes('visit')) {
          stageIcons[iconKey] = 'calendar-outline';
        } else if (stageName.includes('done') || stageName.includes('complete')) {
          stageIcons[iconKey] = 'checkmark-done-outline';
        } else if (stageName.includes('estimating') || stageName.includes('quoting')) {
          stageIcons[iconKey] = 'calculator-outline';
        } else if (stageName.includes('estimate') || stageName.includes('sent')) {
          stageIcons[iconKey] = 'document-text-outline';
        } else if (stageName.includes('viewed')) {
          stageIcons[iconKey] = 'eye-outline';
        } else if (stageName.includes('accepted')) {
          stageIcons[iconKey] = 'thumbs-up-outline';
        } else if (stageName.includes('signed')) {
          stageIcons[iconKey] = 'checkmark-circle-outline';
        } else if (stageName.includes('deposit')) {
          stageIcons[iconKey] = 'card-outline';
        } else {
          stageIcons[iconKey] = 'ellipse-outline';
        }
      }
    }

    // Update location settings with comprehensive logging
    const locationSettings = {
      pipelineSettings: {
        projectsPipelines,
        quotesPipelines,
        stageIcons,
        updatedAt: new Date()
      },
      calendarSettings: {
        projectsCalendars,
        quotesCalendars,
        displayCalendars,
        updatedAt: new Date()
      }
    };

    // 3.5 FLASH GLOBAL TEMPLATES NOW - Right after calendar categorization
    console.log('='.repeat(80));
    console.log('[Template Flash] ⚡ STARTING TEMPLATE FLASH WITH HEAVY LOGGING');
    console.log('='.repeat(80));

    console.log('[Template Flash] Step 1: Inspecting allowedCalendars array...');
    console.log(`[Template Flash] allowedCalendars.length = ${allowedCalendars.length}`);
    console.log('[Template Flash] Full allowedCalendars:', JSON.stringify(allowedCalendars, null, 2));

    // Build calendar ID map DIRECTLY from allowedCalendars - guarantees we use the right IDs
    const calendarIdMap: Record<string, string> = {};

    console.log('[Template Flash] Step 2: Building calendarIdMap...');

    // Loop through allowedCalendars once and map all three calendars
    for (let i = 0; i < allowedCalendars.length; i++) {
      const calendar = allowedCalendars[i];
      console.log(`[Template Flash] Processing calendar ${i + 1}/${allowedCalendars.length}:`);
      console.log(`  - name: "${calendar.name}"`);
      console.log(`  - id: "${calendar.id}"`);
      
      if (calendar.name === 'Quote Calendar') {
        calendarIdMap['{{calendarId_Quote}}'] = calendar.id;
        calendarIdMap['{{calendarId_Quote_Calendar}}'] = calendar.id;
        console.log(`[Template Flash] ✅ MATCHED Quote Calendar: ${calendar.id}`);
      } 
      else if (calendar.name === 'Field Work') {
        calendarIdMap['{{calendarId_FieldWork}}'] = calendar.id;
        calendarIdMap['{{calendarId_Field_Work}}'] = calendar.id;
        console.log(`[Template Flash] ✅ MATCHED Field Work: ${calendar.id}`);
      } 
      else if (calendar.name === 'Customer Walk-Thru') {
        calendarIdMap['{{calendarId_CustomerWalkThru}}'] = calendar.id;
        calendarIdMap['{{calendarId_Customer_Walk_Thru}}'] = calendar.id;
        console.log(`[Template Flash] ✅ MATCHED Customer Walk-Thru: ${calendar.id}`);
      } else {
        console.log(`[Template Flash]    (skipped - not in whitelist)`);
      }
    }

    console.log('[Template Flash] Step 3: Verifying calendar mapping...');
    console.log(`[Template Flash] calendarIdMap has ${Object.keys(calendarIdMap).length} entries`);
    console.log('[Template Flash] Final calendarIdMap:', JSON.stringify(calendarIdMap, null, 2));

    // Verify all expected calendars were mapped
    const expectedCalendars = ['Quote Calendar', 'Field Work', 'Customer Walk-Thru'];
    const mappedCalendars = allowedCalendars.map((c: any) => c.name);
    const missingCalendars = expectedCalendars.filter(name => !mappedCalendars.includes(name));

    if (missingCalendars.length > 0) {
      console.error(`[Template Flash] ⚠️ WARNING: Missing calendars:`, missingCalendars);
      console.error(`[Template Flash] Available calendars:`, mappedCalendars);
    } else {
      console.log(`[Template Flash] ✅ All expected calendars found in allowedCalendars`);
    }

    // Check if we have real IDs for each placeholder
    const requiredPlaceholders = ['{{calendarId_Quote}}', '{{calendarId_FieldWork}}', '{{calendarId_CustomerWalkThru}}'];
    for (const placeholder of requiredPlaceholders) {
      if (calendarIdMap[placeholder]) {
        console.log(`[Template Flash] ✅ ${placeholder} = ${calendarIdMap[placeholder]}`);
      } else {
        console.error(`[Template Flash] ❌ ${placeholder} = MISSING!`);
      }
    }

    console.log('='.repeat(80));
    
    // 1. Flash SMS Templates from global
    const globalSmsTemplates = await db.collection('sms_templates').findOne({ 
      locationId: 'global' 
    });

    if (globalSmsTemplates) {
      const { _id, ...templateData } = globalSmsTemplates;
      
      await db.collection('sms_templates').insertOne({
        ...templateData,
        locationId: locationId,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log('[Template Flash] ✅ Flashed SMS templates');
    }

    // 2. Flash Email Templates from global
    const globalEmailTemplates = await db.collection('email_templates').find({ 
      locationId: 'global',
      isActive: true
    }).toArray();

    for (const template of globalEmailTemplates) {
      const { _id, ...templateData } = template;
      
      await db.collection('email_templates').insertOne({
        ...templateData,
        locationId: locationId,
        isGlobal: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    console.log(`[Template Flash] ✅ Flashed ${globalEmailTemplates.length} email templates`);


    await db.collection('locations').updateOne(
      { locationId },
      { $set: locationSettings }
    );
    
    locationSettingsUpdated = true;
    console.log(`[Pipeline/Calendar Mapping] Updated location settings:`);
    console.log(`  - Quotes: ${quotesPipelines.length} pipelines, ${quotesCalendars.length} calendars`);
    console.log(`  - Projects: ${projectsPipelines.length} pipelines, ${projectsCalendars.length} calendars`);
    console.log(`  - Display: ${displayCalendars.length} calendars`);

    // Publish Ably progress update for location settings
    try {
      await publishAblyEvent({
        locationId,
        entity: {
          locationId,
          syncProgress: {
            automationMapping: {
              status: 'in_progress',
              locationSettingsUpdated: true,
              quotesPipelines: quotesPipelines.length,
              projectsPipelines: projectsPipelines.length,
              quotesCalendars: quotesCalendars.length,
              projectsCalendars: projectsCalendars.length,
              displayCalendars: displayCalendars.length
            }
          }
        },
        eventType: 'progress-update',
        metadata: { stepName: 'Automation Mapping - Company Settings' }
      });
    } catch (error) {
      console.error('[Ably] Failed to publish location settings progress:', error);
    }

    // 4. ENHANCED automation template mapping
    const automations = await db.collection('automation_rules').find({ 
      locationId,
      source: 'auto_install'
    }).toArray();

    console.log(`[Pipeline/Calendar Mapping] Found ${automations.length} automation templates to map`);

    for (const automation of automations) {
      let needsUpdate = false;
      const updates = {};

      console.log(`[Pipeline/Calendar Mapping] Processing automation: "${automation.name}"`);

      // ENHANCED stage-based trigger mapping
      if (automation.trigger?.type?.includes('stage') || automation.trigger?.type === 'opportunity_stage_changed') {
        console.log(`  - Has stage-based trigger: ${automation.trigger.type}`);
        
        // Try multiple mapping strategies
        let mapped = false;

        // Strategy 1: Direct stage ID match (if already has correct ID)
        if (automation.trigger.config?.stageId) {
          for (const pipeline of pipelines) {
            const stage = pipeline.stages.find(s => s.id === automation.trigger.config.stageId);
            if (stage) {
              updates['trigger.config.pipelineId'] = pipeline.id;
              updates['trigger.config.stageId'] = stage.id;
              needsUpdate = true;
              mapped = true;
              console.log(`  - Mapped by direct stage ID to "${stage.name}" in "${pipeline.name}"`);
              break;
            }
          }
        }

        // Strategy 2: Stage name matching
        if (!mapped && automation.trigger.config?.stageName) {
          const targetStageName = automation.trigger.config.stageName.toLowerCase();
          for (const pipeline of pipelines) {
            for (const stage of pipeline.stages || []) {
              const stageName = stage.name.toLowerCase();
              if (stageName === targetStageName || 
                  stageName.includes(targetStageName) || 
                  targetStageName.includes(stageName)) {
                updates['trigger.config.pipelineId'] = pipeline.id;
                updates['trigger.config.stageId'] = stage.id;
                needsUpdate = true;
                mapped = true;
                console.log(`  - Mapped by stage name "${targetStageName}" to "${stage.name}" in "${pipeline.name}"`);
                break;
              }
            }
            if (mapped) break;
          }
        }

        // Strategy 3: Automation name contains stage name
        if (!mapped) {
          const automationName = automation.name.toLowerCase();
          for (const pipeline of pipelines) {
            for (const stage of pipeline.stages || []) {
              const stageName = stage.name.toLowerCase();
              
              // Check if automation name contains stage name or vice versa
              if (automationName.includes(stageName) || stageName.includes(automationName)) {
                updates['trigger.config.pipelineId'] = pipeline.id;
                updates['trigger.config.stageId'] = stage.id;
                needsUpdate = true;
                mapped = true;
                console.log(`  - Mapped by name similarity to "${stage.name}" in "${pipeline.name}"`);
                break;
              }
            }
            if (mapped) break;
          }
        }

        if (!mapped) {
          console.log(`  - WARNING: Could not map stage-based trigger for automation "${automation.name}"`);
        }
      }

      // ENHANCED calendar-based action mapping
      if (automation.actions?.some(action => action.type === 'create-appointment' || action.type === 'book_appointment')) {
        automation.actions.forEach((action, index) => {
          if ((action.type === 'create-appointment' || action.type === 'book_appointment')) {
            console.log(`  - Has calendar-based action at index ${index}`);
            
            let calendarMapped = false;

            // Strategy 1: Direct calendar ID match
            if (action.config?.calendarId) {
              const calendar = calendars.find(c => c.id === action.config.calendarId);
              if (calendar) {
                updates[`actions.${index}.config.calendarId`] = calendar.id;
                needsUpdate = true;
                calendarMapped = true;
                console.log(`    - Mapped by direct ID to "${calendar.name}"`);
              }
            }

            // Strategy 2: Calendar name matching
            if (!calendarMapped && action.config?.calendarName) {
              const targetCalendarName = action.config.calendarName.toLowerCase();
              const calendar = calendars.find(c => 
                c.name.toLowerCase().includes(targetCalendarName) ||
                targetCalendarName.includes(c.name.toLowerCase())
              );
              
              if (calendar) {
                updates[`actions.${index}.config.calendarId`] = calendar.id;
                needsUpdate = true;
                calendarMapped = true;
                console.log(`    - Mapped by name "${targetCalendarName}" to "${calendar.name}"`);
              }
            }

            // Strategy 3: Use first available calendar as fallback
            if (!calendarMapped && calendars.length > 0) {
              const fallbackCalendar = calendars[0];
              updates[`actions.${index}.config.calendarId`] = fallbackCalendar.id;
              needsUpdate = true;
              calendarMapped = true;
              console.log(`    - Mapped to fallback calendar "${fallbackCalendar.name}"`);
            }

            if (!calendarMapped) {
              console.log(`    - WARNING: Could not map calendar for action in automation "${automation.name}"`);
            }
          }
        });
      }

      // Update automation if mappings were found
      if (needsUpdate) {
        await db.collection('automation_rules').updateOne(
          { _id: automation._id },
          { $set: updates }
        );
        automationsMapped++;
        console.log(`  - Updated automation with mapped IDs`);
      } else {
        console.log(`  - No mapping needed for automation "${automation.name}"`);
      }
    }

    // 5. Install automation templates with variable replacement (if not already done)
    const existingTemplates = await db.collection('automation_rules').countDocuments({
      locationId,
      source: 'auto_install',
      isTemplate: false
    });

    if (existingTemplates === 0) {
      console.log(`[Pipeline/Calendar Mapping] Installing automation templates...`);
      
      const automationTemplates = await db.collection('automation_rules').find({ 
        locationId: '{{locationId}}',
        isTemplate: true
      }).toArray();

      console.log(`[Pipeline/Calendar Mapping] Found ${automationTemplates.length} templates to install`);

      // Find pipelines by exact name
      const quotingPipeline = pipelines.find(p => p.name === 'Quoting');
      const activeJobsPipeline = pipelines.find(p => p.name === 'Active Jobs');
      
      // Find calendars - you'll need to confirm the exact calendar names
      const quoteCalendar = calendars.find(c => 
        c.name === 'Quote Calendar' || 
        c.name?.toLowerCase().includes('quote')
      );

      if (!quotingPipeline) {
        console.error(`[Pipeline/Calendar Mapping] ERROR: Could not find Quoting pipeline!`);
      }
      if (!activeJobsPipeline) {
        console.error(`[Pipeline/Calendar Mapping] ERROR: Could not find Active Jobs pipeline!`);
      }

      // Build comprehensive variable map based on exact stage names
      const variableMap: Record<string, string> = {
        '{{locationId}}': locationId,
        
        // Pipeline IDs - all variations found in templates
        '{{pipelineId_Quoting}}': quotingPipeline?.id || '',
        '{{pipelineId_Estimates}}': quotingPipeline?.id || '',
        '{{pipelineId_ActiveJobs}}': activeJobsPipeline?.id || '',
        '{{pipelineId_Active_Jobs}}': activeJobsPipeline?.id || '',
        
        // Calendar IDs
        '{{calendarId_Quote}}': quoteCalendar?.id || calendars[0]?.id || '',
        '{{calendarId_Quote_Calendar}}': quoteCalendar?.id || calendars[0]?.id || '',
        '{{calendarId_FieldWork}}': calendars.find((c: any) => c.name === 'Field Work')?.id || '',
        '{{calendarId_Field_Work}}': calendars.find((c: any) => c.name === 'Field Work')?.id || '',
        '{{calendarId_CustomerWalkThru}}': calendars.find((c: any) => c.name === 'Customer Walk-Thru')?.id || '',
        '{{calendarId_Customer_Walk_Thru}}': calendars.find((c: any) => c.name === 'Customer Walk-Thru')?.id || '',
      };

      // Map Quoting pipeline stages using EXACT names from your screenshots
      if (quotingPipeline?.stages) {
        // From your Quoting pipeline screenshot:
        const quotingStageMap = {
          'Pending Scheduling': ['PendingScheduling', 'Pending_Scheduling'],
          'Visit Scheduled': ['VisitScheduled', 'Visit_Scheduled'],
          'Visit Done': ['VisitDone', 'Visit_Done'],
          'Estimating': ['Estimating'],
          'Estimate Sent': ['EstimateSent', 'Estimate_Sent'],
          'Viewed': ['Viewed'],
          'Accepted': ['Accepted'],
          'Signed': ['Signed'],
          'Deposit': ['Deposit', 'Deposits', 'Estimates_Deposit']
        };

        for (const [stageName, variableKeys] of Object.entries(quotingStageMap)) {
          const stage = quotingPipeline.stages.find(s => s.name === stageName);
          if (stage) {
            // Add all variable patterns for this stage
            for (const key of variableKeys) {
              variableMap[`{{stageId_Quoting_${key}}}`] = stage.id;
              variableMap[`{{stageId_${key}}}`] = stage.id;
              // Also handle underscore versions
              if (key.includes('_')) {
                const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
                variableMap[`{{stageId_Quoting_${camelKey}}}`] = stage.id;
                variableMap[`{{stageId_${camelKey}}}`] = stage.id;
              }
            }
          } else {
            console.log(`[Pipeline/Calendar Mapping] WARNING: Stage "${stageName}" not found in Quoting pipeline`);
          }
        }
      }

      // Map Active Jobs pipeline stages using EXACT names from your screenshots
      if (activeJobsPipeline?.stages) {
        // From your Active Jobs pipeline screenshot:
        const activeJobsStageMap = {
          'Pending Scheduling': ['PendingScheduling', 'Pending_Scheduling'],
          'Scheduled': ['Scheduled'],
          'In Progress': ['InProgress', 'In_Progress'],
          'Quality Review': ['QualityReview', 'Quality_Review'],
          'Customer Walk-Thru': ['CustomerWalkThru', 'Customer_Walk_Thru'],
          'Final Adjustments': ['FinalAdjustments', 'Final_Adjustments'],
          'Completed': ['Completed'],
          'Invoiced': ['Invoiced'],
          'Paid': ['Paid']
        };

        for (const [stageName, variableKeys] of Object.entries(activeJobsStageMap)) {
          const stage = activeJobsPipeline.stages.find(s => s.name === stageName);
          if (stage) {
            for (const key of variableKeys) {
              variableMap[`{{stageId_ActiveJobs_${key}}}`] = stage.id;
              variableMap[`{{stageId_Active_Jobs_${key}}}`] = stage.id;
              // Handle underscore versions
              if (key.includes('_')) {
                const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
                variableMap[`{{stageId_ActiveJobs_${camelKey}}}`] = stage.id;
              }
            }
          } else {
            console.log(`[Pipeline/Calendar Mapping] WARNING: Stage "${stageName}" not found in Active Jobs pipeline`);
          }
        }
      }

      console.log(`[Pipeline/Calendar Mapping] Created ${Object.keys(variableMap).length} variable mappings`);
      
      // Log all mappings for debugging
      console.log(`[Pipeline/Calendar Mapping] Variable mappings:`);
      for (const [key, value] of Object.entries(variableMap)) {
        if (!value) {
          console.log(`  ${key} = NOT_MAPPED (WARNING)`);
        } else {
          console.log(`  ${key} = ${value}`);
        }
      }

      // Process each template
      let successCount = 0;
      let failCount = 0;
      
      for (const template of automationTemplates) {
        const { _id, ...templateData } = template;
        
        console.log(`[Pipeline/Calendar Mapping] Processing template: "${template.name}"`);
        
        // Replace variables using regex with global flag
        let templateString = JSON.stringify(templateData);
        const originalString = templateString;
        
        // Replace all variables found in the map
        for (const [variable, value] of Object.entries(variableMap)) {
          if (value) { // Only replace if we have a value
            const regex = new RegExp(variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            const beforeLength = templateString.length;
            templateString = templateString.replace(regex, value);
            if (templateString.length !== beforeLength) {
              console.log(`  Replaced ${variable} with ${value}`);
            }
          }
        }
        
        // Check for any remaining unmapped variables
        const remainingVars = templateString.match(/\{\{[^}]+\}\}/g);
        if (remainingVars && remainingVars.length > 0) {
          console.log(`  WARNING: Template has unmapped variables:`, remainingVars);
          failCount++;
        } else {
          successCount++;
        }
        
        const processedTemplate = JSON.parse(templateString);
        
        // Special handling for any hardcoded pipeline IDs
        if (processedTemplate.name === "Quote Signed - Direct to Active Jobs") {
          const transitionAction = processedTemplate.actions?.find(a => a.type === 'transition-pipeline');
          if (transitionAction?.config) {
            transitionAction.config.toPipelineId = activeJobsPipeline?.id || transitionAction.config.toPipelineId;
            console.log(`  Special handling: Updated transition-pipeline to ${transitionAction.config.toPipelineId}`);
          }
        }
        
        await db.collection('automation_rules').insertOne({
          ...processedTemplate,
          _id: new ObjectId(),
          locationId,
          createdAt: new Date(),
          updatedAt: new Date(),
          isTemplate: false,
          source: 'auto_install',
          isActive: true,
          executionStats: {
            executionCount: 0,
            successCount: 0,
            failureCount: 0,
            lastExecuted: null
          }
        });
        
        automationsMapped++;
        console.log(`  ✓ Installed automation: "${processedTemplate.name}"`);
      }
      
      console.log(`[Pipeline/Calendar Mapping] Installation complete: ${successCount} successful, ${failCount} with warnings`);
      console.log(`[Pipeline/Calendar Mapping] Total automations installed: ${automationsMapped}`);
    } else {
      console.log(`[Pipeline/Calendar Mapping] Automation templates already installed, skipping`);
    }

    // 6. ACTIVATE CALENDARS - Assign all users to all calendars and make them active
    console.log(`[Pipeline/Calendar Mapping] Activating calendars for location: ${locationId}`);
    
    // Get all users for this location
    const locationUsers = await db.collection('users').find({ 
      locationId,
      isActive: { $ne: false } // Include users that are active or have no isActive field
    }).toArray();
    
    console.log(`[Pipeline/Calendar Mapping] Found ${locationUsers.length} users to assign to calendars`);
    
    // Get auth header for GHL API calls
    const { getAuthHeader } = await import('../ghlAuth');
    const auth = await getAuthHeader(location);
    
    let calendarsActivated = 0;
    
    // Process each calendar and assign all users to it
    for (const calendar of activeCalendars) {
      try {
        console.log(`[Pipeline/Calendar Mapping] Activating calendar: "${calendar.name}" (${calendar.id})`);
        
        // Create team members array - assign ALL users to this calendar
        // Filter out users without ghlUserId
        const validUsers = locationUsers.filter(user => user.ghlUserId);
        
        const teamMembers = validUsers.map((user, index) => ({
          userId: user.ghlUserId,
          priority: 0.5, // Standard priority for all users
          isPrimary: index === 0, // Make first user primary - required for some calendar types
          locationConfigurations: [
            {
              kind: 'custom',
              location: location.address || location.name || 'Business Location'
            }
          ]
        }));
        
        // Skip calendar if no valid users
        if (teamMembers.length === 0) {
          console.log(`[Pipeline/Calendar Mapping]   - Skipping "${calendar.name}" - no users with GHL IDs found`);
          continue;
        }
        
        console.log(`[Pipeline/Calendar Mapping]   - Assigning ${teamMembers.length} team members to "${calendar.name}"`);
        
        // Update calendar via GHL API - EXACT GHL API specification
        const updatePayload = {
          // Team members with exact GHL structure
          teamMembers: teamMembers.map(member => ({
            userId: member.userId,
            priority: member.priority,
            isPrimary: member.isPrimary,
            locationConfigurations: member.locationConfigurations
          })),
          
          // Required calendar fields per GHL API
          name: calendar.name,
          description: calendar.description || '',
          eventType: calendar.eventType || 'RoundRobin_OptimizeForAvailability',
          
          // Slot configuration (required)
          slotDuration: calendar.slotDuration || 30,
          slotDurationUnit: calendar.slotDurationUnit || 'mins',
          slotInterval: calendar.slotInterval || 30,
          slotIntervalUnit: calendar.slotIntervalUnit || 'mins',
          slotBuffer: calendar.slotBuffer || 0,
          preBuffer: calendar.preBuffer || 0,
          preBufferUnit: calendar.preBufferUnit || 'mins',
          
          // Appointment limits
          appoinmentPerSlot: calendar.appoinmentPerSlot || 1,
          appoinmentPerDay: calendar.appoinmentPerDay || 0,
          
          // Booking restrictions
          allowBookingAfter: calendar.allowBookingAfter || 0,
          allowBookingAfterUnit: calendar.allowBookingAfterUnit || 'hours',
          allowBookingFor: calendar.allowBookingFor || 60,
          allowBookingForUnit: calendar.allowBookingForUnit || 'days',
          
          // Open hours (required - use existing or default)
          openHours: calendar.openHours && calendar.openHours.length > 0 ? calendar.openHours : [
            {
              daysOfTheWeek: [1, 2, 3, 4, 5], // Monday-Friday
              hours: [
                {
                  openHour: 9,
                  openMinute: 0,
                  closeHour: 17,
                  closeMinute: 0
                }
              ]
            }
          ],
          
          // Feature flags
          autoConfirm: calendar.autoConfirm !== false,
          allowReschedule: calendar.allowReschedule !== false,
          allowCancellation: calendar.allowCancellation !== false,
          enableRecurring: calendar.enableRecurring || false,
          googleInvitationEmails: calendar.googleInvitationEmails || false,
          shouldAssignContactToTeamMember: calendar.shouldAssignContactToTeamMember || true,
          shouldSkipAssigningContactForExisting: calendar.shouldSkipAssigningContactForExisting || false,
          
          // Widget settings
          widgetType: calendar.widgetType || 'classic',
          eventColor: calendar.eventColor || '#039be5',
          
          // Form settings
          formSubmitType: calendar.formSubmitType || 'ThankYouMessage',
          formSubmitThanksMessage: calendar.formSubmitThanksMessage || 'Thank you for your appointment request.',
          
          // Guest settings
          guestType: calendar.guestType || 'collect_detail',
          
          // Status - this activates the calendar
          isActive: true
        };
        
        // Remove any undefined/null values that could cause API errors
        Object.keys(updatePayload).forEach(key => {
          if (updatePayload[key] === undefined || updatePayload[key] === null) {
            delete updatePayload[key];
          }
        });
        
        // Log the complete payload for debugging GHL API issues
        console.log(`[Pipeline/Calendar Mapping]   - GHL API Payload for "${calendar.name}":`);
        console.log(JSON.stringify(updatePayload, null, 2));
        console.log(`[Pipeline/Calendar Mapping]   - API URL: https://services.leadconnectorhq.com/calendars/${calendar.id}`);
        console.log(`[Pipeline/Calendar Mapping]   - Auth header: ${auth.header.substring(0, 20)}...`);
        
        // Make the API call to update the calendar
        const axios = await import('axios');
        await axios.default.put(
          `https://services.leadconnectorhq.com/calendars/${calendar.id}`,
          updatePayload,
          {
            headers: {
              'Authorization': auth.header,
              'Version': '2021-04-15', // Calendar API uses older version
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          }
        );
        
        console.log(`[Pipeline/Calendar Mapping]   - ✅ Successfully activated "${calendar.name}" with ${teamMembers.length} users`);
        calendarsActivated++;
        
        // Update local calendar record to reflect the changes
        await db.collection('locations').updateOne(
          { locationId },
          { 
            $set: { 
              [`calendars.$[cal].teamMembers`]: teamMembers,
              [`calendars.$[cal].isActive`]: true,
              [`calendars.$[cal].lastActivated`]: new Date()
            } 
          },
          { 
            arrayFilters: [{ 'cal.id': calendar.id }] 
          }
        );
        
      } catch (calendarError) {
        console.error(`[Pipeline/Calendar Mapping] Failed to activate calendar "${calendar.name}":`, calendarError.response?.data || calendarError.message);
        // Continue with other calendars even if one fails
      }
    }
    
    console.log(`[Pipeline/Calendar Mapping] Calendar activation complete: ${calendarsActivated}/${activeCalendars.length} calendars activated`);

    const result = {
      automationsMapped,
      locationSettingsUpdated,
      pipelineCount: pipelines.length,
      calendarCount: calendars.length,
      calendarsActivated,
      quotesPipelinesCount: quotesPipelines.length,
      projectsPipelinesCount: projectsPipelines.length,
      quotesCalendarsCount: quotesCalendars.length,
      projectsCalendarsCount: projectsCalendars.length,
      displayCalendarsCount: displayCalendars.length,
      quotesPipelines,
      projectsPipelines,
      quotesCalendars,
      projectsCalendars,
      displayCalendars,
      duration: `${Date.now() - Date.now()}ms`
    };

    console.log(`[Pipeline/Calendar Mapping] Completed for location: ${locationId}`);
    
    // Publish final Ably progress update
    try {
      await publishAblyEvent({
        locationId,
        entity: {
          locationId,
          syncProgress: {
            automationMapping: {
              status: 'complete',
              automationsMapped,
              locationSettingsUpdated,
              quotesPipelines: result.quotesPipelines.length,
              projectsPipelines: result.projectsPipelines.length,
              quotesCalendars: result.quotesCalendars.length,
              projectsCalendars: result.projectsCalendars.length,
              displayCalendars: result.displayCalendars.length,
              completedAt: new Date()
            }
          }
        },
        eventType: 'progress-update',
        metadata: { stepName: 'Automation Mapping - Complete' }
      });
    } catch (error) {
      console.error('[Ably] Failed to publish automation mapping completion:', error);
    }
    
    // CRITICAL: Send user setup emails at the very end after everything is ready
    await sendUserSetupEmails(db, locationId);
    
    console.log(`[Pipeline/Calendar Mapping] Final Result:`, result);
    return result;

  } catch (error) {
    console.error('[Pipeline/Calendar Mapping] Error:', error);
    throw error;
  }
}

/**
 * Send setup emails to all users who need password setup
 */
async function sendUserSetupEmails(db: any, locationId: string) {
  console.log(`[User Setup Emails] Starting for location: ${locationId}`);
  
  try {
    // Import required modules - removed unused generateSecureToken
    
    // Find all users who have valid tokens but haven't received setup emails yet
    const usersNeedingSetup = await db.collection('users').find({
      locationId,
      needsSetup: true,
      isActive: true,
      isDeleted: { $ne: true },
      setupToken: { $exists: true, $ne: null },
      setupTokenExpiry: { $gt: new Date() },
      $or: [
        { setupEmailSent: { $exists: false } },
        { setupEmailSent: false }
      ]
    }).toArray();
    
    console.log(`[User Setup Emails] Found ${usersNeedingSetup.length} users with valid tokens needing setup emails`);
    
    // DEBUG: Let's see what users we found and their token status
    for (const user of usersNeedingSetup) {
      console.log(`[User Setup Emails] DEBUG User: ${user.email}`);
      console.log(`  - needsSetup: ${user.needsSetup}`);
      console.log(`  - hasSetupToken: ${!!user.setupToken}`);
      console.log(`  - tokenExpires: ${user.setupTokenExpiry}`);
      console.log(`  - emailSent: ${user.setupEmailSent}`);
    }
    
    // Get location info
    const location = await db.collection('locations').findOne({ locationId });
    
    let emailsSent = 0;
    
    for (const user of usersNeedingSetup) {
      try {
        // Use existing token - don't generate new one!
        const setupToken = user.setupToken;
        
        console.log(`[User Setup Emails] Using existing token for: ${user.email}`);
        
        // Send setup email via onboard emails API
        await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/onboard/emails`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: user.email,
            firstName: user.firstName || user.email.split('@')[0] || 'User',
            businessName: location?.name || 'FieldServ AI',
            setupToken,
            setupUrl: `https://www.leadprospecting.ai/setup-password?token=${setupToken}`,
            template: 'welcome'
          })
        });
        
        // Mark email as sent
        await db.collection('users').updateOne(
          { _id: user._id },
          {
            $set: {
              setupEmailSent: true,
              setupEmailSentAt: new Date(),
              updatedAt: new Date()
            }
          }
        );
        
        emailsSent++;
        console.log(`[User Setup Emails] Setup email sent to: ${user.email}`);
        
      } catch (userError) {
        console.error(`[User Setup Emails] Failed to process user ${user.email}:`, userError);
      }
    }
    
    console.log(`[User Setup Emails] Completed - ${emailsSent}/${usersNeedingSetup.length} emails sent`);
    
  } catch (error) {
    console.error('[User Setup Emails] Error:', error);
    // Don't throw - installation should complete even if emails fail
  }
}