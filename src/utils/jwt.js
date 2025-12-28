// Updated: 2024-12-10
// by: DatNB


const jwt = require('jsonwebtoken');
const config = require('../config');

const generateAccessToken = (userId, role) => {
    return jwt.sign(
        { userId, role, type: 'access' },
        config.jwt.accessSecret,
        { expiresIn: config.jwt.accessExpiresIn }
    );
};

const generateRefreshToken = (userId) => {
    return jwt.sign(
        { userId, type: 'refresh' },
        config.jwt.refreshSecret,
        { expiresIn: config.jwt.refreshExpiresIn }
    );
};

const verifyAccessToken = (token) => {
    try {
        return jwt.verify(token, config.jwt.accessSecret);
    } catch (err) {
        return null;
    }
};

const verifyRefreshToken = (token) => {
    try {
        return jwt.verify(token, config.jwt.refreshSecret);
    } catch (err) {
        return null;
    }
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken
};







