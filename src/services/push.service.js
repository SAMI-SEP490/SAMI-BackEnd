// Updated: 2025-07-11
// by: MinhBH

const admin = require('firebase-admin');
const prisma = require('../config/prisma');

// --- IMPORTANT ---
// Make sure this path points to the key you just downloaded
const serviceAccount = require('../../firebase-adminsdk.json'); 

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error('Firebase Admin SDK initialization error:', error);
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
            const response = await admin.messaging().sendMulticast(message);
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
}

// Export a single instance
module.exports = new PushService();
