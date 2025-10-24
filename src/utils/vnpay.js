const crypto = require('crypto');
const querystring = require('qs');
const dateFormat = require('dateformat');
const sortObject = require('sortobject');

// --- THESE MUST BE STORED IN .env ---
const vnp_TmnCode = process.env.VNP_TMNCODE;
const vnp_HashSecret = process.env.VNP_HASHSECRET;
const vnp_Url = process.env.VNP_URL;
const vnp_ReturnUrl = process.env.VNP_RETURN_URL;

/**
 * Generates a VNPay payment URL.
 */
function generateVnpayUrl(ipAddr, amount, orderId, orderInfo) {
    const tmnCode = vnp_TmnCode;
    const secretKey = vnp_HashSecret;
    const returnUrl = vnp_ReturnUrl;
    const date = new Date();

    const locale = 'vn';
    const currCode = 'VND';
    
    let vnp_Params = {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: tmnCode,
        vnp_Locale: locale,
        vnp_CurrCode: currCode,
        vnp_TxnRef: orderId,
        vnp_OrderInfo: orderInfo,
        vnp_OrderType: 'other',
        vnp_Amount: amount * 100, // VNPay requires amount * 100
        vnp_ReturnUrl: returnUrl,
        vnp_IpAddr: ipAddr,
        vnp_CreateDate: dateFormat.default(date, 'yyyymmddHHMMss')
    };

    // Sort params
    vnp_Params = sortObject.default(vnp_Params);

    const signData = querystring.stringify(vnp_Params, { encode: true });
    const hmac = crypto.createHmac('sha512', secretKey);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    vnp_Params['vnp_SecureHash'] = signed;

    const paymentUrl = vnp_Url + '?' + querystring.stringify(vnp_Params, { encode: false });
    return paymentUrl;
}

/**
 * Verifies the secure hash from a VNPay callback (Return or IPN).
 */
function verifyVnpaySignature(vnpParams) {
    const secretKey = vnp_HashSecret;
    const secureHash = vnpParams['vnp_SecureHash'];

    // Remove hash and hashType from params
    delete vnpParams['vnp_SecureHash'];
    delete vnpParams['vnp_HashType'];
    
    // Sort params
    const sortedParams = sortObject.default(vnpParams);
    
    const signData = querystring.stringify(sortedParams, { encode: false });
    const hmac = crypto.createHmac('sha512', secretKey);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    return secureHash === signed;
}

module.exports = {
    generateVnpayUrl,
    verifyVnpaySignature,
};
