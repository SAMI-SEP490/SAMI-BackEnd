// src/utils/tokens.js

const crypto = require('crypto');

const generateRandomToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

module.exports = {
    generateRandomToken,
    generateVerificationCode
};
