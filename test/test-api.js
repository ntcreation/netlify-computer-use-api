/**
 * Simple test script for the API
 * Run with: node test/test-api.js
 */

const fs = require('fs');
const path = require('path');

// Mock environment for testing
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
process.env.WEBSITE_URL = process.env.WEBSITE_URL || 'app.giftround.com';

// Mock Netlify event and context
function createMockEvent(body, options = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': options.clientIP || '127.0.0.1'
    },
    body: JSON.stringify(body),
    requestContext: {
      identity: {
        sourceIp: options.clientIP || '127.0.0.1'
      }
    }
  };
}

function createMockContext() {
  return {
    callbackWaitsForEmptyEventLoop: false
  };
}

async function runTests() {
  console.log('🧪 Starting API Tests\n');

  try {
    // Import the handler
    const { handler } = require('../netlify/functions/test-website');

    // Test 1: Valid request
    console.log('Test 1: Valid request validation');
    const validEvent = createMockEvent({
      instruction: 'take a screenshot of the homepage',
      options: {
        timeout: 60,
        takeScreenshots: true
      }
    });

    const validResponse = await handler(validEvent, createMockContext());
    console.log('✅ Valid request response status:', validResponse.statusCode);
    
    if (validResponse.statusCode !== 200 && validResponse.statusCode !== 503) {
      console.log('Response body:', JSON.parse(validResponse.body));
    }

    // Test 2: Invalid request (missing instruction)
    console.log('\nTest 2: Invalid request handling');
    const invalidEvent = createMockEvent({
      options: { timeout: 60 }
    });

    const invalidResponse = await handler(invalidEvent, createMockContext());
    console.log('✅ Invalid request response status:', invalidResponse.statusCode);
    console.log('Response:', JSON.parse(invalidResponse.body).error);

    // Test 3: OPTIONS request (CORS)
    console.log('\nTest 3: CORS OPTIONS request');
    const optionsEvent = {
      httpMethod: 'OPTIONS',
      headers: {}
    };

    const optionsResponse = await handler(optionsEvent, createMockContext());
    console.log('✅ OPTIONS response status:', optionsResponse.statusCode);

    // Test 4: Rate limiting
    console.log('\nTest 4: Rate limiting (multiple requests)');
    const rateLimitEvent = createMockEvent({
      instruction: 'test rate limiting'
    }, { clientIP: '192.168.1.100' });

    for (let i = 1; i <= 3; i++) {
      const response = await handler(rateLimitEvent, createMockContext());
      console.log(`Request ${i} status:`, response.statusCode);
      
      if (response.statusCode === 429) {
        console.log('✅ Rate limiting working correctly');
        break;
      }
    }

    console.log('\n🎉 All tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Test utility functions
async function testErrorHandling() {
  console.log('\n🛠️ Testing Error Handler');
  
  const ErrorHandler = require('../netlify/functions/lib/error-handler');
  
  // Test error categorization
  const dockerError = new Error('Docker container failed to start');
  const timeoutError = new Error('Test execution timed out after 300 seconds');
  const validationError = new Error('Invalid instruction provided');
  
  console.log('Docker error category:', ErrorHandler.handleError(dockerError).category);
  console.log('Timeout error category:', ErrorHandler.handleError(timeoutError).category);
  console.log('Validation error category:', ErrorHandler.handleError(validationError).category);
  
  // Test request validation
  const validationTests = [
    { body: null, shouldPass: false },
    { body: {}, shouldPass: false },
    { body: { instruction: '' }, shouldPass: false },
    { body: { instruction: 'valid instruction' }, shouldPass: true },
    { body: { instruction: 'valid', options: { timeout: 'invalid' } }, shouldPass: false },
    { body: { instruction: 'valid', options: { timeout: 120 } }, shouldPass: true }
  ];
  
  for (const test of validationTests) {
    const result = ErrorHandler.validateRequest(test.body);
    const passed = result.valid === test.shouldPass;
    console.log(`Validation test ${passed ? '✅' : '❌'}:`, test.body, '-> valid:', result.valid);
    if (!result.valid && result.errors.length > 0) {
      console.log('  Errors:', result.errors);
    }
  }
}

async function testRateLimiter() {
  console.log('\n🚦 Testing Rate Limiter');
  
  const rateLimiter = require('../netlify/functions/lib/rate-limiter');
  
  const testIP = '192.168.1.200';
  
  // Test rate limiting
  console.log('Rate limiter status:', rateLimiter.getStatus());
  
  for (let i = 1; i <= 12; i++) {
    const result = rateLimiter.isRequestAllowed(testIP);
    console.log(`Request ${i}: allowed=${result.allowed}, remaining=${result.remaining}`);
    
    if (result.allowed) {
      rateLimiter.recordRequest(testIP);
    } else {
      console.log(`✅ Rate limit triggered at request ${i}`);
      break;
    }
  }
  
  // Test concurrent test limiting
  rateLimiter.registerTest('test-1');
  rateLimiter.registerTest('test-2');
  
  const concurrentResult = rateLimiter.isRequestAllowed('192.168.1.201');
  console.log('Concurrent test limit result:', concurrentResult);
  
  rateLimiter.unregisterTest('test-1');
  rateLimiter.unregisterTest('test-2');
}

// Run all tests
async function main() {
  await runTests();
  await testErrorHandling();
  await testRateLimiter();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  runTests,
  testErrorHandling,
  testRateLimiter,
  createMockEvent,
  createMockContext
};