# Deployment Guide

## 🚀 Deploying to Netlify

### Prerequisites

1. **Netlify Account**: Sign up at [netlify.com](https://netlify.com)
2. **Claude API Key**: Get your API key from [console.anthropic.com](https://console.anthropic.com)
3. **Docker Support**: Ensure your deployment environment supports Docker

### Step 1: Prepare Repository

1. **Clone/Fork this repository**
2. **Set up environment variables** (see step 3 below)
3. **Push to GitHub/GitLab** (Netlify will connect to your repository)

### Step 2: Connect to Netlify

1. **Log into Netlify Dashboard**
2. **Click "New site from Git"**
3. **Connect your repository**
4. **Configure build settings:**
   - Build command: `echo "No build required"`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`

### Step 3: Environment Variables

In your Netlify site settings → Environment variables, add:

| Variable | Value | Required |
|----------|-------|----------|
| `ANTHROPIC_API_KEY` | Your Claude API key | ✅ Yes |
| `WEBSITE_URL` | `app.giftround.com` | Optional |
| `MAX_TEST_DURATION` | `300` | Optional |
| `MAX_REQUESTS_PER_HOUR` | `10` | Optional |
| `MAX_CONCURRENT_TESTS` | `1` | Optional |
| `NODE_ENV` | `production` | Recommended |

### Step 4: Docker Configuration

**Important**: This API requires Docker to run browser automation. Standard Netlify Functions don't support Docker containers.

#### Option A: Netlify Edge Functions (Experimental)

For production use, you'll need to modify the implementation to use:
- Puppeteer with Chrome bundled for serverless
- Remote browser services like Browserless.io
- Or deploy to a Docker-enabled platform

#### Option B: Alternative Platforms

Consider deploying to platforms with Docker support:
- **Railway**: Full Docker support
- **Render**: Docker container support
- **Vercel**: Limited Docker support
- **Google Cloud Run**: Full container support
- **AWS Lambda**: With container image support

### Step 5: Testing Deployment

1. **Deploy the site**
2. **Visit your Netlify URL**
3. **Test with the web interface**
4. **Check function logs** in Netlify dashboard

## 🐳 Docker-Enabled Alternative Deployment

### Railway Deployment

1. **Connect to Railway**: [railway.app](https://railway.app)
2. **Create new project** from GitHub
3. **Add environment variables**
4. **Deploy automatically**

Railway handles Docker containers natively, making it ideal for this use case.

### Google Cloud Run

1. **Create Dockerfile**:
```dockerfile
FROM node:18
RUN apt-get update && apt-get install -y \
    xvfb x11vnc xdotool scrot \
    google-chrome-stable
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
CMD ["npm", "start"]
```

2. **Deploy to Cloud Run**
3. **Set environment variables**

## 🔧 Local Development

### With Docker

1. **Install Docker**
2. **Set environment variables**:
```bash
export ANTHROPIC_API_KEY="your-key"
export DOCKER_AVAILABLE="true"
```

3. **Run development server**:
```bash
npm run dev
```

### Without Docker (Testing Only)

The API will return a 503 error when Docker isn't available, but you can test other functionality:

```bash
npm run dev
```

## 📊 Monitoring

### Netlify Function Logs

- View function execution logs in Netlify dashboard
- Monitor error rates and performance
- Set up alerting for failures

### Rate Limiting

- API tracks requests per IP address
- Default: 10 requests per hour per IP
- Configure via `MAX_REQUESTS_PER_HOUR` environment variable

### Error Handling

The API includes comprehensive error categorization:
- Docker errors → 503 Service Unavailable
- Rate limit errors → 429 Too Many Requests  
- Validation errors → 400 Bad Request
- Timeout errors → 408 Request Timeout

## 🛡️ Security

- API only allows testing on `app.giftround.com`
- Rate limiting prevents abuse
- Input validation and sanitization
- No sensitive data logging

## 💡 Production Recommendations

1. **Use a Docker-enabled platform** (Railway, Cloud Run, etc.)
2. **Set up monitoring** and alerting
3. **Configure rate limits** appropriately
4. **Enable HTTPS** (automatic with Netlify)
5. **Set up log aggregation** for debugging
6. **Consider authentication** for production use

## 🐛 Troubleshooting

### Common Issues

1. **Docker not available**: Deploy to Docker-enabled platform
2. **Rate limiting**: Check IP-based limits
3. **API key issues**: Verify Claude API key is set correctly
4. **Timeout errors**: Increase `MAX_TEST_DURATION` if needed
5. **Website access**: Ensure target website is accessible

### Debug Mode

Set `NODE_ENV=development` to enable debug information in error responses.

### Logs

Check function logs in your deployment platform for detailed error information.