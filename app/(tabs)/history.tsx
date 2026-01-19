import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import HistoryCard from '../../components/HistoryCard';
import { API_BASE_URL } from '../../constants/config';
import { HistoryFile, SortOrder } from '../../types/file';

const HistoryCardMemo = React.memo(HistoryCard);

export default function HistoryScreen() {
  const [files, setFiles] = useState<HistoryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('recent');
  const [displayCount, setDisplayCount] = useState(15); // 초기 15개 표시

  const fetchRecentFiles = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${API_BASE_URL}/files/history`);
      
      if (!res.ok) {
        throw new Error('서버 응답 오류');
      }
      
      const data = await res.json();
      setFiles(data);
    } catch (e) {
      console.error('Error fetching history:', e);
      setError('히스토리를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setDisplayCount(15); // 새로고침 시 다시 15개로 리셋
    fetchRecentFiles();
  }, [fetchRecentFiles]);

  const handleSort = useCallback(() => {
    const nextOrder: SortOrder = sortOrder === 'recent' ? 'oldest' : 'recent';
    
    setSortOrder(nextOrder);
    
    const sorted = [...files].sort((a, b) => {
      const timeA = new Date(a.lastReadAt).getTime();
      const timeB = new Date(b.lastReadAt).getTime();
      
      return nextOrder === 'recent' 
        ? timeB - timeA  // 최신순 (내림차순)
        : timeA - timeB; // 오래된순 (오름차순)
    });
    
    setDisplayCount(15); // 정렬 시 다시 15개로 리셋
    setFiles(sorted);
  }, [sortOrder, files]);

  const getSortLabel = () => {
    return sortOrder === 'recent' ? '최신순' : '오래된순';
  };

  useEffect(() => {
    fetchRecentFiles();
  }, [fetchRecentFiles]);

  // 로딩 상태
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.header}>히스토리</Text>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.header}>히스토리</Text>
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchRecentFiles}>
            <Text style={styles.retryButtonText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>히스토리</Text>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>최근 본</Text>
        <TouchableOpacity onPress={handleSort}>
          <Text style={styles.sort}>↕ {getSortLabel()}</Text>
        </TouchableOpacity>
      </View>

      {files.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>최근에 읽은 파일이 없어요</Text>
        </View>
      ) : (
        <FlatList
          data={files.slice(0, displayCount)}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item }) => <HistoryCardMemo {...item} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#007AFF"
            />
          }
          onEndReached={() => {
            if (displayCount < files.length) {
              setDisplayCount((prev) => Math.min(prev + 10, files.length));
            }
          }}
          onEndReachedThreshold={0.5}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
    marginTop: 12,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  sort: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '600',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

