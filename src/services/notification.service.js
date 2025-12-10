// Updated: 2025-07-11
// by: MinhBH

const prisma = require('../config/prisma');
const PushService = require('./push.service');

class NotificationService {
    
    /**
     * Creates a notification in the DB and sends a push.
     * This is the central function used by all other services.
     * @param {number | null} senderId - The user_id of who sent it (or null for system).
     * @param {number} recipientId - The user_id of who receives it.
     * @param {string} title - The notification title.
     * @param {string} body - The notification body.
     * @param {object} [payload] - Optional data (e.g., { "link": "/maintenance/123" }).
     */
    async createNotification(senderId, recipientId, title, body, payload = {}) {
        try {
            // 1. Create the master notification content
            const newNotification = await prisma.notifications.create({
                data: {
                    title: title,
                    body: body,
                    payload: payload,
                    created_by: senderId,
                }
            });
            
            // 2. Link it to the recipient's inbox
            const userNotification = await prisma.user_notifications.create({
                data: {
                    notification_id: newNotification.notification_id,
                    user_id: recipientId,
                    is_read: false
                }
            });
            
            // 3. Send the real-time push notification (the "ping")
            // This is "fire-and-forget" - we don't wait for it.
            PushService.sendPushToUser(recipientId, title, body, payload);
            
            return userNotification;

        } catch (error) {
            console.error("Error creating notification:", error);
            if (error.code === 'P2002') { // Handle unique constraint error
                 console.log('Duplicate notification ignored.');
                 return;
            }
            throw error;
        }
    }

    /**
     * Gets all notifications (the inbox) for a specific user.
     */
    async getNotificationsForUser(userId) {
        return prisma.user_notifications.findMany({
            where: { user_id: userId },
            orderBy: { notification: { created_at: 'desc' } },
            select: {
                user_notification_id: true, // This is the ID to mark as read
                is_read: true,
                read_at: true,
                notification: { // The content
                    select: {
                        notification_id: true,
                        title: true,
                        body: true,
                        payload: true,
                        created_at: true,
                    }
                }
            }
        });
    }

    /**
     * Marks a specific notification as read.
     */
    async markAsRead(userNotificationId, userId) {
        // We check for userId to make sure a user can't mark someone else's mail as read
        const updated = await prisma.user_notifications.updateMany({
            where: {
                user_notification_id: userNotificationId,
                user_id: userId,
                is_read: false // Only update if it's unread
            },
            data: {
                is_read: true,
                read_at: new Date()
            }
        });
        
        if (updated.count === 0) {
             const error = new Error('Notification not found or already read.');
             error.statusCode = 404;
             throw error;
        }
        return updated;
    }
    
     /**
     * Saves or updates a device token for FCM.
     */
    async registerDeviceToken(userId, token, deviceType) {
        return prisma.device_tokens.upsert({
            where: { token: token }, // Find by the unique token
            update: { user_id: userId, device_type: deviceType }, // Update owner if needed
            create: { user_id: userId, token: token, device_type: deviceType }
        });
    }

     /**
     * Remove a device token from FCM.
     */
    async removeDeviceToken(userId, token) {
        // Only delete if the token actually matches the user
        return prisma.device_tokens.deleteMany({
            where: {
                token: token,
                user_id: userId 
            }
        });
    }

    /**
     * Creates a broadcast notification for ALL tenants.
     * @param {number} senderId - The manager/owner sending the message.
     * @param {string} title - The notification title.
     * @param {string} body - The notification body.
     * @param {object} [payload] - Optional data.
     */
    async createBroadcastNotification(senderId, title, body, payload = {}) {
        try {
            // 1. Find all tenants
            const tenants = await prisma.users.findMany({
                where: {
                    role: 'TENANT',
                    deleted_at: null, // Only active tenants
                },
                select: { user_id: true }
            });

            if (tenants.length === 0) {
                console.log('No tenants found to broadcast to.');
                return;
            }
            
            const tenantIds = tenants.map(t => t.user_id);

            // 2. Create the ONE master notification content
            const newNotification = await prisma.notifications.create({
                data: {
                    title: title,
                    body: body,
                    payload: payload,
                    created_by: senderId,
                }
            });

            // 3. Create the "inbox" records for ALL tenants in bulk
            const userNotificationData = tenantIds.map(userId => ({
                notification_id: newNotification.notification_id,
                user_id: userId
            }));

            await prisma.user_notifications.createMany({
                data: userNotificationData
            });

            // 4. Send the "ping" to all tenants
            // (Fire-and-forget, we don't await this)
            PushService.sendPushToUsers(tenantIds, title, body, payload);
            
            return newNotification;

        } catch (error) {
            console.error("Error creating broadcast notification:", error);
            throw error;
        }
    }

    /**
     * Creates a broadcast notification for ALL tenants in a specific building.
     * @param {number} senderId - The manager/owner sending the message.
     * @param {number} buildingId - The ID of the building to send to.
     * @param {string} title - The notification title.
     * @param {string} body - The notification body.
     * @param {object} [payload] - Optional data.
     */
    async createBuildingBroadcast(senderId, buildingId, title, body, payload = {}) {
        try {
            // 1. Find all tenants in the specified building
            // We find users who are tenants AND are linked to a room in that building
            const tenants = await prisma.users.findMany({
                where: {
                    role: 'TENANT',
                    deleted_at: null,
                    tenants: {
                        rooms: {
                            building_id: buildingId
                        }
                    }
                },
                select: { user_id: true }
            });

            if (tenants.length === 0) {
                console.log(`No tenants found in building ${buildingId}.`);
                return;
            }
            
            const tenantIds = tenants.map(t => t.user_id);

            // 2. Create the ONE master notification content
            const newNotification = await prisma.notifications.create({
                data: {
                    title: title,
                    body: body,
                    payload: payload,
                    created_by: senderId,
                }
            });

            // 3. Create the "inbox" records for ALL tenants in that building
            const userNotificationData = tenantIds.map(userId => ({
                notification_id: newNotification.notification_id,
                user_id: userId
            }));

            await prisma.user_notifications.createMany({
                data: userNotificationData
            });

            // 4. Send the "ping" to all tenants in that building
            PushService.sendPushToUsers(tenantIds, title, body, payload);
            
            return newNotification;

        } catch (error) {
            console.error("Error creating building broadcast:", error);
            throw error;
        }
    }

    /**
     * Get all notifications sent by a specific manager/owner.
     */
    async getSentNotifications(senderId) {
        return prisma.notifications.findMany({
            where: {
                created_by: senderId
            },
            orderBy: {
                created_at: 'desc' // Newest first
            },
            select: {
                notification_id: true,
                title: true,
                body: true,
                payload: true,
                created_at: true,
                // Also get the count of recipients to show in the dashboard
                // e.g., "Sent to 1 user" vs "Sent to 50 users"
                _count: {
                    select: { user_notifications: true }
                }
            }
        });
    }
}

module.exports = new NotificationService();
