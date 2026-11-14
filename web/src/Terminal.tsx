import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';

const PROMPT = '\x1b[35mhaunt>\x1b[0m ';

/**
 * The restricted terminal. Lines go to the server over a WebSocket, where only
 * allowlisted `haunt` commands run. Nothing executes in the browser.
 */
export function Terminal({ sessionId, onNarration, onEnded }: { sessionId: string; onNarration: (t: string) => void; onEnded: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onNarration, onEnded });
  callbacks.current = { onNarration, onEnded };

  useEffect(() => {
    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 14,
      screenReaderMode: true,
      theme: { background: '#0e0b16', foreground: '#e8e3f5', cursor: '#c084fc' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    fit.fit();
    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/sessions/${sessionId}/terminal`);
    let line = '';
    const history: string[] = [];
    let cursor = 0;
    let busy = false;

    term.writeln('Type \x1b[1mhaunt help\x1b[0m to see what you can do.');
    term.write(PROMPT);

    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { type: string; ok?: boolean; text?: string };
      if (msg.type === 'output') {
        term.writeln(msg.ok ? (msg.text ?? '') : `\x1b[31m${msg.text ?? ''}\x1b[0m`);
        busy = false;
        term.write(PROMPT);
      } else if (msg.type === 'narration' && msg.text) {
        callbacks.current.onNarration(msg.text);
      } else if (msg.type === 'ended') {
        callbacks.current.onEnded();
      }
    };
    ws.onclose = () => term.writeln('\r\n\x1b[2m(terminal disconnected)\x1b[0m');

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
        history.push(cmd);
        cursor = history.length;
        busy = true;
        ws.send(JSON.stringify({ type: 'command', line: cmd }));
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
      window.removeEventListener('resize', onResize);
      ws.close();
      term.dispose();
    };
  }, [sessionId]);

  return <div className="terminal" ref={host} role="region" aria-label="Restricted terminal. Type haunt help for commands." />;
}
