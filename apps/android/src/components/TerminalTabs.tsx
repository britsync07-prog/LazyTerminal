import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import type { TerminalTab } from '../types.js';

interface TerminalTabsProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onDisconnect: () => void;
}

export const TerminalTabs: React.FC<TerminalTabsProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onDisconnect,
}) => {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.activeTab]}
              onPress={() => onSelectTab(tab.id)}
            >
              <View style={styles.tabContent}>
                <View style={[styles.statusDot, isActive && styles.statusDotActive]} />
                <Text
                  style={[styles.tabText, isActive && styles.activeTabText]}
                  numberOfLines={1}
                >
                  {tab.title}
                </Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => onCloseTab(tab.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity style={styles.newTabButton} onPress={onNewTab}>
          <Text style={styles.newTabText}>+ New</Text>
        </TouchableOpacity>
      </ScrollView>

      <TouchableOpacity
        style={styles.disconnectButton}
        onPress={onDisconnect}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.disconnectText}>Disconnect</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 44,
    backgroundColor: '#161b22',
    borderBottomWidth: 1,
    borderBottomColor: '#30363d',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  scrollContent: {
    alignItems: 'center',
    paddingRight: 12,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 6,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  activeTab: {
    backgroundColor: '#21262d',
    borderColor: '#388bfd',
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#6e7681',
    marginRight: 6,
  },
  statusDotActive: {
    backgroundColor: '#3fb950',
  },
  tabText: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '500',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginRight: 8,
  },
  activeTabText: {
    color: '#f0f6fc',
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 2,
  },
  closeButtonText: {
    color: '#8b949e',
    fontSize: 11,
  },
  newTabButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#30363d',
    justifyContent: 'center',
    alignItems: 'center',
  },
  newTabText: {
    color: '#58a6ff',
    fontSize: 12,
    fontWeight: '600',
  },
  disconnectButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginLeft: 4,
  },
  disconnectText: {
    color: '#f85149',
    fontSize: 12,
    fontWeight: '600',
  },
});
