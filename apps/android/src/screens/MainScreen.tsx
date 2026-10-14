import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TerminalClient } from '../services/terminal-client';
import { ConnectionScreen } from '../components/ConnectionScreen';
import { TerminalTabs } from '../components/TerminalTabs';
import { TerminalView, TerminalViewHandle } from '../components/TerminalView';
import { ControlToolbar } from '../components/ControlToolbar';
import type { ConnectionState, TerminalTab, PairingPrompt } from '../types';

export const MainScreen: React.FC = () => {
  const clientRef = useRef<TerminalClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new TerminalClient();
  }
  const client = clientRef.current;

  const terminalRefs = useRef<Record<string, TerminalViewHandle | null>>({});

  const [state, setState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | undefined>();
  const [pairingPrompt, setPairingPrompt] = useState<PairingPrompt | null>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [lastOutputMap, setLastOutputMap] = useState<Record<string, string>>({});
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [fontSize, setFontSize] = useState<number>(13);
  const [scrolledUpMap, setScrolledUpMap] = useState<
    Record<string, { isScrolledUp: boolean; linesFromBottom: number }>
  >({});

  useEffect(() => {
    const unsubState = client.onStateChange((newState, newError) => {
      setState(newState);
      setError(newError);
      if (newState === 'connected') {
        setPairingPrompt(null);
        // Auto-create initial session if none exists
        if (client.getTabs().length === 0) {
          handleCreateTerminal();
        }
      }
    });

    const unsubPair = client.onPairPrompt((prompt) => {
      setPairingPrompt(prompt);
    });

    const unsubSessionCreated = (tab: TerminalTab) => {
      setTabs(client.getTabs());
      setActiveTabId(client.getActiveTabId());
      setIsCreatingSession(false);
    };
    const unsubCreated = client.onSessionCreated(unsubSessionCreated);

    const unsubClosed = (sessionId: string) => {
      setTabs(client.getTabs());
      setActiveTabId(client.getActiveTabId());
      setScrolledUpMap((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      delete terminalRefs.current[sessionId];
    };
    const unsubSessionClosed = client.onSessionClosed(unsubClosed);

    const unsubOutput = client.onOutput((sessionId, data) => {
      setLastOutputMap((prev) => ({
        ...prev,
        [sessionId]: data,
      }));
    });

    return () => {
      unsubState();
      unsubPair();
      unsubCreated();
      unsubSessionClosed();
      unsubOutput();
      client.disconnect();
    };
  }, []);

  const handleConnect = (host: string, port: number) => {
    setError(undefined);
    client.connect({ host, port });
  };

  const handleVerifyPairing = (code: string) => {
    setError(undefined);
    try {
      client.submitPairingCode(code);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreateTerminal = async () => {
    setIsCreatingSession(true);
    try {
      await client.createTerminal();
    } catch (err) {
      setError((err as Error).message);
      setIsCreatingSession(false);
    }
  };

  const handleSelectTab = (sessionId: string) => {
    client.setActiveTabId(sessionId);
    setActiveTabId(sessionId);
    // Fit terminal on tab switch to ensure layout matches current viewport
    setTimeout(() => {
      terminalRefs.current[sessionId]?.fit();
    }, 50);
  };

  const handleCloseTab = (sessionId: string) => {
    client.closeTerminal(sessionId);
  };

  const handleSendInput = (data: string) => {
    if (activeTabId) {
      client.sendInput(activeTabId, data);
    }
  };

  const handleInterrupt = () => {
    if (activeTabId) {
      client.sendInterrupt(activeTabId);
    }
  };

  const handleResize = (cols: number, rows: number) => {
    if (activeTabId) {
      client.resizeTerminal(activeTabId, cols, rows);
    }
  };

  const handleDisconnect = () => {
    client.disconnect();
    setTabs([]);
    setActiveTabId(null);
    setLastOutputMap({});
    setScrolledUpMap({});
  };

  const handleScrollStatusChange = (sessionId: string, isScrolledUp: boolean, linesFromBottom: number) => {
    setScrolledUpMap((prev) => ({
      ...prev,
      [sessionId]: { isScrolledUp, linesFromBottom },
    }));
  };

  const handleScrollToBottom = () => {
    if (activeTabId && terminalRefs.current[activeTabId]) {
      terminalRefs.current[activeTabId]?.scrollToBottom();
    }
  };

  const handleScrollToTop = () => {
    if (activeTabId && terminalRefs.current[activeTabId]) {
      terminalRefs.current[activeTabId]?.scrollToTop();
    }
  };

  const handleIncreaseFont = () => {
    setFontSize((prev) => Math.min(22, prev + 1));
  };

  const handleDecreaseFont = () => {
    setFontSize((prev) => Math.max(9, prev - 1));
  };

  const activeScrollStatus = activeTabId ? scrolledUpMap[activeTabId] : undefined;

  // If not connected or pairing required, show connection screen
  if (state !== 'connected' || tabs.length === 0) {
    if (state === 'connected' && tabs.length === 0) {
      return (
        <SafeAreaView style={styles.container}>
          <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
          <View style={styles.emptyContainer}>
            {isCreatingSession ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color="#58a6ff" />
                <Text style={styles.loadingText}>Spawning PowerShell PTY session...</Text>
              </View>
            ) : (
              <View style={styles.centerBox}>
                <Text style={styles.emptyTitle}>Connected to Windows Agent</Text>
                <Text style={styles.emptyDesc}>No active terminal sessions open.</Text>
                <TouchableOpacity
                  style={styles.newSessionButton}
                  onPress={handleCreateTerminal}
                >
                  <Text style={styles.newSessionButtonText}>+ Open New Terminal</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.disconnectLink}
                  onPress={handleDisconnect}
                >
                  <Text style={styles.disconnectLinkText}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
        <ConnectionScreen
          state={state}
          error={error}
          pairingPrompt={pairingPrompt}
          onConnect={handleConnect}
          onVerifyPairing={handleVerifyPairing}
          onDismissError={() => setError(undefined)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#161b22" />
      <TerminalTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewTab={handleCreateTerminal}
        onDisconnect={handleDisconnect}
      />

      <View style={styles.terminalsContainer}>
        {tabs.map((tab) => (
          <View
            key={tab.id}
            style={[
              styles.terminalWrapper,
              tab.id === activeTabId ? styles.activeTerminal : styles.hiddenTerminal,
            ]}
          >
            <TerminalView
              ref={(r) => {
                terminalRefs.current[tab.id] = r;
              }}
              sessionId={tab.id}
              fontSize={fontSize}
              onInput={handleSendInput}
              onResize={handleResize}
              lastOutput={lastOutputMap[tab.id]}
              initialOutput={client.getSessionHistory(tab.id)}
              onScrollStatusChange={handleScrollStatusChange}
            />
          </View>
        ))}

        {/* Floating Return to Bottom Button when browsing scrollback history */}
        {activeScrollStatus?.isScrolledUp && (
          <TouchableOpacity
            style={styles.floatingBottomButton}
            onPress={handleScrollToBottom}
            activeOpacity={0.8}
          >
            <Text style={styles.floatingBottomText}>
              ▼ Return to live output ({activeScrollStatus.linesFromBottom} lines up)
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <ControlToolbar
        fontSize={fontSize}
        onSendKey={handleSendInput}
        onInterrupt={handleInterrupt}
        onScrollTop={handleScrollToTop}
        onScrollBottom={handleScrollToBottom}
        onIncreaseFont={handleIncreaseFont}
        onDecreaseFont={handleDecreaseFont}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  terminalsContainer: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#0d1117',
  },
  terminalWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  activeTerminal: {
    opacity: 1,
    zIndex: 1,
    pointerEvents: 'auto',
  },
  hiddenTerminal: {
    opacity: 0,
    zIndex: 0,
    pointerEvents: 'none',
  },
  floatingBottomButton: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    backgroundColor: '#1f6feb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 6,
    zIndex: 10,
    borderWidth: 1,
    borderColor: '#58a6ff',
  },
  floatingBottomText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  centerBox: {
    alignItems: 'center',
    maxWidth: 320,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f0f6fc',
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: '#8b949e',
    marginBottom: 20,
    textAlign: 'center',
  },
  loadingText: {
    color: '#58a6ff',
    marginTop: 14,
    fontSize: 14,
  },
  newSessionButton: {
    backgroundColor: '#238636',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 6,
    width: '100%',
    alignItems: 'center',
  },
  newSessionButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  disconnectLink: {
    marginTop: 16,
    padding: 8,
  },
  disconnectLinkText: {
    color: '#f85149',
    fontSize: 13,
  },
});
