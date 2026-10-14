import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import type { ConnectionState, PairingPrompt } from '../types.js';

interface ConnectionScreenProps {
  state: ConnectionState;
  error?: string;
  pairingPrompt?: PairingPrompt | null;
  onConnect: (host: string, port: number) => void;
  onVerifyPairing: (code: string) => void;
  onDismissError: () => void;
}

export const ConnectionScreen: React.FC<ConnectionScreenProps> = ({
  state,
  error,
  pairingPrompt,
  onConnect,
  onVerifyPairing,
  onDismissError,
}) => {
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('4488');
  const [pairingCode, setPairingCode] = useState('');

  const isConnecting = state === 'connecting' || state === 'authenticating';
  const isPairing = state === 'pairing_required';

  const handleConnect = () => {
    onDismissError();
    const portNumber = parseInt(port.trim(), 10) || 4488;
    onConnect(host.trim(), portNumber);
  };

  const handleVerifyPairing = () => {
    onDismissError();
    if (pairingCode.trim().length >= 4) {
      onVerifyPairing(pairingCode.trim());
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>LazyTerminal</Text>
          <Text style={styles.subtitle}>Remote PowerShell for Windows</Text>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isPairing ? (
          <View style={styles.form}>
            <Text style={styles.label}>PC IP Address</Text>
            <TextInput
              style={styles.input}
              value={host}
              onChangeText={setHost}
              placeholder="e.g. 192.168.1.100 or 127.0.0.1"
              placeholderTextColor="#6e7681"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numeric"
            />

            <Text style={styles.label}>Port</Text>
            <TextInput
              style={styles.input}
              value={port}
              onChangeText={setPort}
              placeholder="4488"
              placeholderTextColor="#6e7681"
              keyboardType="number-pad"
            />

            <TouchableOpacity
              style={[styles.button, isConnecting && styles.buttonDisabled]}
              onPress={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <View style={styles.row}>
                  <ActivityIndicator color="#0d1117" size="small" />
                  <Text style={styles.buttonText}>
                    {state === 'authenticating' ? ' Authenticating...' : ' Connecting...'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>Connect to PC</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            <View style={styles.pairingBanner}>
              <Text style={styles.pairingTitle}>Pairing Verification Required</Text>
              <Text style={styles.pairingDesc}>
                {pairingPrompt?.challenge || 'Check your Windows PC terminal for the 6-digit code.'}
              </Text>
            </View>

            <Text style={styles.label}>6-Digit Pairing Code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={pairingCode}
              onChangeText={setPairingCode}
              placeholder="123456"
              placeholderTextColor="#6e7681"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />

            <TouchableOpacity
              style={styles.button}
              onPress={handleVerifyPairing}
            >
              <Text style={styles.buttonText}>Verify & Connect</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleConnect}
            >
              <Text style={styles.secondaryButtonText}>Back to Connection Settings</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 24,
  },
  header: {
    marginBottom: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#58a6ff',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#8b949e',
    marginTop: 4,
  },
  errorBanner: {
    backgroundColor: 'rgba(248, 81, 73, 0.15)',
    borderColor: '#f85149',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff7b72',
    fontSize: 13,
  },
  form: {
    width: '100%',
  },
  label: {
    color: '#c9d1d9',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f0f6fc',
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  codeInput: {
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 6,
    paddingVertical: 12,
  },
  button: {
    backgroundColor: '#238636',
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  secondaryButton: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: '#58a6ff',
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pairingBanner: {
    backgroundColor: 'rgba(56, 139, 253, 0.15)',
    borderColor: '#388bfd',
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    marginBottom: 14,
  },
  pairingTitle: {
    color: '#58a6ff',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
  },
  pairingDesc: {
    color: '#c9d1d9',
    fontSize: 12,
  },
});
