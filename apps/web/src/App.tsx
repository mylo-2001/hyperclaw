/**
 * apps/web/src/App.tsx
 * HyperClaw Web UI — TanStack Router + TanStack Query
 * Routes: / (chat), /dashboard, /canvas, /hub, /memory, /settings
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import axios from 'axios';

// ─── Query client ─────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: 1, refetchOnWindowFocus: false }
  }
});

// ─── API ──────────────────────────────────────────────────────────────────────

const api = axios.create({ baseURL: 'http://localhost:18789', timeout: 30000 });

type Page = 'chat' | 'dashboard' | 'canvas' | 'hub' | 'memory' | 'settings';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  thinking?: string;
  toolCalls?: Array<{ name: string; result: string }>;
}

interface GatewayStatus {
  running: boolean;
  port: number;
  channels: string[];
  model: string;
  agentName: string;
  sessions: number;
  uptime: string;
}

interface CostSummary {
  sessions?: number;
  totalInput?: number;
  totalOutput?: number;
  totalCacheRead?: number;
  totalCostUsd?: number;
  totalRuns?: number;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useGatewayStatus() {
  return useQuery<GatewayStatus>({
    queryKey: ['gateway-status'],
    queryFn: async () => {
      const res = await api.get('/api/status');
      return res.data;
    },
    refetchInterval: 5000,
    retry: false
  });
}

function useCostSummary() {
  return useQuery<{ summary: CostSummary }>({
    queryKey: ['cost-summary'],
    queryFn: async () => {
      const res = await api.get('/api/costs');
      return res.data;
    },
    refetchInterval: 30000,
    retry: false
  });
}

function useChat() {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: '0',
    role: 'assistant',
    content: `🦅 **HyperClaw**\n\nReady. Gateway is running on port 18789.`,
    timestamp: new Date().toISOString()
  }]);
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');

  const sendMutation = useMutation({
    mutationFn: async ({ message, thinking }: { message: string; thinking: string }) => {
      // Use EventSource (SSE) for streaming if available, fallback to POST
      const res = await api.post('/api/chat', { message, thinking });
      return res.data;
    },
    onMutate: async ({ message }) => {
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, userMsg]);
      setStreaming(true);
    },
    onSuccess: (data) => {
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || data.text || '(empty)',
        timestamp: new Date().toISOString(),
        thinking: data.thinking,
        toolCalls: data.toolCalls
      };
      setMessages(prev => [...prev, assistantMsg]);
      setStreaming(false);
      qc.invalidateQueries({ queryKey: ['gateway-status'] });
    },
    onError: () => {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '_⚠️ Gateway unreachable. Start with: `hyperclaw daemon start`_',
        timestamp: new Date().toISOString()
      }]);
      setStreaming(false);
    }
  });

  return { messages, sendMutation, streaming };
}

// ─── Components ───────────────────────────────────────────────────────────────

function StatusBadge({ online }: { online: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
      online ? 'text-cyan-400' : 'text-red-400'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        online ? 'bg-cyan-400 animate-pulse' : 'bg-red-500'
      }`} />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

const NAV_ITEMS: Array<{ page: Page; label: string; icon: string }> = [
  { page: 'chat',      label: 'Chat',       icon: '💬' },
  { page: 'dashboard', label: 'Dashboard',  icon: '📊' },
  { page: 'canvas',    label: 'Canvas',     icon: '🎨' },
  { page: 'hub',       label: 'Skills',     icon: '🧩' },
  { page: 'memory',    label: 'Memory',     icon: '🧠' },
  { page: 'settings',  label: 'Settings',   icon: '⚙️' },
];

function Sidebar({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const { data: status, isError } = useGatewayStatus();

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col bg-gray-900 border-r border-gray-800">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🦅</span>
          <div>
            <div className="text-sm font-bold text-red-400 tracking-wide">HyperClaw</div>
            <div className="text-xs text-gray-500">v4.0.0</div>
          </div>
        </div>
      </div>

      {/* Gateway status */}
      <div className="px-4 py-2.5 border-b border-gray-800">
        <div className="text-xs text-gray-500 mb-1">Gateway</div>
        <StatusBadge online={!!status && !isError} />
        {status && (
          <div className="text-xs text-gray-500 mt-1 truncate">
            :{status.port} · {status.sessions} sessions
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV_ITEMS.map(({ page: p, label, icon }) => (
          <button
            key={p}
            onClick={() => setPage(p)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${
              page === p
                ? 'bg-red-900/20 text-red-400 border border-red-900/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
            }`}
          >
            <span>{icon}</span>
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </nav>

      {/* Model */}
      {status?.model && (
        <div className="px-4 py-2.5 border-t border-gray-800">
          <div className="text-xs text-gray-500">Model</div>
          <div className="text-xs text-gray-400 truncate">{status.model}</div>
        </div>
      )}
    </aside>
  );
}

// ─── Chat page ─────────────────────────────────────────────────────────────────

type ThinkingLevel = 'none' | 'low' | 'medium' | 'high';

function ChatPage() {
  const { messages, sendMutation, streaming } = useChat();
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState<ThinkingLevel>('none');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streaming]);

  const send = useCallback(() => {
    if (!input.trim() || sendMutation.isPending) return;
    sendMutation.mutate({ message: input.trim(), thinking });
    setInput('');
  }, [input, thinking, sendMutation]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-red-900/30 flex items-center justify-center text-sm mr-2 flex-shrink-0 mt-1">
                🦅
              </div>
            )}
            <div className={`max-w-xl rounded-2xl px-4 py-3 text-sm ${
              msg.role === 'user'
                ? 'bg-red-700 text-white'
                : 'bg-gray-800 text-gray-200 border border-gray-700'
            }`}>
              {msg.thinking && (
                <div className="text-xs text-gray-500 mb-2 pb-2 border-b border-gray-700 font-mono">
                  💭 {msg.thinking.slice(0, 120)}...
                </div>
              )}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mb-2 space-y-1">
                  {msg.toolCalls.map((tc, i) => (
                    <div key={i} className="text-xs bg-gray-900 rounded px-2 py-1 font-mono">
                      🔧 <span className="text-cyan-400">{tc.name}</span>
                      <span className="text-gray-500 ml-2">→ {tc.result?.slice(0, 60)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="whitespace-pre-wrap">{msg.content}</div>
              <div className="text-xs opacity-40 mt-1 text-right">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}

        {streaming && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-red-900/30 flex items-center justify-center text-sm">🦅</div>
            <div className="bg-gray-800 rounded-2xl px-4 py-3 border border-gray-700">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 bg-red-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-500">Thinking:</span>
          {(['none', 'low', 'medium', 'high'] as ThinkingLevel[]).map(level => (
            <button key={level} onClick={() => setThinking(level)}
              className={`text-xs px-2 py-1 rounded transition-all ${
                thinking === level ? 'bg-red-800 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            rows={1}
            placeholder="Message HyperClaw..."
            className="flex-1 resize-none bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-700 transition-colors"
            style={{ minHeight: '48px', maxHeight: '120px' }}
            onInput={e => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 120) + 'px';
            }}
          />
          <button onClick={send} disabled={!input.trim() || sendMutation.isPending}
            className="bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white px-4 py-3 rounded-xl transition-all font-bold">
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard page ───────────────────────────────────────────────────────────

function DashboardPage() {
  const { data: status, isLoading, isError } = useGatewayStatus();
  const { data: costData } = useCostSummary();

  if (isLoading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="p-6 space-y-4 overflow-y-auto">
      <h2 className="text-lg font-bold text-red-400 flex items-center gap-2">
        <span>📊</span> Dashboard
      </h2>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Gateway', value: isError ? 'Offline' : 'Online', color: isError ? 'text-red-400' : 'text-green-400', icon: '📡' },
          { label: 'Channels', value: String(status?.channels?.length || 0), color: 'text-cyan-400', icon: '📱' },
          { label: 'Sessions', value: String(status?.sessions || 0), color: 'text-gray-300', icon: '👥' },
        ].map(c => (
          <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500 flex items-center gap-1.5 mb-2">{c.icon} {c.label}</div>
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {status && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Gateway Info</div>
            {[
              ['Port', String(status.port)],
              ['Model', status.model],
              ['Agent', status.agentName],
              ['Uptime', status.uptime],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm py-1 border-b border-gray-800 last:border-0">
                <span className="text-gray-500">{k}</span>
                <span className="text-gray-300 font-mono text-xs">{v}</span>
              </div>
            ))}
          </div>

          {status.channels.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Active Channels</div>
              <div className="flex flex-wrap gap-2">
                {status.channels.map(ch => (
                  <div key={ch} className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-3 py-1.5">
                    <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                    <span className="text-xs text-gray-300">{ch}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {costData?.summary && (costData.summary.totalRuns ?? 0) > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">💰 Cost Summary</div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Runs</span><div className="font-mono text-gray-300">{costData.summary.totalRuns}</div></div>
            <div><span className="text-gray-500">Input tokens</span><div className="font-mono text-gray-300">{(costData.summary.totalInput ?? 0).toLocaleString()}</div></div>
            <div><span className="text-gray-500">Output tokens</span><div className="font-mono text-gray-300">{(costData.summary.totalOutput ?? 0).toLocaleString()}</div></div>
            <div><span className="text-gray-500">Est. cost (USD)</span><div className="font-mono text-cyan-400">${(costData.summary.totalCostUsd ?? 0).toFixed(4)}</div></div>
          </div>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Quick Commands</div>
        <div className="grid grid-cols-2 gap-2">
          {[
            'hyperclaw doctor --fix',
            'hyperclaw security audit --deep',
            'hyperclaw hooks list',
            'hyperclaw hub',
            'hyperclaw agents bindings',
            'hyperclaw delivery status',
          ].map(cmd => (
            <div key={cmd} className="font-mono text-xs text-red-400 bg-gray-800 rounded px-3 py-2 truncate">
              $ {cmd}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlaceholderPage({ title, icon, desc, cmd }: { title: string; icon: string; desc: string; cmd?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8 text-center">
      <div>
        <div className="text-5xl mb-4">{icon}</div>
        <h2 className="text-lg font-bold text-gray-300 mb-2">{title}</h2>
        <p className="text-gray-500 text-sm max-w-xs">{desc}</p>
        {cmd && (
          <div className="mt-4 inline-block font-mono text-xs text-red-400 bg-gray-800 rounded px-4 py-2">
            $ {cmd}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

function SettingsPage() {
  const { data: status } = useGatewayStatus();
  const [gatewayUrl, setGatewayUrl] = useState('http://localhost:18789');

  return (
    <div className="p-6 space-y-4 overflow-y-auto">
      <h2 className="text-lg font-bold text-red-400 flex items-center gap-2">
        <span>⚙️</span> Settings
      </h2>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="text-xs text-gray-500 uppercase tracking-wider">Gateway Connection</div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Gateway URL</label>
          <input
            value={gatewayUrl}
            onChange={e => setGatewayUrl(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-700"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-400">{status ? `Connected to port ${status.port}` : 'Disconnected'}</span>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">HyperClaw CLI Commands</div>
        <div className="space-y-1 text-xs font-mono text-gray-400">
          <div className="text-red-400">$ hyperclaw init            </div>
          <div className="text-gray-500">  → run setup wizard</div>
          <div className="text-red-400 mt-2">$ hyperclaw gateway config --regenerate-token</div>
          <div className="text-gray-500">  → new auth token</div>
          <div className="text-red-400 mt-2">$ hyperclaw doctor --fix</div>
          <div className="text-gray-500">  → auto-fix issues</div>
        </div>
      </div>
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────

function AppShell() {
  const [page, setPage] = useState<Page>('chat');

  const renderPage = () => {
    switch (page) {
      case 'chat':      return <ChatPage />;
      case 'dashboard': return <DashboardPage />;
      case 'canvas':    return <PlaceholderPage title="Canvas" icon="🎨" desc="AI-generated UI components" cmd="hyperclaw canvas show" />;
      case 'hub':       return <PlaceholderPage title="Skill Hub" icon="🧩" desc="Browse and install skills" cmd="hyperclaw hub" />;
      case 'memory':    return <PlaceholderPage title="Memory" icon="🧠" desc="AGENTS.md and MEMORY.md" cmd="hyperclaw memory show" />;
      case 'settings':  return <SettingsPage />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-white">
      <Sidebar page={page} setPage={setPage} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderPage()}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
