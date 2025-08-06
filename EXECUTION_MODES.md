# Execution Modes

This API supports two execution modes for browser automation:

## 🚀 Puppeteer Mode (Default - Netlify Ready)

**Best for**: Production deployment on Netlify Functions

### Features
- ✅ **No Docker required** - works on standard serverless environments
- ✅ **Netlify Functions compatible**
- ✅ **Screenshot capture**
- ✅ **Click, type, scroll interactions**
- ✅ **Faster startup time**
- ✅ **Lower resource usage**

### Limitations
- Limited to basic browser interactions (click, type, key, scroll)
- No system-level interactions
- Cannot access desktop applications

### Configuration
```bash
# Default mode - no configuration needed
# Or explicitly set:
USE_DOCKER=false
```

## 🐳 Docker Mode (Full Computer Use)

**Best for**: Self-hosted or Docker-enabled platforms

### Features  
- ✅ **Full computer use capabilities**
- ✅ **System-level interactions**
- ✅ **Complete Claude computer use tool support**
- ✅ **Virtual display (Xvfb)**
- ✅ **Advanced screenshot tools**

### Requirements
- Docker daemon available
- More system resources
- Docker-enabled hosting platform

### Configuration
```bash
USE_DOCKER=true
DOCKER_AVAILABLE=true
```

## Mode Comparison

| Feature | Puppeteer Mode | Docker Mode |
|---------|----------------|-------------|
| **Netlify Compatible** | ✅ Yes | ❌ No |
| **Setup Complexity** | 🟢 Simple | 🟡 Complex |
| **Resource Usage** | 🟢 Low | 🟡 High |
| **Startup Time** | 🟢 Fast | 🟡 Slow |
| **Browser Control** | ✅ Full | ✅ Full |
| **System Access** | ❌ Limited | ✅ Full |
| **Screenshot Quality** | ✅ High | ✅ High |
| **Claude Integration** | ✅ Computer Use | ✅ Computer Use |

## Automatic Mode Selection

The API automatically selects the execution mode:

```javascript
// Puppeteer mode (default)
const useDocker = false;

// Docker mode (when explicitly enabled)
const useDocker = process.env.USE_DOCKER === 'true' || 
                  process.env.DOCKER_AVAILABLE === 'true';
```

## Platform Recommendations

### ✅ Netlify Functions
- **Mode**: Puppeteer (automatic)
- **Setup**: Just deploy - no additional configuration
- **Performance**: Excellent for web testing

### ✅ Railway
- **Mode**: Docker or Puppeteer
- **Setup**: Docker mode works out of the box
- **Performance**: Full computer use capabilities

### ✅ Google Cloud Run
- **Mode**: Docker (recommended)
- **Setup**: Deploy as container image
- **Performance**: Best for complex interactions

### ✅ Render
- **Mode**: Docker or Puppeteer  
- **Setup**: Both modes supported
- **Performance**: Good for both use cases

## Testing Both Modes

```bash
# Test Puppeteer mode
npm test

# Test Docker mode (requires Docker)
USE_DOCKER=true npm test
```

## Migration Guide

### From Docker to Puppeteer
1. Remove Docker-specific environment variables
2. Deploy to standard Netlify Functions
3. Test basic interactions work as expected

### From Puppeteer to Docker
1. Set `USE_DOCKER=true`
2. Deploy to Docker-enabled platform
3. Benefit from full computer use capabilities

## Troubleshooting

### Puppeteer Mode Issues
- **Browser fails to launch**: Check Puppeteer installation
- **Screenshots fail**: Verify display dimensions
- **Clicks miss targets**: Check coordinate system

### Docker Mode Issues  
- **Container fails**: Check Docker daemon availability
- **Display issues**: Verify Xvfb configuration
- **Resource limits**: Increase container memory/CPU

## Performance Tips

### Puppeteer Mode
- Use smaller viewport sizes for faster screenshots
- Minimize wait times between actions
- Enable screenshot compression

### Docker Mode
- Pre-build container images when possible
- Use container registries for faster pulls
- Configure resource limits appropriately

Both modes provide excellent Claude computer use integration while catering to different deployment environments and use cases.