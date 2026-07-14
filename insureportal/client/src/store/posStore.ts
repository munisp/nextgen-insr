import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AgentProfile {
  id: number;
  agentId: string;
  name: string;
  role: "agent" | "admin" | "supervisor";
  tier: "Bronze" | "Silver" | "Gold" | "Platinum";
  phone: string;
  location: string | null;
  terminalModel: string | null;
  terminalSerial: string | null;
  premiumReserve: number;
  floatLimit: number;
  commissionBalance: number;
  loyaltyPoints: number;
  streak: number;
  rank: number | null;
  floatLocked?: boolean;
}

export interface TxRecord {
  id: number;
  ref: string;
  type: string;
  amount: number;
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  createdAt: string;
}

export interface FraudEvent {
  id: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  amount: number;
  agentId: string;
  customerName: string;
  timestamp: string;
  fraudScore: string;
  reason: string;
}

export interface ChatMessage {
  id: number;
  senderType: "agent" | "support" | "system";
  senderName: string | null;
  content: string;
  createdAt: string;
}

// ─── Offline queue item ───────────────────────────────────────────────────────
export interface OfflineTx {
  id: string;
  type: string;
  amount: number;
  customerPhone?: string;
  customerName?: string;
  destinationBank?: string;
  destinationAccount?: string;
  createdAt: number;
  retries: number;
}

// ─── Store ────────────────────────────────────────────────────────────────────
interface PosState {
  // Session
  agent: AgentProfile | null;
  isLoggedIn: boolean;
  setAgent: (agent: AgentProfile | null) => void;
  logout: () => void;

  // Float (real-time updates)
  updateFloat: (delta: number) => void;
  updateCommission: (delta: number) => void;
  updateLoyaltyPoints: (delta: number) => void;

  // Transactions
  recentTxs: TxRecord[];
  addTx: (tx: TxRecord) => void;
  setRecentTxs: (txs: TxRecord[]) => void;

  // Fraud
  fraudEvents: FraudEvent[];
  unreadFraudCount: number;
  addFraudEvent: (event: FraudEvent) => void;
  clearFraudCount: () => void;

  // Chat
  activeChatSession: string | null;
  chatMessages: ChatMessage[];
  unreadChatCount: number;
  setActiveChatSession: (ref: string | null) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setChatMessages: (msgs: ChatMessage[]) => void;
  clearChatCount: () => void;

  // Network / offline
  isOnline: boolean;
  setOnline: (online: boolean) => void;
  offlineQueue: OfflineTx[];
  enqueueOfflineTx: (
    tx: Omit<OfflineTx, "id" | "createdAt" | "retries">
  ) => void;
  dequeueOfflineTx: (id: string) => void;
  clearOfflineQueue: () => void;
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      // Session
      agent: null,
      isLoggedIn: false,
      setAgent: agent => set({ agent, isLoggedIn: !!agent }),
      logout: () =>
        set({
          agent: null,
          isLoggedIn: false,
          recentTxs: [],
          activeChatSession: null,
          chatMessages: [],
        }),

      // Float
      updateFloat: delta =>
        set(s =>
          s.agent
            ? {
                agent: {
                  ...s.agent,
                  premiumReserve: s.agent.premiumReserve + delta,
                },
              }
            : {}
        ),
      updateCommission: delta =>
        set(s =>
          s.agent
            ? {
                agent: {
                  ...s.agent,
                  commissionBalance: s.agent.commissionBalance + delta,
                },
              }
            : {}
        ),
      updateLoyaltyPoints: delta =>
        set(s =>
          s.agent
            ? {
                agent: {
                  ...s.agent,
                  loyaltyPoints: s.agent.loyaltyPoints + delta,
                },
              }
            : {}
        ),

      // Transactions
      recentTxs: [],
      addTx: tx =>
        set(s => ({ recentTxs: [tx, ...s.recentTxs].slice(0, 100) })),
      setRecentTxs: txs => set({ recentTxs: txs }),

      // Fraud
      fraudEvents: [],
      unreadFraudCount: 0,
      addFraudEvent: event =>
        set(s => ({
          fraudEvents: [event, ...s.fraudEvents].slice(0, 200),
          unreadFraudCount: s.unreadFraudCount + 1,
        })),
      clearFraudCount: () => set({ unreadFraudCount: 0 }),

      // Chat
      activeChatSession: null,
      chatMessages: [],
      unreadChatCount: 0,
      setActiveChatSession: ref => set({ activeChatSession: ref }),
      addChatMessage: msg =>
        set(s => ({
          chatMessages: [...s.chatMessages, msg],
          unreadChatCount:
            msg.senderType === "support"
              ? s.unreadChatCount + 1
              : s.unreadChatCount,
        })),
      setChatMessages: msgs => set({ chatMessages: msgs }),
      clearChatCount: () => set({ unreadChatCount: 0 }),

      // Network
      isOnline: true,
      setOnline: online => set({ isOnline: online }),
      offlineQueue: [],
      enqueueOfflineTx: tx =>
        set(s => ({
          offlineQueue: [
            ...s.offlineQueue,
            {
              ...tx,
              id: `OFL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              createdAt: Date.now(),
              retries: 0,
            },
          ],
        })),
      dequeueOfflineTx: id =>
        set(s => ({ offlineQueue: s.offlineQueue.filter(t => t.id !== id) })),
      clearOfflineQueue: () => set({ offlineQueue: [] }),
    }),
    {
      name: "insureportal-store",
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({
        agent: state.agent,
        isLoggedIn: state.isLoggedIn,
        offlineQueue: state.offlineQueue,
      }),
    }
  )
);
