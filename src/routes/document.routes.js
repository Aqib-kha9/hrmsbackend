const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, selfOrAdmin, requirePermission } = require('../middleware/role.middleware');
const documentController = require('../controllers/document.controller');

// Multer setup — use memory storage so we can write the buffer to local storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
    files: 10, // Max 10 files per request
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type '${file.mimetype}' is not allowed. Accepted: JPEG, PNG, WebP, PDF`), false);
    }
  },
});

// All routes require authentication
router.use(authenticate);

// Employee routes
router.get('/my', documentController.getMyDocuments);

// Single file upload (for the logged-in employee themself)
router.post('/upload', upload.single('file'), documentController.uploadDocument);

// Multiple file upload (for the logged-in employee themself)
router.post('/upload/multiple', upload.array('files', 10), documentController.uploadMultipleDocuments);

// Admin/HR: Upload documents for a specific employee
router.post('/upload/:employeeId', requirePermission('employees:update'), upload.single('file'), documentController.uploadDocumentForEmployee);

router.post('/upload/multiple/:employeeId', requirePermission('employees:update'), upload.array('files', 10), documentController.uploadMultipleDocumentsForEmployee);

router.get('/my/:id', documentController.getDocumentById);

// Admin/HR routes
router.get('/employee/:employeeId', selfOrAdmin(), documentController.getEmployeeDocuments);
router.patch('/:id/verify', requirePermission('employees:update'), documentController.verifyDocument);
router.delete('/:id', requirePermission('employees:delete'), documentController.deleteDocument);

module.exports = router;