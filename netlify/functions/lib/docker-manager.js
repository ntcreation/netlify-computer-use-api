const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');

class DockerManager {
  constructor(testId) {
    this.testId = testId;
    this.docker = new Docker({
      host: process.env.DOCKER_HOST || '/var/run/docker.sock',
      port: process.env.DOCKER_PORT || 2375,
      ca: process.env.DOCKER_CA,
      cert: process.env.DOCKER_CERT,
      key: process.env.DOCKER_KEY
    });
    this.container = null;
    this.containerName = `computer-use-test-${testId}`;
  }

  /**
   * Initialize Docker container with browser environment
   */
  async initialize() {
    try {
      console.log(`[${this.testId}] Creating Docker container: ${this.containerName}`);

      // Pull Ubuntu image if not exists (in production, this should be pre-built)
      try {
        await this.docker.pull('ubuntu:22.04');
      } catch (pullError) {
        console.log(`[${this.testId}] Ubuntu image may already exist, continuing...`);
      }

      // Create container with necessary tools
      this.container = await this.docker.createContainer({
        Image: 'ubuntu:22.04',
        name: this.containerName,
        Tty: true,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Env: [
          'DISPLAY=:99',
          'DEBIAN_FRONTEND=noninteractive'
        ],
        Cmd: ['/bin/bash'],
        WorkingDir: '/workspace'
      });

      // Start container
      await this.container.start();
      console.log(`[${this.testId}] Container started successfully`);

      // Install required packages
      await this.setupContainerEnvironment();

      console.log(`[${this.testId}] Docker container initialized successfully`);

    } catch (error) {
      throw new Error(`Failed to initialize Docker container: ${error.message}`);
    }
  }

  /**
   * Set up the container environment with necessary tools
   */
  async setupContainerEnvironment() {
    console.log(`[${this.testId}] Setting up container environment...`);

    const setupCommands = [
      // Update package list
      'apt-get update',
      
      // Install basic tools
      'apt-get install -y wget curl gnupg2 software-properties-common apt-transport-https ca-certificates',
      
      // Install Xvfb for virtual display
      'apt-get install -y xvfb x11vnc xdotool scrot',
      
      // Install Chrome dependencies
      'apt-get install -y fonts-liberation libasound2 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxss1 libgtk-3-0 libxrandr2 libu2f-udev libvulkan1',
      
      // Add Google Chrome repository
      'wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -',
      'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list',
      
      // Install Google Chrome
      'apt-get update',
      'apt-get install -y google-chrome-stable',
      
      // Create workspace directory
      'mkdir -p /workspace',
      
      // Start Xvfb
      'Xvfb :99 -screen 0 1280x720x24 > /dev/null 2>&1 &',
      
      // Wait for X server to start
      'sleep 3',
      
      // Test X server
      'export DISPLAY=:99 && xdpyinfo >/dev/null 2>&1'
    ];

    for (let i = 0; i < setupCommands.length; i++) {
      const command = setupCommands[i];
      try {
        console.log(`[${this.testId}] Running: ${command}`);
        await this.execute(command);
      } catch (error) {
        // Some commands may fail in certain environments, but we continue
        console.log(`[${this.testId}] Command may have failed but continuing: ${command} - ${error.message}`);
      }
    }

    console.log(`[${this.testId}] Container environment setup completed`);
  }

