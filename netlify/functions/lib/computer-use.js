const Anthropic = require('@anthropic-ai/sdk');
const ScreenshotUtils = require('./screenshot-utils');

class ComputerUse {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.dockerManager = options.dockerManager;
    this.testId = options.testId;
    this.options = options.options || {};
    this.screenshots = [];
    this.log = '';
    
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
   * Execute a natural language instruction using Claude's computer use tool
   */
  async execute(instruction) {
    this.addLog(`Starting execution: ${instruction}`);
    
    try {
      // Initial screenshot
      if (this.options.takeScreenshots) {
        await this.captureScreenshot('Initial state');
      }

      // Navigate to the website first
      await this.navigateToWebsite();

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
    }
  }

  /**
   * Navigate to the target website
   */
  async navigateToWebsite() {
    this.addLog(`Navigating to ${this.websiteUrl}`);
    
    try {
      // Start browser and navigate to website
      await this.dockerManager.execute([
        'export DISPLAY=:99',
        'Xvfb :99 -screen 0 1280x720x24 &',
        'sleep 2',
        `google-chrome --no-sandbox --disable-dev-shm-usage --remote-debugging-port=9222 --start-maximized "https://${this.websiteUrl}" &`,
        'sleep 5'
      ].join(' && '));

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
   * Run Claude with computer use tools
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
        type: 'computer_20250124',
        name: 'computer',
        display_width_px: this.display.width,
        display_height_px: this.display.height
      },
      {
        type: 'bash',
        name: 'bash'
      },
      {
        type: 'text_editor',
        name: 'text_editor'
      }
    ];
  }

  /**
   * Execute computer use tool actions
   */
  async executeComputerUseTool(toolUse) {
    const { name, input } = toolUse;
    
    try {
      switch (name) {
        case 'computer':
          return await this.handleComputerAction(input);
        case 'bash':
          return await this.handleBashAction(input);
        case 'text_editor':
          return await this.handleTextEditorAction(input);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      this.addLog(`Tool execution failed: ${error.message}`);
      return `Error: ${error.message}`;
    }
  }

  /**
   * Handle computer actions (screenshot, click, type, etc.)
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
        await this.dockerManager.execute(`export DISPLAY=:99 && xdotool mousemove ${coordinate[0]} ${coordinate[1]} click 1`);
        this.addLog(`Clicked at coordinates (${coordinate[0]}, ${coordinate[1]})`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for action
        return `Clicked at (${coordinate[0]}, ${coordinate[1]})`;

      case 'type':
        const { text } = input;
        // Escape special characters for shell
        const escapedText = text.replace(/'/g, "'\"'\"'");
        await this.dockerManager.execute(`export DISPLAY=:99 && xdotool type '${escapedText}'`);
        this.addLog(`Typed: ${text}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        return `Typed: ${text}`;

      case 'key':
        const { key } = input;
        await this.dockerManager.execute(`export DISPLAY=:99 && xdotool key ${key}`);
        this.addLog(`Pressed key: ${key}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        return `Pressed key: ${key}`;

      case 'scroll':
        const { coordinate: scrollCoord, direction, clicks } = input;
        const scrollDirection = direction === 'down' ? '5' : '4';
        await this.dockerManager.execute(`export DISPLAY=:99 && xdotool mousemove ${scrollCoord[0]} ${scrollCoord[1]} click ${scrollDirection}`);
        this.addLog(`Scrolled ${direction} at (${scrollCoord[0]}, ${scrollCoord[1]})`);
        await new Promise(resolve => setTimeout(resolve, 500));
        return `Scrolled ${direction}`;

      default:
        throw new Error(`Unknown computer action: ${action}`);
    }
  }

  /**
   * Handle bash commands
   */
  async handleBashAction(input) {
    const { command } = input;
    this.addLog(`Executing bash: ${command}`);
    
    try {
      const result = await this.dockerManager.execute(`export DISPLAY=:99 && ${command}`);
      return result || 'Command executed successfully';
    } catch (error) {
      return `Error executing command: ${error.message}`;
    }
  }

  /**
   * Handle text editor actions
   */
  async handleTextEditorAction(input) {
    // For web testing, text editor actions are limited
    // This is mainly a placeholder for future extensibility
    this.addLog('Text editor action not implemented for web testing');
    return 'Text editor not available in web testing context';
  }

  /**
   * Take screenshot and return base64 data for Claude
   */
  async takeScreenshotForClaude() {
    try {
      // Take screenshot using Docker
      const timestamp = Date.now();
      const filename = `/tmp/screenshot_${timestamp}.png`;
      
      await this.dockerManager.execute(`export DISPLAY=:99 && scrot ${filename}`);
      
      // Get the screenshot data
      const screenshotData = await this.dockerManager.getFile(filename);
      
      // Clean up
      await this.dockerManager.execute(`rm -f ${filename}`);
      
      return screenshotData;
    } catch (error) {
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  /**
   * Capture screenshot for user (stored in results)
   */
  async captureScreenshot(step) {
    if (!this.options.takeScreenshots) return null;

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
   * Add entry to execution log
   */
  addLog(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.log += logEntry + '\n';
    console.log(`[${this.testId}] ${message}`);
  }
}

module.exports = ComputerUse;