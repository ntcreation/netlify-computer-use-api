const Anthropic = require('@anthropic-ai/sdk');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

class PuppeteerComputerUse {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.testId = options.testId;
    this.options = options.options || {};
    this.screenshots = [];
    this.log = '';
    this.browser = null;
    this.page = null;
    
    // Initialize Anthropic client
    this.anthropic = new Anthropic({
      apiKey: this.apiKey
    });

    // Computer use configuration
    this.display = { width: 1280, height: 720 };
    this.maxIterations = 20; // Prevent runaway costs
    this.websiteUrl = this.options.websiteUrl || 'app.giftround.com';
  }

  /**
   * Execute a natural language instruction using Claude's computer use tool with Puppeteer
   */
  async execute(instruction) {
    this.addLog(`Starting execution with Puppeteer: ${instruction}`);
    
    try {
      // Initialize browser
      await this.initializeBrowser();

      // Navigate to the website
      await this.navigateToWebsite();

      // Initial screenshot
      if (this.options.takeScreenshots) {
        await this.captureScreenshot('Initial state');
      }

      // Execute the instruction using Claude's computer use
      const result = await this.runClaudeWithComputerUse(instruction);

      this.addLog('Execution completed successfully');
      return {
        screenshots: this.screenshots,
        log: this.log,
        result: result
      };

    } catch (error) {
      this.addLog(`Execution failed: ${error.message}`);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Initialize Puppeteer browser
   */
  async initializeBrowser() {
    this.addLog('Initializing Puppeteer browser');
    
    try {
      // Configure Chromium for serverless environments
      const isDev = process.env.NODE_ENV !== 'production';
      
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath: isDev ? undefined : await chromium.executablePath(),
        args: isDev ? [] : [
          ...chromium.args,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-extensions',
          `--window-size=${this.display.width},${this.display.height}`
        ]
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport({
        width: this.display.width,
        height: this.display.height
      });

      this.addLog('Puppeteer browser initialized successfully');

    } catch (error) {
      throw new Error(`Failed to initialize browser: ${error.message}`);
    }
  }

  /**
   * Navigate to the target website
   */
  async navigateToWebsite() {
    this.addLog(`Navigating to ${this.websiteUrl}`);
    
    try {
      await this.page.goto(`https://${this.websiteUrl}`, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      // Take screenshot after navigation
      if (this.options.takeScreenshots) {
        await this.captureScreenshot(`Navigated to ${this.websiteUrl}`);
      }

      this.addLog(`Successfully navigated to ${this.websiteUrl}`);

    } catch (error) {
      throw new Error(`Failed to navigate to website: ${error.message}`);
    }
  }

  /**
   * Run Claude with computer use tools using Puppeteer backend
   */
  async runClaudeWithComputerUse(instruction) {
    const messages = [
      {
        role: 'user',
        content: `You are controlling a web browser to test features on ${this.websiteUrl}. 
        
The browser is already open and displaying the website. Please execute this instruction:

"${instruction}"

Guidelines:
- Take screenshots frequently to show progress
- Be thorough but efficient 
- If you encounter errors, try alternative approaches
- Explain what you're doing at each step
- Focus only on ${this.websiteUrl} - do not navigate away
- The display resolution is 1280x720

Available actions: screenshot, click, type, key, scroll

Current browser status: Open and displaying ${this.websiteUrl}`
      }
    ];

    let iteration = 0;
    let lastScreenshot = null;

    while (iteration < this.maxIterations) {
      iteration++;
      this.addLog(`Claude iteration ${iteration}`);

      try {
        // Get current screenshot for Claude
        lastScreenshot = await this.takeScreenshotForClaude();

        // Prepare tools for Claude
        const tools = this.getComputerUseTools();

        // Call Claude with computer use
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          tools: tools,
          messages: messages.concat([
            {
              role: 'assistant',
              content: iteration === 1 ? 'I can see the browser is open. Let me analyze the current state and proceed with the instruction.' : 'Continuing with the task...'
            },
            {
              role: 'user', 
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: lastScreenshot
                  }
                },
                {
                  type: 'text',
                  text: iteration === 1 ? 'Here is the current screenshot. Please proceed with the instruction.' : 'Here is the updated screenshot. Please continue.'
                }
              ]
            }
          ])
        });

        // Process Claude's response
        if (response.content.find(block => block.type === 'text')) {
          const textContent = response.content.find(block => block.type === 'text').text;
          this.addLog(`Claude: ${textContent}`);
        }

        // Check if Claude wants to use tools
        const toolUse = response.content.find(block => block.type === 'tool_use');
        if (toolUse) {
          const toolResult = await this.executeComputerUseTool(toolUse);
          
          // Add tool result to conversation
          messages.push({
            role: 'assistant',
            content: response.content
          });
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: toolResult
              }
            ]
          });
        } else {
          // No more tool use, Claude is finished
          this.addLog('Claude indicates task completion');
          break;
        }

        // Rate limiting - small delay between iterations
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        this.addLog(`Error in iteration ${iteration}: ${error.message}`);
        throw error;
      }
    }

    if (iteration >= this.maxIterations) {
      throw new Error(`Maximum iterations (${this.maxIterations}) reached`);
    }

    return { iterations: iteration, completed: true };
  }

  /**
   * Get computer use tools configuration for Claude
   */
  getComputerUseTools() {
    return [
      {
        type: 'computer_20241022',
        name: 'computer',
        display_width_px: this.display.width,
        display_height_px: this.display.height
      }
    ];
  }

  /**
   * Execute computer use tool actions using Puppeteer
   */
  async executeComputerUseTool(toolUse) {
    const { name, input } = toolUse;
    
    try {
      switch (name) {
        case 'computer':
          return await this.handleComputerAction(input);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      this.addLog(`Tool execution failed: ${error.message}`);
      return `Error: ${error.message}`;
    }
  }

  /**
   * Handle computer actions using Puppeteer
   */
  async handleComputerAction(input) {
    const { action } = input;
    
    switch (action) {
      case 'screenshot':
        const screenshot = await this.takeScreenshotForClaude();
        if (this.options.takeScreenshots) {
          await this.captureScreenshot(`Screenshot taken`);
        }
        return 'Screenshot taken';

      case 'click':
        const { coordinate } = input;
        await this.page.mouse.click(coordinate[0], coordinate[1]);
        this.addLog(`Clicked at coordinates (${coordinate[0]}, ${coordinate[1]})`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for action
        return `Clicked at (${coordinate[0]}, ${coordinate[1]})`;

      case 'type':
        const { text } = input;
        await this.page.keyboard.type(text, { delay: 50 });
        this.addLog(`Typed: ${text}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        return `Typed: ${text}`;

      case 'key':
        const { key } = input;
        // Map computer use keys to Puppeteer keys
        const keyMap = {
          'Return': 'Enter',
          'Tab': 'Tab',
          'Escape': 'Escape',
          'BackSpace': 'Backspace',
          'Delete': 'Delete',
          'Up': 'ArrowUp',
          'Down': 'ArrowDown',
          'Left': 'ArrowLeft',
          'Right': 'ArrowRight'
        };
        const puppeteerKey = keyMap[key] || key;
        await this.page.keyboard.press(puppeteerKey);
        this.addLog(`Pressed key: ${key}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        return `Pressed key: ${key}`;

      case 'scroll':
        const { coordinate: scrollCoord, direction, clicks = 3 } = input;
        const delta = direction === 'down' ? 120 : -120;
        await this.page.mouse.move(scrollCoord[0], scrollCoord[1]);
        await this.page.mouse.wheel({ deltaY: delta * clicks });
        this.addLog(`Scrolled ${direction} at (${scrollCoord[0]}, ${scrollCoord[1]})`);
        await new Promise(resolve => setTimeout(resolve, 500));
        return `Scrolled ${direction}`;

      default:
        throw new Error(`Unknown computer action: ${action}`);
    }
  }

  /**
   * Take screenshot and return base64 data for Claude
   */
  async takeScreenshotForClaude() {
    try {
      const screenshot = await this.page.screenshot({
        encoding: 'base64',
        fullPage: false
      });
      
      return screenshot;
    } catch (error) {
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  /**
   * Capture screenshot for user (stored in results)
   */
  async captureScreenshot(step) {
    if (!this.options.takeScreenshots || !this.page || !this.browser) return null;

    try {
      const screenshotData = await this.takeScreenshotForClaude();
      const screenshot = {
        step,
        timestamp: new Date().toISOString(),
        image_base64: `data:image/png;base64,${screenshotData}`
      };
      
      this.screenshots.push(screenshot);
      this.addLog(`Screenshot captured: ${step}`);
      
      return screenshot;
    } catch (error) {
      this.addLog(`Failed to capture screenshot: ${error.message}`);
      return null;
    }
  }

  /**
   * Clean up browser resources
   */
  async cleanup() {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        this.page = null;
        this.addLog('Browser closed successfully');
      } catch (error) {
        this.addLog(`Failed to close browser: ${error.message}`);
      }
    }
  }

  /**
   * Add entry to execution log
   */
  addLog(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.log += logEntry + '\n';
    console.log(`[${this.testId}] ${message}`);
  }
}

module.exports = PuppeteerComputerUse;