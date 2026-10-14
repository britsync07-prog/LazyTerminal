import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { XTERM_HTML } from '../assets/xterm-bundle';

interface TerminalViewProps {
  sessionId: string;
  onInput: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  lastOutput?: string;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  sessionId,
  onInput,
  onResize,
  lastOutput,
}) => {
  const webViewRef = useRef<WebView>(null);

  // Injects incoming output into the WebView
  useEffect(() => {
    if (lastOutput && webViewRef.current) {
      const payload = JSON.stringify({ type: 'output', data: lastOutput });
      const jsCode = `
        if (window.handleMessage) {
          window.handleMessage({ data: ${JSON.stringify(payload)} });
        }
      `;
      webViewRef.current.injectJavaScript(jsCode);
    }
  }, [lastOutput]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'input') {
        onInput(msg.data);
      } else if (msg.type === 'resize' && onResize) {
        onResize(msg.cols, msg.rows);
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
        scrollEnabled={false}
        overScrollMode="never"
        keyboardDisplayRequiresUserAction={false}
        automaticallyAdjustContentInsets={false}
        scalesPageToFit={false}
      />
    </View>
  );
};

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
