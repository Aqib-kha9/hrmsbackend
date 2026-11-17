const { AuthorisedSignatory } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const uploadService = require('./upload.service');

class SignatoryService {
  async getAllSignatories() {
    return await AuthorisedSignatory.findAll({
      order: [['name', 'ASC']]
    });
  }

  async getActiveSignatories() {
    return await AuthorisedSignatory.findAll({
      where: { is_active: true },
      order: [['name', 'ASC']]
    });
  }

  async createSignatory(data, fileData) {
    let signatureUrl = null;

    if (fileData) {
      const uploadResult = await uploadService.uploadFile(fileData.buffer, {
        folder: 'hrms/signatures',
        format: 'png' // signatures are usually transparent PNGs
      });
      signatureUrl = uploadResult.secure_url || uploadResult.url || uploadResult.public_id;
    }

    const signatory = await AuthorisedSignatory.create({
      name: data.name,
      designation: data.designation,
      signature_url: signatureUrl,
      is_active: data.is_active !== undefined ? data.is_active : true,
    });

    return signatory;
  }

  async updateSignatory(id, data, fileData) {
    const signatory = await AuthorisedSignatory.findByPk(id);
    if (!signatory) {
      throw new AppError('Signatory not found', 404);
    }

    let signatureUrl = signatory.signature_url;

    if (fileData) {
      const uploadResult = await uploadService.uploadFile(fileData.buffer, {
        folder: 'hrms/signatures',
        format: 'png'
      });
      signatureUrl = uploadResult.secure_url || uploadResult.url || uploadResult.public_id;
    }

    await signatory.update({
      name: data.name !== undefined ? data.name : signatory.name,
      designation: data.designation !== undefined ? data.designation : signatory.designation,
      signature_url: signatureUrl,
      is_active: data.is_active !== undefined ? data.is_active : signatory.is_active,
    });

    return signatory;
  }

  async deleteSignatory(id) {
    const signatory = await AuthorisedSignatory.findByPk(id);
    if (!signatory) {
      throw new AppError('Signatory not found', 404);
    }
    
    // Hard delete or soft delete? We'll just hard delete for now.
    await signatory.destroy();
    return true;
  }
}

module.exports = new SignatoryService();
