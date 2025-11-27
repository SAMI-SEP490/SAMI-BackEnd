// Updated: 2025-07-11
// by: MinhBH

const admin = require('firebase-admin');
const prisma = require('../config/prisma');
const fs = require('fs');
const path = require('path');

// --- SAFE INITIALIZATION ---
let isFirebaseInitialized = false;

// --- IMPORTANT ---
// Make sure this path points to the key you just downloaded
const serviceAccountPath = path.join(__dirname, '../../firebase-adminsdk.json');

if (fs.existsSync(serviceAccountPath)) {
    try {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        isFirebaseInitialized = true;
        console.log('✅ Firebase Admin SDK initialized.');
    } catch (error) {
        console.warn('⚠️ Firebase init failed:', error.message);
    }
} else {
    console.warn('⚠️ firebase-adminsdk.json not found. Push notifications will be disabled.');
}

class PushService {
    /**
     * Sends an FCM push notification to all devices of a user.
     * @param {number} userId - The user_id to send to.
     * @param {string} title - The notification title.
     * @param {string} body - The notification body.
     * @param {object} [data] - Optional data payload (e.g., { link: '/bills/123' }).
     */
    async sendPushToUser(userId, title, body, data = {}) {
        if (!isFirebaseInitialized) {
            console.log(`[Mock Push] To User ${userId}: ${title} - ${body}`);
            return;
        }

        console.log(`Attempting to send push notification to user ${userId}`);

        // 1. Find all device tokens for this user
        const devices = await prisma.device_tokens.findMany({
            where: { user_id: userId }
        });

        if (devices.length === 0) {
            console.log(`No device tokens found for user ${userId}. Skipping push.`);
            return;
        }

        const tokens = devices.map(d => d.token);

        // 2. Construct the FCM message
        const message = {
            notification: {
                title: title,
                body: body,
            },
            data: data, // Add custom data (like deep links)
            tokens: tokens, // Array of device tokens
            
            // --- APN & Android config for better mobile display ---
            apns: { // Apple
                payload: { aps: { 'content-available': 1, sound: 'default' } }
            },
            android: { // Android
                priority: 'high',
                notification: {
                    sound: 'default'
                }
            },
        };

        // 3. Send the message
        try {
            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`Successfully sent ${response.successCount} messages to user ${userId}`);
            
            // 4. Clean up invalid tokens
            if (response.failureCount > 0) {
                const tokensToDelete = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        const error = resp.error.code;
                        // Check for errors indicating an invalid/unregistered token
                        if (error === 'messaging/invalid-registration-token' ||
                            error === 'messaging/registration-token-not-registered') {
                            tokensToDelete.push(tokens[idx]);
                        }
                    }
                });
                
                if(tokensToDelete.length > 0) {
                    console.log(`Cleaning up ${tokensToDelete.length} invalid tokens...`);
                    await prisma.device_tokens.deleteMany({
                        where: { token: { in: tokensToDelete } }
                    });
                }
            }
        } catch (error) {
            console.error('Error sending FCM message:', error);
        }
    }

    /**
     * Sends an FCM push notification to all devices of MULTIPLE users.
     * @param {number[]} userIds - An array of user_ids to send to.
     * @param {string} title - The notification title.
     * @param {string} body - The notification body.
     * @param {object} [data] - Optional data payload (e.g., { link: '/notifications' }).
     */
    async sendPushToUsers(userIds, title, body, data = {}) {
        if (!isFirebaseInitialized) {
            console.log(`[Mock Broadcast] To ${userIds.length} users: ${title}`);
            return;
        }

        console.log(`Attempting to broadcast to ${userIds.length} users...`);

        // 1. Find all device tokens for ALL these users
        const devices = await prisma.device_tokens.findMany({
            where: { user_id: { in: userIds } }
        });

        if (devices.length === 0) {
            console.log('No device tokens found for any of the users. Skipping broadcast.');
            return;
        }

        const allTokens = devices.map(d => d.token);
        
        // --- 2. Chunk tokens into batches of 500 (Firebase limit) ---
        const chunkSize = 500;
        const chunkedTokens = [];
        for (let i = 0; i < allTokens.length; i += chunkSize) {
            chunkedTokens.push(allTokens.slice(i, i + chunkSize));
        }

        console.log(`Sending broadcast in ${chunkedTokens.length} chunk(s)...`);

        // 3. Send each chunk
        for (const tokenChunk of chunkedTokens) {
            const message = {
                notification: { title, body },
                data: data,
                tokens: tokenChunk, // Send to this chunk
                apns: { payload: { aps: { 'content-available': 1, sound: 'default' } } },
                android: { priority: 'high', notification: { sound: 'default' } },
            };

            try {
                const response = await admin.messaging().sendEachForMulticast(message);
                console.log(`Broadcast chunk sent: ${response.successCount} success, ${response.failureCount} failure.`);

                // 4. Clean up invalid tokens from this chunk
                if (response.failureCount > 0) {
                    const tokensToDelete = [];
                    response.responses.forEach((resp, idx) => {
                        if (!resp.success) {
                            const error = resp.error.code;
                            if (error === 'messaging/invalid-registration-token' ||
                                error === 'messaging/registration-token-not-registered') {
                                tokensToDelete.push(tokenChunk[idx]);
                            }
                        }
                    });
                    
                    if(tokensToDelete.length > 0) {
                        console.log(`Cleaning up ${tokensToDelete.length} invalid tokens...`);
                        await prisma.device_tokens.deleteMany({
                            where: { token: { in: tokensToDelete } }
                        });
                    }
                }
            } catch (error) {
                console.error('Error sending FCM broadcast chunk:', error);
            }
        }
    }
}

// Export a single instance
module.exports = new PushService();
