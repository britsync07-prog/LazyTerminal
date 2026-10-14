import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';

export interface ControlToolbarProps {
  onSendKey: (data: string) => void;
  onInterrupt: () => void;
  onScrollTop?: () => void;
  onScrollBottom?: () => void;
  onDecreaseFont?: () => void;
  onIncreaseFont?: () => void;
  fontSize?: number;
}

export const ControlToolbar: React.FC<ControlToolbarProps> = ({
  onSendKey,
  onInterrupt,
  onScrollTop,
  onScrollBottom,
  onDecreaseFont,
  onIncreaseFont,
  fontSize = 13,
}) => {
  const buttons: Array<{
    label: string;
    action: () => void;
    isSpecial?: boolean;
    isAction?: boolean;
  }> = [
    { label: 'Ctrl+C', action: onInterrupt, isSpecial: true },
    { label: 'Tab', action: () => onSendKey('\t') },
    { label: 'Esc', action: () => onSendKey('\x1b') },
    { label: '▲', action: () => onSendKey('\x1b[A') },
    { label: '▼', action: () => onSendKey('\x1b[B') },
    { label: '◄', action: () => onSendKey('\x1b[D') },
    { label: '►', action: () => onSendKey('\x1b[C') },
    ...(onScrollBottom ? [{ label: '▼ End', action: onScrollBottom, isAction: true }] : []),
    ...(onScrollTop ? [{ label: '▲ Top', action: onScrollTop, isAction: true }] : []),
    ...(onDecreaseFont ? [{ label: 'A-', action: onDecreaseFont, isAction: true }] : []),
    ...(onIncreaseFont ? [{ label: `A+ (${fontSize}pt)`, action: onIncreaseFont, isAction: true }] : []),
    { label: 'PgUp', action: () => onSendKey('\x1b[5~') },
    { label: 'PgDn', action: () => onSendKey('\x1b[6~') },
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
            style={[
              styles.button,
              btn.isSpecial && styles.specialButton,
              btn.isAction && styles.actionButton,
            ]}
            onPress={btn.action}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.buttonText,
                btn.isSpecial && styles.specialButtonText,
                btn.isAction && styles.actionButtonText,
              ]}
            >
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
    height: 44,
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
    paddingVertical: 7,
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
  actionButton: {
    backgroundColor: 'rgba(88, 166, 255, 0.12)',
    borderColor: '#388bfd',
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
  actionButtonText: {
    color: '#58a6ff',
    fontWeight: 'bold',
  },
});
