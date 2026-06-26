'use client';

import { useState } from 'react';
import {
  ShoppingCart,
  Clock,
  CheckCircle,
  XCircle,
  TrendingUp,
  MessageSquare,
  Bot,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';

// ── Mock data (replace with API calls) ───────────────────────────
const MOCK_STATS = {
  totalOrders: 156,
  pendingApproval: 7,
  approvedToday: 23,
  rejectedToday: 2,
  aiAccuracy: 94.2,
  messagesProcessed: 184,
};

const MOCK_PENDING = [
  {
    id: 'draft-001',
    customer: 'Nimal Perera',
    phone: '+94 77 123 4567',
    message: 'Need 5 white school shirts size M for Royal College',
    product: 'School Shirt - White',
    qty: 5,
    confidence: 97,
    amount: 'LKR 7,500',
    time: '2 min ago',
  },
  {
    id: 'draft-002',
    customer: 'Kasun Silva',
    phone: '+94 71 987 6543',
    message: 'I want 3 blue shirts medium please',
    product: 'School Shirt - Blue',
    qty: 3,
    confidence: 89,
    amount: 'LKR 4,500',
    time: '8 min ago',
  },
  {
    id: 'draft-003',
    customer: 'Amal Fernando',
    phone: '+94 76 555 2345',
    message: 'Can I get 10 uniform shirts for grade 6',
    product: 'Uniform Shirt',
    qty: 10,
    confidence: 76,
    amount: 'LKR 12,000',
    time: '15 min ago',
  },
];

const MOCK_ACTIVITY = [
  { id: 1, type: 'approved', text: 'ORD-2024-0156 approved by you', time: '5 min ago', icon: CheckCircle, color: 'var(--accent-green)' },
  { id: 2, type: 'ai', text: 'AI extracted order from Kasun Silva', time: '8 min ago', icon: Bot, color: 'var(--accent-blue)' },
  { id: 3, type: 'message', text: 'New WhatsApp message from +94 76 555 2345', time: '15 min ago', icon: MessageSquare, color: 'var(--accent-purple)' },
  { id: 4, type: 'rejected', text: 'ORD-2024-0153 rejected — product out of stock', time: '32 min ago', icon: XCircle, color: 'var(--accent-red)' },
  { id: 5, type: 'synced', text: 'ORD-2024-0152 synced to WooCommerce', time: '1 hr ago', icon: CheckCircle, color: 'var(--accent-green)' },
];

function ConfidenceBadge({ score }: { score: number }) {
  const color = score >= 90 ? 'var(--accent-green)' : score >= 75 ? 'var(--accent-amber)' : 'var(--accent-red)';
  const bg = score >= 90 ? 'var(--accent-green-dim)' : score >= 75 ? 'var(--accent-amber-dim)' : 'var(--accent-red-dim)';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        borderRadius: '20px',
        fontSize: '11px',
        fontWeight: 700,
        background: bg,
        color,
      }}
    >
      <Bot size={10} />
      {score}%
    </span>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  dimColor,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  color: string;
  dimColor: string;
}) {
  return (
    <div
      className="glass-card"
      style={{ padding: '20px 24px', cursor: 'default' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: dimColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={18} color={color} />
        </div>
        <TrendingUp size={14} color="var(--accent-green)" />
      </div>
      <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
        {value}
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '2px' }}>{title}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{subtitle}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const handleApprove = (id: string) => {
    setApprovingId(id);
    setTimeout(() => setApprovingId(null), 1500);
  };

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }} className="animate-fade-in">
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
          Operations Dashboard
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
          Thursday, 26 June 2025 · 9:15 AM
        </p>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '28px',
        }}
      >
        <KpiCard
          title="Total Orders"
          value={MOCK_STATS.totalOrders}
          subtitle="All time"
          icon={ShoppingCart}
          color="var(--accent-blue)"
          dimColor="var(--accent-blue-dim)"
        />
        <KpiCard
          title="Pending Approval"
          value={MOCK_STATS.pendingApproval}
          subtitle="Requires your review"
          icon={Clock}
          color="var(--accent-amber)"
          dimColor="var(--accent-amber-dim)"
        />
        <KpiCard
          title="Approved Today"
          value={MOCK_STATS.approvedToday}
          subtitle="Auto + manual"
          icon={CheckCircle}
          color="var(--accent-green)"
          dimColor="var(--accent-green-dim)"
        />
        <KpiCard
          title="AI Accuracy"
          value={`${MOCK_STATS.aiAccuracy}%`}
          subtitle="Order extraction rate"
          icon={Bot}
          color="var(--accent-purple)"
          dimColor="var(--accent-purple-dim)"
        />
        <KpiCard
          title="Messages Processed"
          value={MOCK_STATS.messagesProcessed}
          subtitle="WhatsApp today"
          icon={MessageSquare}
          color="var(--accent-green)"
          dimColor="var(--accent-green-dim)"
        />
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px' }}>
        {/* Pending Orders */}
        <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
          <div
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Pending AI Orders
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {MOCK_STATS.pendingApproval} orders awaiting your approval
              </p>
            </div>
            <span
              className="pulse-green"
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: 'var(--accent-green)',
                display: 'block',
              }}
            />
          </div>

          {MOCK_PENDING.map((draft, i) => (
            <div
              key={draft.id}
              style={{
                padding: '18px 24px',
                borderBottom: i < MOCK_PENDING.length - 1 ? '1px solid var(--border)' : 'none',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                {/* Avatar */}
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-blue))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '15px',
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  {draft.customer[0]}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {draft.customer}
                      </span>
                      <ConfidenceBadge score={draft.confidence} />
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{draft.time}</span>
                  </div>

                  {/* Customer message */}
                  <p
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      fontStyle: 'italic',
                      marginBottom: '8px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    "{draft.message}"
                  </p>

                  {/* AI extraction */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '8px 12px',
                      background: 'var(--bg-secondary)',
                      borderRadius: '8px',
                      marginBottom: '12px',
                    }}
                  >
                    <Bot size={14} color="var(--accent-blue)" />
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>
                      {draft.qty}× {draft.product}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent-green)' }}>
                      {draft.amount}
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1, justifyContent: 'center', padding: '7px 12px', fontSize: '13px' }}
                      onClick={() => handleApprove(draft.id)}
                    >
                      {approvingId === draft.id ? '✓ Approved!' : '✓ Approve Order'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '7px 12px', fontSize: '13px' }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: '7px 12px', fontSize: '13px' }}
                    >
                      ✗
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div
            style={{
              padding: '14px 24px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
              color: 'var(--accent-blue)',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            View all pending orders <ChevronRight size={14} />
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* AI Status */}
          <div className="glass-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              AI Engine Status
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { label: 'Intent Detection', score: 98 },
                { label: 'Product Matching', score: 91 },
                { label: 'Order Completeness', score: 87 },
              ].map((item) => (
                <div key={item.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{item.label}</span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.score}%</span>
                  </div>
                  <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${item.score}%`,
                        background: `linear-gradient(90deg, var(--accent-green), var(--accent-blue))`,
                        borderRadius: '2px',
                        transition: 'width 1s ease',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Activity feed */}
          <div className="glass-card" style={{ padding: '20px', flex: 1 }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Recent Activity
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {MOCK_ACTIVITY.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '8px',
                        background: item.color + '20',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: '1px',
                      }}
                    >
                      <Icon size={13} color={item.color} />
                    </div>
                    <div>
                      <p style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                        {item.text}
                      </p>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.time}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick alert */}
          <div
            style={{
              padding: '14px 16px',
              background: 'var(--accent-amber-dim)',
              border: '1px solid var(--accent-amber)',
              borderRadius: '12px',
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
            }}
          >
            <AlertCircle size={16} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: '1px' }} />
            <div>
              <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-amber)', marginBottom: '2px' }}>
                Low Stock Alert
              </p>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                School Shirt (White, M) has only 8 units remaining.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
