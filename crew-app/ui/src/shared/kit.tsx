import type { ReactNode } from 'react';

/**
 * The few presentational pieces the shared Daemonwatch components need. The standalone
 * page uses plain HTML (htmlKit); the Crew page maps these to @kirocrew/app-sdk/ui.
 */
export interface UiKit {
  Header(props: { title: string; subtitle?: string }): ReactNode;
  Card(props: { title?: ReactNode; titleId?: string; children: ReactNode }): ReactNode;
  Button(props: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; variant?: 'primary' | 'danger'; ariaLabel?: string; disabled?: boolean }): ReactNode;
  Empty(props: { text: string }): ReactNode;
}

export const htmlKit: UiKit = {
  Header: ({ title, subtitle }) => (
    <header className="top">
      <h1>
        {title} {subtitle && <span className="muted">{subtitle}</span>}
      </h1>
    </header>
  ),
  Card: ({ title, titleId, children }) => (
    <section className="card" aria-labelledby={titleId}>
      {title && <h2 id={titleId}>{title}</h2>}
      {children}
    </section>
  ),
  Button: ({ children, onClick, type = 'button', variant, ariaLabel, disabled }) => (
    <button type={type} className={variant} onClick={onClick} aria-label={ariaLabel} disabled={disabled}>
      {children}
    </button>
  ),
  Empty: ({ text }) => <p className="muted">{text}</p>,
};
