// Updated: 2025-07-11
// by: MinhBH

const NotificationService = require('../services/notification.service');
// We won't import Zod here, we'll use the 'validate' middleware wrapper

class NotificationController {
    
    // For Tenant & Manager: Get my inbox
    async getMyNotifications(req, res, next) {
        try {
            const userId = req.user.user_id;
            const notifications = await NotificationService.getNotificationsForUser(userId);
            res.status(200).json({ success: true, data: notifications });
        } catch (err) { next(err); }
    }
    
    // For Tenant & Manager: Mark a message as read
    async markAsRead(req, res, next) {
        try {
            const userId = req.user.user_id;
            const userNotificationId = parseInt(req.params.id, 10);
            if (isNaN(userNotificationId)) {
                return res.status(400).json({ success: false, message: "Invalid Notification ID" });
            }
            
            await NotificationService.markAsRead(userNotificationId, userId);
            res.status(200).json({ success: true, message: "Notification marked as read" });
        } catch (err) { next(err); }
    }
    
    // For Manager: Send a notification to a tenant
    async sendNotification(req, res, next) {
        try {
            // Data is already validated by the middleware
            const { recipient_id, title, body, payload } = req.body;
            const senderId = req.user.user_id;
            
            await NotificationService.createNotification(senderId, recipient_id, title, body, payload);
            res.status(201).json({ success: true, message: "Notification sent successfully" });
        } catch (err) {
            next(err); 
        }
    }
    
    // For Tenant & Manager: Register their device for push
    async registerDevice(req, res, next) {
        try {
            // Data is already validated by the middleware
            const { token, device_type } = req.body;
            const userId = req.user.user_id;
            
            await NotificationService.registerDeviceToken(userId, token, device_type);
            res.status(200).json({ success: true, message: "Device registered" });
        } catch (err) {
            next(err); 
        }
    }

    async sendBroadcast(req, res, next) {
        try {
            // Data is already validated
            const { title, body, payload } = req.body;
            const senderId = req.user.user_id;

            await NotificationService.createBroadcastNotification(senderId, title, body, payload);
            res.status(201).json({ success: true, message: "Broadcast notification sent to all tenants" });
        } catch (err) {
            next(err); 
        }
    }

    /**
     * For Manager: Send 1-to-MANY broadcast to a specific building.
     */
    async sendBuildingBroadcast(req, res, next) {
        try {
            const buildingId = parseInt(req.params.id, 10);
            if (isNaN(buildingId)) {
                return res.status(400).json({ success: false, message: "Invalid Building ID" });
            }

            // Data is already validated by the middleware
            const { title, body, payload } = req.body;
            const senderId = req.user.user_id;
            
            await NotificationService.createBuildingBroadcast(senderId, buildingId, title, body, payload);
            res.status(201).json({ success: true, message: `Broadcast notification sent to tenants in building ${buildingId}` });
        } catch (err) {
            next(err); 
        }
    }

    /**
     * Get list of notifications created by the current logged-in manager.
     */
    async getSentNotifications(req, res, next) {
        try {
            const senderId = req.user.user_id;
            const notifications = await NotificationService.getSentNotifications(senderId);
            
            // Optional: Flatten the _count object for cleaner JSON
            const formattedData = notifications.map(n => ({
                ...n,
                recipient_count: n._count.user_notifications,
                _count: undefined // Remove the raw prisma count object
            }));

            res.status(200).json({ success: true, data: formattedData });
        } catch (err) {
            next(err); 
        }
    }
}

module.exports = new NotificationController();
