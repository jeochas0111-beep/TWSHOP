const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db } = require('../db');
const { makeBackup, exportBackupPayload, importBackupPayload, pruneAutoBackups } = require('../services/backups');
const { requireAdmin, route, sendOk } = require('../utils/api');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function publicBackup(row) {
  if (!row) return null;
  return {
    id: row.id,
    backup_type: row.backup_type,
    created_at: row.created_at,
    note: row.note,
    filename: row.file_path ? path.basename(row.file_path) : ''
  };
}

router.post('/backups/manual', requireAdmin, route((req, res) => {
  sendOk(res, { backup: publicBackup(makeBackup('manual', req.body?.note || '手动备份')) });
}));

router.get('/backups', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 50').all().map(publicBackup));
});

router.get('/backups/latest/download', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 1').get();
  if (!row || !fs.existsSync(row.file_path)) {
    return res.status(404).json({ ok: false, error: '没有备份文件' });
  }
  res.download(row.file_path);
});

router.get('/backups/export-json', requireAdmin, (req, res) => {
  res.json(exportBackupPayload());
});

router.post('/backups/import-json', requireAdmin, upload.single('file'), route((req, res) => {
  makeBackup('auto', 'JSON 恢复前');
  const payload = JSON.parse(req.file ? req.file.buffer.toString('utf8') : JSON.stringify(req.body));
  importBackupPayload(payload);
  pruneAutoBackups();
  sendOk(res);
}));

module.exports = router;
