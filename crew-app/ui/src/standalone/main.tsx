// The standalone Daemonwatch page the game server serves at /daemonwatch/ (for judges
// and anyone without Crew). It shares every component with the Crew page.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Daemonwatch } from '../shared/Daemonwatch';
import { htmlKit } from '../shared/kit';
import { drillsClient, type Request } from '../shared/types';
import './styles.css';

const request: Request = async (method, path, body) => {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data;
};

function StandaloneApp() {
  const client = useMemo(() => drillsClient(request, '/api'), []);
  const [status, setStatus] = useState('');
  // The player view is on the same origin as this page.
  return (
    <>
      <main>
        <Daemonwatch kit={htmlKit} client={client} notify={setStatus} onStarted={() => window.open(new URL('/', location.href).href, '_blank', 'noopener')} />
        <p role="status" className="muted">
          {status}
        </p>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StandaloneApp />
  </StrictMode>,
);
