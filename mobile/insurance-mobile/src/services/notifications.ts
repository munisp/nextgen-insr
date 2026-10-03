import PushNotification from 'react-native-push-notification';
import { Platform } from 'react-native';

export class NotificationService {
  static initialize() {
    PushNotification.configure({
      onRegister: (token: any) => {
        console.log('FCM/APNS Token:', token);
      },
      onNotification: (notification: any) => {
        console.log('Notification received:', notification);
        if (notification.data?.type === 'claim_update') {
          NotificationService.handleClaimUpdate(notification.data);
        } else if (notification.data?.type === 'policy_renewal') {
          NotificationService.handlePolicyRenewal(notification.data);
        } else if (notification.data?.type === 'premium_due') {
          NotificationService.handlePremiumDue(notification.data);
        }
      },
      permissions: { alert: true, badge: true, sound: true },
      popInitialNotification: true,
      requestPermissions: Platform.OS === 'ios',
    });

    PushNotification.createChannel(
      { channelId: 'claims', channelName: 'Claims Updates', importance: 4, vibrate: true },
      () => {}
    );
    PushNotification.createChannel(
      { channelId: 'policies', channelName: 'Policy Notifications', importance: 3 },
      () => {}
    );
    PushNotification.createChannel(
      { channelId: 'payments', channelName: 'Payment Reminders', importance: 4, vibrate: true },
      () => {}
    );
  }

  static requestPermission() {
    PushNotification.requestPermissions();
  }

  static localNotify(title: string, message: string, channelId: string = 'claims') {
    PushNotification.localNotification({
      channelId,
      title,
      message,
      playSound: true,
      soundName: 'default',
    });
  }

  static scheduleReminder(title: string, message: string, date: Date) {
    PushNotification.localNotificationSchedule({
      channelId: 'payments',
      title,
      message,
      date,
      allowWhileIdle: true,
    });
  }

  private static handleClaimUpdate(data: Record<string, unknown>) {
    NotificationService.localNotify(
      'Claim Update',
      `Your claim #${data.claimId} status changed to ${data.status}`,
      'claims'
    );
  }

  private static handlePolicyRenewal(data: Record<string, unknown>) {
    NotificationService.localNotify(
      'Policy Renewal',
      `Policy ${data.policyNumber} is due for renewal on ${data.renewalDate}`,
      'policies'
    );
  }

  private static handlePremiumDue(data: Record<string, unknown>) {
    NotificationService.localNotify(
      'Premium Due',
      `Premium payment of ₦${data.amount} is due on ${data.dueDate}`,
      'payments'
    );
  }
}
