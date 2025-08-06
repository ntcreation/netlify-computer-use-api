const sharp = require('sharp');

class ScreenshotUtils {
  /**
   * Process screenshot data for optimal storage and transmission
   */
  static async processScreenshot(base64Data, options = {}) {
    try {
      const {
        maxWidth = 1280,
        maxHeight = 720,
        quality = 80,
        format = 'png'
      } = options;

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Process with sharp
      let processedImage = sharp(imageBuffer);

      // Get image metadata
      const metadata = await processedImage.metadata();

      // Resize if needed
      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        processedImage = processedImage.resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // Convert format and compress
      let outputBuffer;
      if (format === 'jpeg' || format === 'jpg') {
        outputBuffer = await processedImage
          .jpeg({ quality })
          .toBuffer();
      } else if (format === 'webp') {
        outputBuffer = await processedImage
          .webp({ quality })
          .toBuffer();
      } else {
        // Default to PNG
        outputBuffer = await processedImage
          .png({ compressionLevel: 6 })
          .toBuffer();
      }

      return {
        data: outputBuffer.toString('base64'),
        format: format === 'jpg' ? 'jpeg' : format,
        width: metadata.width,
        height: metadata.height,
        size: outputBuffer.length
      };

    } catch (error) {
      throw new Error(`Failed to process screenshot: ${error.message}`);
    }
  }

