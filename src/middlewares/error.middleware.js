// Updated: 2026-01-10
// by: DatNB & MinhBH


const errorHandler = (err, req, res, next) => {
    console.error(`[Error] ${req.method} ${req.url}`, err);

    // 1. Handle Specific Database Errors (Prisma)
    if (err.name === 'PrismaClientKnownRequestError') {
        // P2002: Unique constraint failed (e.g. duplicate email/phone)
        if (err.code === 'P2002') {
            const field = err.meta?.target ? ` (${err.meta.target})` : '';
            return res.status(409).json({ // 409 Conflict is better than 400 for duplicates
                success: false,
                message: `Dữ liệu đã tồn tại${field}`
            });
        }
        // P2025: Record not found (e.g. update/delete missing ID)
        if (err.code === 'P2025') {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy dữ liệu liên quan'
            });
        }
    }

    // 2. Handle Custom Logic Errors (created via 'new Error()')
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    // 3. Send Response
    res.status(statusCode).json({
        success: false,
        message: message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    error.statusCode = 404;
    next(error);
};

module.exports = { errorHandler, notFound };
