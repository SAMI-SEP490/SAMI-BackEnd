// Updated: 2025-12-30
// Refactored: Allow PDF and Images for contract creation

const multer = require('multer');
const path = require('path');

// Cấu hình multer với memory storage
const storage = multer.memoryStorage();

// File filter - Cho phép PDF và Ảnh
const combinedFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/jpg'
    ];

    // Kiểm tra đuôi file để chắc chắn
    const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedMimeTypes.includes(file.mimetype) && allowedExts.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only PDF and Image files (jpg, png) are allowed!'), false);
    }
};

// Cấu hình upload (Dùng chung cho cả Create/Update contract)
const upload = multer({
    storage: storage,
    fileFilter: combinedFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
    }
});

// Middleware xử lý lỗi upload
const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File size exceeds 10MB limit'
            });
        }
        return res.status(400).json({
            success: false,
            message: `Upload error: ${err.message}`
        });
    } else if (err) {
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }
    next();
};

module.exports = {
    upload,
    handleUploadError
};