const { Document, Employee } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { PAGINATION } = require('../utils/constants');
const uploadService = require('./upload.service');

class DocumentService {
  /**
   * Map frontend-friendly document type labels to backend ENUM values.
   * @param {string} input - Raw type string from the frontend
   * @returns {string} Valid Document.type ENUM value
   */
  _normalizeDocType(input) {
    if (!input || typeof input !== 'string') return 'other';
    const raw = input.toLowerCase().trim();
    if (
      raw.includes('aadhar') ||
      raw.includes('aadhaar') ||
      raw.includes('pan') ||
      raw.includes('voter') ||
      raw.includes('license') ||
      raw.includes('licence') ||
      raw.includes('id_proof')
    ) {
      return 'id_proof';
    }
    if (
      raw.includes('passbook') ||
      raw.includes('bank') ||
      raw.includes('cheque') ||
      raw.includes('address')
    ) {
      return 'address_proof';
    }
    if (
      raw.includes('certificate') ||
      raw.includes('education') ||
      raw.includes('degree') ||
      raw.includes('qualification') ||
      raw.includes('relieving') ||
      raw.includes('experience')
    ) {
      return 'certificate';
    }
    if (
      raw.includes('offer') ||
      raw.includes('appointment') ||
      raw.includes('contract') ||
      raw.includes('signed')
    ) {
      return 'offer_letter';
    }
    return 'other';
  }

  async getDocuments(employeeId, { page = 1, limit = PAGINATION.DEFAULT_LIMIT, type, status } = {}) {
    const offset = (page - 1) * limit;
    const whereClause = { employee_id: employeeId };
    if (type) whereClause.type = type;
    if (status) whereClause.status = status;

    const { rows, count } = await Document.findAndCountAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  /**
   * Upload a document — stores the file on Cloudinary and saves metadata in DB.
   * @param {number} employeeId
   * @param {Object} fileData - { buffer, originalname, mimetype, size }
   * @param {Object} metadata - { name, type } (document name and document type)
   * @returns {Promise<Object>} Created document record
   */
  async uploadDocument(employeeId, fileData, metadata = {}) {
    const { buffer, originalname, mimetype, size } = fileData;

    // Determine resource type — images vs raw (PDFs)
    const isImage = mimetype.startsWith('image/');
    const resourceType = isImage ? 'image' : 'raw';
    const folder = `hrms/documents/employee_${employeeId}`;

    // Upload file buffer to Local Storage
    const uploadResult = await uploadService.uploadFile(buffer, {
      folder,
      filename: originalname.replace(/\.[^.]+$/, ''), // strip extension
      resourceType,
    });

    // Create document record in DB with Cloudinary URL
    const document = await Document.create({
      employee_id: employeeId,
      name: metadata.name || originalname,
      type: this._normalizeDocType(metadata.type),
      file_path: uploadResult.secure_url,
      file_size: uploadResult.bytes || size,
      mime_type: mimetype,
      status: 'pending',
    });

    logger.info(`Document uploaded to Cloudinary by employee ${employeeId}: ${document.name} → ${uploadResult.secure_url}`);
    return document;
  }

  async getDocumentById(documentId, employeeId) {
    const document = await Document.findByPk(documentId);
    if (!document) throw new AppError('Document not found', 404);

    // Non-admin can only view their own documents
    const employee = await Employee.findByPk(employeeId);
    if (employee.role !== 'admin' && employee.role !== 'hr' && document.employee_id !== employeeId) {
      throw new AppError('Access denied', 403);
    }

    return document;
  }

  async verifyDocument(documentId, verifiedBy) {
    const document = await Document.findByPk(documentId);
    if (!document) throw new AppError('Document not found', 404);

    await document.update({
      status: 'verified',
      verified_by: verifiedBy,
      verified_at: new Date(),
    });

    logger.info(`Document ${documentId} verified by ${verifiedBy}`);
    return document;
  }

  async deleteDocument(documentId) {
    const document = await Document.findByPk(documentId);
    if (!document) throw new AppError('Document not found', 404);

    // Delete from Local Storage first
    if (document.file_path) {
      try {
        const extracted = uploadService.extractPublicIdFromUrl(document.file_path);
        if (extracted && extracted.publicId) {
          await uploadService.deleteFile(extracted.publicId, extracted.resourceType);
        }
      } catch (err) {
        logger.error(`Failed to delete file from storage: ${err.message}`);
      }
    }

    await document.destroy();
    logger.info(`Document ${documentId} deleted (Cloudinary + DB)`);
    return true;
  }
}

module.exports = new DocumentService();