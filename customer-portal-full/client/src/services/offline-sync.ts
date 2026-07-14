/**
 * Offline-first data synchronization service for PWA
 * Handles: offline claim drafts, queued mutations, background sync
 */

export interface OfflineAction {
  id: string;
  type: 'claim_draft' | 'payment_initiate' | 'profile_update' | 'document_upload';
  payload: Record<string, unknown>;
  createdAt: number;
  retryCount: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
}

const OFFLINE_QUEUE_KEY = 'insureportal_offline_queue';
const CLAIM_DRAFTS_KEY = 'insureportal_claim_drafts';

class OfflineSyncService {
  private queue: OfflineAction[] = [];

  constructor() {
    this.loadQueue();
    this.setupOnlineListener();
  }

  get isOnline(): boolean {
    return navigator.onLine;
  }

  get pendingCount(): number {
    return this.queue.filter(a => a.status === 'pending').length;
  }

  /**
   * Queue an action for offline sync
   */
  enqueue(action: Omit<OfflineAction, 'id' | 'createdAt' | 'retryCount' | 'status'>): string {
    const id = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const offlineAction: OfflineAction = {
      ...action,
      id,
      createdAt: Date.now(),
      retryCount: 0,
      status: 'pending',
    };

    this.queue.push(offlineAction);
    this.saveQueue();

    // Try immediate sync if online
    if (this.isOnline) {
      this.syncAll();
    }

    return id;
  }

  /**
   * Save a claim draft locally (survives app close)
   */
  saveClaimDraft(draft: Record<string, unknown>): string {
    const drafts = this.getClaimDrafts();
    const id = `draft_${Date.now()}`;
    drafts.push({ id, ...draft, savedAt: Date.now() });
    localStorage.setItem(CLAIM_DRAFTS_KEY, JSON.stringify(drafts));
    return id;
  }

  /**
   * Get all saved claim drafts
   */
  getClaimDrafts(): Array<Record<string, unknown>> {
    try {
      return JSON.parse(localStorage.getItem(CLAIM_DRAFTS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  /**
   * Delete a claim draft
   */
  deleteClaimDraft(id: string): void {
    const drafts = this.getClaimDrafts().filter(d => d.id !== id);
    localStorage.setItem(CLAIM_DRAFTS_KEY, JSON.stringify(drafts));
  }

  /**
   * Sync all pending offline actions
   */
  async syncAll(): Promise<{ synced: number; failed: number }> {
    let synced = 0;
    let failed = 0;

    const pending = this.queue.filter(a => a.status === 'pending');
    for (const action of pending) {
      try {
        action.status = 'syncing';
        await this.syncAction(action);
        action.status = 'synced';
        synced++;
      } catch (err) {
        action.retryCount++;
        if (action.retryCount >= 3) {
          action.status = 'failed';
          failed++;
        } else {
          action.status = 'pending';
        }
      }
    }

    // Remove synced actions
    this.queue = this.queue.filter(a => a.status !== 'synced');
    this.saveQueue();

    return { synced, failed };
  }

  private async syncAction(action: OfflineAction): Promise<void> {
    const endpoints: Record<string, string> = {
      claim_draft: '/api/trpc/claims.create',
      payment_initiate: '/api/trpc/payments.initiate',
      profile_update: '/api/trpc/profile.update',
      document_upload: '/api/trpc/documents.upload',
    };

    const endpoint = endpoints[action.type];
    if (!endpoint) throw new Error(`Unknown action type: ${action.type}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ json: action.payload }),
    });

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`);
    }
  }

  private loadQueue(): void {
    try {
      this.queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    } catch {
      this.queue = [];
    }
  }

  private saveQueue(): void {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(this.queue));
  }

  private setupOnlineListener(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      this.syncAll();
    });
  }
}

export const offlineSync = new OfflineSyncService();
