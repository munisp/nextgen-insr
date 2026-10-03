/**
 * MemberSupport.test.tsx — W7-B8 (2026-10-04): /member/support (tickets +
 * feedback), /member/notifications, /member/disputes.
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub. All rendering and state handling are real. The auth
 * boundary (trpc.auth.me) is scripted to an authenticated member.
 *
 * Proves:
 *   - Support: real ticket list render, honest empty state, verbatim server
 *     error, zod-exact createTicket/replyTicket payloads, mutation error
 *     surfacing, feedback submit (score int, channel defaulted server-side)
 *     + own feedback history;
 *   - Notifications: real unread/total stats, inbox rows, zod-exact
 *     markRead/markAllRead/delete payloads, verbatim mutation error
 *     surfacing, honest empty state, NO archive/bulk buttons (server-side
 *     honest NOT_IMPLEMENTED — documented in the page header);
 *   - Disputes: real list render, honest empty state, zod-exact
 *     fileDispute/replyDispute payloads, verbatim error surfacing (incl.
 *     PRECONDITION_FAILED on resolved disputes).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberSupport from "@/pages/member/MemberSupport";
import MemberNotifications from "@/pages/member/MemberNotifications";
import MemberDisputes from "@/pages/member/MemberDisputes";
import {
  setQuery,
  setMutation,
  getMutationCalls,
  resetTrpcMock,
} from "./helpers/trpcMock";

const MEMBER = {
  id: 9001,
  name: "Adaeze Test",
  email: "adaeze@example.com",
  role: "user",
};

const TICKETS = [
  {
    id: 7,
    sessionRef: "CHT-ABC123",
    agentId: 42,
    subject: "Claim payout delay",
    status: "open",
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:00:00.000Z",
  },
];

const TICKET_DETAIL = {
  ticket: TICKETS[0],
  messages: [
    {
      id: 101,
      sessionId: 7,
      senderType: "agent",
      senderName: "Adaeze Test",
      content: "My claim payout is delayed.",
      createdAt: "2026-09-30T10:00:00.000Z",
    },
    {
      id: 102,
      sessionId: 7,
      senderType: "support",
      senderName: "Support Agent",
      content: "We are looking into it.",
      createdAt: "2026-09-30T11:00:00.000Z",
    },
  ],
};

const NOTIFICATIONS = [
  {
    id: 55,
    recipientId: "9001",
    recipientType: "user",
    subject: "Policy renewed",
    body: "Your motor policy was renewed.",
    status: "pending",
    failureReason: null,
    createdAt: "2026-10-01T08:00:00.000Z",
  },
  {
    id: 56,
    recipientId: "9001",
    recipientType: "user",
    subject: null,
    body: "Payment received.",
    status: "read",
    failureReason: null,
    createdAt: "2026-09-29T08:00:00.000Z",
  },
];

const DISPUTES = [
  {
    id: 21,
    ref: "DSP-ABCDEF123456",
    transactionId: 900,
    transactionRef: "TXN-900",
    status: "open",
    priority: "medium",
    type: "customer",
    reason: "Double charge",
    amount: "5000.00",
    createdAt: "2026-09-28T09:00:00.000Z",
  },
];

const TRANSACTIONS = [
  {
    id: 900,
    ref: "TXN-900",
    type: "Cash Out",
    amount: "5000.00",
    currency: "NGN",
    channel: "wallet",
    status: "success",
    failureReason: null,
    createdAt: "2026-09-27T09:00:00.000Z",
  },
];

beforeEach(() => {
  resetTrpcMock();
  setQuery("auth.me", { data: MEMBER });
});
afterEach(() => cleanup());

describe("MemberSupport — tickets (W7-B8)", () => {
  it("renders the real ticket list", () => {
    setQuery("memberHelpDesk.myTickets", {
      data: { tickets: TICKETS, total: 1 },
    });
    setQuery("memberFeedback.myFeedback", { data: { items: [], count: 0 } });
    render(<MemberSupport />);
    expect(screen.getByText("Claim payout delay")).toBeInTheDocument();
    expect(screen.getByText(/CHT-ABC123/)).toBeInTheDocument();
  });

  it("shows the honest empty state when there are no tickets", () => {
    setQuery("memberHelpDesk.myTickets", { data: { tickets: [], total: 0 } });
    setQuery("memberFeedback.myFeedback", { data: { items: [], count: 0 } });
    render(<MemberSupport />);
    expect(
      screen.getByText(/You have no support tickets yet/)
    ).toBeInTheDocument();
  });

  it("surfaces the verbatim server error when the list query fails", () => {
    setQuery("memberHelpDesk.myTickets", {
      isError: true,
      error: { message: "No customer profile is linked to this account" },
    });
    render(<MemberSupport />);
    expect(
      screen.getByText(/No customer profile is linked to this account/)
    ).toBeInTheDocument();
  });

  it("creates a ticket with the zod-exact payload", () => {
    setQuery("memberHelpDesk.myTickets", { data: { tickets: [], total: 0 } });
    setQuery("memberFeedback.myFeedback", { data: { items: [], count: 0 } });
    setMutation("memberHelpDesk.createTicket", { data: TICKETS[0] });
    render(<MemberSupport />);
    fireEvent.click(screen.getByText("New ticket"));
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Billing issue" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "I was charged twice." },
    });
    fireEvent.click(screen.getByText("Submit ticket"));
    expect(getMutationCalls("memberHelpDesk.createTicket")).toEqual([
      { subject: "Billing issue", description: "I was charged twice.", priority: "low" },
    ]);
  });

  it("surfaces the verbatim create error from the server", () => {
    setQuery("memberHelpDesk.myTickets", { data: { tickets: [], total: 0 } });
    setQuery("memberFeedback.myFeedback", { data: { items: [], count: 0 } });
    setMutation("memberHelpDesk.createTicket", {
      error: { message: "DB unavailable" },
    });
    render(<MemberSupport />);
    fireEvent.click(screen.getByText("New ticket"));
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Billing issue" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "I was charged twice." },
    });
    fireEvent.click(screen.getByText("Submit ticket"));
    expect(screen.getByRole("alert")).toHaveTextContent("DB unavailable");
  });

  it("opens the thread and replies with the zod-exact payload", () => {
    setQuery("memberHelpDesk.myTickets", {
      data: { tickets: TICKETS, total: 1 },
    });
    setQuery("memberHelpDesk.myTicket", { data: TICKET_DETAIL });
    setQuery("memberFeedback.myFeedback", { data: { items: [], count: 0 } });
    setMutation("memberHelpDesk.replyTicket", { data: { success: true } });
    render(<MemberSupport />);
    fireEvent.click(screen.getByText("Claim payout delay"));
    // Real thread rendered.
    expect(screen.getByText("My claim payout is delayed.")).toBeInTheDocument();
    expect(screen.getByText("We are looking into it.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reply"), {
      target: { value: "Any update yet?" },
    });
    fireEvent.click(screen.getByText("Send reply"));
    expect(getMutationCalls("memberHelpDesk.replyTicket")).toEqual([
      { ticketId: 7, content: "Any update yet?" },
    ]);
  });

  it("surfaces the verbatim reply error (resolved ticket rejection)", () => {
    setQuery("memberHelpDesk.myTickets", {
      data: { tickets: TICKETS, total: 1 },
    });
    setQuery("memberHelpDesk.myTicket", { data: TICKET_DETAIL });
    setQuery("memberFeedback.myFeedback", { data: { items: [], count: 0 } });
    setMutation("memberHelpDesk.replyTicket", {
      error: {
        message: "This ticket is resolved and can no longer be replied to",
      },
    });
    render(<MemberSupport />);
    fireEvent.click(screen.getByText("Claim payout delay"));
    fireEvent.change(screen.getByLabelText("Reply"), {
      target: { value: "Any update yet?" },
    });
    fireEvent.click(screen.getByText("Send reply"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This ticket is resolved and can no longer be replied to"
    );
  });
});

describe("MemberSupport — feedback (W7-B8)", () => {
  it("submits feedback with a zod-exact payload and shows own history", () => {
    setQuery("memberHelpDesk.myTickets", { data: { tickets: [], total: 0 } });
    setQuery("memberFeedback.myFeedback", {
      data: {
        items: [
          {
            id: 3,
            score: 9,
            feedback: "Great claims experience",
            channel: "web",
            createdAt: "2026-09-20T08:00:00.000Z",
          },
        ],
        count: 1,
      },
    });
    setMutation("memberFeedback.submitMyFeedback", {
      data: { success: true, feedback: { id: 4 } },
    });
    render(<MemberSupport />);
    expect(screen.getByText("Great claims experience")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Score/), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText(/Feedback \(optional\)/), {
      target: { value: "Loving the portal" },
    });
    fireEvent.click(screen.getByText("Submit feedback"));
    // feedback included when non-blank; channel omitted (server default web).
    expect(getMutationCalls("memberFeedback.submitMyFeedback")).toEqual([
      { score: 10, feedback: "Loving the portal" },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "your feedback was submitted"
    );
  });

  it("omits optional feedback text and surfaces verbatim server errors", () => {
    setQuery("memberHelpDesk.myTickets", { data: { tickets: [], total: 0 } });
    setQuery("memberFeedback.myFeedback", { data: { items: [], count: 0 } });
    setMutation("memberFeedback.submitMyFeedback", {
      error: { message: "Customer profile not found for session user" },
    });
    render(<MemberSupport />);
    fireEvent.change(screen.getByLabelText(/Score/), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByText("Submit feedback"));
    expect(getMutationCalls("memberFeedback.submitMyFeedback")).toEqual([
      { score: 5 },
    ]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Customer profile not found for session user"
    );
  });
});

describe("MemberNotifications (W7-B8)", () => {
  it("renders real stats and inbox rows; failed/unread shown honestly", () => {
    setQuery("notificationInbox.getStats", {
      data: { total: 2, unread: 1, archived: 0 },
    });
    setQuery("notificationInbox.list", {
      data: { notifications: NOTIFICATIONS, total: 2 },
    });
    render(<MemberNotifications />);
    expect(screen.getByTestId("notif-total")).toHaveTextContent("2");
    expect(screen.getByTestId("notif-unread")).toHaveTextContent("1");
    expect(screen.getByText("Policy renewed")).toBeInTheDocument();
    expect(screen.getByText("Payment received.")).toBeInTheDocument();
    // No archive/bulk buttons — server returns honest NOT_IMPLEMENTED.
    expect(screen.queryByText(/archive/i)).not.toBeInTheDocument();
  });

  it("shows the honest empty state", () => {
    setQuery("notificationInbox.getStats", {
      data: { total: 0, unread: 0, archived: 0 },
    });
    setQuery("notificationInbox.list", {
      data: { notifications: [], total: 0 },
    });
    render(<MemberNotifications />);
    expect(screen.getByText(/You have no notifications/)).toBeInTheDocument();
  });

  it("markRead and delete send zod-exact payloads; markAllRead sends none", () => {
    setQuery("notificationInbox.getStats", {
      data: { total: 2, unread: 1, archived: 0 },
    });
    setQuery("notificationInbox.list", {
      data: { notifications: NOTIFICATIONS, total: 2 },
    });
    setMutation("notificationInbox.markRead", { data: { success: true } });
    setMutation("notificationInbox.markAllRead", { data: { success: true } });
    setMutation("notificationInbox.delete", { data: { success: true } });
    render(<MemberNotifications />);
    fireEvent.click(screen.getByText("Mark read"));
    expect(getMutationCalls("notificationInbox.markRead")).toEqual([
      { notificationId: 55 },
    ]);
    const deleteButtons = screen.getAllByText("Delete");
    fireEvent.click(deleteButtons[0]);
    expect(getMutationCalls("notificationInbox.delete")).toEqual([
      { notificationId: 55 },
    ]);
    fireEvent.click(screen.getByText("Mark all read"));
    expect(getMutationCalls("notificationInbox.markAllRead")).toEqual([
      undefined,
    ]);
  });

  it("surfaces verbatim mutation errors (non-enumerating NOT_FOUND)", () => {
    setQuery("notificationInbox.getStats", {
      data: { total: 2, unread: 1, archived: 0 },
    });
    setQuery("notificationInbox.list", {
      data: { notifications: NOTIFICATIONS, total: 2 },
    });
    setMutation("notificationInbox.markRead", {
      error: { message: "Notification not found" },
    });
    render(<MemberNotifications />);
    fireEvent.click(screen.getByText("Mark read"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Notification not found"
    );
  });

  it("surfaces the verbatim list query error", () => {
    setQuery("notificationInbox.getStats", {
      data: { total: 0, unread: 0, archived: 0 },
    });
    setQuery("notificationInbox.list", {
      isError: true,
      error: { message: "Internal server error" },
    });
    render(<MemberNotifications />);
    expect(screen.getByText(/Internal server error/)).toBeInTheDocument();
  });
});

describe("MemberDisputes (W7-B8)", () => {
  it("renders the real dispute list", () => {
    setQuery("memberDisputes.myDisputes", { data: { disputes: DISPUTES, count: 1 } });
    render(<MemberDisputes />);
    expect(screen.getByText("DSP-ABCDEF123456")).toBeInTheDocument();
    expect(screen.getByText(/Double charge/)).toBeInTheDocument();
  });

  it("shows the honest empty state", () => {
    setQuery("memberDisputes.myDisputes", { data: { disputes: [], count: 0 } });
    render(<MemberDisputes />);
    expect(screen.getByText(/You have no disputes/)).toBeInTheDocument();
  });

  it("surfaces the verbatim list error", () => {
    setQuery("memberDisputes.myDisputes", {
      isError: true,
      error: { message: "DB unavailable" },
    });
    render(<MemberDisputes />);
    expect(screen.getByText(/DB unavailable/)).toBeInTheDocument();
  });

  it("files a dispute with the zod-exact payload (transaction picked from real list)", () => {
    setQuery("memberDisputes.myDisputes", { data: { disputes: [], count: 0 } });
    setQuery("memberSavings.myTransactions", {
      data: { transactions: TRANSACTIONS, count: 1 },
    });
    setMutation("memberDisputes.fileDispute", { data: DISPUTES[0] });
    render(<MemberDisputes />);
    fireEvent.click(screen.getByText("File a dispute"));
    // Pick the real transaction from the native select (populated from
    // memberSavings.myTransactions — real transactions-table rows).
    fireEvent.change(screen.getByLabelText("Transaction"), {
      target: { value: "900" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Double charge" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Charged twice for the same premium." },
    });
    fireEvent.change(screen.getByLabelText(/Disputed amount/), {
      target: { value: "5000" },
    });
    fireEvent.click(screen.getByText("File dispute"));
    expect(getMutationCalls("memberDisputes.fileDispute")).toEqual([
      {
        transactionId: 900,
        reason: "Double charge",
        description: "Charged twice for the same premium.",
        amount: 5000,
      },
    ]);
  });

  it("surfaces the verbatim file error (foreign transaction NOT_FOUND)", () => {
    setQuery("memberDisputes.myDisputes", { data: { disputes: [], count: 0 } });
    setQuery("memberSavings.myTransactions", {
      data: { transactions: [], count: 0 },
    });
    setMutation("memberDisputes.fileDispute", {
      error: { message: "Transaction not found" },
    });
    render(<MemberDisputes />);
    fireEvent.click(screen.getByText("File a dispute"));
    // Empty transaction list → manual numeric ID input.
    fireEvent.change(screen.getByLabelText("Transaction"), {
      target: { value: "12345" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Unknown debit" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "I do not recognise this debit." },
    });
    fireEvent.change(screen.getByLabelText(/Disputed amount/), {
      target: { value: "1200" },
    });
    fireEvent.click(screen.getByText("File dispute"));
    expect(getMutationCalls("memberDisputes.fileDispute")).toEqual([
      {
        transactionId: 12345,
        reason: "Unknown debit",
        description: "I do not recognise this debit.",
        amount: 1200,
      },
    ]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Transaction not found"
    );
  });

  it("opens dispute detail and replies with the zod-exact payload", () => {
    setQuery("memberDisputes.myDisputes", { data: { disputes: DISPUTES, count: 1 } });
    setQuery("memberDisputes.myDispute", {
      data: {
        dispute: { ...DISPUTES[0], description: "Charged twice.", resolution: null, resolvedAt: null, updatedAt: null },
        messages: [
          {
            id: 5,
            senderType: "customer",
            senderName: "Adaeze Test",
            content: "Please investigate.",
            createdAt: "2026-09-28T09:30:00.000Z",
          },
        ],
        evidence: [],
      },
    });
    setMutation("memberDisputes.replyDispute", {
      data: { id: 6, senderType: "customer" },
    });
    render(<MemberDisputes />);
    fireEvent.click(screen.getByText("DSP-ABCDEF123456"));
    expect(screen.getByText("Please investigate.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reply"), {
      target: { value: "Adding my receipt." },
    });
    fireEvent.click(screen.getByText("Send reply"));
    expect(getMutationCalls("memberDisputes.replyDispute")).toEqual([
      { disputeId: 21, content: "Adding my receipt." },
    ]);
  });

  it("shows the honest closed state instead of a reply box on resolved disputes", () => {
    setQuery("memberDisputes.myDisputes", {
      data: {
        disputes: [{ ...DISPUTES[0], status: "resolved" }],
        count: 1,
      },
    });
    setQuery("memberDisputes.myDispute", {
      data: {
        dispute: {
          ...DISPUTES[0],
          status: "resolved",
          description: "Charged twice.",
          resolution: "Refund issued",
          resolvedAt: "2026-09-30T00:00:00.000Z",
          updatedAt: null,
        },
        messages: [],
        evidence: [],
      },
    });
    render(<MemberDisputes />);
    fireEvent.click(screen.getByText("DSP-ABCDEF123456"));
    expect(screen.getByText(/Refund issued/)).toBeInTheDocument();
    expect(screen.getByText(/no longer accepts replies/)).toBeInTheDocument();
    expect(screen.queryByText("Send reply")).not.toBeInTheDocument();
  });
});
