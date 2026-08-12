import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

export class TuiTerminal {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, Monaco, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#cccccc',
      }
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());

    this.term.open(this.container);
    this.fitAddon.fit();

    window.addEventListener('resize', () => this.fitAddon.fit());

    this.term.onData((data) => {
      if (this.onInput) {
        this.onInput(data);
      }
    });
  }

  write(data) {
    this.term.write(data);
  }

  clear() {
    this.term.clear();
  }

  resize(cols, rows) {
    this.term.resize(cols, rows);
  }
}
