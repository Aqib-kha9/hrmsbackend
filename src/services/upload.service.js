const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const logger = require('../utils/logger');
const env = require('../config/env');

const isCloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME &&
  env.CLOUDINARY_API_KEY &&
  env.CLOUDINARY_API_SECRET
);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  logger.info('Cloudinary configured — cloud document storage active');
} else {
  logger.warn('Cloudinary credentials missing — using local file system storage');
}

/**
 * Universal File Upload Service
 * Automatically uploads to Cloudinary in production/cloud environments
 * with graceful fallback to local file system.
 */
class UploadService {
  constructor() {
    this.baseUploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(this.baseUploadDir)) {
      try {
        fs.mkdirSync(this.baseUploadDir, { recursive: true });
      } catch (err) {
        // Ignored in read-only environments
      }
    }
  }

  /**
   * Upload a file buffer (Cloudinary primary, Local fallback)
   * @param {Buffer} buffer - File buffer
   * @param {Object} options
   * @param {string} [options.folder] - Subfolder path (e.g. 'hrms/documents' or 'hrms/onboarding/1')
   * @param {string} [options.filename] - Custom filename or prefix
   * @param {string} [options.format] - File format / extension ('pdf', 'png', etc.)
   * @param {string} [options.resourceType] - 'auto' | 'image' | 'raw'
   * @returns {Promise<{secure_url: string, url: string, public_id: string, format: string, resource_type: string, bytes: number}>}
   */
  async uploadFile(buffer, options = {}) {
    if (isCloudinaryConfigured) {
      try {
        return await this._uploadToCloudinary(buffer, options);
      } catch (cloudErr) {
        logger.error(`Cloudinary upload failed: ${cloudErr.message}. Attempting local fallback...`);
        return await this._uploadToLocal(buffer, options);
      }
    }
    return await this._uploadToLocal(buffer, options);
  }

  /**
   * Cloudinary stream upload implementation
   */
  async _uploadToCloudinary(buffer, options = {}) {
    const {
      folder = 'hrms/documents',
      filename,
      resourceType,
      format,
    } = options;

    const resType = resourceType || 'auto';
    const uniqueSuffix = crypto.randomBytes(8).toString('hex');
    const sanitizedFilename = filename
      ? `${filename.replace(/[^a-zA-Z0-9_-]/g, '_')}_${uniqueSuffix}`
      : `file_${Date.now()}_${uniqueSuffix}`;

    const uploadOptions = {
      folder,
      resource_type: resType,
      public_id: sanitizedFilename,
      overwrite: true,
      use_filename: true,
      unique_filename: true,
    };

    if (format) {
      uploadOptions.format = format;
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            return reject(error);
          }

          logger.info(`Cloudinary upload success: ${result.public_id} (${result.secure_url})`);
          resolve({
            secure_url: result.secure_url,
            url: result.secure_url,
            public_id: result.public_id,
            format: result.format || format || '',
            resource_type: result.resource_type || resType,
            bytes: result.bytes || buffer.length,
            width: result.width,
            height: result.height,
          });
        }
      );

      uploadStream.end(buffer);
    });
  }

  /**
   * Local file system upload implementation
   */
  async _uploadToLocal(buffer, options = {}) {
    const folderPath = options.folder || 'hrms/general';
    const fileExt = options.format || 'bin';
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const filename = `${uniqueSuffix}.${fileExt}`;
    const targetDir = path.join(this.baseUploadDir, folderPath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, filename);
    await fs.promises.writeFile(filePath, buffer);

    const relativeUrl = `/uploads/${folderPath}/${filename}`;
    const fullUrl = `${env.BACKEND_URL || env.APP_URL}${relativeUrl}`;

    logger.info(`File uploaded locally to: ${filePath}`);

    return {
      secure_url: fullUrl,
      url: fullUrl,
      public_id: relativeUrl,
      format: fileExt,
      resource_type: 'auto',
      bytes: buffer.length,
    };
  }

  /**
   * Delete file from Cloudinary or Local
   * @param {string} publicIdOrUrl
   * @param {string} [resourceType='auto']
   * @returns {Promise<boolean>}
   */
  async deleteFile(publicIdOrUrl, resourceType = 'auto') {
    if (!publicIdOrUrl) return false;

    // Cloudinary deletion
    if (isCloudinaryConfigured && (publicIdOrUrl.includes('cloudinary.com') || !publicIdOrUrl.startsWith('/uploads'))) {
      try {
        let publicId = publicIdOrUrl;
        let resType = resourceType;

        if (publicIdOrUrl.includes('cloudinary.com')) {
          const parsed = this.extractPublicIdFromUrl(publicIdOrUrl);
          if (parsed) {
            publicId = parsed.publicId;
            resType = parsed.resourceType || resourceType;
          }
        }

        const result = await cloudinary.uploader.destroy(publicId, {
          resource_type: resType,
        });
        logger.info(`Cloudinary destroy for ${publicId}: ${result.result}`);
        return result.result === 'ok';
      } catch (err) {
        logger.error(`Cloudinary delete error: ${err.message}`);
        return false;
      }
    }

    // Local deletion
    return this._deleteFromLocal(publicIdOrUrl);
  }

  async _deleteFromLocal(relativeUrl) {
    try {
      const decodedUrl = decodeURI(relativeUrl);
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
      }
      return false;
    } catch (error) {
      logger.error(`Local delete failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Extract public ID and resource type from URL
   */
  extractPublicIdFromUrl(url) {
    if (!url) return null;

    if (url.includes('cloudinary.com')) {
      try {
        const urlParts = url.split('/');
        const uploadIndex = urlParts.indexOf('upload');
        if (uploadIndex === -1) return null;

        const resourceType = urlParts[uploadIndex - 1] || 'auto';
        const afterUpload = urlParts.slice(uploadIndex + 1);
        const withoutVersion = afterUpload.filter((part) => !part.match(/^v\d+$/));
        const lastPart = withoutVersion[withoutVersion.length - 1];
        const lastDotIndex = lastPart.lastIndexOf('.');
        if (lastDotIndex !== -1) {
          withoutVersion[withoutVersion.length - 1] = lastPart.substring(0, lastDotIndex);
        }

        return {
          publicId: withoutVersion.join('/'),
          resourceType,
        };
      } catch (err) {
        logger.warn(`Failed to extract public ID from Cloudinary URL: ${url}`);
        return null;
      }
    }

    try {
      if (url.startsWith('http')) {
        const parsedUrl = new URL(url);
        return { publicId: parsedUrl.pathname, resourceType: 'auto' };
      }
      return { publicId: url, resourceType: 'auto' };
    } catch {
      return { publicId: url, resourceType: 'auto' };
    }
  }

  /**
   * Generate URL helper
   */
  generateUrl(publicIdOrUrl, options = {}) {
    if (!publicIdOrUrl) return '';
    if (publicIdOrUrl.startsWith('http')) return publicIdOrUrl;

    if (isCloudinaryConfigured && !publicIdOrUrl.startsWith('/uploads')) {
      return cloudinary.url(publicIdOrUrl, { secure: true, ...options });
    }

    return `${env.BACKEND_URL || env.APP_URL}${publicIdOrUrl}`;
  }
}

module.exports = new UploadService();
