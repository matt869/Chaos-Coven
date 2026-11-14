// Types for the Crew app SDK, which the Crew host provides at runtime (it is a Vite
// external and is not installed here). Only what Daemonwatch uses, from
// https://kiro.dev/docs/crew/apps/sdk/. Component props are not documented there, so
// they are typed loosely; check them against the host's SDK when it is available.

declare module '@kirocrew/app-sdk' {
  export interface AppApiClient {
    get<T = unknown>(path: string): Promise<T>;
    post<T = unknown>(path: string, body?: unknown): Promise<T>;
    put<T = unknown>(path: string, body?: unknown): Promise<T>;
    patch<T = unknown>(path: string, body?: unknown): Promise<T>;
    del<T = unknown>(path: string): Promise<T>;
  }
  export function useAppApi(): AppApiClient;
  export function useNotify(): (text: string, opts?: Record<string, unknown>) => void;
  export function useNavigate(): (path: string) => void;
}

declare module '@kirocrew/app-sdk/ui' {
  import type { ComponentType, ReactNode } from 'react';
  type Loose = { children?: ReactNode } & Record<string, unknown>;
  export const Card: ComponentType<Loose>;
  export const CardTitle: ComponentType<Loose>;
  export const Btn: ComponentType<Loose>;
  export const PageHeader: ComponentType<Loose>;
  export const EmptyState: ComponentType<Loose>;
}
