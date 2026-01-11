// test-radar-integration.js
// Comprehensive test script to verify Radar integration and test geocoding for "510 E baseline Rd"

const fetch = require('node-fetch');

// Test configuration
const TEST_ADDRESS = '510 E baseline Rd';
const TEST_ORIGIN = { latitude: 39.7392, longitude: -104.9903 }; // Denver
const TEST_DESTINATION = { latitude: 33.4152, longitude: -111.8315 }; // Example coordinates

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️ ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️ ${message}`, 'blue');
}

function logTest(message) {
  log(`🧪 ${message}`, 'cyan');
}

// Test 1: Check environment variables
async function testEnvironmentVariables() {
  logTest('Testing Environment Variables');
  
  const secretKey = process.env.RADAR_SECRET_KEY;
  
  if (!secretKey) {
    logError('RADAR_SECRET_KEY not found in environment variables');
    logInfo('💡 Add RADAR_SECRET_KEY to your Vercel environment variables');
    logInfo('   Go to Vercel Dashboard > Your Project > Settings > Environment Variables');
    logInfo('   Add: RADAR_SECRET_KEY = your_radar_secret_key_here');
    return false;
  }
  
  logSuccess('RADAR_SECRET_KEY found in environment variables');
  logInfo(`Key starts with: ${secretKey.substring(0, 10)}...`);
  return true;
}

// Test 2: Test Radar geocoding API directly
async function testRadarGeocoding() {
  logTest(`Testing Radar Geocoding for "${TEST_ADDRESS}"`);
  
  const secretKey = process.env.RADAR_SECRET_KEY;
  
  if (!secretKey) {
    logError('Cannot test geocoding without RADAR_SECRET_KEY');
    return false;
  }

  try {
    const url = `https://api.radar.io/v1/geocode/forward?query=${encodeURIComponent(TEST_ADDRESS)}`;
    
    logInfo(`📍 Testing geocoding for: "${TEST_ADDRESS}"`);
    logInfo(`🔗 URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': secretKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError(`Geocoding failed: ${response.status} ${response.statusText}`);
      logError(`Error details: ${errorText}`);
      return false;
    }

    const data = await response.json();
    
    if (data.addresses && data.addresses.length > 0) {
      const result = data.addresses[0];
      logSuccess('Geocoding successful!');
      logInfo('📍 Results:');
      logInfo(`   Latitude: ${result.latitude}`);
      logInfo(`   Longitude: ${result.longitude}`);
      logInfo(`   Formatted Address: ${result.formattedAddress}`);
      logInfo(`   Confidence: ${result.confidence}`);
      logInfo(`   City: ${result.city || 'N/A'}`);
      logInfo(`   State: ${result.state || 'N/A'}`);
      logInfo(`   Postal Code: ${result.postalCode || 'N/A'}`);
      return true;
    } else {
      logWarning('No addresses found for this query');
      return false;
    }
    
  } catch (error) {
    logError(`Error testing geocoding: ${error.message}`);
    return false;
  }
}

// Test 3: Test route calculation
async function testRouteCalculation() {
  logTest('Testing Radar Route Calculation');
  
  const secretKey = process.env.RADAR_SECRET_KEY;
  
  if (!secretKey) {
    logError('Cannot test route calculation without RADAR_SECRET_KEY');
    return false;
  }

  try {
    const url = `https://api.radar.io/v1/route/distance?` +
      `origin=${TEST_ORIGIN.latitude},${TEST_ORIGIN.longitude}` +
      `&destination=${TEST_DESTINATION.latitude},${TEST_DESTINATION.longitude}` +
      `&modes=car&units=imperial`;
    
    logInfo(`🚗 Testing route from Denver to destination`);
    logInfo(`🔗 URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': secretKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError(`Route calculation failed: ${response.status} ${response.statusText}`);
      logError(`Error details: ${errorText}`);
      return false;
    }

    const data = await response.json();
    
    if (data.routes && data.routes.car) {
      const route = data.routes.car;
      logSuccess('Route calculation successful!');
      logInfo('🚗 Results:');
      logInfo(`   Distance: ${route.distance.text}`);
      logInfo(`   Duration: ${route.duration.text}`);
      logInfo(`   Duration (minutes): ${Math.ceil(route.duration.value / 60)}`);
      return true;
    } else {
      logWarning('No route found');
      return false;
    }
    
  } catch (error) {
    logError(`Error testing route calculation: ${error.message}`);
    return false;
  }
}

// Test 4: Test backend service (if running locally)
async function testBackendService() {
  logTest('Testing Backend Radar Service');
  
  try {
    // Test the geocode endpoint
    const response = await fetch('http://localhost:3000/api/radar/geocode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Note: You'll need to add proper authentication here
        'Authorization': 'Bearer YOUR_JWT_TOKEN'
      },
      body: JSON.stringify({
        address: TEST_ADDRESS
      })
    });

    if (!response.ok) {
      logWarning(`Backend geocode failed: ${response.status} ${response.statusText}`);
      logInfo('This is expected if the backend is not running or authentication is missing');
      return false;
    }

    const data = await response.json();
    logSuccess('Backend geocode successful!');
    logInfo('📄 Response:');
    console.log(JSON.stringify(data, null, 2));
    return true;
    
  } catch (error) {
    logWarning(`Error testing backend service: ${error.message}`);
    logInfo('This is expected if the backend is not running locally');
    return false;
  }
}

// Test 5: Test frontend configuration
async function testFrontendConfiguration() {
  logTest('Testing Frontend Configuration');
  
  try {
    // Check if the config file exists and has the right key
    const config = require('../src/config/index.js');
    
    if (!config.RADAR_PUBLISHABLE_KEY) {
      logError('RADAR_PUBLISHABLE_KEY not found in frontend config');
      return false;
    }
    
    logSuccess('RADAR_PUBLISHABLE_KEY found in frontend config');
    logInfo(`Key starts with: ${config.RADAR_PUBLISHABLE_KEY.substring(0, 10)}...`);
    
    // Check if the key format looks correct
    if (config.RADAR_PUBLISHABLE_KEY.startsWith('prj_live_pk_')) {
      logSuccess('Publishable key format looks correct');
    } else {
      logWarning('Publishable key format may be incorrect (should start with prj_live_pk_)');
    }
    
    return true;
    
  } catch (error) {
    logError(`Error checking frontend config: ${error.message}`);
    return false;
  }
}

// Test 6: Test DepartureWidget integration
async function testDepartureWidgetIntegration() {
  logTest('Testing DepartureWidget Integration');
  
  try {
    // Check if the DepartureWidget file exists and has the right imports
    const fs = require('fs');
    const path = require('path');
    
    const widgetPath = path.join(__dirname, '../src/components/dashboard/DepartureWidget.tsx');
    
    if (!fs.existsSync(widgetPath)) {
      logError('DepartureWidget.tsx not found');
      return false;
    }
    
    const widgetContent = fs.readFileSync(widgetPath, 'utf8');
    
    // Check for required imports
    const hasConfigImport = widgetContent.includes("import Config from '../../config'");
    const hasRadarImport = widgetContent.includes("require('react-native-radar')");
    const hasRadarInitialize = widgetContent.includes("Radar.initialize(Config.RADAR_PUBLISHABLE_KEY)");
    
    if (!hasConfigImport) {
      logError('Config import missing in DepartureWidget');
      return false;
    }
    
    if (!hasRadarImport) {
      logError('Radar import missing in DepartureWidget');
      return false;
    }
    
    if (!hasRadarInitialize) {
      logError('Radar initialization with Config key missing in DepartureWidget');
      return false;
    }
    
    logSuccess('DepartureWidget integration looks correct');
    return true;
    
  } catch (error) {
    logError(`Error checking DepartureWidget: ${error.message}`);
    return false;
  }
}

// Main test function
async function runAllTests() {
  log('🚀 Starting Comprehensive Radar Integration Tests', 'bright');
  log('=' * 60, 'bright');
  
  const results = {
    environment: false,
    geocoding: false,
    routing: false,
    backend: false,
    frontend: false,
    widget: false
  };
  
  // Run all tests
  results.environment = await testEnvironmentVariables();
  
  if (results.environment) {
    results.geocoding = await testRadarGeocoding();
    results.routing = await testRouteCalculation();
  }
  
  results.backend = await testBackendService();
  results.frontend = await testFrontendConfiguration();
  results.widget = await testDepartureWidgetIntegration();
  
  // Summary
  log('\n📊 Test Results Summary', 'bright');
  log('=' * 30, 'bright');
  
  Object.entries(results).forEach(([test, passed]) => {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    const color = passed ? 'green' : 'red';
    log(`${status} ${test}`, color);
  });
  
  const passedTests = Object.values(results).filter(Boolean).length;
  const totalTests = Object.keys(results).length;
  
  log(`\n🎯 Overall: ${passedTests}/${totalTests} tests passed`, passedTests === totalTests ? 'green' : 'yellow');
  
  // Recommendations
  log('\n💡 Recommendations:', 'bright');
  
  if (!results.environment) {
    log('1. Add RADAR_SECRET_KEY to your Vercel environment variables', 'yellow');
  }
  
  if (!results.geocoding) {
    log('2. Check your Radar API key and account status', 'yellow');
  }
  
  if (!results.backend) {
    log('3. Start the backend server locally to test API endpoints', 'yellow');
  }
  
  if (!results.widget) {
    log('4. Fix the DepartureWidget integration issues', 'yellow');
  }
  
  if (passedTests === totalTests) {
    log('🎉 All tests passed! Your Radar integration is working correctly.', 'green');
  }
  
  log('\n✅ Tests completed!', 'bright');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testEnvironmentVariables,
  testRadarGeocoding,
  testRouteCalculation,
  testBackendService,
  testFrontendConfiguration,
  testDepartureWidgetIntegration,
  runAllTests
}; 