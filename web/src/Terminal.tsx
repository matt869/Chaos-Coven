import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';

const PROMPT = '\x1b[38;2;240;163;58mhaunt›\x1b[0m ';

export type RunCommand = (line: string) => void;

/**
 * The restricted terminal. Lines go to the server over a WebSocket, where only
 * allowlisted `haunt` commands run. Nothing executes in the browser.
 * `onReady` hands back a function that types and runs a command, for the quick buttons.
 */
export function Terminal({
  sessionId,
  onNarration,
  onEnded,
  onReady,
}: {
  sessionId: string;
  onNarration: (t: string) => void;
  onEnded: () => void;
  onReady?: (run: RunCommand) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onNarration, onEnded, onReady });
  callbacks.current = { onNarration, onEnded, onReady };

  useEffect(() => {
    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono Variable', ui-monospace, 'Cascadia Mono', monospace",
      // Narrow screens fit more of the status table at a smaller size.
      fontSize: host.current && host.current.clientWidth < 420 ? 12 : 14,
      lineHeight: 1.25,
      screenReaderMode: true,
      theme: {
        background: '#1a1d26',
        foreground: '#ece6d8',
        cursor: '#f0a33a',
        selectionBackground: '#f0a33a55',
        red: '#ff7a6b',
        green: '#8ccd9f',
        yellow: '#f0a33a',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    fit.fit();
    // Refit whenever the container changes size (window resize, layout change, rotation).
    const resize = new ResizeObserver(() => fit.fit());
    resize.observe(host.current!);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/sessions/${sessionId}/terminal`);
    let line = '';
    const history: string[] = [];
    let cursor = 0;
    let busy = false;

    term.writeln('\x1b[2mThis is not a shell. Only haunt commands run here.\x1b[0m');
    term.writeln('Type \x1b[1mhaunt help\x1b[0m, or use the buttons above.');
    term.write(PROMPT);

    const send = (cmd: string) => {
      history.push(cmd);
      cursor = history.length;
      busy = true;
      ws.send(JSON.stringify({ type: 'command', line: cmd }));
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { type: string; ok?: boolean; text?: string };
      if (msg.type === 'output') {
        term.writeln(msg.ok ? (msg.text ?? '') : `\x1b[38;2;255;122;107m${msg.text ?? ''}\x1b[0m`);
        busy = false;
        term.write(PROMPT);
      } else if (msg.type === 'narration' && msg.text) {
        callbacks.current.onNarration(msg.text);
      } else if (msg.type === 'ended') {
        callbacks.current.onEnded();
      }
    };
    ws.onclose = () => term.writeln('\r\n\x1b[2m(terminal disconnected)\x1b[0m');

    callbacks.current.onReady?.((cmd) => {
      if (busy || ws.readyState !== ws.OPEN) return;
      term.write(`\x1b[2K\r${PROMPT}${cmd}\r\n`);
      line = '';
      send(cmd);
      term.focus();
    });

    const redraw = () => term.write(`\x1b[2K\r${PROMPT}${line}`);
    const sub = term.onData((data) => {
      if (busy) return;
      if (data === '\r') {
        term.write('\r\n');
        const cmd = line.trim();
        line = '';
        if (cmd === '') return void term.write(PROMPT);
        if (cmd === 'clear') {
          term.clear();
          return void term.write(PROMPT);
        }
        send(cmd);
      } else if (data === '\x7f') {
        if (line.length > 0) {
          line = line.slice(0, -1);
          term.write('\b \b');
        }
      } else if (data === '\x1b[A' || data === '\x1b[B') {
        cursor = Math.max(0, Math.min(history.length, cursor + (data === '\x1b[A' ? -1 : 1)));
        line = history[cursor] ?? '';
        redraw();
      } else if (data === '\x03') {
        line = '';
        term.write('^C\r\n' + PROMPT);
      } else if (data >= ' ' && !data.startsWith('\x1b')) {
        line += data;
        term.write(data);
      }
    });

    return () => {
      sub.dispose();
      resize.disconnect();
      ws.close();
      term.dispose();
    };
  }, [sessionId]);

  return <div className="terminal" ref={host} role="region" aria-label="Restricted terminal. Type haunt help for commands." />;
}
