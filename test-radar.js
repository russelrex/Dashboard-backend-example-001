// test-radar.js
// Test script to verify Radar integration and geocoding

const fetch = require('node-fetch');

// Test the Radar geocoding API directly
async function testRadarGeocoding() {
  console.log('🧪 Testing Radar Geocoding for "510 E baseline Rd"');
  
  // You'll need to add your Radar secret key to Vercel environment variables
  const secretKey = process.env.RADAR_SECRET_KEY;
  
  if (!secretKey) {
    console.error('❌ RADAR_SECRET_KEY not found in environment variables');
    console.log('💡 Add RADAR_SECRET_KEY to your Vercel environment variables');
    return;
  }

  try {
    const address = '510 E baseline Rd';
    const url = `https://api.radar.io/v1/geocode/forward?query=${encodeURIComponent(address)}`;
    
    console.log(`📍 Testing geocoding for: "${address}"`);
    console.log(`🔗 URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': secretKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Geocoding failed: ${response.status} ${response.statusText}`);
      console.error(`📄 Error details: ${errorText}`);
      return;
    }

    const data = await response.json();
    
    if (data.addresses && data.addresses.length > 0) {
      const result = data.addresses[0];
      console.log('✅ Geocoding successful!');
      console.log('📍 Results:');
      console.log(`   Latitude: ${result.latitude}`);
      console.log(`   Longitude: ${result.longitude}`);
      console.log(`   Formatted Address: ${result.formattedAddress}`);
      console.log(`   Confidence: ${result.confidence}`);
      console.log(`   City: ${result.city || 'N/A'}`);
      console.log(`   State: ${result.state || 'N/A'}`);
      console.log(`   Postal Code: ${result.postalCode || 'N/A'}`);
    } else {
      console.log('⚠️ No addresses found for this query');
    }
    
  } catch (error) {
    console.error('❌ Error testing geocoding:', error.message);
  }
}

// Test route calculation
async function testRouteCalculation() {
  console.log('\n🧪 Testing Radar Route Calculation');
  
  const secretKey = process.env.RADAR_SECRET_KEY;
  
  if (!secretKey) {
    console.error('❌ RADAR_SECRET_KEY not found');
    return;
  }

  try {
    // Test route from Denver to the geocoded address
    const origin = { latitude: 39.7392, longitude: -104.9903 }; // Denver
    const destination = { latitude: 33.4152, longitude: -111.8315 }; // Example coordinates for "510 E baseline Rd"
    
    const url = `https://api.radar.io/v1/route/distance?` +
      `origin=${origin.latitude},${origin.longitude}` +
      `&destination=${destination.latitude},${destination.longitude}` +
      `&modes=car&units=imperial`;
    
    console.log(`🚗 Testing route from Denver to destination`);
    console.log(`🔗 URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': secretKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Route calculation failed: ${response.status} ${response.statusText}`);
      console.error(`📄 Error details: ${errorText}`);
      return;
    }

    const data = await response.json();
    
    if (data.routes && data.routes.car) {
      const route = data.routes.car;
      console.log('✅ Route calculation successful!');
      console.log('🚗 Results:');
      console.log(`   Distance: ${route.distance.text}`);
      console.log(`   Duration: ${route.duration.text}`);
      console.log(`   Duration (minutes): ${Math.ceil(route.duration.value / 60)}`);
    } else {
      console.log('⚠️ No route found');
    }
    
  } catch (error) {
    console.error('❌ Error testing route calculation:', error.message);
  }
}

// Test the backend service
async function testBackendService() {
  console.log('\n🧪 Testing Backend Radar Service');
  
  try {
    // Test the geocode endpoint
    const response = await fetch('http://localhost:3000/api/radar/geocode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // You'll need to add proper authentication here
        'Authorization': 'Bearer YOUR_JWT_TOKEN'
      },
      body: JSON.stringify({
        address: '510 E baseline Rd'
      })
    });

    if (!response.ok) {
      console.error(`❌ Backend geocode failed: ${response.status} ${response.statusText}`);
      return;
    }

    const data = await response.json();
    console.log('✅ Backend geocode successful!');
    console.log('📄 Response:', JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('❌ Error testing backend service:', error.message);
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting Radar Integration Tests\n');
  
  await testRadarGeocoding();
  await testRouteCalculation();
  await testBackendService();
  
  console.log('\n✅ Tests completed!');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testRadarGeocoding, testRouteCalculation, testBackendService }; 