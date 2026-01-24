const {
    CloudWatchLogsClient,
    PutLogEventsCommand,
    CreateLogGroupCommand,
    CreateLogStreamCommand,
    DescribeLogStreamsCommand
} = require('@aws-sdk/client-cloudwatch-logs');
const config = require('../config');

class CloudWatchAuditLogger {
    constructor() {
        this.client = new CloudWatchLogsClient({
            region: config.s3.region, // Dùng chung region với S3 (theo file cũ)
            credentials: {
                accessKeyId: config.s3.accessKeyId,
                secretAccessKey: config.s3.secretAccessKey,
            }
        });

        // Tách biệt Log Group cho Audit để dễ truy vết và phân quyền
        // Bạn có thể thêm biến môi trường CLOUDWATCH_AUDIT_LOG_GROUP nếu muốn
        this.logGroupName = process.env.CLOUDWATCH_AUDIT_LOG_GROUP || '/rental-management/contract-audit-logs';

        // Prefix riêng cho các hành động nhạy cảm (Force Termination)
        this.logStreamPrefix = 'contract-activity';
        this.logStreamName = `${this.logStreamPrefix}-${new Date().toISOString().split('T')[0]}`;
        this.sequenceToken = null;

        // Flag để đảm bảo chỉ init 1 lần
        this.isInitialized = false;
    }

    /**
     * Khởi tạo Log Group và Log Stream
     * Nên gọi hàm này khi server start (ví dụ trong app.js hoặc index.js)
     */
    async initialize() {
        if (this.isInitialized) return;

        try {
            // 1. Tạo Log Group (nếu chưa có)
            await this.client.send(
                new CreateLogGroupCommand({
                    logGroupName: this.logGroupName,
                })
            );
            console.log(`✅ [Audit] Created CloudWatch log group: ${this.logGroupName}`);
        } catch (error) {
            if (error.name !== 'ResourceAlreadyExistsException') {
                console.error('❌ [Audit] Error creating log group:', error.message);
            }
        }

        try {
            // 2. Tạo Log Stream (nếu chưa có)
            await this.client.send(
                new CreateLogStreamCommand({
                    logGroupName: this.logGroupName,
                    logStreamName: this.logStreamName,
                })
            );
            console.log(`✅ [Audit] Created CloudWatch log stream: ${this.logStreamName}`);
        } catch (error) {
            if (error.name !== 'ResourceAlreadyExistsException') {
                console.error('❌ [Audit] Error creating log stream:', error.message);
            }
        }

        // 3. Lấy sequence token hiện tại
        await this.updateSequenceToken();
        this.isInitialized = true;
    }

    /**
     * Cập nhật sequence token (Bắt buộc cho PutLogEvents)
     */
    async updateSequenceToken() {
        try {
            const response = await this.client.send(
                new DescribeLogStreamsCommand({
                    logGroupName: this.logGroupName,
                    logStreamNamePrefix: this.logStreamName,
                })
            );

            if (response.logStreams && response.logStreams.length > 0) {
                this.sequenceToken = response.logStreams[0].uploadSequenceToken;
            }
        } catch (error) {
            console.error('❌ [Audit] Error getting sequence token:', error.message);
        }
    }

    /**
     * Gửi Log Audit
     * @param {Object} payload - Dữ liệu cần log (Contract info, Reason, Evidence Key...)
     */
    async logAuditAction(payload) {
        // Đảm bảo đã init trước khi log
        if (!this.isInitialized) {
            await this.initialize();
        }

        const logEvent = {
            message: JSON.stringify({
                timestamp: new Date().toISOString(),
                severity: 'HIGH', // Đánh dấu mức độ quan trọng
                ...payload,
            }),
            timestamp: Date.now(),
        };

        try {
            const command = new PutLogEventsCommand({
                logGroupName: this.logGroupName,
                logStreamName: this.logStreamName,
                logEvents: [logEvent],
                sequenceToken: this.sequenceToken,
            });

            const response = await this.client.send(command);
            this.sequenceToken = response.nextSequenceToken;

            console.log('✅ [Audit] Log sent to CloudWatch successfully');
        } catch (error) {
            console.error('❌ [Audit] Error sending log to CloudWatch:', error.message);

            // Retry logic: Nếu token sai, lấy lại token và thử lại 1 lần
            if (error.name === 'InvalidSequenceTokenException' || error.name === 'DataAlreadyAcceptedException') {
                console.log('⚠️ [Audit] Invalid token, refreshing and retrying...');
                // Lấy token đúng từ error response (nếu có) hoặc query lại
                if (error.expectedSequenceToken) {
                    this.sequenceToken = error.expectedSequenceToken;
                } else {
                    await this.updateSequenceToken();
                }

                // Thử gửi lại lần 2
                try {
                    const retryCommand = new PutLogEventsCommand({
                        logGroupName: this.logGroupName,
                        logStreamName: this.logStreamName,
                        logEvents: [logEvent],
                        sequenceToken: this.sequenceToken,
                    });
                    const retryResponse = await this.client.send(retryCommand);
                    this.sequenceToken = retryResponse.nextSequenceToken;
                    console.log('✅ [Audit] Retry log sent successfully');
                } catch (retryError) {
                    console.error('❌ [Audit] Retry failed:', retryError.message);
                }
            }
        }
    }
}

// Singleton instance
let cloudWatchAuditLoggerInstance = null;

const getCloudWatchAuditLogger = () => {
    if (!cloudWatchAuditLoggerInstance) {
        cloudWatchAuditLoggerInstance = new CloudWatchAuditLogger();
    }
    return cloudWatchAuditLoggerInstance;
};

module.exports = { CloudWatchAuditLogger, getCloudWatchAuditLogger };