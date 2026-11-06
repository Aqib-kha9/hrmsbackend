const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/role.middleware');
const env = require('../config/env');
const { SystemSetting } = require('../models');

// GET /api/v1/config/maps-key — expose Google Maps API key to authenticated users
router.get('/maps-key', authenticate, (req, res) => {
  // Prevent browser caching so the key is always fresh
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  res.json({
    success: true,
    data: {
      googleMapsApiKey: env.GOOGLE_MAPS_API_KEY || null,
    },
  });
});

// ── Weekend Policy ──────────────────────────────────────────────
// Values: 'sunday_only' | 'saturday_sunday'
// Default: 'sunday_only'

// GET /api/v1/config/weekend-policy — read weekend policy (any authenticated user)
router.get('/weekend-policy', authenticate, async (req, res) => {
  try {
    const setting = await SystemSetting.findByPk('weekend_policy');
    res.json({
      success: true,
      data: { weekendPolicy: setting ? setting.value : 'sunday_only' },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/v1/config/weekend-policy — update weekend policy (admin only)
router.put('/weekend-policy', authenticate, requirePermission('settings:update'), async (req, res) => {
  try {
    const { weekendPolicy } = req.body;
    if (!['sunday_only', 'saturday_sunday'].includes(weekendPolicy)) {
      return res.status(400).json({
        success: false,
        message: 'weekendPolicy must be "sunday_only" or "saturday_sunday"',
      });
    }

    await SystemSetting.upsert({ key: 'weekend_policy', value: weekendPolicy });

    res.json({
      success: true,
      data: { weekendPolicy },
      message: 'Weekend policy updated successfully.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/config/pt-slabs — read PT slabs (any authenticated user)
router.get('/pt-slabs', authenticate, async (req, res) => {
  try {
    const setting = await SystemSetting.findByPk('pt_slabs');
    let slabs;
    if (setting) {
      slabs = JSON.parse(setting.value);
    } else {
      slabs = [
        { from: 0, to: 18750, amount: 0 },
        { from: 18751, to: 25000, amount: 125 },
        { from: 25001, to: 33333, amount: 167 },
        { from: 33334, to: null, amount: 208 },
      ];
    }
    res.json({
      success: true,
      data: slabs,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/v1/config/pt-slabs — update PT slabs (admin only)
router.put('/pt-slabs', authenticate, requirePermission('settings:update'), async (req, res) => {
  try {
    const { slabs } = req.body;
    if (!Array.isArray(slabs)) {
      return res.status(400).json({
        success: false,
        message: 'slabs must be an array',
      });
    }

    for (const slab of slabs) {
      if (typeof slab.from !== 'number' || slab.amount === undefined || typeof slab.amount !== 'number') {
        return res.status(400).json({
          success: false,
          message: 'Each slab must have numeric "from" and "amount" fields',
        });
      }
    }

    await SystemSetting.upsert({ key: 'pt_slabs', value: JSON.stringify(slabs) });

    res.json({
      success: true,
      data: slabs,
      message: 'PT slabs updated successfully.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;