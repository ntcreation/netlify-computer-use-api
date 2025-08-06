/**
 * Simple in-memory rate limiter for API requests
 * In production, you'd want to use Redis or a similar persistent store
 */
class RateLimiter {
  constructor() {
    this.requests = new Map(); // IP -> { count, resetTime, blocked }
    this.tests = new Set(); // Active test IDs for concurrency limiting
    
    // Rate limiting configuration
    this.config = {
      maxRequestsPerHour: parseInt(process.env.MAX_REQUESTS_PER_HOUR) || 10,
      maxConcurrentTests: parseInt(process.env.MAX_CONCURRENT_TESTS) || 1,
      blockDurationMinutes: parseInt(process.env.BLOCK_DURATION_MINUTES) || 60,
      windowSizeHours: 1
    };

    // Cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Check if request is allowed for given IP
   */
  isRequestAllowed(clientIP) {
    const now = Date.now();
    const hourInMs = 60 * 60 * 1000;
    
    // Get or create request tracking for this IP
    if (!this.requests.has(clientIP)) {
      this.requests.set(clientIP, {
        count: 0,
        resetTime: now + hourInMs,
        blocked: false,
        blockUntil: 0
      });
    }

    const requestData = this.requests.get(clientIP);

    // Check if IP is currently blocked
    if (requestData.blocked && now < requestData.blockUntil) {
      return {
        allowed: false,
        reason: 'IP temporarily blocked',
        retryAfter: Math.ceil((requestData.blockUntil - now) / 1000),
        remaining: 0,
        resetTime: requestData.resetTime
      };
    }

    // Reset counter if window has expired
    if (now > requestData.resetTime) {
      requestData.count = 0;
      requestData.resetTime = now + hourInMs;
      requestData.blocked = false;
      requestData.blockUntil = 0;
    }

    // Check rate limit
    if (requestData.count >= this.config.maxRequestsPerHour) {
      // Block IP for configured duration
      requestData.blocked = true;
      requestData.blockUntil = now + (this.config.blockDurationMinutes * 60 * 1000);
      
      return {
        allowed: false,
        reason: 'Rate limit exceeded',
        retryAfter: this.config.blockDurationMinutes * 60,
        remaining: 0,
        resetTime: requestData.resetTime
      };
    }

    // Check concurrent tests limit
    if (this.tests.size >= this.config.maxConcurrentTests) {
      return {
        allowed: false,
        reason: 'Too many concurrent tests',
        retryAfter: 60, // Suggest trying again in 1 minute
        remaining: this.config.maxRequestsPerHour - requestData.count,
        resetTime: requestData.resetTime,
        concurrentTests: this.tests.size
      };
    }

    return {
      allowed: true,
      remaining: this.config.maxRequestsPerHour - requestData.count - 1,
      resetTime: requestData.resetTime,
      concurrentTests: this.tests.size
    };
  }

  /**
   * Record a request for the given IP
   */
  recordRequest(clientIP) {
    if (this.requests.has(clientIP)) {
      const requestData = this.requests.get(clientIP);
      requestData.count++;
    }
  }

  /**
   * Register a new test
   */
  registerTest(testId) {
    this.tests.add(testId);
    console.log(`Rate limiter: Test ${testId} registered. Active tests: ${this.tests.size}`);
  }

  /**
   * Unregister a test
   */
  unregisterTest(testId) {
    this.tests.delete(testId);
    console.log(`Rate limiter: Test ${testId} unregistered. Active tests: ${this.tests.size}`);
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      activeConcurrentTests: this.tests.size,
      maxConcurrentTests: this.config.maxConcurrentTests,
      trackedIPs: this.requests.size,
      config: this.config
    };
  }

  /**
   * Get rate limit info for specific IP
   */
  getRateLimitInfo(clientIP) {
    const requestData = this.requests.get(clientIP);
    if (!requestData) {
      return {
        requests: 0,
        remaining: this.config.maxRequestsPerHour,
        resetTime: Date.now() + (60 * 60 * 1000),
        blocked: false
      };
    }

    const now = Date.now();
    
    return {
      requests: requestData.count,
      remaining: Math.max(0, this.config.maxRequestsPerHour - requestData.count),
      resetTime: requestData.resetTime,
      blocked: requestData.blocked && now < requestData.blockUntil,
      blockUntil: requestData.blocked ? requestData.blockUntil : null
    };
  }

  /**
   * Clear rate limit for specific IP (admin function)
   */
  clearRateLimit(clientIP) {
    if (this.requests.has(clientIP)) {
      this.requests.delete(clientIP);
      return true;
    }
    return false;
  }

  /**
   * Get client IP from Netlify event
   */
  static getClientIP(event) {
    // Netlify provides client IP in headers
    return event.headers['x-forwarded-for'] || 
           event.headers['x-real-ip'] || 
           event.headers['client-ip'] ||
           event.requestContext?.identity?.sourceIp ||
           'unknown';
  }

  /**
   * Start cleanup interval to remove old entries
   */
  startCleanupInterval() {
    // Clean up old entries every 30 minutes
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [ip, data] of this.requests.entries()) {
        // Remove entries that are past their reset time and not blocked
        if (now > data.resetTime && (!data.blocked || now > data.blockUntil)) {
          this.requests.delete(ip);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`Rate limiter: Cleaned up ${cleaned} old entries`);
      }
    }, 30 * 60 * 1000); // 30 minutes
  }

  /**
   * Generate rate limit headers for response
   */
  getRateLimitHeaders(clientIP) {
    const info = this.getRateLimitInfo(clientIP);
    
    return {
      'X-RateLimit-Limit': this.config.maxRequestsPerHour.toString(),
      'X-RateLimit-Remaining': info.remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(info.resetTime / 1000).toString(),
      'X-RateLimit-Window': `${this.config.windowSizeHours}h`
    };
  }
}

// Create singleton instance
const rateLimiter = new RateLimiter();

module.exports = rateLimiter;