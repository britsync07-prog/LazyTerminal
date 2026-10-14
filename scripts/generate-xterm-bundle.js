const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const xtermJsPath = path.join(repoRoot, 'apps/android/node_modules/@xterm/xterm/lib/xterm.js');
const xtermCssPath = path.join(repoRoot, 'apps/android/node_modules/@xterm/xterm/css/xterm.css');
const fitAddonJsPath = path.join(repoRoot, 'apps/android/node_modules/@xterm/addon-fit/lib/addon-fit.js');
const targetFile = path.join(repoRoot, 'apps/android/src/assets/xterm-bundle.ts');

const xtermJs = fs.readFileSync(xtermJsPath, 'utf8');
const xtermCss = fs.readFileSync(xtermCssPath, 'utf8');
const fitAddonJs = fs.readFileSync(fitAddonJsPath, 'utf8');

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>LazyTerminal</title>
  <style>
${xtermCss}
    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      background-color: #0d1117;
      overflow: hidden;
      touch-action: pan-y;
      overscroll-behavior: contain;
    }
    #terminal-container {
      width: 100%;
      height: 100%;
      padding: 4px;
      overflow: hidden;
      touch-action: pan-y;
      position: relative;
    }
    .xterm {
      height: 100%;
      width: 100%;
      touch-action: pan-y;
    }
    .xterm .xterm-viewport {
      overflow-y: auto !important;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
    }
  </style>
</head>
<body>
  <div id="terminal-container"></div>
  <script>
${xtermJs}
  </script>
  <script>
