/**
 * Centralized error handling for the API
 */
class ErrorHandler {
  /**
   * Handle and format errors for API responses
   */
  static handleError(error, testId = null, context = {}) {
    const timestamp = new Date().toISOString();
    
    // Log the full error for debugging
    console.error(`[${testId || 'UNKNOWN'}] Error occurred:`, {
      message: error.message,
      stack: error.stack,
      context,
      timestamp
    });

    // Determine error type and create appropriate response
    const errorResponse = this.categorizeError(error, testId, timestamp);
    
    return errorResponse;
  }

  /**
   * Categorize errors and create appropriate responses
   */
  static categorizeError(error, testId, timestamp) {
    const baseResponse = {
      success: false,
      testId,
      timestamp,
      error: null
    };

    // Docker-related errors
    if (error.message.includes('Docker') || error.message.includes('container')) {
      return {
        ...baseResponse,
        error: 'Container initialization failed. Please try again.',
        category: 'docker_error',
        statusCode: 503,
        retryable: true,
        retryAfter: 60
      };
    }

    // Anthropic API errors
    if (error.message.includes('API key') || error.message.includes('Anthropic')) {
      return {
        ...baseResponse,
        error: 'AI service temporarily unavailable. Please try again later.',
        category: 'ai_service_error',
        statusCode: 503,
        retryable: true,
        retryAfter: 300
      };
    }

    // Rate limiting errors (already handled in main function)
    if (error.message.includes('rate limit') || error.message.includes('Too many')) {
      return {
        ...baseResponse,
        error: error.message,
        category: 'rate_limit_error',
        statusCode: 429,
        retryable: true,
        retryAfter: 3600
      };
    }

    // Timeout errors
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return {
        ...baseResponse,
        error: 'Test execution timed out. Please try with a simpler instruction or increase timeout.',
        category: 'timeout_error',
        statusCode: 408,
        retryable: true,
        retryAfter: 60,
        suggestions: [
          'Try breaking down the instruction into smaller steps',
          'Increase the timeout value in options',
          'Simplify the task description'
        ]
      };
    }

    // Validation errors
    if (error.message.includes('validation') || error.message.includes('invalid')) {
      return {
        ...baseResponse,
        error: error.message,
        category: 'validation_error',
        statusCode: 400,
        retryable: false
      };
    }

    // Network/connectivity errors
    if (error.message.includes('network') || error.message.includes('connection') || 
        error.message.includes('ECONNREFUSED') || error.message.includes('fetch')) {
      return {
        ...baseResponse,
        error: 'Network connectivity issue. Please check your connection and try again.',
        category: 'network_error',
        statusCode: 503,
        retryable: true,
        retryAfter: 120
      };
    }

    // Resource exhaustion
    if (error.message.includes('memory') || error.message.includes('disk') || 
        error.message.includes('resource')) {
      return {
        ...baseResponse,
        error: 'Insufficient system resources. Please try again later.',
        category: 'resource_error',
        statusCode: 503,
        retryable: true,
        retryAfter: 600
      };
    }

    // Website-specific errors
    if (error.message.includes('navigation') || error.message.includes('page load')) {
      return {
        ...baseResponse,
        error: 'Unable to load the target website. Please check if the site is accessible.',
        category: 'website_error',
        statusCode: 502,
        retryable: true,
        retryAfter: 120
      };
    }

    // Screenshot/visual errors
    if (error.message.includes('screenshot') || error.message.includes('display')) {
      return {
        ...baseResponse,
        error: 'Visual system error occurred. Test may have partially completed.',
        category: 'visual_error',
        statusCode: 500,
        retryable: true,
        retryAfter: 60
      };
    }

    // Generic/unknown errors
    return {
      ...baseResponse,
      error: 'An unexpected error occurred. Please try again or contact support.',
      category: 'unknown_error',
      statusCode: 500,
      retryable: true,
      retryAfter: 300,
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    };
  }

  /**
   * Create Netlify function response from error
   */
  static createErrorResponse(error, testId = null, context = {}) {
    const errorInfo = this.handleError(error, testId, context);
    
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // Add retry headers for retryable errors
    if (errorInfo.retryable && errorInfo.retryAfter) {
      headers['Retry-After'] = errorInfo.retryAfter.toString();
    }

    return {
      statusCode: errorInfo.statusCode || 500,
      headers,
      body: JSON.stringify(errorInfo)
    };
  }

  /**
   * Validate request body
   */
  static validateRequest(body) {
    const errors = [];

    if (!body || typeof body !== 'object') {
      errors.push('Request body must be a valid JSON object');
      return { valid: false, errors };
    }

    if (!body.instruction || typeof body.instruction !== 'string') {
      errors.push('Missing or invalid instruction field (must be a non-empty string)');
    } else if (body.instruction.trim().length === 0) {
      errors.push('Instruction cannot be empty');
    } else if (body.instruction.length > 1000) {
      errors.push('Instruction is too long (maximum 1000 characters)');
    }

    if (body.options && typeof body.options !== 'object') {
      errors.push('Options field must be an object');
    }

    if (body.options?.timeout && 
        (!Number.isInteger(body.options.timeout) || body.options.timeout < 10 || body.options.timeout > 600)) {
      errors.push('Timeout must be an integer between 10 and 600 seconds');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Sanitize user input
   */
  static sanitizeInput(input) {
    if (typeof input !== 'string') {
      return input;
    }

    // Remove potentially dangerous characters/sequences
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/javascript:/gi, '') // Remove javascript: URLs
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();
  }

  /**
   * Check if error is retryable
   */
  static isRetryableError(error) {
    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /docker/i,
      /container/i,
      /resource/i,
      /temporarily/i
    ];

    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Get error metrics for monitoring
   */
  static getErrorMetrics(errors = []) {
    const categories = {};
    let totalErrors = 0;
    let retryableErrors = 0;

    for (const error of errors) {
      totalErrors++;
      
      const category = error.category || 'unknown';
      categories[category] = (categories[category] || 0) + 1;
      
      if (error.retryable) {
        retryableErrors++;
      }
    }

    return {
      totalErrors,
      retryableErrors,
      retryableRate: totalErrors > 0 ? (retryableErrors / totalErrors) : 0,
      categories,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ErrorHandler;