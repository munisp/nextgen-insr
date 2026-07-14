import { Request, Response } from "express";

interface NotificationClient {
  id: string;
  userId: number;
  res: Response;
}

const clients: NotificationClient[] = [];

export function setupNotificationSSE(req: Request, res: Response, userId: number) {
  const clientId = `${userId}-${Date.now()}`;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  clients.push({ id: clientId, userId, res });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Notification stream connected' })}\n\n`);

  // Remove client on connection close
  req.on('close', () => {
    const index = clients.findIndex(c => c.id === clientId);
    if (index !== -1) {
      clients.splice(index, 1);
    }
  });
}

export function sendNotificationToUser(userId: number, notification: {
  type: 'claim_update' | 'payment_reminder' | 'policy_renewal' | 'general';
  title: string;
  message: string;
  data?: any;
}) {
  const userClients = clients.filter(c => c.userId === userId);
  
  const payload = JSON.stringify({
    ...notification,
    timestamp: new Date().toISOString(),
  });

  userClients.forEach(client => {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (error) {
      console.error(`Failed to send notification to client ${client.id}:`, error);
    }
  });
}

export function broadcastNotification(notification: {
  type: 'system' | 'maintenance';
  title: string;
  message: string;
}) {
  const payload = JSON.stringify({
    ...notification,
    timestamp: new Date().toISOString(),
  });

  clients.forEach(client => {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (error) {
      console.error(`Failed to broadcast to client ${client.id}:`, error);
    }
  });
}

// Simulate periodic notifications (for demo purposes)
export function startNotificationSimulator() {
  setInterval(() => {
    if (clients.length > 0) {
      // Send a test notification to a random connected user
      const randomClient = clients[Math.floor(Math.random() * clients.length)];
      const notifications = [
        {
          type: 'claim_update' as const,
          title: 'Claim Status Updated',
          message: 'Your claim is now under review by our team.',
        },
        {
          type: 'payment_reminder' as const,
          title: 'Payment Due Soon',
          message: 'Your premium payment is due in 7 days.',
        },
        {
          type: 'policy_renewal' as const,
          title: 'Policy Renewal Available',
          message: 'Your policy is eligible for renewal.',
        },
      ];
      
      const randomNotification = notifications[Math.floor(Math.random() * notifications.length)];
      sendNotificationToUser(randomClient.userId, randomNotification);
    }
  }, 60000); // Every 60 seconds
}
