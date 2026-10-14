import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';

interface ControlToolbarProps {
  onSendKey: (data: string) => void;
  onInterrupt: () => void;
}

export const ControlToolbar: React.FC<ControlToolbarProps> = ({
  onSendKey,
  onInterrupt,
}) => {
  const buttons = [
    { label: 'Ctrl+C', action: onInterrupt, isSpecial: true },
    { label: 'Tab', action: () => onSendKey('\t') },
    { label: 'Esc', action: () => onSendKey('\x1b') },
    { label: '▲', action: () => onSendKey('\x1b[A') },
    { label: '▼', action: () => onSendKey('\x1b[B') },
    { label: '◄', action: () => onSendKey('\x1b[D') },
    { label: '►', action: () => onSendKey('\x1b[C') },
    { label: 'Enter', action: () => onSendKey('\r\n') },
    { label: 'Clear', action: () => onSendKey('Clear-Host\r\n') },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {buttons.map((btn, idx) => (
          <TouchableOpacity
            key={idx}
            style={[styles.button, btn.isSpecial && styles.specialButton]}
            onPress={btn.action}
            activeOpacity={0.7}
          >
            <Text style={[styles.buttonText, btn.isSpecial && styles.specialButtonText]}>
              {btn.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 42,
    backgroundColor: '#161b22',
    borderTopWidth: 1,
    borderTopColor: '#30363d',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#21262d',
    borderRadius: 6,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    minWidth: 38,
    alignItems: 'center',
  },
  specialButton: {
    backgroundColor: 'rgba(248, 81, 73, 0.15)',
    borderColor: '#f85149',
  },
  buttonText: {
    color: '#c9d1d9',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  specialButtonText: {
    color: '#ff7b72',
    fontWeight: 'bold',
  },
});
