/**
 * Self-contained offline xterm HTML bundle for LazyTerminal
 * Rendered inside React Native WebView without requiring external network access.
 */
export const XTERM_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>LazyTerminal</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    body, html {
      width: 100%;
      height: 100%;
      background-color: #0d1117;
      color: #c9d1d9;
      font-family: "Cascadia Code", "Fira Code", "Consolas", monospace;
      font-size: 13px;
      line-height: 1.35;
      overflow: hidden;
      user-select: text;
    }
    #terminal-container {
      width: 100%;
      height: 100%;
      padding: 6px;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      scroll-behavior: smooth;
    }
    #screen {
      white-space: pre-wrap;
      word-break: break-all;
      flex: 1;
    }
    .line {
      min-height: 1.35em;
    }
    .cursor {
      display: inline-block;
      width: 8px;
      height: 1.2em;
      background-color: #58a6ff;
      vertical-align: middle;
      animation: blink 1s step-end infinite;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    #hidden-input {
      position: absolute;
      top: -9999px;
      left: -9999px;
      opacity: 0;
    }
    /* ANSI colors */
    .c-30 { color: #484f58; }
    .c-31 { color: #ff7b72; }
    .c-32 { color: #3fb950; }
    .c-33 { color: #d29922; }
    .c-34 { color: #58a6ff; }
    .c-35 { color: #bc8cff; }
    .c-36 { color: #39c5cf; }
    .c-37 { color: #b1bac4; }
    .c-90 { color: #6e7681; }
    .c-91 { color: #ffa198; }
    .c-92 { color: #56d364; }
    .c-93 { color: #e3b341; }
    .c-94 { color: #79c0ff; }
    .c-95 { color: #d2a8ff; }
    .c-96 { color: #56d4dd; }
    .c-97 { color: #f0f6fc; }
    .bold { font-weight: bold; }
    .dim { opacity: 0.6; }
  </style>
</head>
<body>
  <div id="terminal-container" onclick="focusInput()">
    <div id="screen"></div>
    <span class="cursor" id="cursor"></span>
  </div>
  <input type="text" id="hidden-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />

  <script>
    const screen = document.getElementById('screen');
    const container = document.getElementById('terminal-container');
    const input = document.getElementById('hidden-input');
    const cursor = document.getElementById('cursor');

    let buffer = '';
    const MAX_BUFFER_LINES = 2000;

    function postToReactNative(obj) {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    }

    function focusInput() {
      input.focus();
    }

    input.addEventListener('keydown', (e) => {
      let data = '';
      if (e.key === 'Enter') {
        data = '\\r\\n';
      } else if (e.key === 'Backspace') {
        data = '\\x7f';
      } else if (e.key === 'Tab') {
        e.preventDefault();
        data = '\\t';
      } else if (e.key === 'Escape') {
        data = '\\x1b';
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        data = '\\x1b[A';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        data = '\\x1b[B';
      } else if (e.key === 'ArrowRight') {
        data = '\\x1b[C';
      } else if (e.key === 'ArrowLeft') {
        data = '\\x1b[D';
      } else if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        data = '\\x03';
      }
      if (data) {
        postToReactNative({ type: 'input', data });
      }
    });

    input.addEventListener('input', (e) => {
      const val = input.value;
      if (val) {
        postToReactNative({ type: 'input', data: val });
        input.value = '';
      }
    });

    // Basic ANSI escape code to HTML converter
    function ansiToHtml(text) {
      let sanitized = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Handle simple colors
      sanitized = sanitized.replace(/\\x1b\\[([0-9;]+)m/g, (match, code) => {
        const codes = code.split(';');
        let classes = [];
        for (const c of codes) {
          if (c === '0') return '</span>';
          if (c === '1') classes.push('bold');
          if (c === '2') classes.push('dim');
          if (parseInt(c, 10) >= 30 && parseInt(c, 10) <= 37) classes.push('c-' + c);
          if (parseInt(c, 10) >= 90 && parseInt(c, 10) <= 97) classes.push('c-' + c);
        }
        return classes.length > 0 ? '<span class="' + classes.join(' ') + '">' : '';
      });

      // Strip cursor positioning and control sequences
      sanitized = sanitized.replace(/\\x1b\\[[0-9;?]*[a-zA-Z]/g, '');

      return sanitized;
    }

    function appendOutput(chunk) {
      buffer += chunk;
      // Truncate old buffer if it grows too large
      const lines = buffer.split('\\n');
      if (lines.length > MAX_BUFFER_LINES) {
        buffer = lines.slice(-MAX_BUFFER_LINES).join('\\n');
      }

      screen.innerHTML = ansiToHtml(buffer);
      container.scrollTop = container.scrollHeight;
    }

    function clearScreen() {
      buffer = '';
      screen.innerHTML = '';
    }

    function handleMessage(event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          appendOutput(msg.data);
        } else if (msg.type === 'clear') {
          clearScreen();
        } else if (msg.type === 'focus') {
          focusInput();
        }
      } catch (err) {
        // ignore malformed payloads
      }
    }

    window.addEventListener('message', handleMessage);
    document.addEventListener('message', handleMessage);

    // Initial focus & size reporting
    window.onload = () => {
      focusInput();
      reportDimensions();
    };

    function reportDimensions() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const charWidth = 8;
      const charHeight = 17;
      const cols = Math.max(20, Math.floor((width - 12) / charWidth));
      const rows = Math.max(5, Math.floor((height - 12) / charHeight));
      postToReactNative({ type: 'resize', cols, rows });
    }

    window.addEventListener('resize', reportDimensions);
  </script>
</body>
</html>
`;
