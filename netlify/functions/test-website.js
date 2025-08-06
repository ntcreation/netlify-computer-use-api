const { v4: uuidv4 } = require('uuid');
const ComputerUse = require('./lib/computer-use');
const PuppeteerComputerUse = require('./lib/puppeteer-computer-use');
const DockerManager = require('./lib/docker-manager');

// In-memory queue for rate limiting (single concurrent test)
let activeTests = new Set();
let testQueue = [];

// Configuration
const CONFIG = {
  MAX_CONCURRENT_TESTS: 1,
  MAX_TEST_DURATION: parseInt(process.env.MAX_TEST_DURATION) || 300, // 5 minutes
  WEBSITE_URL: process.env.WEBSITE_URL || 'app.giftround.com',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
};

// Validate required environment variables
if (!CONFIG.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required but not set');
}

/**
 * Main Netlify function handler
 */
exports.handler = async (event, context) => {
  // Set function timeout to near Netlify's limit
  context.callbackWaitsForEmptyEventLoop = false;

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed. Use POST.'
      })
    };
  }

  // Validate API key
  if (!CONFIG.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Server configuration error: Missing API key'
      })
    };
  }

  // Determine execution mode: Docker (full computer use) or Puppeteer (serverless)
  const useDocker = process.env.USE_DOCKER === 'true' || process.env.DOCKER_AVAILABLE === 'true';
  const executionMode = useDocker ? 'docker' : 'puppeteer';
  
  console.log(`Using execution mode: ${executionMode}`);

  let testId;
  try {
    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { instruction, options = {} } = body;

    // Validate request
    if (!instruction || typeof instruction !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing or invalid instruction. Please provide a string instruction.'
        })
      };
    }

    // Check rate limiting
    if (activeTests.size >= CONFIG.MAX_CONCURRENT_TESTS) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Too many concurrent tests. Please try again later.',
          retryAfter: 60
        })
      };
    }

    // Generate unique test ID
    testId = uuidv4();
    activeTests.add(testId);

    console.log(`[${testId}] Starting test with instruction: "${instruction}"`);

    // Merge options with defaults
    const testOptions = {
      timeout: Math.min(options.timeout || CONFIG.MAX_TEST_DURATION, CONFIG.MAX_TEST_DURATION),
      takeScreenshots: options.takeScreenshots !== false,
      websiteUrl: CONFIG.WEBSITE_URL,
      ...options
    };

    // Start the test with timeout
    const testResult = await Promise.race([
      runTest(testId, instruction, testOptions, executionMode),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Test timeout')), testOptions.timeout * 1000)
      )
    ]);

    console.log(`[${testId}] Test completed successfully`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(testResult)
    };

  } catch (error) {
    console.error(`[${testId}] Test failed:`, error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        testId,
        timestamp: new Date().toISOString()
      })
    };

  } finally {
    // Always clean up
    if (testId) {
      activeTests.delete(testId);
      console.log(`[${testId}] Test cleanup completed`);
    }
  }
};

/**
 * Run a single test
 */
async function runTest(testId, instruction, options, executionMode = 'puppeteer') {
  const startTime = Date.now();
  let dockerManager = null;
  let computerUse = null;

  try {
    if (executionMode === 'docker') {
      console.log(`[${testId}] Initializing Docker container`);
      
      // Initialize Docker container
      dockerManager = new DockerManager(testId);
      await dockerManager.initialize();

      console.log(`[${testId}] Initializing Computer Use tool (Docker mode)`);
      
      // Initialize Computer Use with Docker
      computerUse = new ComputerUse({
        apiKey: CONFIG.ANTHROPIC_API_KEY,
        dockerManager,
        testId,
        options
      });
    } else {
      console.log(`[${testId}] Initializing Computer Use tool (Puppeteer mode)`);
      
      // Initialize Puppeteer Computer Use
      computerUse = new PuppeteerComputerUse({
        apiKey: CONFIG.ANTHROPIC_API_KEY,
        testId,
        options
      });
    }

    console.log(`[${testId}] Executing instruction: "${instruction}"`);

    // Execute the test instruction
    const result = await computerUse.execute(instruction);

    const duration = (Date.now() - startTime) / 1000;

    return {
      success: true,
      message: `Successfully completed: ${instruction}`,
      duration,
      screenshots: result.screenshots || [],
      log: result.log || '',
      error: null,
      testId,
      executionMode,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    
    // Try to capture error screenshot
    let errorScreenshot = null;
    if (computerUse && computerUse.captureScreenshot) {
      try {
        errorScreenshot = await computerUse.captureScreenshot('Error state');
      } catch (screenshotError) {
        console.log(`[${testId}] Could not capture error screenshot:`, screenshotError.message);
      }
    }

    throw {
      message: error.message,
      duration,
      screenshots: errorScreenshot ? [errorScreenshot] : [],
      testId,
      executionMode
    };

  } finally {
    // Cleanup resources
    if (executionMode === 'docker' && dockerManager) {
      try {
        await dockerManager.cleanup();
        console.log(`[${testId}] Docker cleanup completed`);
      } catch (cleanupError) {
        console.error(`[${testId}] Docker cleanup failed:`, cleanupError);
      }
    }
    // Puppeteer cleanup is handled within the PuppeteerComputerUse class
  }
}

// Graceful cleanup on process termination
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, cleaning up active tests...');
  // In a real implementation, you'd want to gracefully stop active tests
  process.exit(0);
});