  /**
   * Execute command in container
   */
  async execute(command, options = {}) {
    if (!this.container) {
      throw new Error('Container not initialized');
    }

    try {
      const exec = await this.container.exec({
        Cmd: ['bash', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        ...options
      });

      const stream = await exec.start({ Detach: false });
      
      return new Promise((resolve, reject) => {
        let output = '';
        let errorOutput = '';

        stream.on('data', (chunk) => {
          const data = chunk.toString();
          // Docker multiplexes stdout/stderr, we need to handle both
          if (chunk[0] === 1) {
            // stdout
            output += data.slice(8);
          } else if (chunk[0] === 2) {
            // stderr
            errorOutput += data.slice(8);
          } else {
            output += data;
          }
        });

        stream.on('end', async () => {
          try {
            const inspectResult = await exec.inspect();
            if (inspectResult.ExitCode !== 0) {
              reject(new Error(`Command failed with exit code ${inspectResult.ExitCode}: ${errorOutput || output}`));
            } else {
              resolve(output.trim());
            }
          } catch (inspectError) {
            reject(inspectError);
          }
        });

        stream.on('error', reject);

        // Timeout after 30 seconds
        setTimeout(() => {
          reject(new Error('Command execution timeout'));
        }, 30000);
      });

    } catch (error) {
      throw new Error(`Failed to execute command "${command}": ${error.message}`);
    }
  }

  /**
   * Get file contents from container
   */
  async getFile(containerPath) {
    if (!this.container) {
      throw new Error('Container not initialized');
    }

    try {
      const stream = await this.container.getArchive({
        path: containerPath
      });

      return new Promise((resolve, reject) => {
        let data = Buffer.alloc(0);

        stream.on('data', (chunk) => {
          data = Buffer.concat([data, chunk]);
        });

        stream.on('end', () => {
          try {
            // The archive is a tar stream, we need to extract the file
            // For simplicity, we'll just read the file as base64 directly
            this.execute(`base64 ${containerPath}`)
              .then(base64Data => resolve(base64Data))
              .catch(reject);
          } catch (error) {
            reject(error);
          }
        });

        stream.on('error', reject);
      });

    } catch (error) {
      throw new Error(`Failed to get file "${containerPath}": ${error.message}`);
    }
  }

  /**
   * Copy file to container
   */
  async putFile(localPath, containerPath) {
    if (!this.container) {
      throw new Error('Container not initialized');
    }

    try {
      const fileData = fs.readFileSync(localPath);
      const tarStream = require('tar-stream');
      const pack = tarStream.pack();

      pack.entry({ name: path.basename(containerPath) }, fileData);
      pack.finalize();

      await this.container.putArchive(pack, {
        path: path.dirname(containerPath)
      });

    } catch (error) {
      throw new Error(`Failed to copy file to container: ${error.message}`);
    }
  }

  /**
   * Check if container is running
   */
  async isRunning() {
    if (!this.container) return false;

    try {
      const containerInfo = await this.container.inspect();
      return containerInfo.State.Running;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clean up container
   */
  async cleanup() {
    if (!this.container) return;

    try {
      console.log(`[${this.testId}] Cleaning up Docker container: ${this.containerName}`);

      // Stop container
      try {
        await this.container.stop({ t: 5 }); // 5 second timeout
      } catch (stopError) {
        console.log(`[${this.testId}] Container may already be stopped: ${stopError.message}`);
      }

      // Remove container
      try {
        await this.container.remove({ force: true });
        console.log(`[${this.testId}] Container removed successfully`);
      } catch (removeError) {
        console.log(`[${this.testId}] Failed to remove container: ${removeError.message}`);
      }

    } catch (error) {
      console.error(`[${this.testId}] Container cleanup failed: ${error.message}`);
      throw error;
    } finally {
      this.container = null;
    }
  }

  /**
   * Get container logs
   */
  async getLogs() {
    if (!this.container) return '';

    try {
      const stream = await this.container.logs({
        stdout: true,
        stderr: true,
        timestamps: true
      });

      return stream.toString();
    } catch (error) {
      console.error(`[${this.testId}] Failed to get container logs: ${error.message}`);
      return '';
    }
  }
}

// Cleanup orphaned containers on module load
async function cleanupOrphanedContainers() {
  try {
    const docker = new Docker();
    const containers = await docker.listContainers({ all: true });
    
    const testContainers = containers.filter(container => 
      container.Names.some(name => name.includes('computer-use-test-'))
    );

    for (const containerInfo of testContainers) {
      try {
        const container = docker.getContainer(containerInfo.Id);
        await container.remove({ force: true });
        console.log(`Cleaned up orphaned container: ${containerInfo.Names[0]}`);
      } catch (error) {
        console.log(`Failed to cleanup container ${containerInfo.Id}: ${error.message}`);
      }
    }
  } catch (error) {
    console.log('Failed to cleanup orphaned containers:', error.message);
  }
}

// Run cleanup on module load
cleanupOrphanedContainers();

module.exports = DockerManager;