const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/role.middleware');
const holidayController = require('../controllers/holiday.controller');

// All routes require authentication
router.use(authenticate);

// All users can view holidays
router.get('/', holidayController.getAllHolidays);

// Admin/HR can manage holidays
router.post('/', requirePermission('settings:create'), holidayController.createHoliday);
router.put('/:id', requirePermission('settings:update'), holidayController.updateHoliday);
router.delete('/:id', requirePermission('settings:delete'), holidayController.deleteHoliday);
router.post('/fetch-calendar', requirePermission('settings:create'), holidayController.seedCalendar);

module.exports = router;