${fitAddonJs}
  </script>
  <script>
    (function() {
      function postToReactNative(obj) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(obj));
        }
      }

      var term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 13,
        fontFamily: 'Consolas, monospace, "Cascadia Code"',
        lineHeight: 1.2,
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          selectionBackground: 'rgba(88, 166, 255, 0.3)',
          black: '#484f58',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#f0f6fc',
        },
        convertEol: true,
        scrollback: 10000,
        scrollOnUserInput: true,
        allowTransparency: false,
      });

      var fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);

      var container = document.getElementById('terminal-container');
      term.open(container);

      try {
        fitAddon.fit();
      } catch (e) {}

      function getCellHeight() {
        try {
          var h = term._core._renderService.dimensions.css.cell.height;
          if (h && h > 0) return h;
        } catch (e) {}
        return 18;
      }

      function checkScrollStatus() {
        try {
          var buf = term.buffer.active;
          var isScrolledUp = buf.ydisp < buf.ybase;
          var linesFromBottom = buf.ybase - buf.ydisp;
          postToReactNative({
            type: 'scrollStatus',
            isScrolledUp: isScrolledUp,
            linesFromBottom: linesFromBottom,
            ydisp: buf.ydisp,
            ybase: buf.ybase,
          });
        } catch (e) {}
      }

      // Touch gesture support for mobile viewport scrolling
      var touchStartY = 0;
      var touchStartX = 0;
      var touchLastY = 0;
      var touchVelocityY = 0;
      var touchLastTime = 0;
      var touchMoved = false;
      var momentumAnimationId = null;
      var accumulatedScrollDelta = 0;

      container.addEventListener('touchstart', function(e) {
        if (e.touches.length === 1) {
          if (momentumAnimationId) {
            cancelAnimationFrame(momentumAnimationId);
            momentumAnimationId = null;
          }
          touchStartY = e.touches[0].clientY;
          touchStartX = e.touches[0].clientX;
          touchLastY = touchStartY;
          touchLastTime = Date.now();
          touchVelocityY = 0;
          touchMoved = false;
          accumulatedScrollDelta = 0;
        }
      }, { passive: true });

      container.addEventListener('touchmove', function(e) {
        if (e.touches.length === 1) {
          var touch = e.touches[0];
          var deltaY = touch.clientY - touchLastY;
          var totalDeltaY = touch.clientY - touchStartY;
          var totalDeltaX = touch.clientX - touchStartX;
          var now = Date.now();
          var dt = now - touchLastTime;
          if (dt > 0) {
            touchVelocityY = deltaY / dt;
          }
          touchLastY = touch.clientY;
          touchLastTime = now;

          if (Math.abs(totalDeltaY) > 5 || Math.abs(totalDeltaX) > 5) {
            touchMoved = true;
          }

          var cellHeight = getCellHeight();
          accumulatedScrollDelta += deltaY;
          var lines = Math.trunc(accumulatedScrollDelta / cellHeight);
          if (lines !== 0) {
            term.scrollLines(-lines);
            accumulatedScrollDelta -= (lines * cellHeight);
            checkScrollStatus();
          }
        }
      }, { passive: true });

      container.addEventListener('touchend', function(e) {
        if (!touchMoved) {
          term.focus();
          return;
        }

        // Momentum / inertial scrolling on touch release
        if (Math.abs(touchVelocityY) > 0.25) {
          var velocity = touchVelocityY * 16;
          var cellHeight = getCellHeight();
          function momentumStep() {
            velocity *= 0.90;
            var stepLines = Math.round(-velocity / cellHeight * 3);
            if (Math.abs(stepLines) >= 1) {
              term.scrollLines(stepLines);
              checkScrollStatus();
              momentumAnimationId = requestAnimationFrame(momentumStep);
            } else {
              momentumAnimationId = null;
            }
          }
          momentumAnimationId = requestAnimationFrame(momentumStep);
        }
        checkScrollStatus();
      }, { passive: true });

      term.onScroll(function() {
        checkScrollStatus();
      });

      term.onData(function(data) {
        postToReactNative({ type: 'input', data: data });
      });

      term.onResize(function(size) {
        postToReactNative({ type: 'resize', cols: size.cols, rows: size.rows });
      });

      container.addEventListener('click', function() {
        term.focus();
      });

      window.writeTerminal = function(data) {
        term.write(data);
      };

      window.clearTerminal = function() {
        term.clear();
      };

      window.focusTerminal = function() {
        term.focus();
      };

      window.fitTerminal = function() {
        try {
          fitAddon.fit();
        } catch (e) {}
      };

      window.scrollToBottom = function() {
        term.scrollToBottom();
        checkScrollStatus();
      };

      window.scrollToTop = function() {
        term.scrollToTop();
        checkScrollStatus();
      };

      window.scrollLines = function(n) {
        term.scrollLines(n);
        checkScrollStatus();
      };

      window.setFontSize = function(size) {
        term.options.fontSize = size;
        try {
          fitAddon.fit();
        } catch (e) {}
      };

      window.handleMessage = function(event) {
        try {
          var payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (payload.type === 'output') {
            term.write(payload.data);
          } else if (payload.type === 'clear') {
            term.clear();
          } else if (payload.type === 'focus') {
            term.focus();
          } else if (payload.type === 'resize') {
            if (payload.cols && payload.rows) {
              term.resize(payload.cols, payload.rows);
            }
          } else if (payload.type === 'scrollToBottom') {
            term.scrollToBottom();
            checkScrollStatus();
          } else if (payload.type === 'scrollToTop') {
            term.scrollToTop();
            checkScrollStatus();
          } else if (payload.type === 'scrollLines') {
            term.scrollLines(payload.lines || 0);
            checkScrollStatus();
          } else if (payload.type === 'setFontSize') {
            window.setFontSize(payload.size || 13);
          }
        } catch (err) {}
      };

      window.addEventListener('message', window.handleMessage);
      document.addEventListener('message', window.handleMessage);
      window.addEventListener('resize', window.fitTerminal);

      setTimeout(function() {
        window.fitTerminal();
        term.focus();
        postToReactNative({ type: 'ready', cols: term.cols, rows: term.rows });
        checkScrollStatus();
      }, 100);
    })();
  </script>
</body>
</html>`;

const outputTs = `/**
 * Pre-bundled official xterm.js (v6) + @xterm/addon-fit offline HTML bundle
 * Generated automatically from official @xterm packages.
 */
export const XTERM_HTML = ${JSON.stringify(htmlContent)};
`;

fs.writeFileSync(targetFile, outputTs, 'utf8');
console.log('Successfully generated xterm-bundle.ts with size:', outputTs.length);
