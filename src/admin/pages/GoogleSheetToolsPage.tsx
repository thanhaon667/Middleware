import React, { useEffect, useMemo, useState } from 'react';

type ConfigRecord = {
  id: number;
  clientName: string;
  sheetUrl: string;
  sheetTab?: string;
  isActive?: boolean;
  lastSyncStatus?: string;
  lastSyncMessage?: string;
  lastSyncedAt?: string;
};

const card: React.CSSProperties = {
  border: '1px solid #d9dce1',
  borderRadius: 10,
  padding: 16,
  marginBottom: 14,
  background: '#fff'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #c0c4cc',
  borderRadius: 8,
  fontSize: 14
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 14px',
  border: '1px solid #445',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#f2f4f8',
  fontSize: 14
};

async function parseJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || `HTTP ${res.status}` };
  }
}

export default function GoogleSheetToolsPage() {
  const [items, setItems] = useState<ConfigRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [clientName, setClientName] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetTab, setSheetTab] = useState('Orders');

  const backendBase = useMemo(() => '', []);

  async function loadConfigs() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`${backendBase}/api/google-sheet-configs?pagination[pageSize]=100&sort=updatedAt:desc`);
      const json = await parseJsonSafe(res);
      const data = (json?.data || []).map((row: any) => ({ id: row.id, ...row }));
      setItems(data);
    } catch (err: any) {
      setMessage(`Load failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfigs();
  }, []);

  async function connectGoogle(name: string, url: string, tab: string) {
    setMessage('');
    if (!name || !url) {
      setMessage('clientName and sheetUrl are required.');
      return;
    }

    const qs = new URLSearchParams({ sheetUrl: url, sheetTab: tab || 'Orders' }).toString();
    const res = await fetch(`${backendBase}/api/google-sheet-config/auth-url/${encodeURIComponent(name)}?${qs}`);
    const json = await parseJsonSafe(res);
    if (!json?.ok || !json?.authUrl) {
      setMessage(`Connect failed: ${json?.error || 'Cannot create auth URL'}`);
      return;
    }

    const popup = window.open(json.authUrl, '_blank', 'noopener,noreferrer');
    if (!popup) {
      window.location.href = json.authUrl;
      return;
    }

    setMessage('Google consent page opened. After approval, come back and click Refresh list.');
  }

  async function syncNow(name: string) {
    setMessage('');
    const res = await fetch(`${backendBase}/api/google-sheet-config/sync/${encodeURIComponent(name)}`, {
      method: 'POST'
    });
    const json = await parseJsonSafe(res);
    if (!json?.ok) {
      setMessage(`Sync ${name} failed: ${json?.error || 'unknown error'}`);
      return;
    }

    setMessage(`Sync ${name} success. Appended: ${json.appended || 0}`);
    await loadConfigs();
  }

  async function syncAll() {
    setMessage('');
    const res = await fetch(`${backendBase}/api/google-sheet-config/sync-all`, { method: 'POST' });
    const json = await parseJsonSafe(res);
    if (!json?.ok) {
      setMessage(`Sync all failed: ${json?.error || 'unknown error'}`);
      return;
    }

    setMessage('Sync all completed.');
    await loadConfigs();
  }

  return (
    <div style={{ padding: 24, maxWidth: 1120, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 6 }}>Google Sheet Tools</h1>
      <p style={{ marginTop: 0, color: '#57606a' }}>Connect Google once, then sync MISA orders to Google Sheets.</p>

      <div style={{ ...card, background: '#f8fafc' }}>
        <h3 style={{ marginTop: 0 }}>Quick Setup</h3>
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Create OAuth client in Google Cloud and enable Google Sheets API.</li>
          <li>Set `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.</li>
          <li>Fill `clientName` + `sheetUrl` below, then click `Connect Google`.</li>
          <li>Approve Google consent, return here, click `Refresh list` and `Sync now`.</li>
        </ol>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Connect Google</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 10 }}>
          <input style={inputStyle} placeholder="Client name (example: AppId01)" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          <input style={inputStyle} placeholder="Google Sheet URL" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
          <input style={inputStyle} placeholder="Sheet tab (default: Orders)" value={sheetTab} onChange={(e) => setSheetTab(e.target.value)} />
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={buttonStyle} onClick={() => connectGoogle(clientName.trim(), sheetUrl.trim(), sheetTab.trim() || 'Orders')}>Connect Google</button>
          <button style={buttonStyle} onClick={loadConfigs} disabled={loading}>Refresh list</button>
          <button style={buttonStyle} onClick={syncAll}>Sync all now</button>
        </div>
      </div>

      {message ? <div style={{ ...card, borderColor: '#9bb0d9' }}>{message}</div> : null}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Configured Sheets</h3>
        {items.length === 0 ? <p>No configuration yet.</p> : null}
        {items.map((it) => (
          <div key={it.id} style={{ borderTop: '1px solid #eceff4', paddingTop: 12, marginTop: 12 }}>
            <div><strong>{it.clientName}</strong> ({it.isActive ? 'active' : 'inactive'})</div>
            <div>Sheet: <a href={it.sheetUrl} target="_blank" rel="noreferrer">{it.sheetUrl}</a></div>
            <div>Tab: {it.sheetTab || 'Orders'}</div>
            <div>Last sync: {it.lastSyncedAt || 'never'} | Status: {it.lastSyncStatus || 'never'}</div>
            <div>Message: {it.lastSyncMessage || '-'}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button style={buttonStyle} onClick={() => connectGoogle(it.clientName, it.sheetUrl, it.sheetTab || 'Orders')}>Reconnect Google</button>
              <button style={buttonStyle} onClick={() => syncNow(it.clientName)}>Sync now</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
