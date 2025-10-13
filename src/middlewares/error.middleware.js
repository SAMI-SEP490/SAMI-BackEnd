// Updated: 2024-12-10
// by: DatNB


const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    if (err.name === 'PrismaClientKnownRequestError') {
        if (err.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: 'A record with this value already exists'
            });
        }
    }

    res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Internal server error'
    });
};

const notFound = (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
};

module.exports = {
    errorHandler,
    notFound
};