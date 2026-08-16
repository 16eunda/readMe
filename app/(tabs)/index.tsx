import * as DocumentPicker from "expo-document-picker";
//import * as FileSystem from "expo-file-system";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Buffer } from "buffer";
import * as FileSystem from "expo-file-system/legacy";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { htmlToText } from "html-to-text";
import JSZip from "jszip";
import { Plus } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View
} from "react-native";
// 파일 카드
import AiAnalysisModal from "../../components/AiAnalysisModal";
import FileCard, { FileItem } from "../../components/FileCard";

// 검색 바
import SearchBar from "../../components/SearchBar";
import styles from "../../styles/Home.styles";

// 아이콘
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { authenticatedFetch, BASE_URL } from "../../utils/api";
import { getDeviceId } from "../../utils/deviceId";
import { createPreviewText } from "../../utils/preview";

// 파일 수정 모달
import iconv from 'iconv-lite';
import CreateFolderModal from "../../components/CreateFolderModal";
import DuplicateConfirmModal from "../../components/DuplicateConfirmModal";
import EditModal from "../../components/EditModal";
import FileMoveModal from "../../components/FileMoveModal";
import FileOptionsModal from "../../components/FileOptionsModal";
import FolderOptionsModal from "../../components/FolderOptionsModal";
import FolderRenameModal from "../../components/FolderRenameModal";
import PreviewModal from "../../components/PreviewModal";
import SortModal, { SortOption } from "../../components/SortModal";
import { useUser } from "../../contexts/UserContext";

const MANAGED_FILE_DIRECTORY = "library-files";

async function createManagedFileUri(displayName: string): Promise<string> {
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    throw new Error("앱 내부 저장소를 사용할 수 없습니다.");
  }

  const directoryUri = `${documentDirectory}${MANAGED_FILE_DIRECTORY}/`;
  await FileSystem.makeDirectoryAsync(directoryUri, { intermediates: true });

  const extensionIndex = displayName.lastIndexOf(".");
  const extension = extensionIndex >= 0
    ? displayName.slice(extensionIndex).toLowerCase()
    : "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}${extension}`;
    const managedUri = `${directoryUri}${uniqueName}`;
    const info = await FileSystem.getInfoAsync(managedUri);
    if (!info.exists) {
      return managedUri;
    }
  }

  throw new Error("파일의 고유 저장 경로를 만들 수 없습니다.");
}

// 여러 인코딩 시도 방식 (효율적인 순서)
function decodeTextSafe(buffer: Buffer): string {
  // 1. UTF-16 BOM 체크 (가장 먼저!)
  if (buffer.length >= 2) {
    // UTF-16 LE BOM (FF FE)
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      console.log('✅ UTF-16 LE BOM 발견');
      // BOM 제거하고 디코딩
      return iconv.decode(buffer.slice(2), 'utf-16le');
    }
    // UTF-16 BE BOM (FE FF)
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      console.log('✅ UTF-16 BE BOM 발견');
      // BOM 제거하고 디코딩
      return iconv.decode(buffer.slice(2), 'utf-16be');
    }
  }
  
  // 2. UTF-8 BOM 체크 (EF BB BF)
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    console.log('✅ UTF-8 BOM 발견');
    return iconv.decode(buffer.slice(3), 'utf-8');
  }
  
  // 3. 여러 인코딩 시도 (한국 사용자 기준 효율적 순서)
  const encodings = ['cp949', 'utf-8', 'euc-kr', 'utf-16le', 'utf-16be', 'windows-1252'];
  
  for (const enc of encodings) {
    try {
      const text = iconv.decode(buffer, enc);
      
      // 한글 범위(AC00-D7A3) 문자가 있는지 확인
      const hasKorean = /[\uAC00-\uD7A3]/.test(text.slice(0, 200));
      
      // 깨진 문자(�) 비율 확인
      const broken = (text.match(/\uFFFD/g)?.length || 0);
      const ratio = broken / text.length;
      
      // 한글이 있고 깨진 문자가 1% 미만이면 성공
      if (hasKorean && ratio < 0.01) {
        console.log('✅ 성공한 인코딩:', enc);
        return text;
      }
    } catch (e) {
      continue;
    }
  }
  
  // 모두 실패하면 CP949로 폴백 (한국어 파일 가능성 높음)
  console.log('⚠️ 모든 인코딩 실패, CP949로 폴백');
  return iconv.decode(buffer, 'cp949');
}

