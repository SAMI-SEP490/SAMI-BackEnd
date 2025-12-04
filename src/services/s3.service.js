// Updated: 2025-3-12
// By: DatNB

const { s3, BUCKET_NAME } = require('../config/s3');
const crypto = require('crypto');
const path = require('path');
const mime = require('mime-types');

class S3Service {
    /**
     * Upload file lên S3
     * @param {Buffer} fileBuffer - Buffer của file
     * @param {String} fileName - Tên file gốc
     * @param {String} folder - Thư mục trong S3 (vd: 'contracts')
     * @returns {Object} - Thông tin file đã upload
     */
    async uploadFile(fileBuffer, fileName, folder = 'contracts') {
        try {
            // Tạo key unique cho file
            const fileExt = path.extname(fileName);
            const timestamp = Date.now();
            const randomString = crypto.randomBytes(8).toString('hex');
            const s3Key = `${folder}/${timestamp}-${randomString}${fileExt}`;

            // Tính checksum (MD5)
            const checksum = crypto
                .createHash('md5')
                .update(fileBuffer)
                .digest('hex');

            // Lấy content type
            const contentType = mime.lookup(fileName) || 'application/pdf';

            // Upload lên S3
            const uploadParams = {
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: fileBuffer,
                ContentType: contentType,
                ContentMD5: Buffer.from(checksum, 'hex').toString('base64'),
                ServerSideEncryption: 'AES256', // Mã hóa file trên S3
                Metadata: {
                    'original-filename': fileName,
                    'upload-timestamp': timestamp.toString()
                }
            };

            const result = await s3.upload(uploadParams).promise();

            return {
                s3_key: s3Key,
                file_name: fileName,
                checksum: checksum,
                url: result.Location,
                bucket: BUCKET_NAME,
                size: fileBuffer.length,
                uploaded_at: new Date()
            };
        } catch (error) {
            console.error('S3 Upload Error:', error);
            throw new Error(`Failed to upload file to S3: ${error.message}`);
        }
    }

    /**
     * Download file từ S3
     * @param {String} s3Key - Key của file trên S3
     * @returns {Buffer} - Buffer của file
     */
    async downloadFile(s3Key) {
        try {
            const params = {
                Bucket: BUCKET_NAME,
                Key: s3Key
            };

            const result = await s3.getObject(params).promise();
            return result.Body;
        } catch (error) {
            console.error('S3 Download Error:', error);
            throw new Error(`Failed to download file from S3: ${error.message}`);
        }
    }

    /**
     * Tạo presigned URL để download file
     * @param {String} s3Key - Key của file trên S3
     * @param {String} fileName - Tên file khi download
     * @param {Number} expiresIn - Thời gian hết hạn (giây), mặc định 1 giờ
     * @returns {String} - URL để download
     */
    async getDownloadUrl(s3Key, fileName, expiresIn = 3600) {
        try {
            const params = {
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Expires: expiresIn,
                ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`
            };

            return s3.getSignedUrl('getObject', params);
        } catch (error) {
            console.error('S3 Get URL Error:', error);
            throw new Error(`Failed to generate download URL: ${error.message}`);
        }
    }

    /**
     * Xóa file trên S3
     * @param {String} s3Key - Key của file trên S3
     */
    async deleteFile(s3Key) {
        try {
            const params = {
                Bucket: BUCKET_NAME,
                Key: s3Key
            };

            await s3.deleteObject(params).promise();
            return { success: true };
        } catch (error) {
            console.error('S3 Delete Error:', error);
            throw new Error(`Failed to delete file from S3: ${error.message}`);
        }
    }

    /**
     * Kiểm tra file có tồn tại không
     * @param {String} s3Key - Key của file trên S3
     * @returns {Boolean}
     */
    async fileExists(s3Key) {
        try {
            const params = {
                Bucket: BUCKET_NAME,
                Key: s3Key
            };

            await s3.headObject(params).promise();
            return true;
        } catch (error) {
            if (error.code === 'NotFound') {
                return false;
            }
            throw error;
        }
    }

    /**
     * Verify checksum của file
     * @param {Buffer} fileBuffer - Buffer của file
     * @param {String} expectedChecksum - Checksum dự kiến
     * @returns {Boolean}
     */
    verifyChecksum(fileBuffer, expectedChecksum) {
        const actualChecksum = crypto
            .createHash('md5')
            .update(fileBuffer)
            .digest('hex');

        return actualChecksum === expectedChecksum;
    }

    // ==================== METHODS MỚI CHO AVATAR ====================

    /**
     * Upload avatar lên S3 với ACL public-read
     * @param {Buffer} fileBuffer - Buffer của ảnh
     * @param {String} fileName - Tên file gốc
     * @returns {Object} - Thông tin ảnh đã upload
     */
    async uploadAvatar(fileBuffer, fileName) {
        try {
            const fileExt = path.extname(fileName);
            const timestamp = Date.now();
            const randomString = crypto.randomBytes(8).toString('hex');
            const s3Key = `avatars/${timestamp}-${randomString}${fileExt}`;

            const contentType = mime.lookup(fileName) || 'image/jpeg';

            const uploadParams = {
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: fileBuffer,
                ContentType: contentType,
                ACL: 'public-read', // Public để hiển thị ảnh
                ServerSideEncryption: 'AES256',
                CacheControl: 'max-age=31536000', // Cache 1 năm
                Metadata: {
                    'original-filename': fileName,
                    'upload-timestamp': timestamp.toString(),
                    'file-type': 'avatar'
                }
            };

            const result = await s3.upload(uploadParams).promise();

            return {
                s3_key: s3Key,
                file_name: fileName,
                url: result.Location,
                bucket: BUCKET_NAME,
                size: fileBuffer.length,
                content_type: contentType,
                uploaded_at: new Date()
            };
        } catch (error) {
            console.error('S3 Upload Avatar Error:', error);
            throw new Error(`Failed to upload avatar to S3: ${error.message}`);
        }
    }

    /**
     * Extract S3 key từ full URL
     * @param {String} url - Full S3 URL
     * @returns {String|null} - S3 key hoặc null
     */
    extractS3KeyFromUrl(url) {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            // Remove leading slash
            return urlObj.pathname.substring(1);
        } catch (error) {
            console.error('Invalid URL:', error);
            return null;
        }
    }
}

module.exports = new S3Service();