  /**
   * Create thumbnail from screenshot
   */
  static async createThumbnail(base64Data, options = {}) {
    try {
      const {
        width = 320,
        height = 180,
        quality = 60
      } = options;

      const imageBuffer = Buffer.from(base64Data, 'base64');

      const thumbnailBuffer = await sharp(imageBuffer)
        .resize(width, height, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality })
        .toBuffer();

      return {
        data: thumbnailBuffer.toString('base64'),
        format: 'jpeg',
        width,
        height,
        size: thumbnailBuffer.length
      };

    } catch (error) {
      throw new Error(`Failed to create thumbnail: ${error.message}`);
    }
  }

  /**
   * Add annotation to screenshot (e.g., click coordinates, highlights)
   */
  static async annotateScreenshot(base64Data, annotations = [], options = {}) {
    try {
      const imageBuffer = Buffer.from(base64Data, 'base64');
      
      // Get image dimensions
      const metadata = await sharp(imageBuffer).metadata();
      
      // Create SVG overlay for annotations
      let svgOverlay = `<svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">`;
      
      for (const annotation of annotations) {
        switch (annotation.type) {
          case 'click':
            // Red circle for click points
            svgOverlay += `
              <circle cx="${annotation.x}" cy="${annotation.y}" r="10" 
                     fill="none" stroke="red" stroke-width="3" opacity="0.8"/>
              <circle cx="${annotation.x}" cy="${annotation.y}" r="3" 
                     fill="red" opacity="0.8"/>
            `;
            break;
            
          case 'highlight':
            // Yellow rectangle for highlights
            svgOverlay += `
              <rect x="${annotation.x}" y="${annotation.y}" 
                   width="${annotation.width}" height="${annotation.height}" 
                   fill="yellow" opacity="0.3" stroke="orange" stroke-width="2"/>
            `;
            break;
            
          case 'text':
            // Text annotation
            svgOverlay += `
              <text x="${annotation.x}" y="${annotation.y}" 
                   font-family="Arial, sans-serif" font-size="14" 
                   fill="red" stroke="white" stroke-width="1">
                ${annotation.text}
              </text>
            `;
            break;
        }
      }
      
      svgOverlay += '</svg>';

      // Composite the annotation overlay onto the image
      const annotatedBuffer = await sharp(imageBuffer)
        .composite([{
          input: Buffer.from(svgOverlay),
          top: 0,
          left: 0
        }])
        .png()
        .toBuffer();

      return {
        data: annotatedBuffer.toString('base64'),
        format: 'png',
        width: metadata.width,
        height: metadata.height,
        size: annotatedBuffer.length
      };

    } catch (error) {
      throw new Error(`Failed to annotate screenshot: ${error.message}`);
    }
  }

  /**
   * Compare two screenshots and highlight differences
   */
  static async compareScreenshots(beforeBase64, afterBase64, options = {}) {
    try {
      const {
        threshold = 0.1,
        highlightColor = 'red'
      } = options;

      const beforeBuffer = Buffer.from(beforeBase64, 'base64');
      const afterBuffer = Buffer.from(afterBase64, 'base64');

      // Ensure both images are the same size
      const beforeMeta = await sharp(beforeBuffer).metadata();
      const afterMeta = await sharp(afterBuffer).metadata();

      const targetWidth = Math.min(beforeMeta.width, afterMeta.width);
      const targetHeight = Math.min(beforeMeta.height, afterMeta.height);

      const beforeResized = await sharp(beforeBuffer)
        .resize(targetWidth, targetHeight)
        .raw()
        .toBuffer({ resolveWithObject: true });

      const afterResized = await sharp(afterBuffer)
        .resize(targetWidth, targetHeight)
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Simple pixel-by-pixel comparison
      const beforePixels = beforeResized.data;
      const afterPixels = afterResized.data;
      
      let differences = [];
      let diffCount = 0;
      
      for (let i = 0; i < beforePixels.length; i += 3) {
        const rDiff = Math.abs(beforePixels[i] - afterPixels[i]);
        const gDiff = Math.abs(beforePixels[i + 1] - afterPixels[i + 1]);
        const bDiff = Math.abs(beforePixels[i + 2] - afterPixels[i + 2]);
        
        const totalDiff = (rDiff + gDiff + bDiff) / 3 / 255;
        
        if (totalDiff > threshold) {
          const pixelIndex = i / 3;
          const x = pixelIndex % targetWidth;
          const y = Math.floor(pixelIndex / targetWidth);
          
          differences.push({ x, y, difference: totalDiff });
          diffCount++;
        }
      }

      const differencePercentage = (diffCount / (targetWidth * targetHeight)) * 100;

      return {
        hasDifferences: diffCount > 0,
        differencePercentage,
        differenceCount: diffCount,
        differences: differences.slice(0, 100), // Limit to first 100 differences
        summary: `Found ${diffCount} different pixels (${differencePercentage.toFixed(2)}% of image)`
      };

    } catch (error) {
      throw new Error(`Failed to compare screenshots: ${error.message}`);
    }
  }

  /**
   * Extract text regions from screenshot (basic OCR simulation)
   */
  static async extractTextRegions(base64Data, options = {}) {
    try {
      // This is a simplified implementation
      // In a real implementation, you might use Tesseract.js or similar
      
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const metadata = await sharp(imageBuffer).metadata();
      
      // For now, return mock text regions
      // In practice, you'd use OCR here
      return {
        textRegions: [
          {
            text: 'Sample detected text',
            confidence: 0.85,
            boundingBox: { x: 100, y: 100, width: 200, height: 30 }
          }
        ],
        imageWidth: metadata.width,
        imageHeight: metadata.height
      };
      
    } catch (error) {
      throw new Error(`Failed to extract text regions: ${error.message}`);
    }
  }

  /**
   * Validate screenshot data
   */
  static async validateScreenshot(base64Data) {
    try {
      if (!base64Data || typeof base64Data !== 'string') {
        return { valid: false, error: 'Invalid base64 data' };
      }

      const imageBuffer = Buffer.from(base64Data, 'base64');
      
      if (imageBuffer.length === 0) {
        return { valid: false, error: 'Empty image buffer' };
      }

      // Try to get metadata to verify it's a valid image
      const metadata = await sharp(imageBuffer).metadata();
      
      return {
        valid: true,
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        size: imageBuffer.length,
        channels: metadata.channels
      };

    } catch (error) {
      return {
        valid: false,
        error: `Invalid image data: ${error.message}`
      };
    }
  }

  /**
   * Optimize screenshot for storage/transmission
   */
  static async optimizeForStorage(base64Data, targetSizeKB = 100) {
    try {
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const originalSize = imageBuffer.length;
      const targetSize = targetSizeKB * 1024;

      if (originalSize <= targetSize) {
        return {
          data: base64Data,
          format: 'png',
          originalSize,
          optimizedSize: originalSize,
          compressionRatio: 1
        };
      }

      // Try different quality levels
      let quality = 80;
      let optimizedBuffer;
      
      do {
        optimizedBuffer = await sharp(imageBuffer)
          .jpeg({ quality })
          .toBuffer();
        
        quality -= 10;
      } while (optimizedBuffer.length > targetSize && quality > 20);

      return {
        data: optimizedBuffer.toString('base64'),
        format: 'jpeg',
        originalSize,
        optimizedSize: optimizedBuffer.length,
        compressionRatio: originalSize / optimizedBuffer.length,
        quality: quality + 10
      };

    } catch (error) {
      throw new Error(`Failed to optimize screenshot: ${error.message}`);
    }
  }
}

module.exports = ScreenshotUtils;