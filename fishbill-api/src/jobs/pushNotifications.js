/**
 * Firebase Cloud Messaging (FCM) Push Notification Helper
 * Sends push notifications to mobile app users.
 *
 * Setup:
 *  1. Go to Firebase Console → Project Settings → Service Accounts
 *  2. Click "Generate new private key" and download the JSON file
 *  3. In Admin Panel → Platform Settings → Firebase, paste the JSON content
 */

let firebaseApp = null;

async function initFirebase(pool) {
  if (firebaseApp) return firebaseApp;

  try {
    const admin = require('firebase-admin');
    if (admin.apps.length > 0) {
      firebaseApp = admin.apps[0];
      return firebaseApp;
    }

    const [rows] = await pool.execute(
      "SELECT setting_value FROM platform_settings WHERE setting_key = 'firebase_service_account' LIMIT 1"
    );

    if (!rows.length || !rows[0].setting_value) {
      console.warn('[FCM] Firebase service account not configured. Push notifications disabled.');
      return null;
    }

    const serviceAccount = JSON.parse(rows[0].setting_value);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log('[FCM] Firebase Admin initialized successfully.');
    return firebaseApp;
  } catch (err) {
    console.error('[FCM] Firebase init error:', err.message);
    return null;
  }
}

/**
 * Send a push notification to a specific user.
 * @param {object} pool - MySQL2 connection pool
 * @param {string} userId - Target user UUID
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {object} data - Extra data (e.g. { screen: 'invoices' })
 */
async function sendPushNotification(pool, userId, title, body, data = {}) {
  try {
    const app = await initFirebase(pool);
    if (!app) return;

    const [userRows] = await pool.execute(
      'SELECT fcm_token FROM users WHERE id = ? AND fcm_token IS NOT NULL LIMIT 1',
      [userId]
    );
    if (!userRows.length || !userRows[0].fcm_token) return;

    const token = userRows[0].fcm_token;

    const admin = require('firebase-admin');
    const message = {
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: {
          channelId: 'fishbill_main',
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    await admin.messaging().send(message);
    console.log(`[FCM] ✓ Notification sent to user ${userId}`);
  } catch (err) {
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      // Token is stale — clear it
      await pool.execute(
        'UPDATE users SET fcm_token = NULL, fcm_updated_at = NOW() WHERE id = ?',
        [userId]
      ).catch(() => {});
      console.log(`[FCM] Stale token cleared for user ${userId}`);
    } else {
      console.error(`[FCM] Error sending to user ${userId}:`, err.message);
    }
  }
}

/**
 * Send a push notification to all active users of a business.
 */
async function sendPushToAllUsers(pool, businessId, title, body, data = {}) {
  try {
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE business_id = ? AND is_active = 1 AND fcm_token IS NOT NULL',
      [businessId]
    );
    await Promise.allSettled(
      users.map(u => sendPushNotification(pool, u.id, title, body, data))
    );
  } catch (err) {
    console.error('[FCM] sendPushToAllUsers error:', err.message);
  }
}

module.exports = { sendPushNotification, sendPushToAllUsers, initFirebase };
