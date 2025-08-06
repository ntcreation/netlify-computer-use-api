# Netlify Computer Use Testing API

A Netlify Functions API that uses Claude's computer use tool to test features on app.giftround.com with natural language instructions.

## Features

- Natural language website testing instructions
- Automated browser interaction via Claude's computer use tool
- Screenshot capture at each step
- Docker containerized browser environment
- Rate limiting and timeout protection
- Comprehensive error handling and logging

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set environment variables:**
   ```bash
   export ANTHROPIC_API_KEY="your-claude-api-key"
   export WEBSITE_URL="app.giftround.com"  # optional
   export MAX_TEST_DURATION="300"  # optional
   ```

3. **Development:**
   ```bash
   npm run dev
   ```

4. **Deploy to Netlify:**
   - Connect your repository to Netlify
   - Set environment variables in Netlify dashboard
   - Deploy

## API Usage

### Endpoint: POST `/api/test-website`

**Request:**
```json
{
  "instruction": "set up a giftround for the marketing team",
  "options": {
    "timeout": 300,
    "takeScreenshots": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully completed: set up a giftround for the marketing team",
  "duration": 45.2,
  "screenshots": [
    {
      "step": "Initial page load",
      "timestamp": "2025-01-07T10:30:00Z",
      "image_base64": "data:image/png;base64,..."
    }
  ],
  "log": "Detailed step-by-step log of actions taken",
  "error": null
}
```

## Example Instructions

- "set up a giftround for the engineering team"
- "create a new user account and verify email confirmation works"
- "test the payment flow with a sample purchase"
- "check that the mobile menu works correctly"
- "take a screenshot of the homepage"

## Configuration

Environment variables:
- `ANTHROPIC_API_KEY` - Required: Your Claude API key
- `WEBSITE_URL` - Optional: Target website (defaults to app.giftround.com)
- `MAX_TEST_DURATION` - Optional: Max test duration in seconds (defaults to 300)
- `DOCKER_HOST` - Optional: Docker daemon host for containerized environments

## Security

- Domain restriction: Only allows testing on app.giftround.com
- Rate limiting: Maximum 1 concurrent test
- Timeout protection: Hard timeout at 5 minutes
- Request validation and sanitization

## Development

The API is structured as follows:
- `netlify/functions/test-website.js` - Main API endpoint
- `netlify/functions/lib/computer-use.js` - Computer use tool implementation
- `netlify/functions/lib/docker-manager.js` - Docker container management
- `netlify/functions/lib/screenshot-utils.js` - Screenshot utilities