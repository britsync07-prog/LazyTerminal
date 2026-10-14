import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { TerminalClient } from '../services/terminal-client.js';
import { ConnectionScreen } from '../components/ConnectionScreen.js';
import { TerminalTabs } from '../components/TerminalTabs.js';
import { TerminalView } from '../components/TerminalView.js';
import { ControlToolbar } from '../components/ControlToolbar.js';
import type { ConnectionState, TerminalTab, PairingPrompt } from '../types.js';

export const MainScreen: React.FC = () => {
  const clientRef = useRef<TerminalClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new TerminalClient();
  }
  const client = clientRef.current;

  const [state, setState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | undefined>();
  const [pairingPrompt, setPairingPrompt] = useState<PairingPrompt | null>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [lastOutputMap, setLastOutputMap] = useState<Record<string, string>>({});
  const [isCreatingSession, setIsCreatingSession] = useState(false);

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

    const unsubClosed = client.onSessionClosed((sessionId) => {
      setTabs(client.getTabs());
      setActiveTabId(client.getActiveTabId());
    });

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
      unsubClosed();
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
  };

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

      {activeTabId && (
        <TerminalView
          key={activeTabId}
          sessionId={activeTabId}
          onInput={handleSendInput}
          onResize={handleResize}
          lastOutput={lastOutputMap[activeTabId]}
        />
      )}

      <ControlToolbar
        onSendKey={handleSendInput}
        onInterrupt={handleInterrupt}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
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
