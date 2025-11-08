// Updated: 2024-17-10
// by: DatNB

const multer = require('multer');
const path = require('path');

// Cấu hình multer với memory storage
const storage = multer.memoryStorage();

// File filter - chỉ cho phép PDF
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['application/pdf'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(file.mimetype) && ext === '.pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only PDF files are allowed!'), false);
    }
};

const imageFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only image files (jpg, png) are allowed!'), false);
    }
};
// Cấu hình upload
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
    }
});

const uploadImage = multer({
    storage: storage,
    fileFilter: imageFilter,
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
    uploadImage,
    handleUploadError
};