export default function Home() {
  // 렌더 횟수 추적 (디버깅용) - 실제 앱에서는 제거 권장
  const renderCount = useRef(0);
  renderCount.current += 1;

  // ========== 1. 외부 Hooks (useRouter, useLocalSearchParams) ==========
  const router = useRouter();
  const { folder, locateFileId } = useLocalSearchParams();
  const currentFolder = Array.isArray(folder) ? String(folder[0] ?? "root") : String(folder ?? "root");
  const requestedLocateFileId = Array.isArray(locateFileId)
    ? String(locateFileId[0] ?? "")
    : String(locateFileId ?? "");

  // ========== 2. 모든 useState ==========
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState(""); // 디바운싱된 검색어
  
  // 파일 상태
  const [fileOptionsVisible, setFileOptionsVisible] = useState(false);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // 폴더 상태
  const [folderModal, setFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<any>(null);
  const [folderOptionsVisible, setFolderOptionsVisible] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [folderMoveModalVisible, setFolderMoveModalVisible] = useState(false);

  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [lastProgress, setLastProgress] = useState(0);

  // AI 분석 모달
  const [aiModalFile, setAiModalFile] = useState<FileItem | null>(null);

  // 중복 파일 확인 모달
  const [duplicateModalVisible, setDuplicateModalVisible] = useState(false);
  const [duplicateFileName, setDuplicateFileName] = useState("");
  const [pendingFile, setPendingFile] = useState<any>(null);

  // 페이지네이션 (추가 페이지 로딩용)
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [extraFiles, setExtraFiles] = useState<any[]>([]); // 2페이지 이후 누적
  const isLoadingMoreRef = useRef(false); // ref로 관리 → 리렌더 유발 안 함
  const loadMoreRequestIdRef = useRef(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false); // UI 표시용만
  const [isSearching, setIsSearching] = useState(false); // 검색 모드 추적
  const [searchResults, setSearchResults] = useState<any[]>([]); // 검색 결과
  const [locationPageFiles, setLocationPageFiles] = useState<any[] | null>(null);
  const [locatedFileId, setLocatedFileId] = useState<string | null>(null);
  const [isLocatingFile, setIsLocatingFile] = useState(false);
  const fileListRef = useRef<FlatList<any>>(null);
  const locateRequestIdRef = useRef(0);
  const processedLocateFileIdRef = useRef("");

  // 정렬
  const [sortOption, setSortOption] = useState<SortOption>("date-desc");
  const [sortModalVisible, setSortModalVisible] = useState(false);

  // 선택 모드 (파일과 폴더 함께 선택)
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<{ files: number[], folders: number[] }>({ files: [], folders: [] });
  const [bulkMoveModalVisible, setBulkMoveModalVisible] = useState(false); // 일괄 이동 모달
  
  // Pull to Refresh
  const [refreshing, setRefreshing] = useState(false);

  // 파일 등록 중 로딩
  const [isUploading, setIsUploading] = useState(false);

  // 파일 삭제 중 로딩
  const [isDeleting, setIsDeleting] = useState(false);

  // 전역 상태에서 사용자 정보 가져오기
  const { user, deviceId, incomingFile, setIncomingFile, isLoading: isUserLoading } = useUser();
  const queryClient = useQueryClient();

  // 🔍 어떤 값이 계속 바뀌는지 추적
  const _prevDebug = useRef<Record<string, any>>({});
  useEffect(() => {
    const current: Record<string, any> = {
      user, deviceId, incomingFile,
      search, debouncedSearch, isSearching,
      currentFolder, sortOption, extraFiles,
      hasMore, refreshing,
      isUploading, isDeleting,
    };
    const changed = Object.keys(current).filter(
      (k) => _prevDebug.current[k] !== current[k]
    );
    if (changed.length > 0) {
      console.log("🔴 변경된 값:", changed.join(", "), "렌더:", renderCount.current);
    }
    _prevDebug.current = current;
  });

  // ========== React Query: 파일/폴더 조회 ==========
  // 정렬 파라미터 변환
  const sortParam = sortOption === "date-desc" ? "date,desc"
    : sortOption === "date-asc" ? "date,asc"
    : sortOption === "rating-desc" ? "rating,desc"
    : "rating,asc";

  // 파일 목록 (page 0, 1페이지분)
  // 앱 시작 중 user가 undefined → 로그인 사용자로 확정돼도 동일 목록 캐시를 유지한다.
  // 로그인/로그아웃 시에는 아래 userId 변경 effect에서 명시적으로 캐시를 무효화한다.
  const filesQueryKey = ['files', currentFolder, sortParam, deviceId];
  const { data: filesData, isLoading: isInitialLoading, refetch: refetchFiles } = useQuery({
    queryKey: filesQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        path: String(currentFolder),
        page: '0',
        size: '15',
        sort: sortParam,
      });
      const response = await authenticatedFetch(
        `${BASE_URL}/files?${params.toString()}`,
        {},
        deviceId!
      );
      const data = await response.json();
      if (data.content && Array.isArray(data.content)) {
        return { content: data.content, hasMore: !data.last };
      } else if (Array.isArray(data)) {
        return { content: data, hasMore: false };
      }
      return { content: [], hasMore: false };
    },
    enabled: !!deviceId && !isSearching && !isUserLoading,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  // 현재 폴더 폴더 목록
  const foldersQueryKey = ['folders', currentFolder, deviceId];
  const { data: foldersData, isLoading: isFoldersLoading, refetch: refetchFolders } = useQuery({
    queryKey: foldersQueryKey,
    queryFn: async () => {
      const url = `${BASE_URL}/folders?path=${String(currentFolder)}`;
      console.log("📁 폴더 쿼리 요청:", url, "deviceId:", deviceId);
      const response = await authenticatedFetch(url, {}, deviceId!);
      const data = await response.json();

      console.log("📁 폴더 쿼리 응답:", Array.isArray(data) ? `배열 ${data.length}개` : data);

      return Array.isArray(data) ? data : [];
    },
    enabled: !!deviceId && !isUserLoading,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  // 전체 폴더 목록 (breadcrumb용)
  const allFoldersQueryKey = ['allFolders', deviceId];
  const { data: allFoldersData, refetch: refetchAllFolders } = useQuery({
    queryKey: allFoldersQueryKey,
    queryFn: async () => {
      const response = await authenticatedFetch(`${BASE_URL}/folders`, {}, deviceId!);
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!deviceId && !isUserLoading,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  // React Query 데이터 → 로컬 변수
  const page0Files: any[] = filesData?.content ?? [];
  const files = isSearching
    ? searchResults
    : locationPageFiles
      ? [...locationPageFiles, ...extraFiles]
      : [...page0Files, ...extraFiles];
  const folders: any[] = foldersData ?? [];
  const allFolders: any[] = allFoldersData ?? [];

  // hasMore 동기화 (queryFn 바깥에서 side effect 처리)
  useEffect(() => {
    if (filesData !== undefined && locationPageFiles === null) {
      setHasMore(filesData.hasMore);
    }
  }, [filesData, locationPageFiles]);

  // ========== 3. 모든 useMemo ==========
  const filteredFiles = useMemo(() => {
    // files가 배열이 아니면 빈 배열 반환
    if (!Array.isArray(files)) {
      console.warn('⚠️ files가 배열이 아닙니다:', files);
      return [];
    }
    
    // 서버에서 이미 path로 필터링되어 온 결과를 그대로 사용
    return files;
  }, [files]);

  const visibleFolders = useMemo(() => {
    // 서버에서 이미 경로별로 필터링된 폴더를 받으므로 추가 필터링 불필요
    return folders.filter((f) => f && f.name);
  }, [folders]);

  // Breadcrumb 경로 계산
  const breadcrumbPath = useMemo(() => {
    if (currentFolder === "root") {
      return [{ id: "root", name: "Home" }];
    }

    const path: any[] = [];
    let folderId = currentFolder;

    // 현재 폴더부터 root까지 거슬러 올라감
    while (folderId && folderId !== "root") {
      const folder = allFolders.find((f) => String(f.id) === String(folderId));
      if (!folder) {
        console.log("⚠️ 폴더를 찾을 수 없음:", folderId);
        break;
      }
      
      console.log("📁 경로 추가:", folder.name, "path:", folder.path);
      path.unshift({ id: folder.id, name: folder.name });
      folderId = folder.path;
    }

    // 맨 앞에 root 추가
    path.unshift({ id: "root", name: "Home" });
    console.log("🗺️ 최종 경로:", path.map(p => p.name).join(" > "));
    return path;
  }, [currentFolder, allFolders]);

  // ========== 4. 모든 useEffect ==========
  useEffect(() => {
    console.log("🔄 currentFolder =", currentFolder);
  }, [currentFolder]);

  // 초기 로드 (deviceId 준비되면 실행) - React Query enabled로 자동 처리되므로 별도 호출 불필요
  // useQuery의 enabled: !!deviceId 가 있으므로 deviceId 생기면 자동 fetch 됨

  // 로그인/로그아웃 감지: user 객체 참조가 아니라 실제 ID 변경만 감지한다.
  const prevUserIdRef = useRef<string | number | null | undefined>(undefined);
  useEffect(() => {
    if (isUserLoading) return;

    const nextUserId = user?.userId ?? null;
    if (prevUserIdRef.current === undefined) {
      prevUserIdRef.current = nextUserId;
      return;
    }
    if (prevUserIdRef.current !== nextUserId && deviceId) {
      console.log(user ? "🔐 로그인 감지 → 캐시 무효화" : "🚪 로그아웃 감지 → 캐시 무효화");
      prevUserIdRef.current = nextUserId;
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['allFolders'] });
    }
  }, [user?.userId, deviceId, isUserLoading, queryClient]);

  // 탭/화면에 포커스될 때 - stale된 경우에만 재조회
  const lastFocusTimeRef = useRef(0);
  const hasFocusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!deviceId || isUserLoading) return;
      const now = Date.now();

      AsyncStorage.getItem('reader_exited').then((val) => {
        if (val === '1') {
          // reader에서 돌아온 경우 → 쿨다운 무시하고 즉시 refetch
          AsyncStorage.removeItem('reader_exited');
          hasFocusedOnceRef.current = true;
          lastFocusTimeRef.current = now;
          refetchFiles();
          refetchFolders();
          refetchAllFolders();
        } else if (!hasFocusedOnceRef.current) {
          // 최초 포커스는 useQuery의 enabled 자동 조회가 담당한다.
          hasFocusedOnceRef.current = true;
          lastFocusTimeRef.current = now;
        } else if (now - lastFocusTimeRef.current > 30_000) {
          lastFocusTimeRef.current = now;
          refetchFiles();
          refetchFolders();
          refetchAllFolders();
        }
      });
    }, [deviceId, isUserLoading, refetchFiles, refetchFolders, refetchAllFolders])
  );

  // -------------------------------------------------------
  // 외부 파일 열기 (Open With) 처리
  // -------------------------------------------------------
  useEffect(() => {
    if (!incomingFile || isUserLoading) return;

    setIncomingFile(null); // 중복 처리 방지
    
    const { uri, name } = incomingFile;

    // 외부 파일 열기에서는 사용자가 이미 파일을 선택했으므로 원본/수신 파일명으로 자동 등록
    processExternalFile({ uri, name });
  }, [incomingFile, isUserLoading]);
  
  // 외부 파일 실제 처리
  const processExternalFile = async (file: { uri: string; name: string }) => {
    const { uri, name } = file;
    
    try {
      // 중복 체크 (root 폴더 기준)
      const checkRes = await authenticatedFetch(
        `${BASE_URL}/files/check?title=${encodeURIComponent(name)}&path=root`,
        {},
        deviceId ?? undefined
      );
      const { exists } = await checkRes.json();

      if (exists) {
        Alert.alert(
          '이미 있는 파일',
          `"${name}"이(가) 이미 라이브러리에 있어요.`,
          [
            {
              text: '그냥 열기',
              onPress: async () => {
                // 목록에서 찾아 reader로 이동
                const res = await authenticatedFetch(
                  `${BASE_URL}/files?path=root&page=0&size=100`,
                  {},
                  deviceId ?? undefined
                );
                const data = await res.json();
                const list = data.content ?? data;
                const found = (list as any[]).find((f: any) => f.title === name);
                if (found) {
                  router.push({
                    pathname: '/reader',
                    params: { fileId: found.id, uri: found.uri, name: found.title, type: found.type },
                  });
                }
              },
            },
            {
              text: '새로 추가',
              onPress: async () => {
                const saved = await addFileToSystem({ uri, name }, 'root');
                if (saved) {
                  router.push({
                    pathname: '/reader',
                    params: { fileId: saved.id, uri: saved.uri, name: saved.title, type: saved.type },
                  });
                }
              },
            },
          ]
        );
        return;
      }

      // 새 파일 → root에 추가 후 바로 reader로 이동
      const saved = await addFileToSystem({ uri, name }, 'root');
      if (saved) {
        router.push({
          pathname: '/reader',
          params: { fileId: saved.id, uri: saved.uri, name: saved.title, type: saved.type },
        });
      }
    } catch (e) {
      console.error('❌ 외부 파일 처리 실패:', e);
    }
  };

  // 디바운싱: 검색어 입력 후 0.5초 대기
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500); // 0.5초 디바운싱
    
    return () => clearTimeout(timer); // 타이핑 중이면 이전 타이머 취소
  }, [search]);

  // 디바운스된 검색어로 서버 검색
  useEffect(() => {
    if (debouncedSearch.trim()) {
      console.log("🔍 검색 시작:", debouncedSearch);
      setIsSearching(true);
      setCurrentPage(0);
      searchFilesFromServer(debouncedSearch, 0, true);
    } else {
      setIsSearching(false);
      setSearchResults([]);
    }
  }, [debouncedSearch]);

  // currentFolder 변경 시 데이터 다시 로드 - React Query 쿼리 키 변경으로 자동 재조회됨
  useEffect(() => {
    console.log("📂 폴더 변경됨:", currentFolder);
  }, [currentFolder, deviceId]);
  
  // currentFolder 변경 시 추가 페이지 리셋
  useEffect(() => {
    loadMoreRequestIdRef.current += 1;
    isLoadingMoreRef.current = false;
    setIsLoadingMore(false);
    setLocationPageFiles(null);
    setExtraFiles([]);
    setCurrentPage(0);
    // 새 폴더의 첫 페이지 응답이 다음 페이지 존재 여부를 알려주기 전에는
    // FlatList의 onEndReached가 추가 조회를 시작하지 않도록 한다.
    setHasMore(filesData?.hasMore ?? false);
  }, [currentFolder, sortParam]);

  // 검색 결과의 "파일 위치 열기": 백엔드가 계산한 대상 페이지를 바로 표시한다.
  useEffect(() => {
    if (!requestedLocateFileId || !deviceId || isUserLoading) return;
    if (processedLocateFileIdRef.current === requestedLocateFileId) return;

    processedLocateFileIdRef.current = requestedLocateFileId;
    const requestId = ++locateRequestIdRef.current;

    const scrollToLocatedFile = (pageFiles: any[], indexInPage: number) => {
      const actualIndex = pageFiles.findIndex((file) => String(file.id) === requestedLocateFileId);
      const targetIndex = actualIndex >= 0 ? actualIndex : indexInPage;
      if (targetIndex < 0) return false;

      setLocatedFileId(requestedLocateFileId);
      setTimeout(() => {
        fileListRef.current?.scrollToIndex({
          index: targetIndex,
          animated: true,
          viewPosition: 0.25,
        });
      }, 180);
      setTimeout(() => setLocatedFileId((id) => id === requestedLocateFileId ? null : id), 3000);
      return true;
    };

    const locate = async () => {
      setIsLocatingFile(true);
      isLoadingMoreRef.current = true;
      try {
        const params = new URLSearchParams({ sort: sortParam, size: '15' });
        const response = await authenticatedFetch(
          `${BASE_URL}/files/${requestedLocateFileId}/location?${params.toString()}`,
          {},
          deviceId
        );
        if (!response.ok) throw new Error(`파일 위치 조회 실패: ${response.status}`);

        if (requestId !== locateRequestIdRef.current) return;

        const location = await response.json();
        const pageFiles: any[] = Array.isArray(location.content) ? location.content : [];
        setLocationPageFiles(pageFiles);
        setExtraFiles([]);
        setCurrentPage(Math.max(0, Number(location.page) || 0));
        setHasMore(Boolean(location.hasNext));

        if (!scrollToLocatedFile(pageFiles, Number(location.indexInPage))) {
          Alert.alert("파일 위치를 찾을 수 없어요", "파일이 이동되었거나 삭제되었을 수 있습니다.");
        }
      } catch (error) {
        console.error("파일 위치 열기 실패:", error);
        Alert.alert("파일 위치 열기 실패", "파일 위치를 불러오지 못했습니다.");
      } finally {
        if (requestId === locateRequestIdRef.current) {
          isLoadingMoreRef.current = false;
          setIsLocatingFile(false);
          router.setParams({ locateFileId: "" });
        }
      }
    };

    locate();
  }, [
    requestedLocateFileId,
    deviceId,
    isUserLoading,
    sortParam,
    router,
  ]);

  useEffect(() => {
    if (!requestedLocateFileId) processedLocateFileIdRef.current = "";
  }, [requestedLocateFileId]);

  // 추가 페이지 로드 (2페이지 이후 스크롤 끝에 도달)
  async function loadMoreFiles() {
    if (!deviceId || !hasMore || isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    const requestId = ++loadMoreRequestIdRef.current;
    const nextPage = currentPage + 1;
    try {
      const params = new URLSearchParams({
        path: String(currentFolder),
        page: String(nextPage),
        size: '15',
        sort: sortParam,
      });
      const response = await authenticatedFetch(
        `${BASE_URL}/files?${params.toString()}`,
        {},
        deviceId
      );
      const data = await response.json();
      let fileList: any[] = [];
      let nextHasMore = false;
      if (data.content && Array.isArray(data.content)) {
        fileList = data.content;
        nextHasMore = !data.last;
      } else if (Array.isArray(data)) {
        fileList = data;
      }
      if (requestId !== loadMoreRequestIdRef.current) return;
      setHasMore(fileList.length > 0 && nextHasMore);
      setExtraFiles(prev => [...prev, ...fileList]);
      setCurrentPage(nextPage);
    } catch (e) {
      console.log("Error loading more files:", e);
    } finally {
      if (requestId === loadMoreRequestIdRef.current) {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }

  // 서버 검색 (디바운싱 + 페이지네이션)
  // -----------------------------
  async function searchFilesFromServer(keyword: string, page = 0, reset = false) {
    try {
      if (reset) {
        setCurrentPage(0);
        setHasMore(true);
      }
      
      setIsLoadingMore(true);
      
      // 정렬 옵션을 서버 형식으로 변환
      const sortParam = sortOption === "date-desc" ? "date,desc" 
        : sortOption === "date-asc" ? "date,asc"
        : sortOption === "rating-desc" ? "rating,desc"
        : "rating,asc";
      
      // deviceId가 없으면 요청하지 않음
      if (!deviceId) {
        console.log('⚠️ 디바이스 ID 없음, 검색 대기');
        setIsLoadingMore(false);
        return;
      }
      
      const params = new URLSearchParams({
        keyword: keyword,
        page: String(page),
        size: '15',
        sort: sortParam
      });
      
      console.log('🔍 검색 요청:', keyword, 'page:', page, 'sort:', sortParam, "deviceId:", deviceId);

      const response = await authenticatedFetch(
        `${BASE_URL}/files/search?${params.toString()}`,
        {},
        deviceId
      );
      const data = await response.json();
      
      console.log('🔍 검색 결과 (page=' + page + '):', data);
      
      // 응답 처리
      let fileList = [];
      if (data.content && Array.isArray(data.content)) {
        fileList = data.content;
        // Spring Data 새 형식: data.page.number, data.page.totalPages
        if (data.page) {
          setHasMore(data.page.number + 1 < data.page.totalPages);
        } else {
          setHasMore(!data.last); // 구형 형식 폴백
        }
      } else if (Array.isArray(data)) {
        fileList = data;
        setHasMore(false);
      } else {
        fileList = [];
        setHasMore(false);
      }
      
      // 페이지 누적 또는 초기화
      if (reset || page === 0) {
        setSearchResults(fileList);
      } else {
        setSearchResults((prev: any[]) => [...prev, ...fileList]);
      }
      
      setCurrentPage(page);
    } catch (e) {
      console.log("Error searching files:", e);
      setSearchResults([]);
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }

  // -----------------------------
  // 파일 저장
  // -----------------------------
  async function saveFileToServer(fileData: any) {
    try {
      // 실기기에서는 외부 파일 처리/등록이 UserContext의 deviceId 상태 갱신보다 먼저
      // 시작될 수 있으므로 저장 직전에 영속 deviceId를 직접 확보한다.
      const resolvedDeviceId = deviceId ?? await getDeviceId();
      const requestBody = {
        ...fileData,
        deviceId: resolvedDeviceId,
      };
      console.log('🚀 서버 요청 시작:', {
        url: `${BASE_URL}/files`,
        method: 'POST',
        deviceId: resolvedDeviceId,
      });
      
      const response = await authenticatedFetch(`${BASE_URL}/files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }, resolvedDeviceId);

      console.log('📡 서버 응답 상태:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ 서버 응답 에러:', { status: response.status, error: errorText });
        return null;
      }

      const saved = await response.json();
      console.log('✅ 서버 응답 파싱 완료:', { id: saved?.id, title: saved?.title });
      return saved;
    } catch (error) {
      console.error("❌ saveFileToServer 에러:", error);
      return null;
    }
  }

  // -----------------------------
  // Pull to Refresh 핸들러
  // -----------------------------
  const onRefresh = useCallback(async () => {
    console.log("🔄 Pull to Refresh 시작");
    setRefreshing(true);
    try {
      await Promise.all([
        refetchFiles(),
        refetchFolders(),
        refetchAllFolders(),
      ]);
      setLocationPageFiles(null);
      setExtraFiles([]);
      setCurrentPage(0);
    } catch (e) {
      console.log("새로고침 실패:", e);
    } finally {
      setRefreshing(false);
    }
  }, [refetchFiles, refetchFolders, refetchAllFolders]);

  // -----------------------------
  // 폴더 저장
  // -----------------------------
  async function saveFolderToServer(folderData: any) {
    try {
      if (!deviceId) {
        console.log('⚠️ 디바이스 ID 없음, 폴더 저장 불가');
        return;
      }
      
      const response = await authenticatedFetch(`${BASE_URL}/folders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(folderData),
      }, deviceId);

      return await response.json();
    } catch (e) {
      console.log("Error saving folder:", e);
    }
  }

  // -----------------------------
  // 폴더 삭제
  // -----------------------------
  async function deleteFolderFromServer(id: number) {
  try {
    const res = await authenticatedFetch(`${BASE_URL}/folders/${id}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: id })
    }, deviceId ?? undefined);

    // 백엔드는 body 없이 200/204만 반환하므로 OK면 삭제 성공
    return res.ok;
  } catch (e) {
    console.log("Error deleting folder:", e);
    return false;
  }
}

  // -----------------------------
  // 폴더 이동
  // -----------------------------
  async function moveFolderToServer(folderId: number, newPath: string) {
    try {
      const res = await authenticatedFetch(`${BASE_URL}/folders/${folderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newPath })
      }, deviceId ?? undefined);
      return res.ok;
    } catch (e) {
      console.log("Error moving folder:", e);
      return false;
    }
  }

  // -----------------------------
  // 파일 추가 (+ 버튼)
  // -----------------------------
  const pickFile = async () => {
    console.log('🔍 pickFile 호출됨');
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["text/plain", "application/epub+zip"],
        copyToCacheDirectory: true, // ★ 반드시 추가
      });
      
      console.log('📋 DocumentPicker 결과:', { canceled: res.canceled, assets: res.assets?.length });
      
      if (res.canceled) {
        console.log('❌ 파일 선택 취소됨');
        return;
      }

      const file = res.assets[0];
      console.log('✅ 파일 선택됨:', { name: file.name, uri: file.uri });

      setIsUploading(true);
      try {
        // 🔵 서버 API로 중복 체크
        console.log('🔎 중복 체크 중:', file.name);
        const checkRes = await authenticatedFetch(
          `${BASE_URL}/files/check?title=${encodeURIComponent(file.name)}&path=${currentFolder}`,
          {},
          deviceId ?? undefined
        );
        const { exists } = await checkRes.json();
        
        console.log('✓ 중복 체크 완료:', { exists, fileName: file.name });
        
        if (exists) {
          // 중복 파일일 경우 모달 표시 (로딩 끄고)
          console.log('⚠️ 중복 파일 발견, 모달 표시');
          setIsUploading(false);
          setDuplicateFileName(file.name);
          setPendingFile(file);
          setDuplicateModalVisible(true);
          return;
        }

        // 중복이 아니면 바로 추가
        console.log('➕ 새 파일 추가 시작');
        await addFileToSystem(file);
        console.log('✅ 파일 추가 완료');
      } catch (e) {
        console.error('❌ 파일 추가 중 오류:', e);
        Alert.alert('파일 추가 실패', String(e));
      } finally {
        setIsUploading(false);
      }
    } catch (e) {
      console.error('❌ pickFile 오류:', e);
      Alert.alert('오류', String(e));
    }
  };

  // 실제 파일 추가 로직을 별도 함수로 분리 (isUploading은 호출자가 관리)
  const addFileToSystem = async (file: any, targetFolder?: string) => {
    console.log('📝 addFileToSystem 호출:', { fileName: file.name, uri: file.uri, targetFolder, currentFolder });
    setIsUploading(true);
    
    try {
      // 화면에는 원본 파일명을 유지하고, 실제 파일은 충돌 없는 이름으로 저장한다.
      const displayName = file.name;
      const title = displayName;

      const newPath = await createManagedFileUri(displayName);
      console.log('📂 파일 복사 시작:', { displayName, title, targetPath: newPath });

      // 앱 전용 영구 폴더로 복사한 URI를 서버에도 저장한다.
      await FileSystem.copyAsync({
        from: file.uri,
        to: newPath,
      });
      
      console.log('✅ 파일 복사 완료:', newPath);

      let preview = "";

      try {
        if (displayName.toLowerCase().endsWith(".epub")) {
          console.log('📖 EPUB 미리보기 추출 중...');
          preview = await extractEpubPreview(newPath);
          preview = createPreviewText(preview);
          console.log('✅ EPUB 미리보기 완료:', preview);
        } else {
          console.log('📄 TXT 미리보기 추출 중...');
          // Base64로 읽고 자동 인코딩 감지
          const base64 = await FileSystem.readAsStringAsync(newPath, { 
            encoding: FileSystem.EncodingType.Base64 
          });
          
          const buffer = Buffer.from(base64, 'base64');
          const text = decodeTextSafe(buffer);
          
          // 줄바꿈을 공백으로, 연속 공백을 하나로 압축
          const cleanedText = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
          
          // 공통 미리보기 기준(200자, 줄임표 포함)으로 제한
          preview = createPreviewText(cleanedText);
          console.log('✅ TXT 미리보기 완료:', preview);
        }
      } catch(e) {
        console.log("⚠️ 미리보기 추출 실패:", e);
        preview = "(미리보기를 불러올 수 없습니다)";
      }

      
      // 백엔드에 보낼 파일 정보
      const folderPath = targetFolder ?? currentFolder;
      const fileType = displayName.toLowerCase().endsWith('.epub') ? 'EPUB' : 'TXT'; // ★ 파일 타입 추가
      const newFile = {
        title: title,
        type: fileType, // ★ 백엔드 필수 필드
        preview,
        date: new Date().toISOString(),
        rating: 0,
        uri: newPath,
        path: folderPath,
        // saveFileToServer에서 저장 직전 영속 deviceId로 확정한다.
        deviceId: deviceId,
      };
      
      console.log('💾 서버에 파일 저장 중:', { title, path: folderPath, type: fileType });

      // 1) 서버에 저장 요청
      const saved = await saveFileToServer(newFile);
      
      if (!saved) {
        console.error('❌ 서버 저장 실패:', saved);
        setIsUploading(false);
        return null;
      }
      
      console.log('✅ 서버 저장 완료:', saved.id);

      // 2) Optimistic update: 캐시에 즉시 추가 → 기존 파일 유지하면서 새 파일 표시
      if (saved) {
        queryClient.setQueryData(filesQueryKey, (old: any) => ({
          content: [saved, ...(old?.content ?? [])],
          hasMore: old?.hasMore ?? false,
        }));
        // 백그라운드에서 서버와 동기화
        refetchFiles();
      }

      setIsUploading(false);
      return saved;
    } catch (e) {
      console.error('❌ addFileToSystem 오류:', e);
      setIsUploading(false);
      Alert.alert('파일 추가 실패', String(e));
      return null;
    }
  };

  const extractEpubPreview = async (newPath: any, progress: number = 0) => {
    try {
      // 1) base64로 읽기 (zip 해석용)
      const base64 = await FileSystem.readAsStringAsync(newPath, {
        encoding: FileSystem.EncodingType.Base64
      });

      const zip = await JSZip.loadAsync(base64, { base64: true });

      // 2) .opf 파일 찾기 (epub 메타데이터)
      let opfPath = Object.keys(zip.files).find((p) => p.endsWith(".opf"));
      if (!opfPath) {
        opfPath = Object.keys(zip.files).find((p) => p.toLowerCase().includes("opf"));
      }
      if (!opfPath) return "(EPUB 메타데이터를 읽을 수 없습니다)";

      const opfText = await zip.files[opfPath].async("text");
      const baseDir = opfPath.replace(/[^/]+$/, "");

      // 3) spine 순서대로 본문 챕터 목록 수집
      const spineIdrefs = [...opfText.matchAll(/<(?:\w+:)?itemref[^>]+idref="([^"]+)"/g)].map(m => m[1]);

      // 비본문 패턴
      const skipPatterns = [
        'cover', 'title', 'toc', 'notice', 'info', 'copyright',
        'colophon', 'dedication', 'foreword', 'preface', 'intro',
        'bookinfo', 'writer', 'reader', 'split_000',
      ];

      // ★ 본문 챕터 수집: 실제 텍스트가 있는 챕터만
      const bodyChapters: string[] = [];
      for (const idref of spineIdrefs) {
        const r1 = new RegExp(`<(?:\\w+:)?item\\b[^>]*\\bid="${idref}"[^>]*href="([^"]+)"`, "i");
        const r2 = new RegExp(`<(?:\\w+:)?item\\b[^>]*href="([^"]+)"[^>]*\\bid="${idref}"`, "i");
        const m = opfText.match(r1) ?? opfText.match(r2);
        if (!m) continue;
        const href = m[1];
        if (skipPatterns.some(p => href.toLowerCase().includes(p))) continue;
        
        const fullPath = baseDir + href;
        const file = zip.files[fullPath] ?? zip.files[href];
        if (!file) continue;
        
        // ★ 각 챕터의 텍스트 양 확인
        try {
          const chapterContent = await file.async("text");
          const plain = htmlToText(chapterContent, {
            wordwrap: false,
            selectors: [{ selector: 'img', format: 'skip' }], // 이미지 건너뛰기
          });
          const cleanedText = plain.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
          
          // 텍스트가 50글자 이상 있어야 본문으로 간주
          if (cleanedText.length >= 50) {
            bodyChapters.push(href);
          }
        } catch (e) {
          // 읽기 실패한 챕터는 스킵
          continue;
        }
      }

      if (bodyChapters.length === 0) return "(본문을 찾을 수 없습니다)";

      // 4) progress 비율로 챕터 선택
      const chapterIndex = Math.min(
        Math.floor(progress * bodyChapters.length),
        bodyChapters.length - 1
      );
      const targetHref = bodyChapters[chapterIndex];
      console.log(`📖 progress:${progress} → 챕터 ${chapterIndex + 1}/${bodyChapters.length} (${targetHref})`);

      const fullPath = baseDir + targetHref;
      const chapterFile = zip.files[fullPath] ?? zip.files[targetHref] ??
        Object.values(zip.files).find(f => f.name.endsWith(targetHref.split("/").pop()!));
      if (!chapterFile) return "(본문 파일을 찾을 수 없습니다)";

      const chapterText = await chapterFile.async("text");

      // 5) HTML → 텍스트 변환 (이미지/사진 건너뛰기)
      const plain = htmlToText(chapterText, {
        wordwrap: false,
        selectors: [
          { selector: 'img', format: 'skip' },     // 이미지 건너뛰기
          { selector: 'figure', format: 'skip' },  // figure (캡션 포함) 건너뛰기
          { selector: 'picture', format: 'skip' }, // picture 건너뛰기
          { selector: 'svg', format: 'skip' },     // SVG 그래픽 건너뛰기
        ],
      });
      const cleanedText = plain.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

      if (!cleanedText) return "(본문 텍스트가 비어있습니다)";

      // 챕터 내 progress 위치 계산
      const chapterProgress = (progress * bodyChapters.length) - chapterIndex;
      const startPos = Math.floor(cleanedText.length * chapterProgress);
      const sliced = cleanedText.slice(startPos, startPos + 100);

      return sliced + (startPos + 100 < cleanedText.length ? "..." : "");

    } catch (e) {
      console.log("EPUB 미리보기 실패:", e);
      return "(EPUB 미리보기를 불러올 수 없습니다)";
    }
  };

  // -----------------------------
  // 파일 카드 클릭 기능
  // -----------------------------
  const handleFilePress = async (file : any) => {
    // 1) 서버에서 진행도 가져오기
    const res = await authenticatedFetch(`${BASE_URL}/files/${file.id}`, {}, deviceId ?? undefined);
    const info = await res.json();

    // progress 없으면 바로 Reader로 이동
    if (!info.progress || info.progress === 0) {
      router.push({
        pathname: "/reader",
        params: { fileId: file.id, uri: file.uri, name: file.title, type: file.type }
      });
      return;
    }

    // progress 있음 → 모달 띄우기
    setSelectedFile(file);
    setLastProgress(info.progress);

    // 서버에 저장된 readingPreview 사용 (없으면 파일에서 직접 추출)
    let preview = info.readingPreview || "";

    if (!preview) {
      // TXT 미리보기: progress 위치의 줄을 보여줌
      const base64 = await FileSystem.readAsStringAsync(file.uri, { 
        encoding: FileSystem.EncodingType.Base64 
      });
      const buffer = Buffer.from(base64, 'base64');
      const localContent = decodeTextSafe(buffer);

      preview = createPreviewText(localContent, Math.floor(info.progress * localContent.length));
    }

    setPreviewText(preview);
    setPreviewModalVisible(true);
  };

  const handleLongPress = (item: FileItem) => {
    setSelectedFile(item);
    setShowEditModal(true);
  };

  // 파일 선택 토글
  const toggleSelectFile = (id: number) => {
    setSelectedItems(prev => ({
      ...prev,
      files: prev.files.includes(id)
        ? prev.files.filter(v => v !== id)
        : [...prev.files, id]
    }));
  };

  // 폴더 선택 토글
  const toggleSelectFolder = (id: number) => {
    setSelectedItems(prev => ({
      ...prev,
      folders: prev.folders.includes(id)
        ? prev.folders.filter(v => v !== id)
        : [...prev.folders, id]
    }));
  };

  // 호환성을 위한 wrapper (기존 코드 참조용)
  const toggleSelect = (id: number) => toggleSelectFile(id);

  // 폴더 일괄 삭제 헬퍼 함수
  const deleteFoldersBulk = async (folderIds: number[], force: boolean) => {
    if (!deviceId) {
      throw new Error("디바이스 ID가 없습니다");
    }

    const res = await authenticatedFetch(`${BASE_URL}/folders/bulk-delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        folderIds: folderIds,
        force: force
      })
    }, deviceId);

    return res;
  };

  // 선택 모드에서 삭제 버튼 핸들러 (파일 + 폴더 삭제)
  const handleBulkDelete = async () => {
    try {
      // 1. 폴더 먼저 삭제 (하위 파일/폴더 포함 여부 체크)
      if (selectedItems.folders.length > 0) {
        console.log(`📁 폴더 ${selectedItems.folders.length}개 일괄 삭제:`, selectedItems.folders);
        
        const res = await deleteFoldersBulk(selectedItems.folders, false);

        // 409: 하위 파일/폴더 존재 경고
        if (res.status === 409) {
          const err = await res.json();
          const fileCount = err.data?.fileCount || 0;
          const folderCount = err.data?.folderCount || 0;

          // 경고 메시지 표시
          Alert.alert(
            "폴더 삭제 확인",
            `선택한 폴더 안에 파일 ${fileCount}개와 하위 폴더 ${folderCount}개가 있습니다.\n모두 삭제하시겠습니까?`,
            [
              { 
                text: "취소", 
                style: "cancel",
                onPress: () => {
                  console.log("폴더 삭제 취소됨");
                }
              },
              {
                text: "삭제",
                style: "destructive",
                onPress: async () => {
                  try {
                    // force=true로 재시도
                    console.log("📁 강제 삭제 실행");
                    await deleteFoldersBulk(selectedItems.folders, true);

                    // 폴더 삭제 완료 후 파일 삭제
                    if (selectedItems.files.length > 0) {
                      console.log(`🗑️ 파일 ${selectedItems.files.length}개 삭제:`, selectedItems.files);
                      await authenticatedFetch(`${BASE_URL}/files`, {
                        method: "DELETE",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ ids: selectedItems.files })
                      }, deviceId ?? undefined);
                    }

                    console.log("✅ 일괄 삭제 완료");
                    setIsSelectMode(false);
                    setSelectedItems({ files: [], folders: [] });
                    refetchFiles();
                    refetchFolders();
                  } catch (error) {
                    console.error("❌ 강제 삭제 실패:", error);
                    Alert.alert("삭제 실패", "폴더/파일 삭제에 실패했습니다.");
                  }
                }
              }
            ]
          );
          return; // 409 응답 시 여기서 종료 (사용자 선택 대기)
        }

        // 200/204: 정상 삭제 완료
        if (!res.ok) {
          throw new Error(`폴더 삭제 실패: ${res.status}`);
        }
      }

      // 2. 파일 삭제 (폴더 밖의 개별 파일들만)
      if (selectedItems.files.length > 0) {
        console.log(`🗑️ 파일 ${selectedItems.files.length}개 일괄 삭제:`, selectedItems.files);
        await authenticatedFetch(`${BASE_URL}/files`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ids: selectedItems.files })
        }, deviceId ?? undefined);
      }

      console.log("✅ 일괄 삭제 완료");
      setIsSelectMode(false);
      setSelectedItems({ files: [], folders: [] });
      refetchFiles();
      refetchFolders();
    } catch (error) {
      console.error("❌ 일괄 삭제 실패:", error);
      Alert.alert("삭제 실패", "파일/폴더 삭제에 실패했습니다.");
    }
  };

  // 선택 모드에서 이동 버튼 핸들러 (파일 + 폴더 이동)
  const handleBulkMove = async (folder: any) => {
    try {
      // 파일 이동
      for (const id of selectedItems.files) {
        console.log(`🚀 파일 ${id} 이동 요청:`, folder.id);
        const response = await authenticatedFetch(`${BASE_URL}/files/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: String(folder.id) })
        }, deviceId ?? undefined);

        if (!response.ok) {
          console.error(`❌ 파일 ${id} 이동 실패:`, response.status);
        }
      }

      // 폴더 이동
      for (const id of selectedItems.folders) {
        console.log(`📁 폴더 ${id} 이동 요청:`, folder.id);
        const response = await authenticatedFetch(`${BASE_URL}/folders/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: String(folder.id) })
        }, deviceId ?? undefined);

        if (!response.ok) {
          console.error(`❌ 폴더 ${id} 이동 실패:`, response.status);
        }
      }

      console.log("✅ 일괄 이동 완료");
      setBulkMoveModalVisible(false);
      setIsSelectMode(false);
      setSelectedItems({ files: [], folders: [] });
      refetchFiles();
      refetchFolders();
    } catch (error) {
      console.error("❌ 일괄 이동 실패:", error);
      Alert.alert("이동 실패", "파일/폴더 이동에 실패했습니다.");
    }
  };

  const updateFileInfo = async (updated: FileItem) => {
    try {
      console.log("🚀 PATCH 요청 보냄:", `${BASE_URL}/files/${updated.id}`);
      const res = await authenticatedFetch(`${BASE_URL}/files/${updated.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: updated.title,
          review: updated.review,
          rating: updated.rating,
        }),
      }, deviceId ?? undefined);

      console.log("📡 응답 상태:", res.status, res.statusText);
      
      // 2. 응답확인
      if (!res.ok) {
        const errorText = await res.text();
        console.error("❌ 에러 응답:", errorText);
        throw new Error("파일 정보 업데이트 실패: " + errorText);
      }

      const saved = await res.json();

      // 3. 캐시 즉시 업데이트
      queryClient.setQueryData(filesQueryKey, (old: any) => ({
        content: (old?.content ?? []).map((f: any) => (f.id === saved.id ? saved : f)),
        hasMore: old?.hasMore ?? false,
      }));
    } catch (err) {
      console.log(err);
      Alert.alert("오류", "파일 정보를 업데이트하는데 실패했습니다.");
    } finally {
      setShowEditModal(false);
    }
  };

  // 검색어 변경 시 displayCount 리셋 (이미 위에 useEffect로 처리됨)
  const isHomeBootstrapping = isUserLoading || !deviceId;
  const isHomeListLoading =
    !isSearching &&
    (isHomeBootstrapping || isInitialLoading || isFoldersLoading);
  const showInitialLoading =
    isHomeListLoading &&
    !search &&
    filteredFiles.length === 0 &&
    visibleFolders.length === 0;
  const isInitial =
    !showInitialLoading &&
    files.length === 0 &&
    visibleFolders.length === 0 &&
    !search;
  const noSearchResult =
    !showInitialLoading &&
    filteredFiles.length === 0 &&
    search &&
    !isInitialLoading;
  return (
    <SafeAreaView style={styles.container}>
       {/* 🔹 상단 전체 묶음 */}
    <View style={styles.topArea}>
      <Text style={styles.homeTitle}>
        {currentFolder === "root" ? "Home" : "Folder"}
      </Text>

      {/* Breadcrumb 경로 - 검색 중이거나 root가 아닐 때 표시 */}
      {(isSearching || currentFolder !== "root") && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.breadcrumbScroll}
          contentContainerStyle={{ flexDirection: "row", alignItems: "center" }}
        >
          {isSearching ? (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <MaterialCommunityIcons name="magnify" size={16} color="#4A90E2" style={{ marginRight: 4 }} />
              <Text style={[styles.breadcrumbItem, styles.breadcrumbActive]}>
                검색 결과: {debouncedSearch}
              </Text>
            </View>
          ) : (
            breadcrumbPath.map((item, index) => (
              <View key={item.id} style={{ flexDirection: "row", alignItems: "center" }}>
                <TouchableOpacity
                  onPress={() => {
                    if (item.id === "root") {
                      router.push({ pathname: "/" });
                    } else {
                      router.push({ pathname: "/", params: { folder: item.id } });
                    }
                  }}
                  style={{ flexDirection: "row", alignItems: "center" }}
                >
                  {index === 0 ? (
                    <MaterialCommunityIcons name="home" size={16} color={index === breadcrumbPath.length - 1 ? "#4A90E2" : "#666"} style={{ marginRight: 4 }} />
                  ) : (
                    <MaterialCommunityIcons name="folder" size={16} color={index === breadcrumbPath.length - 1 ? "#4A90E2" : "#666"} style={{ marginRight: 4 }} />
                  )}
                  <Text style={[
                    styles.breadcrumbItem,
                    index === breadcrumbPath.length - 1 && styles.breadcrumbActive
                  ]}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
                {index < breadcrumbPath.length - 1 && (
                  <Text style={styles.breadcrumbSeparator}> › </Text>
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* 검색창 */}
      <SearchBar value={search} onChange={setSearch} />

      {/* 폴더 메뉴 - 검색 중이 아닐 때만 */}
      {!isSearching && (
        <View style={styles.folderMenu}>
          <TouchableOpacity onPress={() => setFolderModal(true)}>
            <Text>폴더생성</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSortModalVisible(true)}>
            <Text>정렬</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => 
          {
            setIsSelectMode((prev) => !prev); // 선택 모드 토글
            setSelectedItems({ files: [], folders: [] }); // 선택 모드 토글 시 선택 초기화
          }}>
            <Text>{isSelectMode ? "선택 종료" : "선택"}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>

    {/* 폴더 그리드 - 파일 목록 바로 위 (검색 중이 아닐 때만) */}
    {!isSearching && visibleFolders.length > 0 && (
      <View style={styles.folderGridContainer}>
        {visibleFolders
          .filter((folder) => folder && folder.id && folder.name)
          .map((folder, index) => {
            const isSelected = selectedItems.folders.includes(folder.id);
            return (
              <TouchableOpacity
                key={folder.id}
                style={[
                  styles.folderGridItem,
                  (index + 1) % 4 === 0 && { marginRight: 0 },
                  isSelectMode && isSelected && { backgroundColor: "#e8f4f8", borderWidth: 2, borderColor: "#4A90E2" }
                ]}
                onPress={() => {
                  if (isSelectMode) {
                    toggleSelectFolder(folder.id);
                  } else {
                    router.push({ pathname: "/", params: { folder: String(folder.id) } });
                  }
                }}
                onLongPress={() => {
                  if (!isSelectMode) {
                    setSelectedFolder(folder);
                    setFolderOptionsVisible(true);
                  }
                }}
              >
                {isSelectMode && (
                  <View style={{ position: "absolute", top: 4, right: 4, zIndex: 10 }}>
                    <MaterialCommunityIcons
                      name={isSelected ? "checkbox-marked" : "checkbox-blank-outline"}
                      size={24}
                      color="#4A90E2"
                    />
                  </View>
                )}
                <MaterialCommunityIcons 
                  name="folder" 
                  size={60} 
                  color="#4A90E2" 
                />
                <Text style={styles.folderGridText}>{folder.name}</Text>
              </TouchableOpacity>
            );
          })}
      </View>
    )}

      {/* 목록 최초 로딩 중 */}
      {showInitialLoading && (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#4A90E2" />
          <Text style={{ color: "#888", marginTop: 12, fontSize: 14 }}>목록을 불러오는 중...</Text>
        </View>
      )}

    {/* 파일 없음 : 앱 첫 실행 */}
      {isInitial && (
        <View style={styles.centerBox}>
          <Text style={{ color: "#666" }}>
            파일이 없습니다. + 버튼으로 파일을 추가하세요!
          </Text>
        </View>
    )}

    {/* 검색 결과 없음 */}
    {noSearchResult && (
      <View style={styles.centerBox}>
        <Text style={{ color: "#666" }}>검색 결과가 없습니다.</Text>
      </View>
    )}

    {/* 파일 목록 */}
    {filteredFiles.length > 0 && (
      <FlatList
        ref={fileListRef}
        data={filteredFiles}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#b84a8c"
            colors={["#b84a8c"]}
          />
        }
        renderItem={({ item }) => (
          <FileCard
            item={item}
            isSelectMode={isSelectMode}
            isSelected={selectedItems.files.includes(item.id)}
            isLocated={String(item.id) === locatedFileId}
            onPress={ () => {
              if (isSelectMode) {
                toggleSelect(item.id);
              } else {
                handleFilePress(item);
              }
            }
              }
            onLongPress={() => {
              handleLongPress(item)
            }}
            onOptionsPress={(file) => {
              setSelectedFile(file);
              setFileOptionsVisible(true);
            }}
            onAiPress={(file) => setAiModalFile(file)}
          />
        )}
        onEndReached={() => {
          if (!isLoadingMore && hasMore) {
            if (isSearching && debouncedSearch.trim()) {
              searchFilesFromServer(debouncedSearch, currentPage + 1, false);
            } else {
              loadMoreFiles();
            }
          }
        }}
        onEndReachedThreshold={0.5}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          fileListRef.current?.scrollToOffset({
            offset: Math.max(0, averageItemLength * index),
            animated: false,
          });
          setTimeout(() => {
            fileListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.25 });
          }, 120);
        }}
        ListFooterComponent={() => {
          if (isLoadingMore && currentPage > 0) {
            return (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ color: '#999' }}>로딩 중...</Text>
              </View>
            );
          }
          return null;
        }}
      />
    )}

    {isLocatingFile && (
      <View style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(255,255,255,0.82)",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 50,
      }}>
        <ActivityIndicator size="large" color="#4A90E2" />
        <Text style={{ marginTop: 12, color: "#555" }}>파일 위치를 찾는 중...</Text>
      </View>
    )}

    {/* 플로팅 버튼 */}
    <TouchableOpacity style={styles.fab} onPress={pickFile}>
      <Plus size={28} color="#fff" strokeWidth={3.3} />
    </TouchableOpacity>

    {isSelectMode && (selectedItems.files.length > 0 || selectedItems.folders.length > 0) && (
      <View style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: "#fff",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderColor: "#eee"
      }}>
        <Text style={{ fontSize: 14, color: "#666" }}>
          선택: 파일 {selectedItems.files.length}개, 폴더 {selectedItems.folders.length}개
        </Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <TouchableOpacity onPress={handleBulkDelete} style={{ padding: 8 }}>
            <Text style={{ color: "#e74c3c", fontWeight: "bold" }}>삭제</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setBulkMoveModalVisible(true)} style={{ padding: 8 }}>
            <Text style={{ color: "#4A90E2", fontWeight: "bold" }}>이동</Text>
          </TouchableOpacity>
        </View>
      </View>
    )}

    {/* 수정 모달 */}
    {showEditModal && selectedFile && (
      <EditModal
        file={selectedFile}
        onClose={() => setShowEditModal(false)}
        onSave={updateFileInfo}
      />
    )}

    {/* 이어읽기 모달 */}
    <PreviewModal
      visible={previewModalVisible}
      file={selectedFile}
      previewText={previewText}
      lastProgress={lastProgress}
      onClose={() => setPreviewModalVisible(false)}
    />

    {/* 파일생성 모달 */}
   <CreateFolderModal
      visible={folderModal}
      folderName={newFolderName}
      setFolderName={setNewFolderName}
      onCreate={async () => {
        if (!newFolderName.trim()) {
          Alert.alert("폴더 생성", "폴더 이름을 입력해주세요");
          return;
        }

        if (newFolderName.length > 15) {
          Alert.alert("폴더 생성", "폴더 이름은 15자 이내로 입력해주세요");
          return;
        }

        const newFolder = {
          name: newFolderName,
          path: currentFolder,
        };

        // 서버 저장
        const saved = await saveFolderToServer(newFolder);

        if (saved) {
          // 캐시 즉시 추가 (Optimistic)
          queryClient.setQueryData(foldersQueryKey, (old: any[]) => [...(old ?? []), saved]);
          queryClient.setQueryData(allFoldersQueryKey, (old: any[]) => [...(old ?? []), saved]);
          // 백그라운드 동기화
          refetchFolders();
          refetchAllFolders();
        }

        setNewFolderName("");
        setFolderModal(false);
      }}
      onClose={() => setFolderModal(false)}
    />

    {/* 폴더 옵션 */}
    <FolderOptionsModal
      visible={folderOptionsVisible}
      onClose={() => setFolderOptionsVisible(false)}
      onRename={() => {
        setRenameText(selectedFolder?.name);
        setFolderOptionsVisible(false);
        setRenameModalVisible(true);
      }}
      onMove={() => {
        setFolderOptionsVisible(false);
        setFolderMoveModalVisible(true);
      }}
      onDelete={async () => {
        if (!selectedFolder || !selectedFolder.id) {
          console.log("❗ 삭제 실패: selectedFolder 없음");
          return;
        }

        // 폴더 안에 파일이 있는지 체크
        const hasFiles = files.some(f => String(f.path) === String(selectedFolder.id));
        
        // 하위 폴더가 있는지 체크
        const hasSubFolders = allFolders.some(f => String(f.path) === String(selectedFolder.id));
        
        if (hasFiles || hasSubFolders) {
          Alert.alert(
            "폴더 삭제 불가",
            hasFiles 
              ? "폴더 안에 파일이 있습니다. 파일을 먼저 삭제하거나 이동하세요."
              : "폴더 안에 하위 폴더가 있습니다. 하위 폴더를 먼저 삭제하거나 이동하세요."
          );
          setFolderOptionsVisible(false);
          return;
        }

        const ok = await deleteFolderFromServer(selectedFolder.id);

        if (!ok) {
          Alert.alert("삭제 실패", "서버에서 삭제에 실패했습니다.");
          return;
        }

        queryClient.setQueryData(foldersQueryKey, (old: any[]) =>
          (old ?? []).filter((f: any) => f.id !== selectedFolder.id)
        );
        queryClient.setQueryData(allFoldersQueryKey, (old: any[]) =>
          (old ?? []).filter((f: any) => f.id !== selectedFolder.id)
        );
        setFolderOptionsVisible(false);
      }}
    />

    {/* 폴더 이름 변경 모달 */}
    <FolderRenameModal
      visible={renameModalVisible}
      name={renameText}
      onChangeName={setRenameText}
      onSave={async () => {
        try {
          const res = await authenticatedFetch(`${BASE_URL}/folders/${selectedFolder.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: renameText }),
          }, deviceId ?? undefined);

          if (!res.ok) {
            throw new Error("폴더 이름 변경 실패");
          }

          const updated = await res.json();
          queryClient.setQueryData(foldersQueryKey, (old: any[]) =>
            (old ?? []).map((f: any) => (f.id === updated.id ? updated : f))
          );
          queryClient.setQueryData(allFoldersQueryKey, (old: any[]) =>
            (old ?? []).map((f: any) => (f.id === updated.id ? updated : f))
          );
          setRenameModalVisible(false);
        } catch (err) {
          console.log(err);
          Alert.alert("오류", "폴더 이름 변경에 실패했습니다.");
        }
      }}
      onClose={() => setRenameModalVisible(false)}
    />

    {/* 중복 확인 모달 */}
    <DuplicateConfirmModal
      visible={duplicateModalVisible}
      fileName={duplicateFileName}
      onConfirm={() => {
        setDuplicateModalVisible(false);
        if (pendingFile) {
          addFileToSystem(pendingFile);
        }
      }}
      onCancel={() => {
        setDuplicateModalVisible(false);
        setPendingFile(null);
      }}
    />

    {/* 파일 옵션 모달 */}
    <FileOptionsModal
      visible={fileOptionsVisible}
      onDelete={async () => {
        if (!selectedFile) return;
        
        setFileOptionsVisible(false);
        setIsDeleting(true);
        
        try {
          const res = await authenticatedFetch(`${BASE_URL}/files`, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ids: [selectedFile.id] })
          }, deviceId ?? undefined);

          if (!res.ok) {
            Alert.alert("삭제 실패", "서버에서 삭제에 실패했습니다.");
            return;
          }

          // 캐시에서 즉시 제거
          queryClient.setQueryData(filesQueryKey, (old: any) => ({
            content: (old?.content ?? []).filter((f: any) => f.id !== selectedFile!.id),
            hasMore: old?.hasMore ?? false,
          }));
        } catch (error) {
          console.log("파일 삭제 실패:", error);
          Alert.alert("삭제 실패", "파일 삭제에 실패했습니다.");
        } finally {
          setIsDeleting(false);
        }
      }}
      onMove={() => {
        setFileOptionsVisible(false);
        setMoveModalVisible(true);
      }}
      onOpenLocation={() => {
        if (!selectedFile) return;
        setFileOptionsVisible(false);
        
        // 검색 모드 해제
        setSearch("");
        setDebouncedSearch("");
        setIsSearching(false);
        
        // 파일이 있는 폴더로 이동한 뒤, 대상 파일이 포함된 페이지까지 불러와 카드로 스크롤한다.
        router.push({
          pathname: "/",
          params: {
            folder: selectedFile.path || "root",
            locateFileId: String(selectedFile.id),
          },
        });
      }}
      onClose={() => setFileOptionsVisible(false)}
    />


    {/* 파일 이동 모달 */}
    <FileMoveModal
      visible={moveModalVisible}
      folders={allFolders}
      selectedFile={selectedFile}
      onMove={async (folder) => {
        if (!selectedFile) return;

        // 서버에 파일 이동 저장
        try {
          console.log("🚀 파일 이동 요청:", `${BASE_URL}/files/${selectedFile.id}`, { path: folder.id });
          const response = await authenticatedFetch(`${BASE_URL}/files/${selectedFile.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: String(folder.id) })
          }, deviceId ?? undefined);

          console.log("📥 응답 상태:", response.status);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ 서버 에러:", errorText);
            Alert.alert("이동 실패", `서버 오류: ${response.status}`);
            setMoveModalVisible(false);
            return;
          }

          const updatedFile = await response.json();
          console.log("✅ 파일 이동 완료:", updatedFile);

          // 현재 폴더 목록 새로고침 (파일이 사라지도록)
          refetchFiles();
        } catch (error) {
          console.log("❌ 파일 이동 실패:", error);
          Alert.alert("이동 실패", "파일 이동에 실패했습니다.");
        }

        setMoveModalVisible(false);
      }}
      onClose={() => setMoveModalVisible(false)}
    />

    {/* 폴더 이동 모달 */}
    <FileMoveModal
      visible={folderMoveModalVisible}
      folders={allFolders.filter((f) => {
        if (!f || !f.id) return false;
        // 자기 자신 제외
        if (String(f.id) === String(selectedFolder?.id)) return false;
        // 자기 자신의 하위 폴더 제외 (순환 참조 방지)
        if (String(f.path) === String(selectedFolder?.id)) return false;
        return true;
      })}
      selectedFile={selectedFolder}
      onMove={async (folder) => {
        if (!selectedFolder) return;

        const ok = await moveFolderToServer(selectedFolder.id, String(folder.id));
        if (ok) {
          await refetchFolders();
          await refetchAllFolders();
          await refetchFiles();
          setFolderMoveModalVisible(false);
        } else {
          Alert.alert("이동 실패", "폴더 이동에 실패했습니다.");
        }
      }}
      onClose={() => setFolderMoveModalVisible(false)}
    />

    {/* 일괄 이동 모달 */}
    <FileMoveModal
      visible={bulkMoveModalVisible}
      folders={allFolders.filter((f) => {
        if (!f || !f.id) return false;
        // 선택된 폴더들 자기 자신 제외
        if (selectedItems.folders.includes(f.id)) return false;
        // 선택된 폴더들의 하위 폴더 제외 (순환 참조 방지)
        if (selectedItems.folders.some(id => String(f.path) === String(id))) return false;
        return true;
      })}
      selectedFile={null}
      onMove={handleBulkMove}
      onClose={() => setBulkMoveModalVisible(false)}
    />

    {/* 파일 삭제 중 로딩 오버레이 */}
    <Modal visible={isDeleting} transparent animationType="fade">
      <View style={{
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "center",
        alignItems: "center",
      }}>
        <View style={{
          backgroundColor: "#fff",
          borderRadius: 16,
          padding: 32,
          alignItems: "center",
          gap: 16,
          minWidth: 200,
        }}>
          <ActivityIndicator size="large" color="#e74c3c" />
          <Text style={{ fontSize: 16, fontWeight: "600", color: "#333" }}>삭제 중...</Text>
          <Text style={{ fontSize: 13, color: "#888", textAlign: "center" }}>잠시만 기다려 주세요</Text>
        </View>
      </View>
    </Modal>

    {/* 파일 등록 중 로딩 오버레이 */}
    <Modal visible={isUploading} transparent animationType="fade">
      <View style={{
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "center",
        alignItems: "center",
      }}>
        <View style={{
          backgroundColor: "#fff",
          borderRadius: 16,
          padding: 32,
          alignItems: "center",
          gap: 16,
          minWidth: 200,
        }}>
          <ActivityIndicator size="large" color="#4A90E2" />
          <Text style={{ fontSize: 16, fontWeight: "600", color: "#333" }}>파일 등록 중...</Text>
          <Text style={{ fontSize: 13, color: "#888", textAlign: "center" }}>잠시만 기다려 주세요</Text>
        </View>
      </View>
    </Modal>

    {/* AI 분석 모달 */}
    <AiAnalysisModal
      visible={aiModalFile !== null}
      fileId={aiModalFile?.id ?? null}
      fileTitle={aiModalFile?.title ?? ""}
      onClose={() => setAiModalFile(null)}
    />

    {/* 정렬 모달 */}
    <SortModal
      visible={sortModalVisible}
      currentSort={sortOption}
      onSelect={(newSort) => {
        console.log('🎯 정렬 선택됨:', newSort);
        setSortOption(newSort);
        setExtraFiles([]);
        setCurrentPage(0);
        // 쿼리 키에 sortParam 포함되어 있어 자동으로 새 데이터 fetch
      }}
      onClose={() => setSortModalVisible(false)}
    />
  </SafeAreaView>
  );
}
