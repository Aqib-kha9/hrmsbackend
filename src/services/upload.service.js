const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const env = require('../config/env');

/**
 * Local File Upload Service
 * Replaces Cloudinary with local file system storage.
 */
class UploadService {
  constructor() {
    // Base uploads directory: backend/uploads
    this.baseUploadDir = path.join(__dirname, '../../uploads');
    
    // Ensure base directory exists
    if (!fs.existsSync(this.baseUploadDir)) {
      fs.mkdirSync(this.baseUploadDir, { recursive: true });
    }
  }

  /**
   * Save a file buffer to local storage
   * @param {Buffer} buffer - The file buffer
   * @param {Object} options
   * @param {string} options.folder - Subfolder (e.g., 'hrms/documents')
   * @param {string} options.resource_type - Not strictly needed locally, kept for compatibility
   * @param {string} options.format - File extension (e.g., 'pdf', 'png')
   * @returns {Promise<Object>} Object containing secure_url and public_id
   */
  async uploadFile(buffer, options = {}) {
    try {
      const folderPath = options.folder || 'hrms/general';
      const fileExt = options.format || 'bin';
      
      // Generate a unique filename using crypto
      const uniqueSuffix = crypto.randomBytes(16).toString('hex');
      const filename = `${uniqueSuffix}.${fileExt}`;
      
      // Target directory
      const targetDir = path.join(this.baseUploadDir, folderPath);
      
      // Ensure target directory exists
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      // Full file path
      const filePath = path.join(targetDir, filename);
      
      // Write buffer to file
      await fs.promises.writeFile(filePath, buffer);
      
      // Generate the public URL
      // We store relative URL like /uploads/hrms/documents/filename.pdf
      const relativeUrl = `/uploads/${folderPath}/${filename}`;
      const fullUrl = `${env.BACKEND_URL || env.APP_URL}${relativeUrl}`;
      
      logger.info(`File uploaded locally to: ${filePath}`);
      
      return {
        secure_url: fullUrl,
        public_id: relativeUrl, // Using relative URL as public_id for easy local deletion
        format: fileExt
      };
    } catch (error) {
      logger.error(`Local upload failed: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Delete a file from local storage
   * @param {string} relativeUrl - The relative URL (e.g., /uploads/hrms/documents/filename.pdf)
   * @param {string} resourceType - Kept for compatibility
   * @returns {Promise<boolean>} True if successful
   */
  async deleteFile(relativeUrl, resourceType = 'auto') {
    if (!relativeUrl) return false;
    try {
      // Decode URL in case it has encoded characters
      const decodedUrl = decodeURI(relativeUrl);
      
      // Remove '/uploads/' from the start to get the relative file path within the uploads directory
      let filePathWithinUploads = decodedUrl;
      if (decodedUrl.startsWith('/uploads/')) {
        filePathWithinUploads = decodedUrl.replace('/uploads/', '');
      } else if (decodedUrl.includes('/uploads/')) {
        filePathWithinUploads = decodedUrl.split('/uploads/')[1];
      }
      
      const fullFilePath = path.join(this.baseUploadDir, filePathWithinUploads);
      
      if (fs.existsSync(fullFilePath)) {
        await fs.promises.unlink(fullFilePath);
        logger.info(`Local file deleted: ${fullFilePath}`);
        return true;
      } else {
        logger.warn(`Local file not found for deletion: ${fullFilePath}`);
        return false;
      }
    } catch (error) {
      logger.error(`Local delete failed for ${relativeUrl}: ${error.message}`);
      return false;
    }
  }

  /**
   * Extract public ID / relative path from URL (compatibility with Cloudinary method)
   */
  extractPublicIdFromUrl(url) {
    if (!url) return null;
    
    try {
      // If it's a full URL, parse it to get pathname
      if (url.startsWith('http')) {
        const parsedUrl = new URL(url);
        return {
          publicId: parsedUrl.pathname, // This gives something like /uploads/folder/file.ext
          resourceType: 'auto'
        };
      }
      
      // If it's already relative
      return {
        publicId: url,
        resourceType: 'auto'
      };
    } catch (e) {
      return { publicId: url, resourceType: 'auto' };
    }
  }

  /**
   * Generate URL (compatibility)
   */
  generateUrl(publicId, options = {}) {
    // We already have the publicId as the relative path, so just prepend APP_URL if needed
    if (publicId && publicId.startsWith('http')) {
      return publicId;
    }
    return `${env.BACKEND_URL || env.APP_URL}${publicId}`;
  }
}

module.exports = new UploadService();
