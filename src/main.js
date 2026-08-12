import { TuiTerminal } from './terminal.js';

const terminal = new TuiTerminal('terminal-container');

async function invoke(command, args = {}) {
  return window.__TAURI__.invoke(command, args);
}

async function init() {
  try {
    const pid = await invoke('spawn_tui', {
      file: 'mimo',
      args: [],
      cols: terminal.term.cols,
      rows: terminal.term.rows,
    });
    console.log('TUI spawned with pid:', pid);
    window.__TAURI__currentPid = pid;
  } catch (err) {
    console.error('Failed to spawn TUI:', err);
  }
}

terminal.onInput = async (data) => {
  try {
    await invoke('write_tui', {
      pid: window.__TAURI__currentPid,
      data: data,
    });
  } catch (err) {
    console.error('Write failed:', err);
  }
};

window.__TAURI__.event.listen('pty-output', (event) => {
  terminal.write(event.payload);
});

init();
