// src/utils/jwt.js

const jwt = require('jsonwebtoken');
const config = require('../config');

const generateAccessToken = (userId) => {
    return jwt.sign(
        { userId, type: 'access' },
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







