import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StatusBar,
} from 'react-native';

const WS_URL = 'wss://your-worker-url/websocket';
const API_URL = 'https://your-worker-url/api/events';

interface FirehoseEvent {
  id: string;
  source: string;
  type: string;
  receivedAt: string;
  payload: any;
}

export default function App() {
  const [events, setEvents] = useState<FirehoseEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const totalRef = useRef(0);

  useEffect(() => {
    fetch(API_URL)
      .then((res) => res.json())
      .then((data) => {
        setEvents(data.slice(0, 50));
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000);
      };
      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
      };

      ws.onmessage = (e) => {
        const message = JSON.parse(e.data);
        if (message.type === 'event') {
          const event = message.data;
          totalRef.current += 1;
          setEvents((prev) => [event, ...prev].slice(0, 100));
        }
      };
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  const formatEvent = (item: FirehoseEvent) => {
    let title = 'Unknown event';
    let subtitle = '';
    let type = item.type || 'unknown';

    if (item.source === 'github') {
      if (type === 'push') {
        const commit = item.payload.head_commit;
        title = commit ? commit.message.split('\n')[0] : 'Push event';
        subtitle = `${item.payload.repository?.full_name || 'unknown'} • ${item.payload.pusher?.name || 'unknown'}`;
      } else if (type === 'pull_request') {
        title = `PR ${item.payload.action}: ${item.payload.pull_request?.title || 'Untitled'}`;
        subtitle = `${item.payload.repository?.full_name || 'unknown'}`;
      } else if (type === 'issues') {
        title = `Issue ${item.payload.action}: ${item.payload.issue?.title || 'Untitled'}`;
        subtitle = `${item.payload.repository?.full_name || 'unknown'}`;
      } else {
        title = `${type}: ${item.payload.repository?.full_name || 'unknown'}`;
        subtitle = item.payload.repository?.full_name || 'unknown';
      }
    }

    const typeColors: Record<string, string> = {
      push: '#3b82f6',
      pull_request: '#a855f7',
      issues: '#f59e0b',
      default: '#64748b',
    };

    return { title, subtitle, type, color: typeColors[type] || typeColors.default };
  };

  const renderEvent = ({ item }: { item: FirehoseEvent }) => {
    const { title, subtitle, type, color } = formatEvent(item);

    return (
      <View style={styles.eventItem}>
        <View style={styles.eventHeader}>
          <View style={[styles.typeBadge, { backgroundColor: color }]}>
            <Text style={styles.typeText}>{type.toUpperCase()}</Text>
          </View>
          <Text style={styles.eventTime}>
            {new Date(item.receivedAt).toLocaleTimeString()}
          </Text>
        </View>
        <Text style={styles.eventTitle}>{title}</Text>
        <Text style={styles.eventSubtitle}>{subtitle}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>GitHub Firehose</Text>
        <View style={[styles.statusBadge, { backgroundColor: connected ? '#22c55e' : '#ef4444' }]}>
          <Text style={styles.statusText}>{connected ? 'LIVE' : 'OFFLINE'}</Text>
        </View>
      </View>

      <View style={styles.statsBar}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{events.length}</Text>
          <Text style={styles.statLabel}>Events</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{totalRef.current}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{connected ? 'Yes' : 'No'}</Text>
          <Text style={styles.statLabel}>Connected</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      ) : (
        <FlatList
          data={events}
          renderItem={renderEvent}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📡</Text>
              <Text style={styles.emptyText}>
                Waiting for events...{'\n'}Set up your GitHub webhook to see commits flow in.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    paddingTop: 10,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f8fafc',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  statsBar: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#1e293b',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f8fafc',
  },
  statLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  },
  list: {
    padding: 16,
  },
  eventItem: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  typeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  eventTime: {
    color: '#64748b',
    fontSize: 12,
  },
  eventTitle: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  eventSubtitle: {
    color: '#94a3b8',
    fontSize: 14,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
});
