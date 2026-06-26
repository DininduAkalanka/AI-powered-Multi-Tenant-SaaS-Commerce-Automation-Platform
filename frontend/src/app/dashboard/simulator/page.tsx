'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Zap, Phone } from 'lucide-react';

interface ChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  time: string;
  aiProcessed?: boolean;
  confidence?: number;
}

const STARTER_MESSAGES: ChatMessage[] = [
  {
    id: '1',
    direction: 'inbound',
    text: 'Hi! I need 5 white school shirts size Medium for Royal College grade 10',
    time: '09:10',
    aiProcessed: true,
    confidence: 97,
  },
  {
    id: '2',
    direction: 'outbound',
    text: '✅ Order received!\n\n📦 5× School Shirt (White, M)\n💰 Total: LKR 7,500\n📬 Processing your order...\n\nOrder ID: ORD-2024-0156 — Pending approval by store owner.',
    time: '09:10',
  },
];

const QUICK_MESSAGES = [
  'Need 3 blue shirts size L',
  'Can I get 10 school uniforms for grade 8?',
  'I want 2 white shirts medium please',
  'Do you have black shirts in XL?',
  'Order status for #1024?',
];

export default function SimulatorPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(STARTER_MESSAGES);
  const [inputText, setInputText] = useState('');
  const [phone, setPhone] = useState('+94 77 123 4567');
  const [isProcessing, setIsProcessing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const messageText = text ?? inputText;
    if (!messageText.trim() || isProcessing) return;

    const inbound: ChatMessage = {
      id: Date.now().toString(),
      direction: 'inbound',
      text: messageText,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, inbound]);
    setInputText('');
    setIsProcessing(true);

    // Simulate AI processing delay
    setTimeout(() => {
      const aiReply: ChatMessage = {
        id: (Date.now() + 1).toString(),
        direction: 'outbound',
        text: '🤖 AI is processing your message...\n\n✅ Order detected!\n📦 Extracting order details...\n💡 Confidence: 94%\n\nDraft order created — awaiting owner approval.',
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        aiProcessed: true,
        confidence: 94,
      };
      setMessages((prev) => [...prev, aiReply]);
      setIsProcessing(false);
    }, 2000);
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }} className="animate-fade-in">
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
          WhatsApp Simulator
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
          Test the AI pipeline without a real WhatsApp Business account
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '20px' }}>
        {/* Chat window */}
        <div className="glass-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '600px' }}>
          {/* Chat header */}
          <div
            style={{
              padding: '14px 20px',
              background: 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #25D366, #128C7E)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Phone size={16} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {phone}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--accent-green)' }}>● Online · Mock Mode</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              <Zap size={14} color="var(--accent-amber)" />
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>AI Active</span>
            </div>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: 'var(--bg-primary)',
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent: msg.direction === 'inbound' ? 'flex-start' : 'flex-end',
                  alignItems: 'flex-end',
                  gap: '8px',
                }}
              >
                {msg.direction === 'inbound' && (
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: 'var(--accent-purple-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <User size={13} color="var(--accent-purple)" />
                  </div>
                )}
                <div
                  style={{
                    maxWidth: '75%',
                    padding: '10px 14px',
                    borderRadius: msg.direction === 'inbound' ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                    background: msg.direction === 'inbound' ? 'var(--bg-card)' : 'linear-gradient(135deg, #25D366, #128C7E)',
                    color: msg.direction === 'inbound' ? 'var(--text-primary)' : '#fff',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.text}
                  <div
                    style={{
                      fontSize: '10px',
                      marginTop: '4px',
                      opacity: 0.6,
                      textAlign: msg.direction === 'outbound' ? 'right' : 'left',
                    }}
                  >
                    {msg.time}
                    {msg.aiProcessed && (
                      <span style={{ marginLeft: '6px' }}>
                        <Bot size={9} style={{ display: 'inline', verticalAlign: 'middle' }} /> AI {msg.confidence}%
                      </span>
                    )}
                  </div>
                </div>
                {msg.direction === 'outbound' && (
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--accent-green), var(--accent-blue))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Bot size={13} color="#000" />
                  </div>
                )}
              </div>
            ))}

            {isProcessing && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: '8px' }}>
                <div
                  style={{
                    padding: '10px 16px',
                    background: 'var(--bg-card)',
                    borderRadius: '16px 4px 16px 16px',
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center',
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: 'var(--accent-green)',
                        animation: `pulse-green 1s ${i * 0.2}s infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <input
              className="input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type a customer message..."
              style={{ flex: 1 }}
            />
            <button
              className="btn btn-primary"
              onClick={() => sendMessage()}
              disabled={isProcessing}
              style={{ padding: '10px 14px', flexShrink: 0 }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Phone input */}
          <div className="glass-card" style={{ padding: '18px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
              Simulated Customer Phone
            </label>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+94 77 123 4567"
            />
          </div>

          {/* Quick messages */}
          <div className="glass-card" style={{ padding: '18px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Quick Test Messages
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {QUICK_MESSAGES.map((msg) => (
                <button
                  key={msg}
                  onClick={() => sendMessage(msg)}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    color: 'var(--text-secondary)',
                    fontSize: '12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-green)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {msg}
                </button>
              ))}
            </div>
          </div>

          {/* Info */}
          <div
            style={{
              padding: '14px 16px',
              background: 'var(--accent-blue-dim)',
              border: '1px solid var(--accent-blue)',
              borderRadius: '12px',
            }}
          >
            <p style={{ fontSize: '12px', color: 'var(--accent-blue)', fontWeight: 600, marginBottom: '4px' }}>
              Mock Mode Active
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              Messages go through the full AI pipeline. Check the Orders tab to see generated draft orders.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
