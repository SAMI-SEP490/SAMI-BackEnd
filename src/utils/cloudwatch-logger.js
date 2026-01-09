const {
    CloudWatchLogsClient,
    PutLogEventsCommand,
    CreateLogGroupCommand,
    CreateLogStreamCommand,
    DescribeLogStreamsCommand
} = require('@aws-sdk/client-cloudwatch-logs');
const config = require('../config');

class CloudWatchLogger {
    constructor() {
        this.client = new CloudWatchLogsClient({
            region: config.s3.region, // Dùng chung region với S3
            credentials: {
                accessKeyId: config.s3.accessKeyId,
                secretAccessKey: config.s3.secretAccessKey,
            }
        });

        this.logGroupName = config.cloudWatch?.logGroupName || '/rental-management/consent-logs';
        this.logStreamPrefix = config.cloudWatch?.logStreamPrefix || 'consent';
        this.logStreamName = `${this.logStreamPrefix}-${new Date().toISOString().split('T')[0]}`;
        this.sequenceToken = null;
    }

    /**
     * Khởi tạo Log Group và Log Stream
     */
    async initialize() {
        try {
            // Tạo Log Group
            await this.client.send(
                new CreateLogGroupCommand({
                    logGroupName: this.logGroupName,
                })
            );
            console.log(`✅ Created CloudWatch log group: ${this.logGroupName}`);
        } catch (error) {
            if (error.name !== 'ResourceAlreadyExistsException') {
                console.error('❌ Error creating log group:', error.message);
            }
        }

        try {
            // Tạo Log Stream
            await this.client.send(
                new CreateLogStreamCommand({
                    logGroupName: this.logGroupName,
                    logStreamName: this.logStreamName,
                })
            );
            console.log(`✅ Created CloudWatch log stream: ${this.logStreamName}`);
        } catch (error) {
            if (error.name !== 'ResourceAlreadyExistsException') {
                console.error('❌ Error creating log stream:', error.message);
            }
        }

        // Lấy sequence token
        await this.updateSequenceToken();
    }

    /**
     * Cập nhật sequence token
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
            console.error('❌ Error getting sequence token:', error.message);
        }
    }

    /**
     * Gửi log lên CloudWatch
     */
    async log(eventType, metadata = {}) {
        const logEvent = {
            message: JSON.stringify({
                timestamp: new Date().toISOString(),
                eventType,
                ...metadata,
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

            console.log('✅ Log sent to CloudWatch successfully');
        } catch (error) {
            console.error('❌ Error sending log to CloudWatch:', error.message);

            // Nếu sequence token không hợp lệ, cập nhật và thử lại
            if (error.name === 'InvalidSequenceTokenException') {
                await this.updateSequenceToken();
            }

            throw error;
        }
    }
}

// Singleton instance
let cloudWatchLoggerInstance = null;

const getCloudWatchLogger = () => {
    if (!cloudWatchLoggerInstance) {
        cloudWatchLoggerInstance = new CloudWatchLogger();
    }
    return cloudWatchLoggerInstance;
};

module.exports = { CloudWatchLogger, getCloudWatchLogger };