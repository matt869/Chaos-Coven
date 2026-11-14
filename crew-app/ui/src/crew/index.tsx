// The Daemonwatch page inside the Crew dashboard. Built by vite.crew.config.ts into
// ui/dist/index.mjs; the default export is the page component (per the Crew
// "build your first app" guide). React and the SDK come from the host.
import { useAppApi, useNotify } from '@kirocrew/app-sdk';
import { Btn, Card, CardTitle, EmptyState, PageHeader } from '@kirocrew/app-sdk/ui';
import { useMemo } from 'react';
import { Daemonwatch } from '../shared/Daemonwatch';
import { PLAYER_VIEW_URL } from '../shared/helpers';
import type { UiKit } from '../shared/kit';
import { drillsClient, type Request } from '../shared/types';

/** The backend is reachable through the gateway at /apps/{name}/api/*. */
export const CREW_API_BASE = '/apps/daemonwatch/api';

export const crewKit: UiKit = {
  Header: ({ title, subtitle }) => <PageHeader title={title} subtitle={subtitle} />,
  Card: ({ title, titleId, children }) => (
    <Card>
      {title && <CardTitle id={titleId}>{title}</CardTitle>}
      {children}
    </Card>
  ),
  Button: ({ children, onClick, type = 'button', variant, ariaLabel, disabled }) => (
    <Btn type={type} onClick={onClick} variant={variant} aria-label={ariaLabel} disabled={disabled}>
      {children}
    </Btn>
  ),
  Empty: ({ text }) => <EmptyState title={text} />,
};

export default function DaemonwatchPage() {
  const api = useAppApi();
  const notify = useNotify();
  const client = useMemo(() => {
    const request: Request = (method, path, body) =>
      method === 'GET' ? api.get(path) : method === 'POST' ? api.post(path, body) : api.del(path);
    return drillsClient(request, CREW_API_BASE);
  }, [api]);
  return <Daemonwatch kit={crewKit} client={client} notify={(t) => notify(t)} onStarted={() => window.open(PLAYER_VIEW_URL, '_blank', 'noopener')} />;
}
