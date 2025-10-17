const AWS = require('aws-sdk');
const config = require('./index');

const s3 = new AWS.S3({
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
    region: config.s3.region
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || config.s3.bucketName;

module.exports = {
    s3,
    BUCKET_NAME
};