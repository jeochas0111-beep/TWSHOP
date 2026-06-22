const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { now } = require('../utils/helpers');
const { notFound, route, sendOk } = require('../utils/api');

const photoDir = path.join(__dirname, '..', '..', 'data', 'production-photos');
fs.mkdirSync(photoDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, photoDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `pp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持图片文件 (png/jpg/gif/webp)'));
  }
});

// 获取订单的照片列表
router.get('/production-photos/:orderId', route((req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isFinite(orderId) || orderId <= 0) return notFound('订单不存在');
  const order = db.prepare('SELECT id FROM orders WHERE id=?').get(orderId);
  if (!order) return notFound('订单不存在');
  const photos = db.prepare('SELECT * FROM production_photos WHERE order_id=? ORDER BY created_at DESC').all(orderId);
  res.json(photos);
}));

// 上传照片（支持多图）
router.post('/production-photos/:orderId', (req, res, next) => {
  upload.array('photos', 20)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: '文件大小超过限制（最大 10MB）' });
      return res.status(400).json({ ok: false, error: err.message || '文件上传失败' });
    }
    next();
  });
}, route((req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isFinite(orderId) || orderId <= 0) return notFound('订单不存在');
  const order = db.prepare('SELECT id FROM orders WHERE id=?').get(orderId);
  if (!order) return notFound('订单不存在');
  if (!req.files || !req.files.length) return res.status(400).json({ ok: false, error: '请选择图片文件' });

  const insert = db.prepare('INSERT INTO production_photos(order_id, filename, original_name, mime_type, size_bytes, created_at) VALUES(?,?,?,?,?,?)');
  const photos = [];
  for (const file of req.files) {
    const info = insert.run(orderId, file.filename, file.originalname, file.mimetype, file.size, now());
    photos.push({ id: info.lastInsertRowid, filename: file.filename, original_name: file.originalname });
  }
  sendOk(res, { photos });
}));

// 删除照片
router.delete('/production-photos/:photoId', route((req, res) => {
  const photoId = Number(req.params.photoId);
  if (!Number.isFinite(photoId) || photoId <= 0) return notFound('照片不存在');
  const photo = db.prepare('SELECT * FROM production_photos WHERE id=?').get(photoId);
  if (!photo) return notFound('照片不存在');
  // 删除磁盘文件
  const filePath = path.join(photoDir, photo.filename);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }
  db.prepare('DELETE FROM production_photos WHERE id=?').run(photoId);
  sendOk(res, { deleted: true });
}));

// 访问照片文件（防路径穿越）
router.get('/production-photos/file/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(photoDir, filename);
  if (!fs.existsSync(filePath)) return notFound('照片不存在');
  res.sendFile(filePath);
});

module.exports = router;
