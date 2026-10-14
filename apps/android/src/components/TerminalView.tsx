import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { XTERM_HTML } from '../assets/xterm-bundle';

export interface TerminalViewHandle {
  scrollToBottom: () => void;
  scrollToTop: () => void;
  scrollLines: (lines: number) => void;
  setFontSize: (size: number) => void;
  fit: () => void;
  focus: () => void;
}

export interface TerminalViewProps {
  sessionId: string;
  onInput: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  lastOutput?: string;
  initialOutput?: string;
  fontSize?: number;
  onScrollStatusChange?: (sessionId: string, isScrolledUp: boolean, linesFromBottom: number) => void;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  (
    {
      sessionId,
      onInput,
      onResize,
      lastOutput,
      initialOutput,
      fontSize = 13,
      onScrollStatusChange,
    },
    ref,
  ) => {
    const webViewRef = useRef<WebView>(null);
    const isReadyRef = useRef<boolean>(false);

    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom: () => {
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript('if (window.scrollToBottom) { window.scrollToBottom(); } true;');
          }
        },
        scrollToTop: () => {
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript('if (window.scrollToTop) { window.scrollToTop(); } true;');
          }
        },
        scrollLines: (lines: number) => {
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript(`if (window.scrollLines) { window.scrollLines(${lines}); } true;`);
          }
        },
        setFontSize: (size: number) => {
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript(`if (window.setFontSize) { window.setFontSize(${size}); } true;`);
          }
        },
        fit: () => {
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript('if (window.fitTerminal) { window.fitTerminal(); } true;');
          }
        },
        focus: () => {
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript('if (window.focusTerminal) { window.focusTerminal(); } true;');
          }
        },
      }),
      [],
    );

    // Injects incoming output into the WebView
    useEffect(() => {
      if (lastOutput && webViewRef.current) {
        const jsCode = `if (window.writeTerminal) { window.writeTerminal(${JSON.stringify(lastOutput)}); } true;`;
        webViewRef.current.injectJavaScript(jsCode);
      }
    }, [lastOutput]);

    // Updates font size if changed
    useEffect(() => {
      if (isReadyRef.current && webViewRef.current) {
        webViewRef.current.injectJavaScript(`if (window.setFontSize) { window.setFontSize(${fontSize}); } true;`);
      }
    }, [fontSize]);

    const handleMessage = (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'input') {
          onInput(msg.data);
        } else if (msg.type === 'resize' && onResize) {
          onResize(msg.cols, msg.rows);
        } else if (msg.type === 'scrollStatus' && onScrollStatusChange) {
          onScrollStatusChange(sessionId, !!msg.isScrolledUp, msg.linesFromBottom || 0);
        } else if (msg.type === 'ready') {
          isReadyRef.current = true;
          if (fontSize !== 13 && webViewRef.current) {
            webViewRef.current.injectJavaScript(`if (window.setFontSize) { window.setFontSize(${fontSize}); } true;`);
          }
          if (initialOutput && webViewRef.current) {
            const jsCode = `if (window.writeTerminal) { window.writeTerminal(${JSON.stringify(initialOutput)}); } true;`;
            webViewRef.current.injectJavaScript(jsCode);
          }
          if (onResize && msg.cols && msg.rows) {
            onResize(msg.cols, msg.rows);
          }
        }
      } catch {
        // ignore malformed payloads
      }
    };

    const WebViewComponent = WebView as unknown as React.ComponentType<any>;

    return (
      <View style={styles.container}>
        <WebViewComponent
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: XTERM_HTML }}
          style={styles.webView}
          onMessage={handleMessage}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          scrollEnabled={true}
          nestedScrollEnabled={true}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          keyboardDisplayRequiresUserAction={false}
          automaticallyAdjustContentInsets={false}
          scalesPageToFit={false}
        />
      </View>
    );
  },
);

TerminalView.displayName = 'TerminalView';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  webView: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
});
