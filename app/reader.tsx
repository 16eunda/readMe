// app/reader.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import { Buffer } from 'buffer';
import * as FileSystem from "expo-file-system/legacy";
import * as NavigationBar from "expo-navigation-bar";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { readExternalTextFile } from "external-file-info";
import iconv from 'iconv-lite';
import { Search, X } from "lucide-react-native";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import ReaderSearchModal, { ReaderSearchResult } from "../components/ReaderSearchModal";
import { authenticatedFetch, BASE_URL } from "../utils/api";
import { createPreviewAroundOffset, createPreviewText } from "../utils/preview";
import {
  enqueueReaderWrite,
  hasSupersedingReaderSession,
  ReaderFlushReason,
  registerActiveReaderSession,
  waitForReaderWrites,
} from "../utils/readerLifecycle";

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

// ===================== 리더 설정 =====================
const SETTINGS_KEY = "@reader_settings";

interface ReaderSettings {
  fontSize: number;
  bgColor: string;
  textColor: string;
  fontFamily: string;
  usePublisherFont: boolean;
  brightness: number;
  lineSpacing: number;   // 줄 간격 배수 (1.2 ~ 2.5)
  sidePadding: number;  // 좌우 여백 px (8 ~ 60)
}

interface TxtSearchTarget {
  chunkIndex: number;
  localOffset: number;
  length: number;
  query: string;
}

interface TxtPendingNavigation {
  id: number;
  characterOffset: number;
  chunkIndex: number;
  localOffset: number;
  lineTopInset: number;
  viewPosition: number;
  attempts: number;
}

interface TxtRenderChunk {
  start: number;
  end: number;
}

interface TxtItemLayout {
  y: number;
  height: number;
}

interface TxtLineMetric {
  offset: number;
  y: number;
  height: number;
}

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  bgColor: "#f5f0e6",
  textColor: "#333333",
  fontFamily: "default",
  usePublisherFont: false,
  brightness: 1.0,
  lineSpacing: 1.9,
  sidePadding: 24,
};

const BG_PRESETS = [
  { label: "종이", bg: "#f5f0e6", text: "#000000" },
  { label: "흰색", bg: "#fafaf8", text: "#000000" },
  { label: "회색", bg: "#e8e8e8", text: "#000000" },
  { label: "다크", bg: "#1c1c1e", text: "#e5e5e7" },
  { label: "초록", bg: "#c3dda8", text: "#000000" }, // #dde9cc : 연한 아라그린, #c3dda8 : 아라그린
];

const FONT_PRESETS = [
  { label: "기본", value: "default" },
  { label: "명조", value: "Georgia" },
];

const TXT_RENDER_CHUNK_SIZE = 4000;
const TXT_SEARCH_SCAN_CHUNK_SIZE = 250000;
const READER_SEARCH_RESULT_LIMIT = 100;
const TXT_SCROLL_UI_UPDATE_INTERVAL_MS = 100;
// 목표 구간이 렌더될 때까지 측정값 기반으로 다시 시도하는 최대 횟수
const TXT_NAVIGATION_MAX_ATTEMPTS = 12;
// 이어읽기 복원이 "도착했다"고 볼 문자 오차(한 줄 남짓)와 재정렬 상한
const TXT_RESUME_SETTLE_TOLERANCE = 300;
const TXT_RESUME_SETTLE_MAX_ATTEMPTS = 10;
const TXT_LOCAL_PROGRESS_KEY_PREFIX = "@reader_txt_position:";
const READER_LOCAL_PROGRESS_KEY_PREFIX = "@reader_position:";
const EPUB_LOCATIONS_CACHE_KEY_PREFIX = "@reader_epub_locations:";
const ACTIVE_READER_SESSION_KEY = "@active_reader_session";

interface LocalReaderPosition {
  uri?: string;
  format?: "EPUB" | "TXT";
  progress?: number;
  epubCfi?: string;
  anchorRatio?: number;
  readingPreview?: string;
  characterOffset?: number;
  previewCharacterOffset?: number;
  lineTopInset?: number;
  layoutSignature?: string;
  updatedAt?: number;
}

type CanonicalReadingPosition =
  | {
      format: "TXT";
      characterOffset: number;
      lineTopInset: number;
    }
  | {
      format: "EPUB";
      cfi: string;
      anchorRatio: number;
    };

function escapeSearchPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitSearchExcerpt(excerpt: string, query: string) {
  const normalized = String(excerpt || "").replace(/\s+/g, " ").trim();
  const normalizedQuery = query.trim();
  const matchIndex = normalized.toLocaleLowerCase().indexOf(normalizedQuery.toLocaleLowerCase());

  if (matchIndex < 0 || !normalizedQuery) {
    return { before: normalized, match: "", after: "" };
  }

  return {
    before: normalized.slice(0, matchIndex),
    match: normalized.slice(matchIndex, matchIndex + normalizedQuery.length),
    after: normalized.slice(matchIndex + normalizedQuery.length),
  };
}

// 한 구간이 몇 줄로 그려질지 추정한다.
// 구간은 각각 독립된 <Text>로 렌더되므로 줄바꿈 계산도 구간 단위로 끊어진다.
// 본문 스타일에는 여백이 없어서 구간 높이 = 줄 수 × lineHeight 로 정확히 대응한다.
function estimateTxtChunkLines(
  text: string,
  start: number,
  end: number,
  unitsPerLine: number,
): number {
  if (end <= start) return 1;

  let lines = 0;
  let units = 0;
  for (let index = start; index < end; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 10) {
      lines += Math.max(1, Math.ceil(units / unitsPerLine));
      units = 0;
      continue;
    }
    // 한글/한자 등은 전각, 영문·숫자·공백은 반각으로 폭을 근사한다.
    units += code < 0x1100 ? 0.5 : 1;
  }
  lines += Math.max(1, Math.ceil(units / unitsPerLine));

  return Math.max(1, lines);
}

// 화면에서 내려간 셀의 y는 더 이상 현재 목록 좌표계의 값이 아니다.
// 언마운트될 때 측정값을 지워, 옛 좌표가 현재 스크롤 위치를 "포함"한다고
// 오인해 엉뚱한 구간을 현재 위치로 보고하는 것을 막는다.
function TxtCell({
  index,
  style,
  onLayout,
  onMeasuredRef,
  onUnmountRef,
  children,
}: {
  index?: number;
  style?: any;
  onLayout?: (event: any) => void;
  onMeasuredRef: React.RefObject<(index: number, layout: TxtItemLayout) => void>;
  onUnmountRef: React.RefObject<(index: number) => void>;
  children?: React.ReactNode;
}) {
  useEffect(() => {
    if (typeof index !== "number") return;
    return () => onUnmountRef.current?.(index);
  }, [index, onUnmountRef]);

  return (
    <View
      style={style}
      onLayout={(event) => {
        onLayout?.(event);
        if (typeof index !== "number") return;
        const { y, height } = event.nativeEvent.layout;
        if (!(height > 0)) return;
        onMeasuredRef.current?.(index, { y, height });
      }}
    >
      {children}
    </View>
  );
}

function splitTextIntoRenderChunks(text: string): TxtRenderChunk[] {
  if (!text) return [{ start: 0, end: 0 }];

  const chunks: TxtRenderChunk[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + TXT_RENDER_CHUNK_SIZE);

    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > start + TXT_RENDER_CHUNK_SIZE * 0.55) {
        end = newline + 1;
      } else if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) {
        end -= 1;
      }
    }

    chunks.push({ start, end });
    start = end;
  }

  return chunks;
}

export default function ReaderScreen() {
  const router = useRouter();
  const { fileId, uri, name, type, resetProgress } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const readerTopInset = Math.max(
    insets.top,
    Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0,
  );
  const { width: windowWidth } = useWindowDimensions();
  const readerSessionIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const flushReaderSessionRef = useRef<(reason: ReaderFlushReason) => Promise<void>>(async () => {});

  useFocusEffect(
    useCallback(() => {
      const normalizedFileId = Array.isArray(fileId) ? String(fileId[0] ?? "") : String(fileId ?? "");
      const normalizedUri = Array.isArray(uri) ? String(uri[0] ?? "") : String(uri ?? "");
      const normalizedName = Array.isArray(name) ? String(name[0] ?? "") : String(name ?? "");
      const normalizedType = Array.isArray(type) ? String(type[0] ?? "") : String(type ?? "");
      if (!normalizedFileId || !normalizedUri || !normalizedName) return;

      const serializedSession = JSON.stringify({
        sessionId: readerSessionIdRef.current,
        fileId: normalizedFileId,
        uri: normalizedUri,
        name: normalizedName,
        type: normalizedType,
      });
      const unregisterReaderSession = registerActiveReaderSession({
        sessionId: readerSessionIdRef.current,
        fileId: normalizedFileId,
        flush: (reason) => flushReaderSessionRef.current(reason),
      });
      AsyncStorage.setItem(ACTIVE_READER_SESSION_KEY, serializedSession).catch(() => {});

      return () => {
        unregisterReaderSession();
        AsyncStorage.getItem(ACTIVE_READER_SESSION_KEY)
          .then((currentSession) => {
            if (currentSession === serializedSession) {
              return AsyncStorage.removeItem(ACTIVE_READER_SESSION_KEY);
            }
          })
          .catch(() => {});
      };
    }, [fileId, name, type, uri]),
  );

  const [isEpub, setIsEpub] = useState(false);
  const [content, setContent] = useState<TxtRenderChunk[]>([]); // txt 렌더링 구간 배열
  const [txtLoading, setTxtLoading] = useState(false); // txt 로딩 중
  const [txtError, setTxtError] = useState<string | null>(null); // txt 에러
  const [showUI, setShowUI] = useState(false);

  // 공통 진행도 상태 (0~1)
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const progressRef = useRef(progress); // unmount 시점에 최신 progress 저장용

  // 터치 vs 드래그 구분용
  const touchStartPos = useRef({
    x: 0,
    y: 0,
    time: 0,
    maxMove: 0,
    active: false,
    didScroll: false,
  });

  // txt 전용 스크롤 정보
  const scrollRef = useRef<FlatList<TxtRenderChunk>>(null);
  const [viewHeight, setViewHeight] = useState(1);
  const [txtLayoutModelVersion, setTxtLayoutModelVersion] = useState(0);
  const [txtContentHeight, setTxtContentHeight] = useState(1);
  const viewHeightRef = useRef(1);
  const txtContentHeightRef = useRef(1);
  const hasResumedRef = useRef(false); // TXT 이어읽기 한 번만 실행
  const contentRef = useRef<TxtRenderChunk[]>([]); // 현재 렌더링 구간 배열
  const rawTextRef = useRef<string>(""); // 전체 원문 (progress 비율로 preview 추출용)
  const currentReadingPreviewRef = useRef<string>(""); // 현재 화면에 보이는 텍스트
  const lastProgressUpdateAtRef = useRef<number>(0); // 마지막 progress 메시지 수신 시간 (최신 preview 타이밍 추적용)
  const currentScrollYRef = useRef<number>(0);
  const currentTxtCharOffsetRef = useRef(0);
  const currentTxtPreviewCharOffsetRef = useRef(0);
  const currentTxtLineTopInsetRef = useRef(0);
  const canonicalReadingPositionRef = useRef<CanonicalReadingPosition | null>(null);
  const previousTxtLayoutSignatureRef = useRef<string | null>(null);
  const pendingTxtRelayoutAnchorRef = useRef<{
    characterOffset: number;
    lineTopInset: number;
  } | null>(null);
  const txtVisibleChunkIndexRef = useRef(0);
  const txtItemLayoutsRef = useRef<Record<number, TxtItemLayout>>({});
  const txtLineMetricsRef = useRef<Record<number, TxtLineMetric[]>>({});
  // 현재 레이아웃에서 문서 전체가 몇 px인지에 대한 단 하나의 모델.
  // FlatList(getItemLayout), 슬라이더 이동, 이어읽기, 페이지 수가 모두 이 모델을 공유한다.
  const txtLayoutModelRef = useRef<{
    offsets: Float64Array;   // 구간별 시작 y (prefix sum)
    lineHeight: number;
    unitsPerLine: number;
    totalHeight: number;
  } | null>(null);
  const txtMeasuredLineCountsRef = useRef<Record<number, number>>({});
  const txtModelCalibratedRef = useRef(false);
  const rebuildTxtLayoutModelRef = useRef<(calibrate: boolean) => void>(() => {});
  const refreshTxtPaginationRef = useRef<() => void>(() => {});
  const txtTotalPagesRef = useRef(1);
  const lastTxtScrollUiUpdateAtRef = useRef(0);
  const txtNavigationIdRef = useRef(0);
  const pendingTxtNavigationRef = useRef<TxtPendingNavigation | null>(null);
  const isTxtProgrammaticNavigationRef = useRef(false);
  const txtNavigationRetryScheduledRef = useRef(false);
  // 이어읽기 복원 전용: 목표 문자 위치에 "실제로" 도착할 때까지 확인한다.
  const txtResumeSettleRef = useRef<{
    characterOffset: number;
    lineTopInset: number;
    attempts: number;
  } | null>(null);
  const onTxtChunkMeasuredRef = useRef<(chunkIndex: number) => void>(() => {});
  const txtCellMeasuredRef = useRef<(index: number, layout: TxtItemLayout) => void>(() => {});
  const txtCellUnmountRef = useRef<(index: number) => void>(() => {});
  const scheduleTxtNavigationRetryRef = useRef<() => void>(() => {});
  const navigateTxtToCharacterOffsetRef = useRef<(
    offset: number,
    viewPosition?: number,
    alignToMeasuredLine?: boolean,
    lineTopInset?: number,
  ) => void>(() => {});
  const updateTxtReadingPreviewRef = useRef<() => void>(() => {});
  const recordedReadFileIdRef = useRef("");
  const txtViewabilityConfigRef = useRef({ viewAreaCoveragePercentThreshold: 10 });
  const onTxtViewableItemsChangedRef = useRef(({ viewableItems }: any) => {
    const firstVisible = (Array.isArray(viewableItems) ? viewableItems : [])
      .filter((item: any) => typeof item.index === "number" && item.isViewable)
      .sort((a: any, b: any) => a.index - b.index)[0];
    if (firstVisible && typeof firstVisible.index === "number") {
      txtVisibleChunkIndexRef.current = firstVisible.index;
      requestAnimationFrame(() => updateTxtReadingPreviewRef.current());
    }
  });

  // epub 전용 base64 데이터
  const [epubBase64, setEpubBase64] = useState("");
  // location 간격 정책은 "파일 크기" 기준을 유지한다. (로딩 방식과 분리)
  const [epubFileSize, setEpubFileSize] = useState(0);
  const [epubLoadKey, setEpubLoadKey] = useState("");
  const epubLoadRetryRef = useRef(0);
  const webViewRef = useRef<WebView>(null);
  const epubOpenStartedAtRef = useRef(0);
  const txtOpenStartedAtRef = useRef(0);
  const epubTouchStartRef = useRef({
    x: 0,
    y: 0,
    time: 0,
    active: false,
    didScroll: false,
  });
  const epubTouchMaxMoveRef = useRef(0);
  const lastEpubWebToggleAtRef = useRef(0);
  const [lastCfi, setLastCfi] = useState<string | null>(null);     // 마지막 위치
  const lastCfiRef = useRef<string | null>(null);
  const lastAnchorRatioRef = useRef<number>(0.5); // 저장 당시 CFI의 화면 내 위치 비율 (re-render 불필요)
  const [initialCfi, setInitialCfi] = useState<string | null>(null); // 서버에서 받은 CFI
  const [fileInfoLoaded, setFileInfoLoaded] = useState(false); // 서버 파일 정보 로딩 완료 여부
  const [epubReady, setEpubReady] = useState(false);               // WebView 준비 여부
  const [epubRestoring, setEpubRestoring] = useState(false);       // CFI 복원 스크롤 계산 중 (로딩 오버레이)
  const [epubError, setEpubError] = useState<string | null>(null); // EPUB 로딩 에러
  const [epubLocationsReady, setEpubLocationsReady] = useState(false);
  const [epubNavigationReady, setEpubNavigationReady] = useState(false);
  const [epubNavigationError, setEpubNavigationError] = useState(false);
  const [epubAtFirstSection, setEpubAtFirstSection] = useState(false);
  const firstSectionTouchRef = useRef({
    x: 0,
    y: 0,
    time: 0,
    maxMove: 0,
    active: false,
    didScroll: false,
  });
  const lastWebPercentRef = useRef<number | null>(null);
  const lastWebLogAtRef = useRef<number>(0);
  const pendingEpubLocationRequestRef = useRef<{
    promise: Promise<void>;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [sliderPreviewValue, setSliderPreviewValue] = useState<number | null>(null);
  const sliderDraggingRef = useRef(false);
  const sliderPendingValueRef = useRef<number | null>(null);
  const sliderThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSliderSeekAtRef = useRef(0);
  const sliderSeekRequestIdRef = useRef(0);
  const sliderFinalRequestIdRef = useRef<number | null>(null);

  // ===== 리더 설정 =====
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [readerSettingsLoaded, setReaderSettingsLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // ===== 본문 검색 =====
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLimited, setSearchLimited] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [txtSearchTarget, setTxtSearchTarget] = useState<TxtSearchTarget | null>(null);
  const [epubSearchHighlightActive, setEpubSearchHighlightActive] = useState(false);
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    if (!showSearch) return;

    const query = searchQuery.trim();
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearchResults([]);
    setSearchLimited(false);
    setSearchError(null);

    if (!query) {
      setSearchLoading(false);
      webViewRef.current?.postMessage(JSON.stringify({ type: "cancelSearch", requestId }));
      return;
    }

    setSearchLoading(true);
    const debounceTimer = setTimeout(() => {
      if (searchRequestIdRef.current !== requestId) return;

      if (isEpub) {
        if (!epubReady || !webViewRef.current) {
          setSearchLoading(false);
          setSearchError("EPUB 본문을 불러온 뒤 다시 검색해 주세요.");
          return;
        }
        webViewRef.current.postMessage(JSON.stringify({
          type: "searchBook",
          query,
          requestId,
          limit: READER_SEARCH_RESULT_LIMIT,
        }));
        return;
      }

      const raw = rawTextRef.current;
      if (!raw) {
        setSearchLoading(false);
        return;
      }

      const results: ReaderSearchResult[] = [];
      const pattern = new RegExp(escapeSearchPattern(query), "giu");
      let cursor = 0;
      let publishedResultCount = 0;

      const scanNextChunk = () => {
        if (searchRequestIdRef.current !== requestId) return;

        const ownedEnd = Math.min(raw.length, cursor + TXT_SEARCH_SCAN_CHUNK_SIZE);
        const scanEnd = Math.min(raw.length, ownedEnd + Math.max(0, query.length - 1));
        const chunk = raw.slice(cursor, scanEnd);
        pattern.lastIndex = 0;

        let found: RegExpExecArray | null;
        while ((found = pattern.exec(chunk)) && results.length < READER_SEARCH_RESULT_LIMIT) {
          const textOffset = cursor + found.index;
          if (textOffset >= ownedEnd) break;

          const contextStart = Math.max(0, textOffset - 70);
          const contextEnd = Math.min(raw.length, textOffset + found[0].length + 110);
          const before = raw.slice(contextStart, textOffset).replace(/\s+/g, " ").trimStart();
          const match = raw.slice(textOffset, textOffset + found[0].length).replace(/\s+/g, " ");
          const after = raw.slice(textOffset + found[0].length, contextEnd).replace(/\s+/g, " ").trimEnd();
          const ratio = raw.length > 0 ? textOffset / raw.length : 0;

          results.push({
            id: `txt-${requestId}-${textOffset}`,
            before: `${contextStart > 0 ? "… " : ""}${before}`,
            match,
            after: `${after}${contextEnd < raw.length ? " …" : ""}`,
            locationLabel: `${Math.max(1, Math.round(ratio * 100))}% 지점`,
            textOffset,
          });

          if (found[0].length === 0) pattern.lastIndex += 1;
        }

        if (results.length !== publishedResultCount) {
          publishedResultCount = results.length;
          setSearchResults([...results]);
        }
        if (results.length >= READER_SEARCH_RESULT_LIMIT) {
          setSearchLimited(true);
          setSearchLoading(false);
          return;
        }

        cursor = ownedEnd;
        if (cursor >= raw.length) {
          setSearchLoading(false);
          return;
        }

        setTimeout(scanNextChunk, 0);
      };

      scanNextChunk();
    }, 250);

    return () => clearTimeout(debounceTimer);
  }, [epubReady, isEpub, searchQuery, showSearch]);

  // 리더 진입 기록: lastReadAt/읽기 횟수는 progress 저장과 분리해 세션당 한 번만 기록한다.
  useEffect(() => {
    const currentFileId = Array.isArray(fileId) ? String(fileId[0] ?? "") : String(fileId ?? "");
    if (!currentFileId || recordedReadFileIdRef.current === currentFileId) return;

    recordedReadFileIdRef.current = currentFileId;
    authenticatedFetch(`${BASE_URL}/files/${encodeURIComponent(currentFileId)}/read`, {
      method: "POST",
    }).then(async (response) => {
      if (response.ok) {
        console.log("✅ 읽기 진입 기록 완료:", currentFileId);
        return;
      }
      const errorText = await response.text().catch(() => "");
      console.log("⚠️ 읽기 진입 기록 실패:", response.status, errorText.slice(0, 100));
      recordedReadFileIdRef.current = "";
    }).catch((error) => {
      console.log("⚠️ 읽기 진입 기록 요청 실패:", error);
      recordedReadFileIdRef.current = "";
    });
  }, [fileId]);

  // 설정 불러오기
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((val) => {
        if (val) {
          try {
            setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(val) });
          } catch {}
        }
      })
      .finally(() => setReaderSettingsLoaded(true));
  }, []);

  // 설정 저장
  useEffect(() => {
    if (!readerSettingsLoaded) return;
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [readerSettingsLoaded, settings]);

  // 줄바꿈에 실제로 영향을 주는 값만 서명에 넣는다. 뷰포트 높이는 줄 나눔이 아니라
  // 페이지 환산에만 쓰이므로 제외한다. (상/하단 UI 토글로 시스템 바가 접혔다 펴질 때
  // 본문 셀이 통째로 다시 마운트되면서 측정값과 읽던 위치가 초기화되는 것을 막는다.)
  const txtLayoutSignature = [
    settings.fontSize,
    settings.fontFamily,
    settings.lineSpacing,
    settings.sidePadding,
    Math.round(windowWidth),
  ].join(":");

  useLayoutEffect(() => {
    if (isEpub) return;
    const previousSignature = previousTxtLayoutSignatureRef.current;
    const layoutChanged = previousSignature != null
      && previousSignature !== txtLayoutSignature
      && rawTextRef.current.length > 0;

    if (layoutChanged) {
      const currentAnchor = canonicalReadingPositionRef.current;
      pendingTxtRelayoutAnchorRef.current = currentAnchor?.format === "TXT"
        ? {
            characterOffset: currentAnchor.characterOffset,
            lineTopInset: currentAnchor.lineTopInset,
          }
        : {
            characterOffset: currentTxtCharOffsetRef.current,
            lineTopInset: currentTxtLineTopInsetRef.current,
          };
      // 새 레이아웃의 초기 scroll 이벤트가 기존 pixel offset을 본문 위치로
      // 오인하지 못하게, 문자 앵커 재정렬이 끝날 때까지 scroll 보고를 차단한다.
      isTxtProgrammaticNavigationRef.current = true;
    }
    previousTxtLayoutSignatureRef.current = txtLayoutSignature;
    txtItemLayoutsRef.current = {};
    txtLineMetricsRef.current = {};
    // 줄 나눔 모델은 폰트/자간/여백/폭에 종속이므로 새 레이아웃에서 다시 세운다.
    // 우선 이론값으로 바로 세우고, 실제 측정이 들어오면 한 번 보정한다.
    txtMeasuredLineCountsRef.current = {};
    txtModelCalibratedRef.current = false;
    rebuildTxtLayoutModelRef.current(false);

    if (layoutChanged) {
      requestAnimationFrame(() => {
        const anchor = pendingTxtRelayoutAnchorRef.current;
        if (!anchor) return;
        navigateTxtToCharacterOffsetRef.current(
          anchor.characterOffset,
          0,
          true,
          anchor.lineTopInset,
        );
      });
    }
  }, [
    content.length,
    isEpub,
    settings.fontSize,
    settings.lineSpacing,
    settings.sidePadding,
    txtLayoutSignature,
    windowWidth,
  ]);

  // 읽는 중 설정 변경 → "theme" 메시지 전송 (display 이후에만)
  useEffect(() => {
    if (!isEpub || !epubReady || !epubStartedRef.current || !webViewRef.current) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: "theme",
      bgColor: settings.bgColor,
      textColor: settings.textColor,
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      usePublisherFont: settings.usePublisherFont,
      lineSpacing: settings.lineSpacing,
      sidePadding: settings.sidePadding,
    }));
  }, [epubReady, isEpub, settings]);


  useEffect(() => {
    const fileName = String(name || "");
    const fileUri = decodeURI(String(uri || ""));
    const uriFileName = fileUri.split('/').pop() || '';
    const fileType = String(type || "").toUpperCase();
    let isEpubFile =
      fileType === 'EPUB' ||
      fileName.toLowerCase().endsWith(".epub") ||
      uriFileName.toLowerCase().endsWith('.epub');
    
    setIsEpub(isEpubFile);
    setEpubBase64("");
    setEpubFileSize(0);
    setEpubLoadKey("");
    epubLoadRetryRef.current = 0;
    setEpubReady(false);
    setEpubRestoring(false);
    setEpubError(null);
    setEpubLocationsReady(false);
    setEpubNavigationReady(false);
    setEpubNavigationError(false);
    setEpubAtFirstSection(false);
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchLoading(false);
    setSearchLimited(false);
    setSearchError(null);
    setTxtSearchTarget(null);
    setEpubSearchHighlightActive(false);
    setSliderPreviewValue(null);
    sliderDraggingRef.current = false;
    sliderPendingValueRef.current = null;
    sliderFinalRequestIdRef.current = null;
    if (sliderThrottleTimerRef.current) {
      clearTimeout(sliderThrottleTimerRef.current);
      sliderThrottleTimerRef.current = null;
    }
    txtNavigationIdRef.current += 1;
    pendingTxtNavigationRef.current = null;
    isTxtProgrammaticNavigationRef.current = false;
    txtResumeSettleRef.current = null;
    setLastCfi(null);
    lastCfiRef.current = null;
    canonicalReadingPositionRef.current = null;
    lastWebPercentRef.current = null;
    epubStartedRef.current = false;
    epubStartedCfiRef.current = null;

    let active = true;

    const read = async () => {
      try {
        const decoded = decodeURI(uri as string);
        console.log("📖 파일 읽기 시작:", fileName, "→", decoded);

        // 앱 컨테이너 경로가 바뀐 경우 현재 documentDirectory에서 다시 찾는다.
        const readWithFallback = async (path: string, opts: any): Promise<string> => {
          try {
            return await FileSystem.readAsStringAsync(path, opts);
          } catch (e) {
            const msg = String(e);
            if (msg.includes('ENOENT') || msg.includes('FileNotFoundException')) {
              const fileNameOnly = path.split('/').pop() || '';
              const documentDirectory = FileSystem.documentDirectory ?? '';
              const fallbackPaths = [
                `${documentDirectory}library-files/${fileNameOnly}`,
                `${documentDirectory}${fileNameOnly}`,
              ];

              for (const fallback of fallbackPaths) {
                try {
                  console.log("⚠️ 폴백 시도:", fallback);
                  return await FileSystem.readAsStringAsync(fallback, opts);
                } catch (fallbackError) {
                  const fallbackMessage = String(fallbackError);
                  if (!fallbackMessage.includes('ENOENT') && !fallbackMessage.includes('FileNotFoundException')) {
                    throw fallbackError;
                  }
                }
              }
            }
            throw e;
          }
        };

        const getFallbackPaths = (path: string) => {
          const fileNameOnly = path.split('/').pop() || '';
          const documentDirectory = FileSystem.documentDirectory ?? '';
          return [
            `${documentDirectory}library-files/${fileNameOnly}`,
            `${documentDirectory}${fileNameOnly}`,
          ];
        };

        const readTextWithNativeFallback = async (path: string): Promise<string | null> => {
          const direct = await readExternalTextFile(path);
          if (direct != null) return direct;

          for (const fallback of getFallbackPaths(path)) {
            const fallbackText = await readExternalTextFile(fallback);
            if (fallbackText != null) {
              console.log("⚠️ TXT 네이티브 폴백 성공:", fallback);
              return fallbackText;
            }
          }

          return null;
        };

        if (isEpubFile) {
          epubOpenStartedAtRef.current = Date.now();
          console.log("⏱️ EPUB [0ms] 파일 열기 시작:", fileName);
          // 큰 EPUB은 base64를 거대한 WebView HTML에 포함하지 않고 파일 URI로 직접 연다.
          try {
            const info = await FileSystem.getInfoAsync(decoded);
            const fileSize = info.exists && typeof info.size === "number" ? info.size : 0;
            console.log(
              `⏱️ EPUB [${Date.now() - epubOpenStartedAtRef.current}ms] 파일 정보 조회 완료`,
              `${(fileSize / 1024 / 1024).toFixed(1)}MB`,
            );
            // 파일 URI로 바로 여는 경로가 압도적으로 빠르다.
            // base64로 읽으면 파일 전체가 문자열이 되어 WebView HTML에 박히고,
            // RN 브리지 전달 + 거대 HTML 파싱 비용이 파일 크기에 비례해 붙는다.
            if (decoded.startsWith("file://")) {
              console.log("✅ EPUB 파일 URI 직접 로드:", (fileSize / 1024 / 1024).toFixed(1), "MB");
              if (!active) return;
              setEpubFileSize(fileSize);
              setEpubBase64("__FILE_URI__");
              setEpubLoadKey(`${String(fileId || '')}-${Date.now()}-${Math.random()}`);
              return;
            }

            // file:// 이 아닌 예외적인 경로만 기존 base64 방식으로 처리한다.
            const b64 = await readWithFallback(decoded, {
              encoding: FileSystem.EncodingType.Base64,
            });
            console.log("✅ EPUB base64 로드 완료, 길이:", b64.length);
            
            if (!b64 || b64.length === 0) {
              console.error("❌ base64가 비어있습니다");
              setEpubError("파일을 읽을 수 없습니다");
              return;
            }
            if (!active) return;
            setEpubFileSize(fileSize);
            setEpubBase64(b64);
            setEpubLoadKey(`${String(fileId || '')}-${Date.now()}-${Math.random()}`);
          } catch (epubError) {
            console.log('❌ EPUB 읽기 실패:', epubError);
            setEpubError("EPUB 파일을 읽을 수 없습니다");
          }
        } else {
          // TXT 파일
          txtOpenStartedAtRef.current = Date.now();
          console.log("⏱️ TXT [0ms] 파일 열기 시작:", fileName);
          hasResumedRef.current = false;
          setTxtLoading(true);
          setTxtError(null);
          setContent([]);
          setTxtContentHeight(1);
          txtContentHeightRef.current = 1;
          contentRef.current = [];
          rawTextRef.current = "";
          currentTxtCharOffsetRef.current = 0;
          currentTxtPreviewCharOffsetRef.current = 0;
          currentTxtLineTopInsetRef.current = 0;
          canonicalReadingPositionRef.current = {
            format: "TXT",
            characterOffset: 0,
            lineTopInset: 0,
          };
          previousTxtLayoutSignatureRef.current = null;
          pendingTxtRelayoutAnchorRef.current = null;
          txtVisibleChunkIndexRef.current = 0;
          txtItemLayoutsRef.current = {};
          txtLineMetricsRef.current = {};
          txtLayoutModelRef.current = null;
          txtMeasuredLineCountsRef.current = {};
          txtModelCalibratedRef.current = false;
          txtTotalPagesRef.current = 1;
          setTxtSearchTarget(null);
          currentReadingPreviewRef.current = "";

          let text = await readTextWithNativeFallback(decoded);
          console.log(`⏱️ TXT [${Date.now() - txtOpenStartedAtRef.current}ms] 파일 읽기/디코딩 완료`,
            text == null ? "native-fail" : `${text.length}자`);
          if (text == null) {
            console.log("⚠️ 네이티브 TXT 읽기 실패, JS base64 폴백 사용");
            const base64 = await readWithFallback(decoded, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const buffer = Buffer.from(base64, 'base64');
            text = decodeTextSafe(buffer);
          }

          if (!active) return;
          const normalizedText = text.includes('\r') ? text.replace(/\r/g, '') : text;
          console.log(`⏱️ TXT [${Date.now() - txtOpenStartedAtRef.current}ms] 개행 정규화 완료`);
          const chunks = splitTextIntoRenderChunks(normalizedText);
          console.log(`⏱️ TXT [${Date.now() - txtOpenStartedAtRef.current}ms] 구간 분할 완료`, `${chunks.length}개`);
          rawTextRef.current = normalizedText; // progress 비율 fallback용
          currentTxtCharOffsetRef.current = 0;
          currentTxtPreviewCharOffsetRef.current = 0;
          currentTxtLineTopInsetRef.current = 0;
          canonicalReadingPositionRef.current = {
            format: "TXT",
            characterOffset: 0,
            lineTopInset: 0,
          };
          txtVisibleChunkIndexRef.current = 0;
          txtItemLayoutsRef.current = {};
          txtLineMetricsRef.current = {};
          txtLayoutModelRef.current = null;
          txtMeasuredLineCountsRef.current = {};
          txtModelCalibratedRef.current = false;
          txtTotalPagesRef.current = 1;
          currentReadingPreviewRef.current = "";
          setContent(chunks);
          contentRef.current = chunks;
          setTxtLoading(false);
          console.log(`⏱️ TXT [${Date.now() - txtOpenStartedAtRef.current}ms] 본문 렌더 요청`);
        }
      } catch (e) {
        console.error("❌ 파일 읽기 오류:", e);
        const isNotFound = String(e).includes('ENOENT') || String(e).includes('FileNotFoundException');
        const msg = isNotFound
          ? '파일을 찾을 수 없습니다.\n파일을 삭제 후 다시 추가해 주세요.'
          : '파일을 읽을 수 없습니다.';
        if (isEpubFile) {
          setEpubError(msg);
        } else {
          setTxtLoading(false);
          setTxtError(msg);
        }
      }
    };

    read();
    return () => {
      active = false;
      txtNavigationIdRef.current += 1;
      pendingTxtNavigationRef.current = null;
      isTxtProgrammaticNavigationRef.current = false;
    };
  }, [uri, name, type, fileId]);

  useEffect(() => {
    if (!isEpub || !epubBase64 || !epubLoadKey || epubReady) return;

    // 실제 기기의 대용량 EPUB은 HTML 주입, base64 디코딩, ZIP 분석에 오래 걸릴 수 있다.
    // 시간 초과만으로 정상 WebView를 파괴하거나 파일 오류로 판정하지 않는다.
    // 파일 URI로 열면 base64 길이가 없으므로 실제 파일 크기를 쓴다.
    const estimatedMegabytes = epubFileSize > 0
      ? epubFileSize / (1024 * 1024)
      : epubBase64.length / 4 * 3 / (1024 * 1024);
    const readyTimeoutMs = Math.min(300000, Math.max(90000, 60000 + estimatedMegabytes * 6000));
    const timer = setTimeout(() => {
      if (epubReady) return;
      console.warn("⚠️ EPUB 준비가 오래 걸리는 중 - 로딩 계속", {
        estimatedMegabytes: estimatedMegabytes.toFixed(1),
        readyTimeoutMs,
      });
    }, readyTimeoutMs);

    return () => clearTimeout(timer);
  }, [isEpub, epubBase64, epubFileSize, epubLoadKey, epubReady, fileId]);

  // 서버에서 불러온 초기 progress (이어읽기 시작점)
  const [initialProgress, setInitialProgress] = useState<number>(0);
  const initialProgressRef = useRef<number>(0); // saveProgressToServer에서 사용
  const initialTxtCharOffsetRef = useRef<number | null>(null);
  const initialTxtLineTopInsetRef = useRef(0);
  const initialTxtLayoutSignatureRef = useRef<string | null>(null);
  const [initialEpubLocationsCache, setInitialEpubLocationsCache] = useState<string | null>(null);
  const [epubLocationsCacheLoaded, setEpubLocationsCacheLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const currentFileId = Array.isArray(fileId) ? String(fileId[0] ?? "") : String(fileId ?? "");
    const currentUri = Array.isArray(uri) ? String(uri[0] ?? "") : String(uri ?? "");
    const storageKey = `${EPUB_LOCATIONS_CACHE_KEY_PREFIX}${currentFileId}`;

    setInitialEpubLocationsCache(null);
    setEpubLocationsCacheLoaded(false);

    const loadCache = async () => {
      try {
        await waitForReaderWrites(`epub-cache:${currentFileId}`);
        const serialized = await AsyncStorage.getItem(storageKey);
        if (!active || !serialized) return;
        const cached = JSON.parse(serialized);
        if (cached?.uri === currentUri && typeof cached?.locations === "string") {
          setInitialEpubLocationsCache(cached.locations);
        }
      } catch (error) {
        console.log("EPUB 위치 인덱스 캐시 불러오기 실패:", error);
      } finally {
        if (active) setEpubLocationsCacheLoaded(true);
      }
    };

    void loadCache();
    return () => {
      active = false;
    };
  }, [fileId, uri]);

  useEffect(() => {
  let active = true;
  setFileInfoLoaded(false);
  setInitialCfi(null);
  setInitialProgress(0);
  initialProgressRef.current = 0;
  initialTxtCharOffsetRef.current = null;
  initialTxtLineTopInsetRef.current = 0;
  initialTxtLayoutSignatureRef.current = null;
  setProgress(0);
  progressRef.current = 0;
  lastAnchorRatioRef.current = 0.5;

  const load = async () => {
    const currentFileId = Array.isArray(fileId) ? String(fileId[0] ?? "") : String(fileId ?? "");
    const localProgressKey = `${TXT_LOCAL_PROGRESS_KEY_PREFIX}${currentFileId}`;
    const shouldResetProgress = resetProgress === "true";
    const readerLocalProgressKey = `${READER_LOCAL_PROGRESS_KEY_PREFIX}${currentFileId}`;
    let localPosition: LocalReaderPosition | null = null;
    let readerLocalPosition: LocalReaderPosition | null = null;

    try {
      if (shouldResetProgress) {
        await AsyncStorage.multiRemove([localProgressKey, readerLocalProgressKey]);
      } else {
        await Promise.all([
          waitForReaderWrites(`txt-local:${currentFileId}`),
          waitForReaderWrites(`reader-local:${currentFileId}`),
        ]);
        const [savedLocalPosition, savedReaderPosition] = await Promise.all([
          AsyncStorage.getItem(localProgressKey),
          AsyncStorage.getItem(readerLocalProgressKey),
        ]);
        localPosition = savedLocalPosition ? JSON.parse(savedLocalPosition) : null;
        readerLocalPosition = savedReaderPosition ? JSON.parse(savedReaderPosition) : null;
        const currentUri = String(Array.isArray(uri) ? uri[0] : uri);
        if (readerLocalPosition?.uri !== currentUri) {
          readerLocalPosition = null;
        }
      }
    } catch (localError) {
      console.log("로컬 이어읽기 위치 불러오기 실패:", localError);
    }

    const latestLocalPosition = (Number(readerLocalPosition?.updatedAt) || 0) >= (Number(localPosition?.updatedAt) || 0)
      ? readerLocalPosition
      : localPosition;

    try {
      console.log("🔍 서버에서 파일 정보 불러오는 중...", fileId);
      const res = await authenticatedFetch(`${BASE_URL}/files/${fileId}`);
      const fileInfo = await res.json();
      if (!active) return;
      console.log("📚 서버에서 받은 데이터:", fileInfo);

      const serverProgress = Number(fileInfo.progress) || 0;
      const localProgress = Number(latestLocalPosition?.progress) || 0;
      const restoredProgress = localProgress > 0 ? localProgress : serverProgress;
      const restoredReadingPreview = readerLocalPosition?.readingPreview || fileInfo.readingPreview;
      if (typeof restoredReadingPreview === "string" && restoredReadingPreview.trim()) {
        currentReadingPreviewRef.current = createPreviewText(restoredReadingPreview);
      }

      if (!shouldResetProgress && restoredProgress > 0) {
        console.log("✅ 저장된 progress 발견:", restoredProgress, localProgress > 0 ? "(기기 저장값)" : "(서버 저장값)");
        setProgress(restoredProgress);
        setInitialProgress(restoredProgress);
        initialProgressRef.current = restoredProgress;
        if (Number.isFinite(latestLocalPosition?.characterOffset)) {
          initialTxtCharOffsetRef.current = Math.max(0, Number(latestLocalPosition?.characterOffset));
        }
        if (Number.isFinite(latestLocalPosition?.lineTopInset)) {
          initialTxtLineTopInsetRef.current = Math.max(0, Number(latestLocalPosition?.lineTopInset));
        }
        if (typeof latestLocalPosition?.layoutSignature === "string") {
          initialTxtLayoutSignatureRef.current = latestLocalPosition.layoutSignature;
        }
      } else if (shouldResetProgress) {
        console.log("↩️ 처음으로 열기 - 저장된 progress/CFI 복원 생략");
      } else {
        console.log("⚠️ 저장된 progress 없음");
      }

      // ⭐ EPUB 이어 읽기: 저장된 CFI 있으면 기억 (문자열인지 반드시 확인)
      const localEpubCfi = readerLocalPosition?.uri === String(Array.isArray(uri) ? uri[0] : uri)
        && typeof readerLocalPosition?.epubCfi === "string"
        ? readerLocalPosition.epubCfi
        : null;
      if (!shouldResetProgress && (localEpubCfi || (fileInfo.epubCfi && typeof fileInfo.epubCfi === 'string'))) {
        const restoredCfi = localEpubCfi || fileInfo.epubCfi;
        setInitialCfi(restoredCfi);
        lastCfiRef.current = restoredCfi;
        canonicalReadingPositionRef.current = {
          format: "EPUB",
          cfi: restoredCfi,
          anchorRatio: lastAnchorRatioRef.current,
        };
        console.log(`✅ [복원] ${localEpubCfi ? "로컬" : "서버"} CFI 로드:`, restoredCfi.slice(0, 80));
      } else if (!shouldResetProgress && fileInfo.epubCfi) {
        console.log("⚠️ CFI가 문자열이 아님, 무시:", typeof fileInfo.epubCfi);
      } else if (!shouldResetProgress) {
        console.log("⚠️ [복원] 서버에 저장된 CFI 없음 - 처음부터 시작");
      }

      // ⭐ anchorRatio 복원: 저장 당시 CFI의 화면 내 위치 비율
      const restoredAnchorRatio = localEpubCfi && typeof readerLocalPosition?.anchorRatio === "number"
        ? readerLocalPosition.anchorRatio
        : fileInfo.anchorRatio;
      if (!shouldResetProgress && typeof restoredAnchorRatio === 'number' && restoredAnchorRatio > 0) {
        lastAnchorRatioRef.current = restoredAnchorRatio;
        if (canonicalReadingPositionRef.current?.format === "EPUB") {
          canonicalReadingPositionRef.current = {
            ...canonicalReadingPositionRef.current,
            anchorRatio: restoredAnchorRatio,
          };
        }
        console.log("✅ [복원] anchorRatio 로드:", restoredAnchorRatio);
      }
      if (epubOpenStartedAtRef.current > 0) {
        console.log(
          `⏱️ EPUB [${Date.now() - epubOpenStartedAtRef.current}ms] 이어읽기 정보 조회 완료`,
        );
      }
      setFileInfoLoaded(true); // 서버 응답 완료
    } catch (e) {
      if (!active) return;
      console.log("진행도 불러오기 실패:", e);
      const localProgress = Number(latestLocalPosition?.progress) || 0;
      if (!shouldResetProgress && localProgress > 0) {
        setProgress(localProgress);
        setInitialProgress(localProgress);
        initialProgressRef.current = localProgress;
        if (Number.isFinite(latestLocalPosition?.characterOffset)) {
          initialTxtCharOffsetRef.current = Math.max(0, Number(latestLocalPosition?.characterOffset));
        }
        if (Number.isFinite(latestLocalPosition?.lineTopInset)) {
          initialTxtLineTopInsetRef.current = Math.max(0, Number(latestLocalPosition?.lineTopInset));
        }
        if (typeof latestLocalPosition?.layoutSignature === "string") {
          initialTxtLayoutSignatureRef.current = latestLocalPosition.layoutSignature;
        }
      }
      if (!shouldResetProgress && readerLocalPosition?.uri === String(Array.isArray(uri) ? uri[0] : uri)) {
        if (typeof readerLocalPosition.epubCfi === "string") {
          setInitialCfi(readerLocalPosition.epubCfi);
          lastCfiRef.current = readerLocalPosition.epubCfi;
          canonicalReadingPositionRef.current = {
            format: "EPUB",
            cfi: readerLocalPosition.epubCfi,
            anchorRatio: lastAnchorRatioRef.current,
          };
        }
        if (typeof readerLocalPosition.anchorRatio === "number" && readerLocalPosition.anchorRatio > 0) {
          lastAnchorRatioRef.current = readerLocalPosition.anchorRatio;
          if (canonicalReadingPositionRef.current?.format === "EPUB") {
            canonicalReadingPositionRef.current = {
              ...canonicalReadingPositionRef.current,
              anchorRatio: readerLocalPosition.anchorRatio,
            };
          }
        }
        if (typeof readerLocalPosition.readingPreview === "string") {
          currentReadingPreviewRef.current = createPreviewText(readerLocalPosition.readingPreview);
        }
      }
      setFileInfoLoaded(true); // 실패해도 EPUB 시작은 해야 함
    }
  };

  load();
  return () => {
    active = false;
  };
}, [fileId, BASE_URL, resetProgress, uri]);

// TXT 본문과 저장 위치가 준비되면 저장된 문자 위치를 기준으로 이어읽기한다.
useEffect(() => {
  if (isEpub) return;
  if (hasResumedRef.current) return;
  if (resetProgress === "true") return;
  if (
    !fileInfoLoaded
    || !readerSettingsLoaded
    || content.length === 0
    || txtContentHeight <= 1
    || viewHeight <= 1
  ) return;

  const savedProgress = initialProgress;
  if (!savedProgress || savedProgress <= 0) return;

  // progress는 있는데 문자 위치가 0이면 서로 모순된 기록이다.
  // 이때는 진행률에서 문자 위치를 되돌려 같은 기준으로 복원한다.
  const savedCharacterOffset = initialTxtCharOffsetRef.current;
  const characterOffset = savedCharacterOffset != null && savedCharacterOffset > 0
    ? Math.min(rawTextRef.current.length, Math.floor(savedCharacterOffset))
    : Math.floor(
        Math.min(1, Math.max(0, savedProgress)) * rawTextRef.current.length,
      );
  // 저장된 scrollY(픽셀)는 그 세션 목록의 추정 좌표계 값이라 다시 재현되지 않는다.
  // 이어읽기는 슬라이더/스크롤과 똑같이 문자 오프셋만으로 복원한다.
  // lineTopInset(줄 안에서의 세로 미세 위치)만 같은 레이아웃일 때 함께 복원한다.
  const hasMatchingLayout = initialTxtLayoutSignatureRef.current === txtLayoutSignature;

  console.log("[Resume] loaded char=" + characterOffset
    + " progress=" + savedProgress.toFixed(4)
    + " sameLayout=" + hasMatchingLayout
    + " target=\"" + txtSnippetAt(characterOffset) + "\"");

  const restoredLineTopInset = hasMatchingLayout ? initialTxtLineTopInsetRef.current : 0;
  // 목록이 렌더 창을 넓히는 동안 위치가 밀릴 수 있으므로,
  // 실제로 이 문자 위치가 화면에 올 때까지 측정값으로 다시 맞춘다.
  txtResumeSettleRef.current = {
    characterOffset,
    lineTopInset: restoredLineTopInset,
    attempts: 0,
  };

  navigateTxtToCharacterOffsetRef.current(
    characterOffset,
    0,
    true,
    restoredLineTopInset,
  );
}, [
  content.length,
  fileInfoLoaded,
  initialProgress,
  isEpub,
  readerSettingsLoaded,
  resetProgress,
  txtContentHeight,
  txtLayoutSignature,
  viewHeight,
]);

// TXT는 첫 스크롤 이벤트 전에도 "처음으로" 상태를 즉시 반영한다.
useEffect(() => {
  if (isEpub || content.length === 0 || viewHeight <= 1) return;

  if (resetProgress === "true") {
    hasResumedRef.current = true;
    navigateTxtToCharacterOffsetRef.current(0, 0);
  }
}, [content.length, isEpub, resetProgress, viewHeight]);

  // 화면 진입 시 즉시 시스템 UI 숨기기, 나갈 때 복원
  useEffect(() => {
    if (Platform.OS !== "android") return;
    StatusBar.setHidden(true, "fade");
    NavigationBar.setVisibilityAsync("hidden");
    return () => {
      StatusBar.setHidden(false, "fade");
      NavigationBar.setVisibilityAsync("visible");
    };
  }, []);

  // showUI 변경 시 시스템 상태바 / 네비게이션 바 토글
  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (showUI) {
      StatusBar.setHidden(false, "fade");
      NavigationBar.setVisibilityAsync("visible");
    } else {
      StatusBar.setHidden(true, "fade");
      NavigationBar.setVisibilityAsync("hidden");
    }
  }, [showUI]);

  // EPUB ready + 서버 파일 정보 모두 준비된 후 한 번만 themeAndStart 발사
  const epubStartedRef = useRef(false);
  const epubStartedCfiRef = useRef<string | null>(null);
  useEffect(() => {
    epubStartedRef.current = false;
    epubStartedCfiRef.current = null;
  }, [uri]);

  useEffect(() => {
    if (!isEpub || !epubReady || !fileInfoLoaded || !epubLocationsCacheLoaded || !webViewRef.current) return;
    const cfiToUse = resetProgress === "true" ? null : (initialCfi || null);

    // 이미 시작했고 같은 CFI로 시작했다면 스킵
    if (epubStartedRef.current && epubStartedCfiRef.current === cfiToUse) return;

    // 이미 CFI로 시작한 상태면 재전송 불필요
    if (epubStartedRef.current && epubStartedCfiRef.current && cfiToUse) return;

    epubStartedRef.current = true;
    epubStartedCfiRef.current = cfiToUse;
    // CFI가 있으면 복원 중 오버레이 표시
    if (cfiToUse) setEpubRestoring(true);
    console.log(
      `⏱️ EPUB [${Date.now() - epubOpenStartedAtRef.current}ms] themeAndStart 전송`,
      "CFI:", cfiToUse,
      "/ initialCfi:", initialCfi,
      "/ resetProgress:", resetProgress,
      "/ anchorRatio:", lastAnchorRatioRef.current,
    );
    webViewRef.current.postMessage(JSON.stringify({
      type: "themeAndStart",
      bgColor: settings.bgColor,
      textColor: settings.textColor,
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      usePublisherFont: settings.usePublisherFont,
      lineSpacing: settings.lineSpacing,
      sidePadding: settings.sidePadding,
      cfi: resetProgress === "true" ? null : (initialCfi || null),
      anchorRatio: resetProgress === "true" ? 0.5 : (lastAnchorRatioRef.current || 0.5),
      locationsCache: initialEpubLocationsCache,
    }));
  }, [
    epubLocationsCacheLoaded,
    epubReady,
    fileInfoLoaded,
    initialCfi,
    initialEpubLocationsCache,
    isEpub,
    resetProgress,
    settings.bgColor,
    settings.fontFamily,
    settings.fontSize,
    settings.lineSpacing,
    settings.sidePadding,
    settings.textColor,
    settings.usePublisherFont,
  ]);


  // ===================== TXT 쪽 진행도 계산 =====================
  const renderTxtCell = useCallback((props: any) => (
    <TxtCell
      index={props.index}
      style={props.style}
      onLayout={props.onLayout}
      onMeasuredRef={txtCellMeasuredRef}
      onUnmountRef={txtCellUnmountRef}
    >
      {props.children}
    </TxtCell>
  ), []);

  txtCellMeasuredRef.current = (index, layout) => {
    txtItemLayoutsRef.current[index] = layout;
    onTxtChunkMeasuredRef.current(index);
  };
  txtCellUnmountRef.current = (index) => {
    delete txtItemLayoutsRef.current[index];
  };

  const getRawTextPreviewAtOffset = (characterOffset: number) => {
    const raw = rawTextRef.current;
    if (raw.length === 0) return "";
    return createPreviewAroundOffset(raw, characterOffset);
  };

  const getTxtChunkText = (index: number) => {
    const chunk = contentRef.current[index];
    if (!chunk) return "";
    return rawTextRef.current.slice(chunk.start, chunk.end);
  };

  const updateTxtReadingPreview = (offsetY = currentScrollYRef.current, progressValue = progressRef.current) => {
    const rawLength = rawTextRef.current.length;
    const fallbackOffset = Math.floor(
      Math.min(1, Math.max(0, progressValue)) * rawLength,
    );
    const viewportCenterY = Math.min(
      Math.max(0, txtContentHeightRef.current - 1),
      Math.max(0, offsetY) + viewHeightRef.current * 0.5,
    );
    const visibleCenterOffset = getTxtCharacterOffsetForScroll(viewportCenterY, false);
    const characterOffset = Math.min(
      rawLength,
      Math.max(
        0,
        visibleCenterOffset ?? fallbackOffset,
      ),
    );
    const preview = getRawTextPreviewAtOffset(characterOffset);

    if (preview) {
      currentTxtPreviewCharOffsetRef.current = characterOffset;
      currentReadingPreviewRef.current = createPreviewText(preview);
      lastProgressUpdateAtRef.current = Date.now();
      return true;
    }

    return false;
  };
  updateTxtReadingPreviewRef.current = () => {
    updateTxtReadingPreview(currentScrollYRef.current, progressRef.current);
  };

  const scrollTxtToOffset = (offset: number) => {
    scrollRef.current?.scrollToOffset({
      offset: Math.max(0, offset),
      animated: false,
    });
  };

  const findTxtChunkIndexForOffset = (characterOffset: number) => {
    const chunks = contentRef.current;
    if (chunks.length === 0) return -1;

    let low = 0;
    let high = chunks.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const chunk = chunks[middle];
      if (characterOffset < chunk.start) {
        high = middle - 1;
      } else if (characterOffset >= chunk.end && middle < chunks.length - 1) {
        low = middle + 1;
      } else {
        return middle;
      }
    }

    return Math.min(chunks.length - 1, Math.max(0, low));
  };

  // ---------- 문서 전체 높이 모델 ----------
  // FlatList는 아직 그리지 않은 구간의 높이를 모른다. 그래서 getItemLayout이 없으면
  // 스크롤 가능한 영역 자체가 "이미 그린 만큼"으로 제한되고, 먼 위치로의 이동이
  // 구조적으로 불가능해진다. 문자 오프셋 하나로 어디든 갈 수 있게 하려면
  // 문서 전체 좌표계를 우리가 직접 갖고 있어야 한다.
  const buildTxtLayoutModel = (calibrate: boolean) => {
    const chunks = contentRef.current;
    const raw = rawTextRef.current;
    if (chunks.length === 0 || raw.length === 0) {
      txtLayoutModelRef.current = null;
      return;
    }

    const lineHeight = Math.max(1, settings.fontSize * settings.lineSpacing);
    const availableWidth = Math.max(
      40,
      windowWidth - settings.sidePadding * 2,
    );
    // 이론값: 전각 한 글자 폭 ≈ fontSize
    let unitsPerLine = Math.max(2, availableWidth / Math.max(1, settings.fontSize));

    if (calibrate) {
      const measuredEntries = Object.entries(txtMeasuredLineCountsRef.current)
        .map(([index, count]) => [Number(index), count] as const)
        .filter(([index, count]) => chunks[index] && count > 0);

      if (measuredEntries.length > 0) {
        const measuredLines = measuredEntries.reduce((sum, [, count]) => sum + count, 0);
        // 추정 줄 수는 unitsPerLine에 대해 단조 감소하므로 이분 탐색으로 맞춘다.
        let low = 2;
        let high = 400;
        for (let step = 0; step < 40; step += 1) {
          const middle = (low + high) / 2;
          let estimated = 0;
          for (const [index] of measuredEntries) {
            const chunk = chunks[index];
            estimated += estimateTxtChunkLines(raw, chunk.start, chunk.end, middle);
          }
          if (estimated > measuredLines) low = middle;
          else high = middle;
        }
        unitsPerLine = (low + high) / 2;
        txtModelCalibratedRef.current = true;
      }
    }

    const offsets = new Float64Array(chunks.length + 1);
    for (let index = 0; index < chunks.length; index += 1) {
      const measured = txtMeasuredLineCountsRef.current[index];
      const lines = measured && measured > 0
        ? measured
        : estimateTxtChunkLines(raw, chunks[index].start, chunks[index].end, unitsPerLine);
      offsets[index + 1] = offsets[index] + lines * lineHeight;
    }

    const previousModel = txtLayoutModelRef.current;
    txtLayoutModelRef.current = {
      offsets,
      lineHeight,
      unitsPerLine,
      totalHeight: offsets[chunks.length],
    };

    // 셀의 y는 "이전 모델 기준"으로 측정된 값이다. 모델이 바뀌면 같은 y가
    // 다른 구간을 가리키므로, 새로 측정될 때까지 이전 좌표를 버린다.
    // (버리지 않으면 이어읽기가 옛 좌표계의 y로 스크롤해 엉뚱한 구간에 도착한다)
    if (previousModel && previousModel.totalHeight !== offsets[chunks.length]) {
      txtItemLayoutsRef.current = {};
    }
    setTxtLayoutModelVersion((version) => version + 1);
    refreshTxtPaginationRef.current();

    // 모델이 바뀌면 목록의 좌표계 자체가 바뀐다. 스크롤 위치는 위치의 원본이
    // 아니라 파생값이므로, 지금 읽고 있는 문자 위치를 기준으로 다시 계산한다.
    const anchor = canonicalReadingPositionRef.current;
    if (calibrate && hasResumedRef.current && anchor?.format === "TXT") {
      requestAnimationFrame(() => {
        navigateTxtToCharacterOffsetRef.current(
          anchor.characterOffset,
          0,
          true,
          anchor.lineTopInset,
        );
      });
    }
  };
  rebuildTxtLayoutModelRef.current = buildTxtLayoutModel;

  const getTxtItemLayout = useCallback((_data: any, index: number) => {
    const model = txtLayoutModelRef.current;
    if (!model || index + 1 >= model.offsets.length) {
      return { length: 0, offset: 0, index };
    }
    return {
      length: model.offsets[index + 1] - model.offsets[index],
      offset: model.offsets[index],
      index,
    };
  }, []);

  // 페이지 수는 "문서 전체 높이 ÷ 화면 높이"에서 파생되는 표시값이다.
  // 읽는 위치 자체는 문자 오프셋이므로 페이지 수가 다시 계산돼도 위치는 움직이지 않는다.
  const refreshTxtPagination = () => {
    const model = txtLayoutModelRef.current;
    const viewportHeight = viewHeightRef.current;
    if (!model || viewportHeight <= 1) return;

    const pages = Math.max(1, Math.ceil(model.totalHeight / viewportHeight));
    if (pages === txtTotalPagesRef.current) return;

    txtTotalPagesRef.current = pages;
    setTotalPages(pages);
    setCurrentPage(Math.min(
      pages,
      Math.max(1, Math.floor(progressRef.current * pages) + 1),
    ));
  };
  refreshTxtPaginationRef.current = refreshTxtPagination;

  const applyTxtCharacterPosition = (characterOffset: number, progressOverride?: number) => {
    const rawLength = rawTextRef.current.length;
    const clampedOffset = Math.min(
      rawLength,
      Math.max(0, Math.floor(characterOffset)),
    );
    const nextProgress = typeof progressOverride === "number"
      ? Math.min(1, Math.max(0, progressOverride))
      : rawLength > 0 ? clampedOffset / rawLength : 0;
    const pages = Math.max(1, txtTotalPagesRef.current);

    currentTxtCharOffsetRef.current = clampedOffset;
    canonicalReadingPositionRef.current = {
      format: "TXT",
      characterOffset: clampedOffset,
      lineTopInset: currentTxtLineTopInsetRef.current,
    };
    progressRef.current = nextProgress;
    setProgress(nextProgress);
    setTotalPages(pages);
    setCurrentPage(Math.min(
      pages,
      Math.max(1, Math.floor(nextProgress * pages) + 1),
    ));
    updateTxtReadingPreview(currentScrollYRef.current, nextProgress);
  };

  const completePendingTxtNavigation = (chunkIndex: number) => {
    const pending = pendingTxtNavigationRef.current;
    if (!pending || pending.chunkIndex !== chunkIndex) return;

    const chunk = contentRef.current[chunkIndex];
    const layout = txtItemLayoutsRef.current[chunkIndex];
    const lineMetrics = txtLineMetricsRef.current[chunkIndex];
    if (!chunk || !layout || !Array.isArray(lineMetrics) || lineMetrics.length === 0) return;

    let targetWithinChunk = layout.height;
    if (pending.characterOffset < rawTextRef.current.length) {
      let selectedLine = lineMetrics[0];
      for (const line of lineMetrics) {
        if (line.offset > pending.localOffset) break;
        selectedLine = line;
      }
      const appliedLineTopInset = Math.min(
        Math.max(0, selectedLine.height - 1),
        Math.max(0, pending.lineTopInset),
      );
      currentTxtLineTopInsetRef.current = appliedLineTopInset;
      targetWithinChunk = selectedLine.y + appliedLineTopInset;
    } else {
      currentTxtLineTopInsetRef.current = 0;
    }

    const targetY = Math.max(
      0,
      layout.y + targetWithinChunk - viewHeightRef.current * pending.viewPosition,
    );
    pendingTxtNavigationRef.current = null;
    pendingTxtRelayoutAnchorRef.current = null;
    currentScrollYRef.current = targetY;
    currentTxtCharOffsetRef.current = pending.characterOffset;
    scrollTxtToOffset(targetY);
    applyTxtCharacterPosition(pending.characterOffset);

    const navigationId = pending.id;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (txtNavigationIdRef.current !== navigationId) return;
        isTxtProgrammaticNavigationRef.current = false;
        applyTxtCharacterPosition(pending.characterOffset);
        updateTxtReadingPreview(currentScrollYRef.current, progressRef.current);
      });
    });
  };

  const requestTxtScrollToChunk = (chunkIndex: number, viewPosition: number) => {
    if (!scrollRef.current) return;
    try {
      scrollRef.current.scrollToIndex({
        index: chunkIndex,
        animated: false,
        viewPosition,
      });
    } catch {
      // 목표 구간이 아직 측정되지 않았으면 onScrollToIndexFailed가 처리한다.
    }
  };

  // 목표 구간까지 도달하지 못한 채 끝난 이동은 요청값을 그대로 두지 않는다.
  // 화면에 실제로 보이는 위치를 다시 읽어 canonical position을 맞춘다.
  const abandonTxtNavigation = () => {
    pendingTxtNavigationRef.current = null;
    pendingTxtRelayoutAnchorRef.current = null;
    isTxtProgrammaticNavigationRef.current = false;

    const measuredOffset = getTxtCharacterOffsetForScroll(currentScrollYRef.current);
    if (measuredOffset == null) return;
    console.log("⚠️ [TXT] 목표 구간 렌더 실패 - 실제 화면 위치로 재동기화", measuredOffset);
    applyTxtCharacterPosition(measuredOffset);
  };

  // FlatList는 아직 측정하지 않은 구간의 위치를 평균값으로만 추정한다.
  // 그래서 먼 곳으로의 이동은 한 번에 도착하지 못할 수 있다.
  // 셀이 측정될 때마다 "목표 구간이 실제로 렌더됐는지" 확인하고,
  // 아직이면 개선된 측정값으로 다시 요청해 수렴시킨다. (타이머 보정 아님)
  const scheduleTxtNavigationRetry = () => {
    if (txtNavigationRetryScheduledRef.current) return;
    if (!pendingTxtNavigationRef.current) return;

    txtNavigationRetryScheduledRef.current = true;
    requestAnimationFrame(() => {
      txtNavigationRetryScheduledRef.current = false;
      const pending = pendingTxtNavigationRef.current;
      if (!pending || pending.id !== txtNavigationIdRef.current) return;

      completePendingTxtNavigation(pending.chunkIndex);
      if (!pendingTxtNavigationRef.current) return;

      // 목표 구간이 이미 렌더된 상태라면 줄 측정만 기다리면 된다.
      if (txtItemLayoutsRef.current[pending.chunkIndex]) return;

      if (pending.attempts >= TXT_NAVIGATION_MAX_ATTEMPTS) {
        abandonTxtNavigation();
        return;
      }
      pending.attempts += 1;
      requestTxtScrollToChunk(pending.chunkIndex, pending.viewPosition);
    });
  };

  // 이어읽기는 한 번 스크롤하는 것으로 끝나지 않는다. 가상 목록이 렌더 창을
  // 넓히는 동안 같은 scrollY가 가리키는 본문이 조금씩 밀리기 때문에,
  // 화면에 실제로 그 문자 위치가 올 때까지 측정값을 보고 다시 맞춘다.
  const settleTxtResumePosition = () => {
    const settle = txtResumeSettleRef.current;
    if (!settle || pendingTxtNavigationRef.current) return;

    const actual = getTxtCharacterOffsetForScroll(currentScrollYRef.current, false);
    if (actual == null) return;

    if (Math.abs(actual - settle.characterOffset) <= TXT_RESUME_SETTLE_TOLERANCE) {
      console.log(`⏱️ TXT [${Date.now() - txtOpenStartedAtRef.current}ms] 이어읽기 복원 완료`
        + " char=" + actual + " (재정렬 " + settle.attempts + "회)");
      txtResumeSettleRef.current = null;
      return;
    }
    if (settle.attempts >= TXT_RESUME_SETTLE_MAX_ATTEMPTS) {
      console.log("[Restore] 정렬 상한 도달 want=" + settle.characterOffset + " actual=" + actual);
      txtResumeSettleRef.current = null;
      return;
    }

    settle.attempts += 1;
    navigateTxtToCharacterOffset(settle.characterOffset, 0, true, settle.lineTopInset);
  };

  // 셀이 측정될 때마다 목표 구간에 도착했는지 확인한다.
  // 아직 목표가 렌더되지 않은 경우의 재시도는 scrollToIndex 실패 신호가 담당한다.
  const handleTxtChunkMeasured = (chunkIndex: number) => {
    completePendingTxtNavigation(chunkIndex);
    settleTxtResumePosition();
  };

  const navigateTxtToCharacterOffset = (
    characterOffset: number,
    viewPosition = 0,
    _alignToMeasuredLine = false,
    lineTopInset = 0,
  ) => {
    const rawLength = rawTextRef.current.length;
    const clampedOffset = Math.min(
      rawLength,
      Math.max(0, Math.floor(characterOffset)),
    );
    const chunkIndex = findTxtChunkIndexForOffset(clampedOffset);
    const chunk = contentRef.current[chunkIndex];
    if (!scrollRef.current || !chunk) return;

    const requestedProgress = rawLength > 0 ? clampedOffset / rawLength : 0;
    const pending: TxtPendingNavigation = {
      id: txtNavigationIdRef.current + 1,
      characterOffset: clampedOffset,
      chunkIndex,
      localOffset: Math.max(0, clampedOffset - chunk.start),
      lineTopInset: Math.max(0, lineTopInset),
      viewPosition: Math.min(0.8, Math.max(0, viewPosition)),
      attempts: 0,
    };
    txtNavigationIdRef.current = pending.id;
    pendingTxtNavigationRef.current = pending;
    isTxtProgrammaticNavigationRef.current = true;
    hasResumedRef.current = true;
    currentTxtCharOffsetRef.current = clampedOffset;
    applyTxtCharacterPosition(clampedOffset, requestedProgress);

    completePendingTxtNavigation(chunkIndex);
    if (!pendingTxtNavigationRef.current) return;

    requestTxtScrollToChunk(chunkIndex, pending.viewPosition);
    scheduleTxtNavigationRetry();
  };

  navigateTxtToCharacterOffsetRef.current = navigateTxtToCharacterOffset;
  onTxtChunkMeasuredRef.current = handleTxtChunkMeasured;
  scheduleTxtNavigationRetryRef.current = scheduleTxtNavigationRetry;

  const getTxtCharacterOffsetForScroll = (
    offsetY: number,
    updateLineTopInset = true,
  ): number | null => {
    let chunkIndex = txtVisibleChunkIndexRef.current;
    // 화면에 보이는 구간에서 멀리 떨어진 셀의 오래된 측정값이 현재 위치를
    // 가로채지 못하게 한다. (가상 목록은 렌더 창이 움직이면 셀의 y를 다시 잡는다)
    const measuredLayouts = Object.entries(txtItemLayoutsRef.current).filter(
      ([index]) => Math.abs(Number(index) - chunkIndex) <= 12,
    );
    const containingLayout = measuredLayouts.find(([, layout]) => (
      offsetY >= layout.y && offsetY < layout.y + layout.height
    ));
    if (containingLayout) {
      chunkIndex = Number(containingLayout[0]);
      txtVisibleChunkIndexRef.current = chunkIndex;
    }

    const chunk = contentRef.current[chunkIndex];
    const layout = txtItemLayoutsRef.current[chunkIndex];
    if (
      !chunk
      || !layout
      || layout.height <= 0
      || offsetY < layout.y
      || offsetY >= layout.y + layout.height
    ) {
      // 가상 목록이 아직 현재 셀을 측정하지 못한 순간에는 기존 위치를 유지한다.
      return null;
    }

    const relativeY = Math.max(0, offsetY - layout.y);
    const lineMetrics = txtLineMetricsRef.current[chunkIndex];
    if (Array.isArray(lineMetrics) && lineMetrics.length > 0) {
      let low = 0;
      let high = lineMetrics.length - 1;
      let selected = lineMetrics[high];

      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const line = lineMetrics[middle];
        if (relativeY < line.y + line.height) {
          selected = line;
          high = middle - 1;
        } else {
          low = middle + 1;
        }
      }

      if (updateLineTopInset) {
        currentTxtLineTopInsetRef.current = Math.min(
          Math.max(0, selected.height - 1),
          Math.max(0, relativeY - selected.y),
        );
      }
      return Math.min(
        rawTextRef.current.length,
        Math.max(0, chunk.start + selected.offset),
      );
    }

    const ratioInChunk = Math.min(
      1,
      Math.max(0, relativeY / layout.height),
    );
    if (updateLineTopInset) {
      currentTxtLineTopInsetRef.current = 0;
    }
    return Math.min(
      rawTextRef.current.length,
      Math.max(
        0,
        Math.floor(chunk.start + (chunk.end - chunk.start) * ratioInChunk),
      ),
    );
  };

  const txtSnippetAt = (offset: number) =>
    rawTextRef.current.slice(Math.max(0, offset), Math.max(0, offset) + 26).replace(/\n/g, "\\n");

  const captureTxtPositionSnapshot = () => {
    const measuredCharacterOffset = getTxtCharacterOffsetForScroll(
      currentScrollYRef.current,
    );
    if (measuredCharacterOffset != null) {
      currentTxtCharOffsetRef.current = measuredCharacterOffset;
    }
    canonicalReadingPositionRef.current = {
      format: "TXT",
      characterOffset: currentTxtCharOffsetRef.current,
      lineTopInset: currentTxtLineTopInsetRef.current,
    };

    const rawLength = rawTextRef.current.length;
    const capturedProgress = rawLength > 0
      ? Math.min(1, Math.max(0, currentTxtCharOffsetRef.current / rawLength))
      : 0;
    progressRef.current = capturedProgress;
    updateTxtReadingPreview(currentScrollYRef.current, capturedProgress);

    return {
      progress: capturedProgress,
      characterOffset: currentTxtCharOffsetRef.current,
      previewCharacterOffset: currentTxtPreviewCharOffsetRef.current,
      lineTopInset: currentTxtLineTopInsetRef.current,
      layoutSignature: txtLayoutSignature,
      readingPreview: currentReadingPreviewRef.current,
      updatedAt: Date.now(),
    };
  };

  const persistTxtProgressLocally = (
    snapshot = captureTxtPositionSnapshot(),
  ) => {
    const currentFileId = Array.isArray(fileId) ? String(fileId[0] ?? "") : String(fileId ?? "");
    if (!currentFileId || rawTextRef.current.length === 0 || snapshot.progress <= 0) {
      return Promise.resolve();
    }

    const serializedPosition = JSON.stringify({
      progress: snapshot.progress,
      characterOffset: snapshot.characterOffset,
      previewCharacterOffset: snapshot.previewCharacterOffset,
      lineTopInset: snapshot.lineTopInset,
      layoutSignature: snapshot.layoutSignature,
      updatedAt: snapshot.updatedAt,
    });

    return enqueueReaderWrite(`txt-local:${currentFileId}`, () => AsyncStorage.setItem(
      `${TXT_LOCAL_PROGRESS_KEY_PREFIX}${currentFileId}`,
      serializedPosition,
    )).catch((error) => console.log("TXT 로컬 이어읽기 위치 저장 실패:", error));
  };

  const updateTxtScrollState = (
    e: NativeSyntheticEvent<NativeScrollEvent>,
    forceUiUpdate = false,
  ) => {
    const offsetY = e.nativeEvent.contentOffset.y;
    currentScrollYRef.current = offsetY;
    const eventContentHeight = e.nativeEvent.contentSize.height;
    if (eventContentHeight > 0) {
      txtContentHeightRef.current = eventContentHeight;
    }
    if (pendingTxtNavigationRef.current || isTxtProgrammaticNavigationRef.current) return;
    // offsetY=0이고 아직 이어읽기 복원 전이면 preview 갱신 스킵 (초기 렌더 onScroll 방지)
    const skipPreview = offsetY < 5 && !hasResumedRef.current;

    const rawLength = rawTextRef.current.length;
    // 마지막 구간의 "측정된" 아래끝이 화면 안에 들어왔을 때만 문서 끝으로 본다.
    // (가상 목록이 추정 중인 contentHeight를 문서 끝으로 오인하지 않게 한다)
    const lastChunkLayout = contentRef.current.length > 0
      ? txtItemLayoutsRef.current[contentRef.current.length - 1]
      : undefined;
    const isAtActualEnd = !!lastChunkLayout
      && offsetY + e.nativeEvent.layoutMeasurement.height
        >= lastChunkLayout.y + lastChunkLayout.height - 2;
    const measuredCharacterOffset = getTxtCharacterOffsetForScroll(offsetY);
    const characterOffset = isAtActualEnd
      ? rawLength
      : measuredCharacterOffset ?? currentTxtCharOffsetRef.current;
    currentTxtCharOffsetRef.current = characterOffset;
    canonicalReadingPositionRef.current = {
      format: "TXT",
      characterOffset,
      lineTopInset: currentTxtLineTopInsetRef.current,
    };
    const clamped = rawLength > 0
      ? Math.min(1, Math.max(0, characterOffset / rawLength))
      : 0;

    progressRef.current = clamped;
    const now = Date.now();
    if (
      !forceUiUpdate &&
      now - lastTxtScrollUiUpdateAtRef.current < TXT_SCROLL_UI_UPDATE_INTERVAL_MS
    ) {
      return;
    }
    lastTxtScrollUiUpdateAtRef.current = now;

    const pages = Math.max(1, txtTotalPagesRef.current);
    // 컨트롤이 숨겨진 동안에는 ref만 갱신한다. 보이지 않는 slider/page UI 때문에
    // Reader 전체가 스크롤 중 반복 렌더링되지 않도록 한다.
    if (showUI) {
      setProgress(clamped);
      setCurrentPage(Math.min(
        pages,
        Math.max(1, Math.floor(clamped * pages) + 1),
      ));
    }

    // readingPreview: 현재 청크 안의 위치를 기준으로 화면 근처 텍스트를 저장
    if (!skipPreview) {
      updateTxtReadingPreview(offsetY, clamped);
    }
    if (forceUiUpdate) {
      persistTxtProgressLocally();
    }
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (touchStartPos.current.active) {
      touchStartPos.current.didScroll = true;
    }
    updateTxtScrollState(e);
  };

  // 뷰포트 높이는 줄 나눔이 아니라 페이지 환산에만 영향을 준다.
  // 본문을 다시 마운트하지 않고 페이지 수만 새로 계산한다.
  useEffect(() => {
    if (isEpub) return;
    refreshTxtPaginationRef.current();
  }, [isEpub, viewHeight]);

  useEffect(() => {
    if (isEpub || !showUI) return;
    const currentProgress = Math.min(1, Math.max(0, progressRef.current));
    const pages = Math.max(1, txtTotalPagesRef.current);
    setProgress(currentProgress);
    setTotalPages(pages);
    setCurrentPage(Math.min(
      pages,
      Math.max(1, Math.floor(currentProgress * pages) + 1),
    ));
  }, [isEpub, showUI]);

  // txt 슬라이더로 위치 이동
  const handleSeekText = (value: number) => {
    // 사용자가 직접 위치를 옮기면 이어읽기 복원 정착은 포기한다.
    txtResumeSettleRef.current = null;
    const requested = Math.min(1, Math.max(0, value));
    navigateTxtToCharacterOffset(
      Math.floor(requested * rawTextRef.current.length),
      0,
    );
  };

  // ===================== Slider 공통 핸들러 =====================
  const dispatchSliderSeek = (value: number, final = false) => {
    const requested = Math.min(1, Math.max(0, value));
    lastSliderSeekAtRef.current = Date.now();
    if (isEpub) {
      if (!epubNavigationReady) return;
      const requestId = sliderSeekRequestIdRef.current + 1;
      sliderSeekRequestIdRef.current = requestId;
      if (final) sliderFinalRequestIdRef.current = requestId;
      webViewRef.current?.postMessage(
        JSON.stringify({ type: "seek", percent: requested, requestId })
      );
    } else {
      handleSeekText(requested);
      if (final) setSliderPreviewValue(null);
    }
  };

  const scheduleSliderSeek = (value: number) => {
    const requested = Math.min(1, Math.max(0, value));
    sliderPendingValueRef.current = requested;
    setSliderPreviewValue(requested);

    const elapsed = Date.now() - lastSliderSeekAtRef.current;
    if (elapsed >= 80 && !sliderThrottleTimerRef.current) {
      sliderPendingValueRef.current = null;
      dispatchSliderSeek(requested);
      return;
    }
    if (sliderThrottleTimerRef.current) return;

    sliderThrottleTimerRef.current = setTimeout(() => {
      sliderThrottleTimerRef.current = null;
      const pendingValue = sliderPendingValueRef.current;
      sliderPendingValueRef.current = null;
      if (pendingValue != null) dispatchSliderSeek(pendingValue);
    }, Math.max(0, 80 - elapsed));
  };

  const handleSliderStart = (value: number) => {
    sliderDraggingRef.current = true;
    setSliderPreviewValue(Math.min(1, Math.max(0, value)));
  };

  const handleSliderComplete = (value: number) => {
    const requested = Math.min(1, Math.max(0, value));
    sliderDraggingRef.current = false;
    setSliderPreviewValue(requested);
    sliderPendingValueRef.current = null;
    if (sliderThrottleTimerRef.current) {
      clearTimeout(sliderThrottleTimerRef.current);
      sliderThrottleTimerRef.current = null;
    }
    dispatchSliderSeek(requested, true);
  };

  const openReaderSearch = () => {
    setShowSettings(false);
    setShowUI(true);
    setShowSearch(true);
  };

  const dismissReaderSearch = () => {
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setShowSearch(false);
    setSearchLoading(false);
    webViewRef.current?.postMessage(JSON.stringify({ type: "cancelSearch", requestId }));
  };

  const cancelReaderSearch = () => {
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchLoading(false);
    setSearchLimited(false);
    setSearchError(null);
    setTxtSearchTarget(null);
    setEpubSearchHighlightActive(false);
    webViewRef.current?.postMessage(JSON.stringify({
      type: "cancelSearch",
      requestId,
      clearHighlight: true,
    }));
  };

  const recordTxtLineMetrics = (chunkIndex: number, lines: any[]) => {
    if (!Array.isArray(lines) || lines.length === 0) return;
    const chunkText = getTxtChunkText(chunkIndex);
    let cursor = 0;

    Object.keys(txtLineMetricsRef.current).forEach((key) => {
      const cachedIndex = Number(key);
      if (Math.abs(cachedIndex - chunkIndex) > 12) {
        delete txtLineMetricsRef.current[cachedIndex];
        delete txtItemLayoutsRef.current[cachedIndex];
      }
    });

    // 실제로 측정된 줄 수는 문서 높이 모델을 보정하는 표본이 된다.
    txtMeasuredLineCountsRef.current[chunkIndex] = lines.length;
    if (
      !txtModelCalibratedRef.current
      && Object.keys(txtMeasuredLineCountsRef.current).length >= 3
    ) {
      rebuildTxtLayoutModelRef.current(true);
    }

    txtLineMetricsRef.current[chunkIndex] = lines.map((line) => {
      const lineText = String(line?.text || "");
      const foundOffset = lineText
        ? chunkText.indexOf(lineText, cursor)
        : cursor;
      const offset = foundOffset >= cursor ? foundOffset : cursor;
      // 빈 줄은 원문의 줄바꿈 문자 하나에 대응한다. 커서를 함께 넘겨야
      // 연달아 나오는 빈 줄들이 서로 다른 문자 위치를 갖고,
      // 저장 당시의 줄과 복원 시의 줄이 정확히 같아진다.
      cursor = Math.min(
        chunkText.length,
        offset + (lineText.length > 0 ? lineText.length : 1),
      );
      return {
        offset,
        y: Number(line?.y) || 0,
        height: Math.max(1, Number(line?.height) || settings.fontSize * settings.lineSpacing),
      };
    });
  };

  const handleTxtTextLayout = (chunkIndex: number, lines: any[]) => {
    recordTxtLineMetrics(chunkIndex, lines);
    onTxtChunkMeasuredRef.current(chunkIndex);
  };

  const handleSearchResultSelect = (result: ReaderSearchResult) => {
    dismissReaderSearch();

    if (isEpub) {
      if (!result.cfi) return;
      setEpubSearchHighlightActive(true);
      webViewRef.current?.postMessage(JSON.stringify({
        type: "navigateSearchResult",
        cfi: result.cfi,
        query: searchQuery.trim(),
      }));
      return;
    }

    if (typeof result.textOffset !== "number") return;

    txtResumeSettleRef.current = null;
    const chunkIndex = findTxtChunkIndexForOffset(result.textOffset);
    const chunkStart = contentRef.current[chunkIndex]?.start || 0;

    const localOffset = Math.max(0, result.textOffset - chunkStart);
    const target: TxtSearchTarget = {
      chunkIndex,
      localOffset,
      length: Math.max(1, result.match.length || searchQuery.trim().length),
      query: searchQuery.trim(),
    };
    setTxtSearchTarget(target);
    navigateTxtToCharacterOffset(result.textOffset, 0.28, true);
  };

  // ===================== EPUB WebView 메시지 처리 =====================
  const handleWebViewMessage = (event: any) => {
    const message = event.nativeEvent.data;
    
    // WebView 내부 메시지(setImmediate 등)는 무시
    if (!message || typeof message !== 'string' || !message.startsWith('{')) {
      return;
    }
    
    try {
      const data = JSON.parse(message);
      if (data.type === "console") {
        // WebView 내부 console.log 출력
        console.log("📱 WebView:", data.message);
      } else if (data.type === "progress") {
        const { current, total, percent, cfi, anchorRatio, visibleText } = data;
        const nextPercent = Math.min(100, Math.max(0, Number(percent) || 0));
        const prevPercent = lastWebPercentRef.current;
        if (prevPercent != null) {
          const diff = nextPercent - prevPercent;
          const now = Date.now();
          if (Math.abs(diff) > 1.2 && now - lastWebLogAtRef.current > 120) {
            lastWebLogAtRef.current = now;
            console.log("🧭RN jump", {
              from: prevPercent.toFixed(2),
              to: nextPercent.toFixed(2),
              diff: diff.toFixed(2),
              cfi,
            });
          }
        }
        lastWebPercentRef.current = nextPercent;
        progressRef.current = nextPercent / 100;

        setCurrentPage(Math.max(1, Number(current) || 1));
        // locations 계산 후에는 늦게 도착한 total=1 메시지가 실제 총 페이지를 덮지 못하게 한다.
        const nextTotal = Math.max(1, Number(total) || 1);
        setTotalPages((prev) => (epubLocationsReady && nextTotal <= 1 ? prev : nextTotal));
        setProgress(nextPercent / 100);

        if (cfi) {
          console.log("💾 [RN] CFI 저장:", cfi.slice(0, 80), "| pct:", nextPercent.toFixed(1), "| anchor:", anchorRatio);
          lastCfiRef.current = cfi;
          setLastCfi(cfi);
          if (typeof anchorRatio === 'number') lastAnchorRatioRef.current = anchorRatio;
          canonicalReadingPositionRef.current = {
            format: "EPUB",
            cfi,
            anchorRatio: typeof anchorRatio === "number" ? anchorRatio : lastAnchorRatioRef.current,
          };
        }
        if (visibleText) {
          currentReadingPreviewRef.current = createPreviewText(visibleText);
        }
        lastProgressUpdateAtRef.current = Date.now();
        const pendingLocationRequest = pendingEpubLocationRequestRef.current;
        if (pendingLocationRequest) {
          clearTimeout(pendingLocationRequest.timer);
          pendingEpubLocationRequestRef.current = null;
          pendingLocationRequest.resolve();
        }
      } else if (data.type === "restored") {
        // 복원 스크롤 완료 → 로딩 오버레이 제거
        console.log("✅ EPUB 복원 완료 - 오버레이 제거");
        setEpubRestoring(false);
      } else if (data.type === "ready") {
        // EPUB 쪽 준비 완료
        console.log(
          `⏱️ EPUB [${Date.now() - epubOpenStartedAtRef.current}ms] book.ready 수신`,
        );
        setEpubReady(true);
        setEpubError(null);
      } else if (data.type === "performance") {
        const totalElapsed = epubOpenStartedAtRef.current > 0
          ? Date.now() - epubOpenStartedAtRef.current
          : 0;
        console.log(
          `⏱️ EPUB [전체 ${totalElapsed}ms / WebView ${Math.round(Number(data.elapsedMs) || 0)}ms] ${String(data.stage || "unknown")}`,
          data.detail || "",
        );
      } else if (data.type === "locationsReady") {
        // CFI 보고와 별개로 locations 계산 완료 즉시 총 페이지 표시 갱신
        const nextCurrent = Math.max(1, Number(data.current) || 1);
        const nextTotal = Math.max(1, Number(data.total) || 1);
        console.log("📄 [RN] locationsReady:", nextCurrent, "/", nextTotal);
        setCurrentPage(nextCurrent);
        setTotalPages(nextTotal);
        setEpubLocationsReady(true);
      } else if (data.type === "locationsCache") {
        const locations = typeof data.locations === "string" ? data.locations : "";
        const currentFileId = Array.isArray(fileId) ? String(fileId[0] ?? "") : String(fileId ?? "");
        const currentUri = Array.isArray(uri) ? String(uri[0] ?? "") : String(uri ?? "");
        if (locations && currentFileId) {
          void enqueueReaderWrite(`epub-cache:${currentFileId}`, () => AsyncStorage.setItem(
            `${EPUB_LOCATIONS_CACHE_KEY_PREFIX}${currentFileId}`,
            JSON.stringify({ uri: currentUri, locations, updatedAt: Date.now() }),
          )).catch((error) => console.log("EPUB 위치 인덱스 캐시 저장 실패:", error));
        }
      } else if (data.type === "seekState") {
        // 드래그 중 page 표시는 목표 위치의 파생값만 미리 보여 준다.
        // canonical position/progress는 실제 CFI 이동 완료 후 progress 메시지에서만 갱신한다.
        const nextTotal = Math.max(1, Number(data.total) || 1);
        const nextCurrent = Math.min(nextTotal, Math.max(1, Number(data.current) || 1));
        setCurrentPage(nextCurrent);
        setTotalPages(nextTotal);
      } else if (data.type === "seekComplete") {
        const completedRequestId = Number(data.requestId) || 0;
        if (
          !sliderDraggingRef.current
          && sliderFinalRequestIdRef.current != null
          && completedRequestId >= sliderFinalRequestIdRef.current
        ) {
          sliderFinalRequestIdRef.current = null;
          setSliderPreviewValue(null);
        }
      } else if (data.type === "navigationReady") {
        console.log("✅ EPUB 위치 이동 준비 완료:", data.mode || "unknown");
        setEpubNavigationReady(true);
        setEpubNavigationError(false);
      } else if (data.type === "navigationError") {
        console.warn("⚠️ EPUB 위치 이동 계산 실패:", data.message);
        setEpubNavigationReady(false);
        setEpubNavigationError(true);
      } else if (data.type === "searchResults") {
        if (Number(data.requestId) !== searchRequestIdRef.current) return;

        const responseQuery = String(data.query || searchQuery).trim();
        const nextResults = (Array.isArray(data.results) ? data.results : []).map((item: any, index: number) => {
          const parts = splitSearchExcerpt(String(item.excerpt || ""), responseQuery);
          return {
            id: `epub-${data.requestId}-${index}-${String(item.cfi || "")}`,
            ...parts,
            locationLabel: String(item.chapterLabel || `챕터 ${Number(item.sectionIndex || 0) + 1}`),
            cfi: String(item.cfi || ""),
          } satisfies ReaderSearchResult;
        }).filter((item: ReaderSearchResult) => Boolean(item.cfi));

        setSearchResults(nextResults);
        setSearchLimited(Boolean(data.limited));
        setSearchLoading(!data.done);
        setSearchError(data.error ? String(data.error) : null);
      } else if (data.type === "sectionState") {
        setEpubAtFirstSection(Boolean(data.isFirst));
      } else if (data.type === "toggleUI") {
        // WebView 탭 → UI 토글
        lastEpubWebToggleAtRef.current = Date.now();
        setShowUI((prev) => !prev);
      } else if (data.type === "error") {
        // EPUB 로딩 에러
        console.log("❌ EPUB 로딩 에러:", data.message);
        setEpubError(data.message);
        setEpubReady(false);
      }
    } catch (e) {
      // JSON 파싱 실패는 조용히 무시 (내부 메시지일 가능성)
    }
  };

  // ===================== EPUB용 HTML =====================
  const epubHtml = useMemo(() => `
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <script>window.__readmeEpubBootStartedAt = performance.now();</script>
      <!-- JSZip을 먼저 로드 (epub.js가 의존) -->
      <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
      <!-- epub.js 로드 -->
      <script src="https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { 
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          background: #f5f0e6;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #viewer { 
          width: 100%;
          height: 100%;
          padding: 0;
          opacity: 1;
          transform: translateY(0);
          transform-origin: center;
        }
        #book-cover {
          display: none;
          position: fixed;
          inset: 0;
          z-index: 20;
          align-items: center;
          justify-content: center;
          background: #f5f0e6;
        }
        #book-cover img {
          display: block;
          max-width: 100%;
          max-height: 100%;
          width: auto;
          height: auto;
          object-fit: contain;
        }
        #fallback-section {
          display: none;
          position: fixed;
          inset: 0;
          z-index: 15;
          overflow-y: auto;
          background: #f5f0e6;
          color: #333;
          padding: 24px;
          font-size: 18px;
          line-height: 1.9;
          word-break: keep-all;
          overflow-wrap: break-word;
        }
        :where(#fallback-section) :where(img, svg, object, video, canvas) {
          max-width: 100%;
          max-height: calc(100vh - 48px);
        }
        #fallback-document.fallback-image-page {
          min-height: calc(100vh - 48px);
          height: calc(100vh - 48px);
          box-sizing: border-box;
        }
        #fallback-document.fallback-image-page > * {
          max-width: 100%;
          max-height: 100%;
        }
        #viewer iframe {
          pointer-events: auto !important;
        }
        /* 좌우 클릭 영역 - 터치는 통과시킴 */
        .nav-area {
          position: fixed;
          top: 0;
          bottom: 0;
          width: 30%;
          z-index: 1;
          pointer-events: none;
        }
        .nav-left {
          left: 0;
        }
        .nav-right {
          right: 0;
        }
        #loading {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          color: #666;
          font-size: 16px;
        }
        #error {
          display: none;
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          color: #d32f2f;
          font-size: 14px;
          padding: 20px;
        }
        #chapter-indicator {
          position: fixed;
          left: 50%;
          bottom: 24px;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.62);
          color: #fff;
          font-size: 13px;
          padding: 8px 12px;
          border-radius: 999px;
          z-index: 9999;
          opacity: 0;
          transition: opacity 140ms ease;
          pointer-events: none;
          max-width: 88vw;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #chapter-indicator.show {
          opacity: 1;
        }
        /* Pull-to-chapter indicators */
        .pull-indicator {
          position: fixed;
          left: 0; right: 0;
          z-index: 9998;
          pointer-events: none;
          overflow: hidden;
          transition: height 60ms linear;
          height: 0;
        }
        #pull-indicator-top {
          top: 0;
          background: linear-gradient(to bottom, rgba(80,120,200,0.18) 0%, transparent 100%);
        }
        #pull-indicator-bottom {
          bottom: 0;
          background: linear-gradient(to top, rgba(80,120,200,0.18) 0%, transparent 100%);
        }
        .pull-indicator-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          padding-bottom: 8px;
          height: 100%;
          gap: 4px;
        }
        #pull-indicator-bottom .pull-indicator-inner {
          justify-content: flex-start;
          padding-bottom: 0;
          padding-top: 8px;
        }
        .pull-indicator-arrow {
          font-size: 18px;
          line-height: 1;
          color: rgba(60,100,200,0.85);
          transition: transform 100ms ease;
        }
        .pull-indicator-label {
          font-size: 12px;
          color: rgba(40,80,180,0.9);
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .pull-indicator-bar-wrap {
          width: 80px;
          height: 3px;
          border-radius: 2px;
          background: rgba(60,100,200,0.15);
          overflow: hidden;
        }
        .pull-indicator-bar {
          height: 100%;
          border-radius: 2px;
          background: rgba(60,100,200,0.7);
          width: 0%;
          transition: width 60ms linear;
        }
        .spinner {
          border: 3px solid #f3f3f3;
          border-top: 3px solid #b84a8c;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div id="loading">
        <div class="spinner"></div>
        <div>책을 불러오는 중...</div>
      </div>
      <div id="error"></div>
      <div id="viewer"></div>
      <div id="fallback-section"></div>
      <div id="book-cover"><img id="book-cover-image" alt="" /></div>
      <div id="chapter-indicator">챕터 이동 중...</div>
      <div id="pull-indicator-top" class="pull-indicator">
        <div class="pull-indicator-inner">
          <div class="pull-indicator-arrow" id="pull-arrow-top">↑</div>
          <div class="pull-indicator-label" id="pull-label-top">이전 챕터로</div>
          <div class="pull-indicator-bar-wrap"><div class="pull-indicator-bar" id="pull-bar-top"></div></div>
        </div>
      </div>
      <div id="pull-indicator-bottom" class="pull-indicator">
        <div class="pull-indicator-inner">
          <div class="pull-indicator-bar-wrap"><div class="pull-indicator-bar" id="pull-bar-bottom"></div></div>
          <div class="pull-indicator-label" id="pull-label-bottom">다음 챕터로</div>
          <div class="pull-indicator-arrow" id="pull-arrow-bottom">↓</div>
        </div>
      </div>
      <!-- 좌우 클릭 영역 -->
      <div class="nav-area nav-left" id="nav-left"></div>
      <div class="nav-area nav-right" id="nav-right"></div>
      <script>
        (function() {
          // ⭐ console.log를 React Native로 전달 (오직 우리가 명시적으로 호출한 것만)
          function sendLog(message) {
            try {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "console",
                message: message
              }));
            } catch(e) {
              // 무시
            }
          }

          var epubBootStartedAt = window.__readmeEpubBootStartedAt || performance.now();
          var firstContentRendered = false;
          function reportPerformance(stage, detail) {
            try {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "performance",
                stage: stage,
                detail: detail || "",
                elapsedMs: performance.now() - epubBootStartedAt
              }));
            } catch(e) {}
          }
          
          var loadingEl = document.getElementById('loading');
          var errorEl = document.getElementById('error');
          var viewerEl = document.getElementById('viewer');
          var fallbackSectionEl = document.getElementById('fallback-section');
          var bookCoverEl = document.getElementById('book-cover');
          var bookCoverImageEl = document.getElementById('book-cover-image');
          var chapterIndicatorEl = document.getElementById('chapter-indicator');

          var fallbackTouchStartX = 0;
          var fallbackTouchStartY = 0;
          var fallbackTouchStartAt = 0;
          var fallbackTouchMaxMove = 0;
          var fallbackTouchStartScrollTop = 0;
          var fallbackTouchActive = false;
          var fallbackScrolledDuringTouch = false;
          if (fallbackSectionEl) {
            fallbackSectionEl.addEventListener('touchstart', function(e) {
              if (!e.touches || !e.touches[0]) return;
              fallbackTouchStartX = e.touches[0].clientX;
              fallbackTouchStartY = e.touches[0].clientY;
              fallbackTouchStartAt = Date.now();
              fallbackTouchMaxMove = 0;
              fallbackTouchStartScrollTop = fallbackSectionEl.scrollTop;
              fallbackTouchActive = true;
              fallbackScrolledDuringTouch = false;
            }, { passive: true });
            fallbackSectionEl.addEventListener('touchmove', function(e) {
              if (!e.touches || !e.touches[0]) return;
              var dx = e.touches[0].clientX - fallbackTouchStartX;
              var dy = e.touches[0].clientY - fallbackTouchStartY;
              fallbackTouchMaxMove = Math.max(fallbackTouchMaxMove, Math.sqrt(dx * dx + dy * dy));
              if (fallbackTouchMaxMove > 8) fallbackScrolledDuringTouch = true;
            }, { passive: true });
            fallbackSectionEl.addEventListener('scroll', function() {
              if (fallbackTouchActive) fallbackScrolledDuringTouch = true;
            }, { passive: true });
            fallbackSectionEl.addEventListener('touchend', function(e) {
              if (!e.changedTouches || !e.changedTouches[0]) return;
              var dx = e.changedTouches[0].clientX - fallbackTouchStartX;
              var dy = e.changedTouches[0].clientY - fallbackTouchStartY;
              var dt = Date.now() - fallbackTouchStartAt;
              var scrollChanged = Math.abs(fallbackSectionEl.scrollTop - fallbackTouchStartScrollTop) > 2;
              fallbackTouchActive = false;
              if (!fallbackScrolledDuringTouch && !scrollChanged
                && dt >= 40 && dt <= 350
                && Math.abs(dx) <= 8 && Math.abs(dy) <= 8 && fallbackTouchMaxMove <= 8) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: "toggleUI" }));
                return;
              }
              var atTop = fallbackSectionEl.scrollTop <= 6;
              var atBottom = fallbackSectionEl.scrollTop + fallbackSectionEl.clientHeight >= fallbackSectionEl.scrollHeight - 10;
              if (dt <= 1400 && Math.abs(dy) >= 88 && Math.abs(dx) < Math.abs(dy) * 0.8) {
                if (dy < 0 && atBottom) triggerAutoTransition(false);
                else if (dy > 0 && atTop) triggerAutoTransition(true);
              }
            }, { passive: true });
            fallbackSectionEl.addEventListener('touchcancel', function() {
              fallbackTouchActive = false;
              fallbackScrolledDuringTouch = true;
            }, { passive: true });
          }

          // 실제 표지 overlay는 iframe 밖에 있으므로 표지 자체에서 탭을 직접 처리한다.
          // 이동이 있는 스와이프는 UI 토글로 처리하지 않는다.
          var coverTapStartX = 0;
          var coverTapStartY = 0;
          var coverTapStartAt = 0;
          var coverTapMaxMove = 0;
          if (bookCoverEl) {
            bookCoverEl.addEventListener('touchstart', function(e) {
              if (!e.touches || !e.touches[0]) return;
              coverTapStartX = e.touches[0].clientX;
              coverTapStartY = e.touches[0].clientY;
              coverTapStartAt = Date.now();
              coverTapMaxMove = 0;
            }, { passive: true, capture: true });

            bookCoverEl.addEventListener('touchmove', function(e) {
              if (!e.touches || !e.touches[0]) return;
              var dx = e.touches[0].clientX - coverTapStartX;
              var dy = e.touches[0].clientY - coverTapStartY;
              coverTapMaxMove = Math.max(coverTapMaxMove, Math.sqrt(dx * dx + dy * dy));
            }, { passive: true, capture: true });

            bookCoverEl.addEventListener('touchend', function(e) {
              if (!e.changedTouches || !e.changedTouches[0]) return;
              var dx = Math.abs(e.changedTouches[0].clientX - coverTapStartX);
              var dy = Math.abs(e.changedTouches[0].clientY - coverTapStartY);
              var dt = Date.now() - coverTapStartAt;
              if (dt >= 40 && dt <= 350 && dx <= 8 && dy <= 8 && coverTapMaxMove <= 8) {
                sendLog('👆 cover 단일 탭 - UI 토글');
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: "toggleUI" }));
              }
            }, { passive: true, capture: true });
          }

          function showChapterIndicator(text) {
            try {
              if (!chapterIndicatorEl) return;
              chapterIndicatorEl.textContent = text || '챕터 이동 중...';
              chapterIndicatorEl.classList.add('show');
            } catch(e) {}
          }

          function hideChapterIndicator() {
            try {
              if (!chapterIndicatorEl) return;
              chapterIndicatorEl.classList.remove('show');
            } catch(e) {}
          }

          function showError(msg) {
            loadingEl.style.display = 'none';
            errorEl.style.display = 'block';
            errorEl.textContent = msg;
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: "error",
              message: msg
            }));
          }

          try {
            // JSZip이 로드되었는지 확인
            if (typeof JSZip === 'undefined') {
              showError("JSZip 라이브러리 로드 실패");
              return;
            }

            // epub.js가 로드되었는지 확인
            if (typeof ePub === 'undefined') {
              showError("ePub.js 라이브러리 로드 실패");
              return;
            }

            sendLog("✅ 라이브러리 로드 완료: JSZip, ePub.js");
            reportPerformance("라이브러리 로드 완료");

            var directFileUri = ${JSON.stringify(decodeURI(String(uri || "")))};
            var useDirectFile = "${epubBase64}" === "__FILE_URI__";

            // 작은 EPUB은 base64 ArrayBuffer, 큰 EPUB은 파일 URI로 직접 초기화
            var base64Data = "${epubBase64}";
            if (!useDirectFile && (!base64Data || base64Data.length === 0)) {
              showError("EPUB 데이터가 비어있습니다");
              return;
            }

            var book;
            var rawZipPromise = null;
            var archiveBytes = null;
            // 파일 URI로 열면 디코딩한 바이트가 없으므로 RN이 알려준 파일 크기를 쓴다.
            var archiveDecodedLength = ${Number(epubFileSize) || 0};
            if (useDirectFile) {
              sendLog("📂 대용량 EPUB 파일 URI 직접 초기화: " + directFileUri);
              book = ePub(directFileUri, { openAs: "epub" });
            } else {
              sendLog("📦 base64 디코딩 시작, 길이: " + base64Data.length);
              reportPerformance("base64 디코딩 시작");
              var padding = base64Data.slice(-2) === '==' ? 2 : (base64Data.slice(-1) === '=' ? 1 : 0);
              var decodedLength = Math.floor(base64Data.length * 3 / 4) - padding;
              archiveDecodedLength = decodedLength;
              var bytes = new Uint8Array(decodedLength);
              var chunkChars = 65536;
              var byteOffset = 0;
              for (var base64Offset = 0; base64Offset < base64Data.length; base64Offset += chunkChars) {
                var binaryChunk = window.atob(base64Data.slice(base64Offset, base64Offset + chunkChars));
                for (var chunkIndex = 0; chunkIndex < binaryChunk.length; chunkIndex++) {
                  bytes[byteOffset++] = binaryChunk.charCodeAt(chunkIndex);
                }
              }
              base64Data = '';
              archiveBytes = bytes;
              reportPerformance("base64 디코딩 완료", "bytes=" + decodedLength);
              book = ePub(bytes.buffer);
            }
            reportPerformance("EPUB 객체 생성 완료", useDirectFile ? "file-uri" : "array-buffer");

            // 정상 EPUB은 epub.js가 이미 연 archive만 사용한다. 전체 파일 재읽기와
            // 별도 JSZip 파싱은 빈 XHTML 복구가 실제로 필요할 때에만 수행한다.
            function getRawZip() {
              if (rawZipPromise) return rawZipPromise;
              reportPerformance("ZIP fallback 준비 시작");
              rawZipPromise = Promise.resolve(book.ready).then(function() {
                var archiveZip = book.archive && book.archive.zip;
                if (archiveZip && archiveZip.files) {
                  sendLog('📦 epub.js archive ZIP 재사용');
                  return archiveZip;
                }
                if (archiveBytes) {
                  return JSZip.loadAsync(archiveBytes);
                }
                if (!useDirectFile) return null;
                return fetch(directFileUri).then(function(response) {
                  // file:// 응답은 Android WebView에서 status=0, ok=false여도 정상 데이터가 온다.
                  if (!response.ok && response.status !== 0) {
                    throw new Error('직접 EPUB ZIP 읽기 실패: ' + response.status);
                  }
                  return response.arrayBuffer();
                }).then(function(buffer) {
                  archiveDecodedLength = buffer.byteLength || archiveDecodedLength;
                  return JSZip.loadAsync(buffer);
                });
              }).then(function(zip) {
                reportPerformance("ZIP fallback 준비 완료");
                return zip;
              }).catch(function(error) {
                sendLog('⚠️ EPUB ZIP fallback 사용 불가: ' + error.message);
                return null;
              });
              return rawZipPromise;
            }
            
            sendLog("📚 EPUB 초기화 중...");
            var rendition = book.renderTo("viewer", { 
              // 안정 우선 모드: continuous에서 발생하는 상향 스크롤 점프를 방지
              // (챕터 단위 렌더링으로 위치 계산 일관성 확보)
              flow: "scrolled-doc",
              manager: "default",
              method: "default",
              width: "100%",
              height: "100%",
              allowScriptedContent: true
            });
            window.rendition = rendition;
            
            sendLog("✅ EPUB 렌더링 설정 완료");

            // 테마 상태
            var currentTheme = {
              bgColor: '#f5f0e6', textColor: '#333333', fontSize: 18,
              lineSpacing: 1.9, sidePadding: 24, fontFamily: 'default',
              usePublisherFont: false
            };
            var loadedContents = [];
            var contentTouchActive = false;
            var contentScrolledDuringTouch = false;

            function buildThemeCss(t, preserveLayout) {
              var ff = (t.fontFamily && t.fontFamily !== 'default')
                ? t.fontFamily + ', sans-serif'
                : 'Roboto, "Noto Sans KR", "Noto Sans CJK KR", sans-serif';
              if (preserveLayout) {
                return 'html,body{background:' + t.bgColor + '!important}' +
                  'img,svg,object,video,canvas{max-width:100%!important;max-height:100vh!important;object-fit:contain!important}';
              }
              var fontCss = t.usePublisherFont
                ? ':where(body){font-family:' + ff + '}'
                : 'body,p,li,dd,dt,blockquote,td,th{' +
                    'font-family:' + ff + '!important}';
              return 'html{background:' + t.bgColor + '!important;margin:0!important;padding:0!important;width:100%!important}' +
                'body{background:' + t.bgColor + '!important;color:' + t.textColor + '!important;' +
                'font-size:' + t.fontSize + 'px!important;line-height:' + t.lineSpacing + '!important;' +
                'padding-left:' + t.sidePadding + 'px!important;padding-right:' + t.sidePadding + 'px!important;' +
                // WebView 자체가 safe area 아래에서 시작하므로 여기에는 읽기용 최소 여백만 둔다.
                'padding-top:16px!important;padding-bottom:36px!important;' +
                'margin:0!important;box-sizing:border-box!important;width:100%!important;' +
                'word-break:keep-all!important;overflow-wrap:break-word!important;' +
                'text-align:left!important}' + fontCss +
                'p{line-height:' + t.lineSpacing + '!important;margin-left:0!important;margin-right:0!important;word-break:keep-all!important;text-align:left!important}' +
                'img,svg,object,video,canvas{max-width:100%!important;max-height:100vh!important;width:auto!important;height:auto!important;object-fit:contain!important}';
            }

            function injectTheme(contents) {
              try {
                if (!contents || !contents.document || !contents.document.head) return;
                var doc = contents.document;
                var el = doc.getElementById('__rdr_theme__');
                var metadataLayout = book.packaging && book.packaging.metadata && book.packaging.metadata.layout;
                var hasViewport = Boolean(doc.querySelector && doc.querySelector('meta[name="viewport"]'));
                var bodyText = doc.body ? String(doc.body.textContent || '').replace(/\\s+/g, '').trim() : '';
                var preserveLayout = metadataLayout === 'pre-paginated' || (hasViewport && bodyText.length < 20);
                var css = buildThemeCss(currentTheme, preserveLayout);
                if (el) { el.textContent = css; }
                else {
                  var s = doc.createElement('style');
                  s.id = '__rdr_theme__'; s.textContent = css;
                  doc.head.appendChild(s);
                }
                if (preserveLayout) sendLog('🧩 EPUB 고유 레이아웃 보존');
                document.documentElement.style.background = currentTheme.bgColor;
                document.body.style.background = currentTheme.bgColor;
              } catch(e) { sendLog('❌ injectTheme: ' + e.message); }
            }

            function attachTapToContents(contents) {
              try {
                var doc = contents.document;
                if (!doc) return;

                // outer window의 sendLog를 참조 (iframe 안에서 직접 호출 가능)
                var log = function(msg) { try { window.parent.sendLog(msg); } catch(_) {} };

                // ── 탭(toggleUI) 감지 ──
                var tapStartX = 0, tapStartY = 0, tapStartTime = 0;
                var tapMaxMove = 0;
                var tapStartScrollTop = 0;
                var movedDuringTouch = false;
                var touchedInternalLink = false;
                var lastInternalLinkAt = 0;

                // ── Pull-to-chapter 상태 ──
                var pullDir = null;
                var pullStartY = 0;
                var pullDist = 0;
                var pullTriggered = false;
                var pullReady = false;
                var startedAtTop = false;
                var startedAtBottom = false;
                var startedInShortSection = false;
                var PULL_TH = 96;

                // 실제로 스크롤되는 엘리먼트를 찾는 함수
                // scrolled-doc 모드에서는 iframe 내부 body/html이 스크롤되지 않고
                // outer container가 스크롤될 수도 있으니 양쪽 모두 확인
                function findScrollInfo() {
                  var result = { scrollTop: 0, clientH: 0, scrollH: 0, src: 'none' };
                  try {
                    // 1순위: outer rendition manager container
                    var c = window.parent.rendition && window.parent.rendition.manager && window.parent.rendition.manager.container;
                    if (c && c.scrollHeight > c.clientHeight + 2) {
                      result = { scrollTop: c.scrollTop, clientH: c.clientHeight, scrollH: c.scrollHeight, src: 'outer-container' };
                      return result;
                    }
                    // 2순위: iframe 내부 scrollingElement
                    var se = doc.scrollingElement || doc.documentElement;
                    if (se && se.scrollHeight > se.clientHeight + 2) {
                      result = { scrollTop: se.scrollTop, clientH: se.clientHeight, scrollH: se.scrollHeight, src: 'inner-scrollingEl' };
                      return result;
                    }
                    // 3순위: iframe 내부 body
                    if (doc.body && doc.body.scrollHeight > doc.body.clientHeight + 2) {
                      result = { scrollTop: doc.body.scrollTop, clientH: doc.body.clientHeight, scrollH: doc.body.scrollHeight, src: 'inner-body' };
                      return result;
                    }
                    // 4순위: outer window 자체
                    if (window.parent.document && window.parent.document.scrollingElement) {
                      var pe = window.parent.document.scrollingElement;
                      if (pe.scrollHeight > pe.clientHeight + 2) {
                        result = { scrollTop: pe.scrollTop, clientH: pe.clientHeight, scrollH: pe.scrollHeight, src: 'outer-scrollingEl' };
                        return result;
                      }
                    }
                    // 5순위: 정보가 없어도 outer container 값 그대로 사용
                    if (c) {
                      result = { scrollTop: c.scrollTop, clientH: c.clientHeight, scrollH: c.scrollHeight, src: 'outer-container-fallback' };
                    }
                  } catch(e) {}
                  return result;
                }

                function findAnchor(target) {
                  try {
                    var el = target && target.nodeType === 3 ? target.parentElement : target;
                    return el && el.closest ? el.closest('a[href]') : null;
                  } catch(e) {
                    return null;
                  }
                }

                function isInternalHref(href) {
                  if (!href) return false;
                  var lower = String(href).trim().toLowerCase();
                  return lower.indexOf('http://') !== 0
                    && lower.indexOf('https://') !== 0
                    && lower.indexOf('mailto:') !== 0
                    && lower.indexOf('tel:') !== 0
                    && lower.indexOf('javascript:') !== 0;
                }

                function openInternalLink(anchor, event) {
                  try {
                    if (!anchor) return false;
                    var rawHref = anchor.getAttribute('href') || '';
                    if (!isInternalHref(rawHref)) return false;

                    try { event.preventDefault(); event.stopPropagation(); } catch(_) {}
                    touchedInternalLink = true;
                    var now = Date.now();
                    if (now - lastInternalLinkAt < 500) return true;
                    lastInternalLinkAt = now;

                    var resolvedHref = rawHref;
                    try {
                      var base = contents.section && contents.section.href ? contents.section.href : '';
                      if (rawHref.charAt(0) === '#') {
                        resolvedHref = base + rawHref;
                      } else if (rawHref.indexOf('/') !== 0 && rawHref.indexOf('epubcfi(') !== 0) {
                        var normalized = new URL(rawHref, 'https://epub.local/' + base);
                        resolvedHref = normalized.pathname.replace(/^\\//, '') + normalized.hash;
                      }
                    } catch(_) {}

                    log('🔗 EPUB 내부 링크 이동: ' + resolvedHref);
                    try { window.parent.hideBookCover && window.parent.hideBookCover(); } catch(_) {}
                    try { window.parent.navigateInternalHref(resolvedHref); } catch(_) {}
                    return true;
                  } catch(e) {
                    log('⚠️ EPUB 링크 이동 실패: ' + e.message);
                    return false;
                  }
                }

                doc.addEventListener("touchstart", function(e) {
                  tapStartX = e.touches[0].clientX;
                  tapStartY = e.touches[0].clientY;
                  tapStartTime = Date.now();
                  tapMaxMove = 0;
                  movedDuringTouch = false;
                  contentTouchActive = true;
                  contentScrolledDuringTouch = false;
                  touchedInternalLink = Boolean(findAnchor(e.target));
                  pullDir = null;
                  pullDist = 0;
                  pullTriggered = false;
                  pullReady = false;
                  pullStartY = e.touches[0].clientY;
                  try { window.parent.hidePullIndicator(); } catch(_) {}

                  // touchstart 시 스크롤 상태 진단 로그
                  var si = findScrollInfo();
                  tapStartScrollTop = si.scrollTop;
                  startedAtTop = si.scrollTop <= 6;
                  startedAtBottom = (si.scrollTop + si.clientH) >= (si.scrollH - 10);
                  startedInShortSection = si.clientH > 0 && (si.scrollH - si.clientH) <= 140;
                  log('🔍TOUCH_START src=' + si.src + ' scrollTop=' + Math.round(si.scrollTop) + ' scrollH=' + Math.round(si.scrollH) + ' clientH=' + Math.round(si.clientH));
                }, { passive: true, capture: true });

                doc.addEventListener("touchmove", function(e) {
                  if (pullTriggered) return;
                  try {
                    if (window.parent.isAutoTransition || window.parent.isSeeking || window.parent.isChapterLoading) return;
                  } catch(_) { return; }

                  var currentY = e.touches[0].clientY;
                  var currentX = e.touches[0].clientX;
                  var tapDx = currentX - tapStartX;
                  var tapDy = currentY - tapStartY;
                  tapMaxMove = Math.max(tapMaxMove, Math.sqrt(tapDx * tapDx + tapDy * tapDy));
                  if (tapMaxMove > 8) {
                    movedDuringTouch = true;
                    contentScrolledDuringTouch = true;
                  }
                  var dy = currentY - pullStartY;

                  var si = findScrollInfo();
                  var atTop    = si.scrollTop <= 6;
                  var atBottom = (si.scrollTop + si.clientH) >= (si.scrollH - 10);

                  log('🔍PULL src=' + si.src
                    + ' sT=' + Math.round(si.scrollTop)
                    + ' sH=' + Math.round(si.scrollH)
                    + ' cH=' + Math.round(si.clientH)
                    + ' atTop=' + atTop + ' atBot=' + atBottom
                    + ' dy=' + Math.round(dy)
                    + ' dir=' + pullDir
                    + ' dist=' + Math.round(pullDist));

                  // pull 방향 결정 (최초)
                  if (!pullDir) {
                    if (atTop && dy > 12) {
                      pullDir = 'prev';
                      pullStartY = currentY;
                      pullDist = 0;
                      log('🔍PULL ▶ START PREV');
                      try { e.preventDefault(); } catch(_) {}
                    } else if (atBottom && dy < -12) {
                      pullDir = 'next';
                      pullStartY = currentY;
                      pullDist = 0;
                      log('🔍PULL ▶ START NEXT');
                      try { e.preventDefault(); } catch(_) {}
                    }
                    return;
                  }

                  // 경계를 벗어나면 취소
                  if ((pullDir === 'prev' && !atTop) || (pullDir === 'next' && !atBottom)) {
                    log('🔍PULL ▶ CANCEL (left boundary)');
                    pullDir = null; pullDist = 0; pullReady = false;
                    try { window.parent.hidePullIndicator(); } catch(_) {}
                    return;
                  }

                  // 거리 누적 (절대 거리 기반)
                  if (pullDir === 'prev') {
                    pullDist = Math.max(0, currentY - pullStartY);
                  } else {
                    pullDist = Math.max(0, pullStartY - currentY);
                  }

                  try { window.parent.showPullIndicator(pullDir, pullDist / PULL_TH); } catch(_) {}
                  pullReady = pullDist >= PULL_TH;

                  // pull 중 native 스크롤/bounce 방지
                  try { e.preventDefault(); } catch(_) {}
                }, { passive: false, capture: true }); // capture로 표지 SVG/이미지의 이벤트 차단 우회

                doc.addEventListener("touchend", function(e) {
                  var dx = Math.abs(e.changedTouches[0].clientX - tapStartX);
                  var signedDy = e.changedTouches[0].clientY - tapStartY;
                  var dy = Math.abs(signedDy);
                  var dt = Date.now() - tapStartTime;
                  var tappedAnchor = findAnchor(e.target);
                  var endScrollInfo = findScrollInfo();
                  var scrollChangedDuringTouch = Math.abs(endScrollInfo.scrollTop - tapStartScrollTop) > 2;
                  if (!pullTriggered && pullReady && pullDir) {
                    pullTriggered = true;
                    log('🔍PULL ▶ RELEASE TRIGGER ' + pullDir + ' dist=' + Math.round(pullDist));
                    try { window.parent.triggerAutoTransition(pullDir === 'prev'); } catch(_) {}
                  }
                  if (!movedDuringTouch && !pullTriggered && dx <= 8 && dy <= 8 && dt <= 400 && tappedAnchor) {
                    openInternalLink(tappedAnchor, e);
                  }
                  // 표지처럼 스크롤할 영역이 없는 첫 섹션은 touchmove가 네이티브에 소비될 수 있다.
                  // touchend의 전체 이동 거리로 경계 당김을 확정해 다음/이전 spine으로 이동한다.
                  if (!pullTriggered && dx < dy * 0.8 && dy >= 88 && dt <= 1200) {
                    if ((startedAtBottom || startedInShortSection) && signedDy < 0) {
                      pullTriggered = true;
                      log('🔍PULL ▶ TOUCHEND NEXT FALLBACK dy=' + Math.round(signedDy));
                      try { window.parent.triggerAutoTransition(false); } catch(_) {}
                    } else if (startedAtTop && signedDy > 0) {
                      pullTriggered = true;
                      log('🔍PULL ▶ TOUCHEND PREV FALLBACK dy=' + Math.round(signedDy));
                      try { window.parent.triggerAutoTransition(true); } catch(_) {}
                    }
                  }
                  var isStrictTap = !movedDuringTouch && !pullDir && !pullTriggered
                    && !contentScrolledDuringTouch && !scrollChangedDuringTouch
                    && !touchedInternalLink
                    && dx <= 8 && dy <= 8 && tapMaxMove <= 8
                    && dt >= 40 && dt <= 350;
                  if (isStrictTap) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "toggleUI" }));
                  }
                  if (!pullTriggered) {
                    try { window.parent.hidePullIndicator(); } catch(_) {}
                  }
                  pullDir = null; pullDist = 0; pullTriggered = false; pullReady = false;
                  startedAtTop = false; startedAtBottom = false; startedInShortSection = false;
                  contentTouchActive = false;
                }, { passive: true, capture: true });

                doc.addEventListener('touchcancel', function() {
                  contentTouchActive = false;
                  contentScrolledDuringTouch = true;
                  movedDuringTouch = true;
                  try { window.parent.hidePullIndicator(); } catch(_) {}
                }, { passive: true, capture: true });

                var markContentScroll = function() {
                  if (contentTouchActive) contentScrolledDuringTouch = true;
                };
                doc.addEventListener('scroll', markContentScroll, { passive: true, capture: true });
                if (doc.defaultView) {
                  doc.defaultView.addEventListener('scroll', markContentScroll, { passive: true });
                }

                doc.addEventListener('click', function(e) {
                  var anchor = findAnchor(e.target);
                  openInternalLink(anchor, e);
                }, true);

              } catch(e) {
                try { window.parent.sendLog("❌ attachTap error: " + e.message); } catch(_) {}
              }
            }

            // 각 챕터 렌더링 시 훅으로 CSS 주입 + 탭 이벤트 등록
            rendition.hooks.content.register(function(contents) {
              loadedContents.push(contents);
              injectTheme(contents);
              attachTapToContents(contents);
            });

            // locations 생성 완료 여부 플래그
            var locationsReady = false;
            var totalLocations = 1;
            var locationsGenerationStarted = false;
            var locationsGenerationRequested = false;
            var locationsIdleTimer = null;
            var locationsEarliestStartAt = 0;
            var lastContentScrollAt = 0;
            var fallbackPageCounts = {};
            var fallbackMeasuredPageCounts = {};
            var fallbackTextLengths = {};
            var fallbackCharsPerPage = 500;
            var fallbackPaginationReady = false;
            var fallbackPaginationStarted = false;
            var fallbackScrollBound = false;
            var pendingFallbackSeek = null;
            var pendingFallbackRestore = false;
            var navigationReadyMode = '';
            var fallbackRecoveryGeneration = 0;

            function isFallbackVisible() {
              return Boolean(fallbackSectionEl && fallbackSectionEl.style.display === 'block');
            }

            function reportNavigationReady(mode) {
              if (!mode || navigationReadyMode === mode) return;
              navigationReadyMode = mode;
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "navigationReady",
                mode: mode
              }));
              sendLog('✅ 슬라이더 이동 준비 완료 mode=' + mode);
            }

            function hideFallbackSection(reason, keepPendingSeek) {
              if (!fallbackSectionEl) return;
              var wasVisible = isFallbackVisible();
              fallbackSectionEl.style.display = 'none';
              fallbackSectionEl.innerHTML = '';
              fallbackSectionEl.scrollTop = 0;
              fallbackRecoveryGeneration++;
              if (!keepPendingSeek) pendingFallbackSeek = null;
              if (wasVisible && reason) sendLog('🧹 fallback 종료: ' + reason);
            }

            function getFallbackPagination() {
              var spineCount = book.spine && book.spine.spineItems ? book.spine.spineItems.length : 1;
              var counts = [];
              var total = 0;
              for (var index = 0; index < spineCount; index++) {
                var count = Math.max(1, fallbackPageCounts[index]
                  || Math.ceil((fallbackTextLengths[index] || 0) / fallbackCharsPerPage));
                counts.push(count);
                total += count;
              }
              return { counts: counts, total: Math.max(1, total) };
            }

            function applyPendingFallbackSeek() {
              if (!pendingFallbackSeek || !isFallbackVisible()) return false;
              if (pendingFallbackSeek.sectionIndex !== lastDisplayedSectionIndex) return false;
              var seek = pendingFallbackSeek;
              pendingFallbackSeek = null;
              var maxScroll = Math.max(0, fallbackSectionEl.scrollHeight - fallbackSectionEl.clientHeight);
              fallbackSectionEl.scrollTop = Math.max(0, Math.min(maxScroll, maxScroll * seek.withinRatio));
              sendLog('🎯 fallback 슬라이더 정렬 section=' + seek.sectionIndex
                + ' within=' + Math.round(seek.withinRatio * 100) + '%'
                + ' scrollTop=' + Math.round(fallbackSectionEl.scrollTop)
                + ' max=' + Math.round(maxScroll));
              reportFallbackPaging();
              if (seek.requestId) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'seekComplete',
                  requestId: seek.requestId
                }));
              }
              if (pendingFallbackRestore) {
                pendingFallbackRestore = false;
                sendLog('✅ fallback 이어읽기 복원 완료 section=' + seek.sectionIndex
                  + ' within=' + Math.round(seek.withinRatio * 100) + '%');
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'restored' }));
              }
              return true;
            }

            function seekFallbackPercent(percent, requestId) {
              var paging = getFallbackPagination();
              var p = Math.max(0, Math.min(1, percent));
              var targetPosition = p * paging.total;
              var before = 0;
              var sectionIndex = 0;
              for (var index = 0; index < paging.counts.length; index++) {
                var sectionEnd = before + paging.counts[index];
                if (targetPosition <= sectionEnd || index === paging.counts.length - 1) {
                  sectionIndex = index;
                  break;
                }
                before += paging.counts[index];
              }
              var sectionPages = Math.max(1, paging.counts[sectionIndex] || 1);
              var withinRatio = Math.max(0, Math.min(1, (targetPosition - before) / sectionPages));
              var targetPage = Math.min(paging.total, Math.floor(targetPosition) + 1);
              pendingFallbackSeek = {
                sectionIndex: sectionIndex,
                withinRatio: withinRatio,
                requestId: requestId || 0
              };
              totalLocations = paging.total;
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "seekState",
                current: targetPage,
                total: paging.total,
                percent: p * 100
              }));
              hideBookCover();
              sendLog('🔍 fallback 슬라이더 이동: ' + Math.round(p * 100) + '%'
                + ' page=' + targetPage + '/' + paging.total
                + ' section=' + sectionIndex
                + ' within=' + Math.round(withinRatio * 100) + '%');
              if (sectionIndex === lastDisplayedSectionIndex && isFallbackVisible()) {
                applyPendingFallbackSeek();
                return Promise.resolve(true);
              }
              return displaySectionByIndex(sectionIndex);
            }

            function getFallbackVisibleText() {
              if (!isFallbackVisible()) return '';
              var previewLength = 200;

              function normalizePreviewText(value) {
                return String(value || '').replace(/\\s+/g, ' ').trim();
              }

              function createPreview(fullText, centerOffset) {
                var startOffset = Math.max(0, centerOffset - Math.floor(previewLength * 0.35));
                if (startOffset + previewLength > fullText.length) {
                  startOffset = Math.max(0, fullText.length - previewLength);
                }
                return fullText.slice(startOffset, startOffset + previewLength);
              }

              try {
                var root = document.getElementById('fallback-document') || fallbackSectionEl;
                var containerRect = fallbackSectionEl.getBoundingClientRect();
                var top = containerRect.top;
                var bottom = containerRect.bottom;
                var centerY = (top + bottom) * 0.5;
                var walker = document.createTreeWalker(
                  root,
                  NodeFilter.SHOW_TEXT,
                  {
                    acceptNode: function(node) {
                      if (!node || !String(node.nodeValue || '').trim()) return NodeFilter.FILTER_REJECT;
                      var parent = node.parentElement;
                      if (!parent || parent.closest('style,script,noscript')) return NodeFilter.FILTER_REJECT;
                      return NodeFilter.FILTER_ACCEPT;
                    }
                  }
                );
                var pickedNode = null;
                var pickedDistance = Infinity;
                var node;
                while ((node = walker.nextNode())) {
                  var range = document.createRange();
                  range.selectNodeContents(node);
                  var rects = range.getClientRects();
                  for (var rectIndex = 0; rectIndex < rects.length; rectIndex++) {
                    if (rects[rectIndex].bottom >= top && rects[rectIndex].top <= bottom) {
                      var rectMidY = (rects[rectIndex].top + rects[rectIndex].bottom) * 0.5;
                      var distance = Math.abs(rectMidY - centerY);
                      if (distance < pickedDistance) {
                        pickedDistance = distance;
                        pickedNode = node;
                      }
                    }
                  }
                }
                if (pickedNode) {
                  var fullText = normalizePreviewText(root.textContent || '');
                  var beforeRange = document.createRange();
                  beforeRange.selectNodeContents(root);
                  beforeRange.setEnd(pickedNode, Math.floor(String(pickedNode.nodeValue || '').length * 0.5));
                  var centerOffset = normalizePreviewText(beforeRange.toString()).length;
                  var visibleText = createPreview(fullText, Math.min(fullText.length, centerOffset));
                  if (visibleText) return visibleText;
                }
              } catch(e) {
                sendLog('⚠️ fallback 현재 화면 텍스트 추출 실패: ' + e.message);
              }

              // 레이아웃 좌표를 얻지 못하는 특수 문서는 스크롤 비율로 텍스트 위치를 추정한다.
              var fullText = normalizePreviewText(fallbackSectionEl.innerText || '');
              var maxScroll = Math.max(1, fallbackSectionEl.scrollHeight - fallbackSectionEl.clientHeight);
              var ratio = Math.max(0, Math.min(1, fallbackSectionEl.scrollTop / maxScroll));
              return createPreview(fullText, Math.floor(fullText.length * ratio));
            }

            function reportFallbackPaging() {
              if (!isFallbackVisible()) return;
              if (pendingFallbackSeek
                && pendingFallbackSeek.sectionIndex === lastDisplayedSectionIndex
                && applyPendingFallbackSeek()) {
                return;
              }
              var spineCount = book.spine && book.spine.spineItems ? book.spine.spineItems.length : 1;
              var viewportHeight = Math.max(1, fallbackSectionEl.clientHeight);
              var currentSectionPages = Math.max(1, Math.ceil(fallbackSectionEl.scrollHeight / viewportHeight));
              var currentTextLength = String(fallbackSectionEl.innerText || '').replace(/\\s+/g, '').trim().length;
              if (!fallbackPaginationReady) {
                if (currentTextLength > 100 && currentSectionPages > 1) {
                  fallbackCharsPerPage = Math.max(250, Math.min(900, currentTextLength / currentSectionPages));
                }
                fallbackPageCounts[lastDisplayedSectionIndex] = currentSectionPages;
                fallbackMeasuredPageCounts[lastDisplayedSectionIndex] = true;
              }

              var paging = getFallbackPagination();
              var total = paging.total;
              var before = 0;
              for (var pageIndex = 0; pageIndex < spineCount; pageIndex++) {
                if (pageIndex < lastDisplayedSectionIndex) before += paging.counts[pageIndex] || 1;
              }
              var maxScroll = Math.max(0, fallbackSectionEl.scrollHeight - fallbackSectionEl.clientHeight);
              var withinRatio = maxScroll > 0 ? fallbackSectionEl.scrollTop / maxScroll : 0;
              var fixedSectionPages = Math.max(1, paging.counts[lastDisplayedSectionIndex] || 1);
              var absolutePosition = before + withinRatio * fixedSectionPages;
              var current = Math.min(total, Math.floor(absolutePosition) + 1);
              var percent = total > 0 ? (absolutePosition / total) * 100 : 0;
              var fallbackLocation = 'readme-fallback:' + lastDisplayedSectionIndex + ':' + withinRatio.toFixed(6);
              var fallbackVisibleText = getFallbackVisibleText();
              totalLocations = total;
              if (fallbackPaginationReady) reportNavigationReady('fallback');
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "locationsReady",
                current: current,
                total: total
              }));
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "progress",
                current: current,
                total: total,
                percent: percent,
                cfi: fallbackLocation,
                anchorRatio: 0.5,
                visibleText: fallbackVisibleText
              }));
              sendLog('📄 fallback paging current=' + current + '/' + total
                + ' section=' + lastDisplayedSectionIndex
                + ' within=' + Math.round(withinRatio * 100) + '%/' + fixedSectionPages
                + ' charsPerPage=' + Math.round(fallbackCharsPerPage)
                + ' visibleTxt=' + fallbackVisibleText.slice(0, 35));
            }

            function startLocationsGeneration() {
              if (locationsReady || locationsGenerationStarted) return;
              locationsGenerationStarted = true;
              clearTimeout(locationsIdleTimer);
              // 슬라이더는 생성된 location 중 가장 가까운 곳으로 이동한다.
              // 작은/중간 EPUB은 location을 촘촘히 만들어 눈에 보이는 스냅을 줄이고,
              // 대용량 EPUB은 초기 로딩 속도를 위해 성긴 간격을 유지한다.
              var estimatedTextLength = 0;
              Object.keys(fallbackTextLengths).forEach(function(key) {
                estimatedTextLength += fallbackTextLengths[key] || 0;
              });
              var locationBreakSize;
              if (archiveDecodedLength >= 5 * 1024 * 1024) {
                locationBreakSize = 1000;
              } else if (estimatedTextLength > 0) {
                // 최대 약 1,200개 location, 최소 180자 간격
                locationBreakSize = Math.max(180, Math.min(1000, Math.ceil(estimatedTextLength / 1200)));
              } else if (archiveDecodedLength > 0 && archiveDecodedLength <= 2 * 1024 * 1024) {
                locationBreakSize = 250;
              } else {
                locationBreakSize = 500;
              }
              sendLog("📚 reader idle 후 locations.generate 시작 break=" + locationBreakSize
                + " estimatedText=" + estimatedTextLength
                + " archiveBytes=" + archiveDecodedLength);
              reportPerformance("locations 생성 시작", "break=" + locationBreakSize);
              book.locations.generate(locationBreakSize).then(function() {
                sendLog("📚 locations.generate 완료");
                reportPerformance("locations 생성 완료", "count=" + Math.max(1, book.locations.length()));
                locationsReady = true;
                var generatedCount = Math.max(1, book.locations.length());
                var spineCount = book.spine && book.spine.spineItems ? book.spine.spineItems.length : 1;
                // fixed-layout/특수 EPUB은 locations가 1개만 생성된다. 이 경우 spine을 페이지로 사용한다.
                totalLocations = generatedCount <= 1 ? Math.max(1, spineCount) : generatedCount;
                if (generatedCount > 1) {
                  reportNavigationReady('locations');
                  try {
                    var serializedLocations = book.locations.save();
                    if (serializedLocations) {
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'locationsCache',
                        locations: serializedLocations
                      }));
                    }
                  } catch(cacheError) {
                    sendLog('⚠️ locations 캐시 직렬화 실패: ' + cacheError.message);
                  }
                } else {
                  // locations를 만들 수 없는 fixed-layout/특수 EPUB만 전체 fallback 범위를 계산한다.
                  estimateFallbackPageCounts();
                  if (fallbackPaginationReady) reportNavigationReady('fallback');
                }
                sendLog("📚 페이지 기준=" + (generatedCount <= 1 ? 'spine' : 'locations')
                  + " generated=" + generatedCount + " spine=" + spineCount);
                reportLocationsReady();
                setTimeout(function() {
                  try {
                    reportLocationsReady();
                    updateCenterText();
                    var loc = rendition.currentLocation();
                    if (loc) safeReport(loc, false);
                  } catch(e) {
                    sendLog("⚠️ 초기 위치 보고 실패: " + e.message);
                  }
                }, 120);
              }).catch(function(err) {
                sendLog("⚠️ locations.generate 실패, 본문 읽기 계속: " + err.message);
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: "navigationError",
                  message: err.message
                }));
              });
            }

            function queueLocationsGenerationWhenIdle() {
              if (!locationsGenerationRequested || locationsReady || locationsGenerationStarted) return;
              clearTimeout(locationsIdleTimer);
              var now = Date.now();
              var earliestWait = Math.max(0, locationsEarliestStartAt - now);
              var scrollIdleWait = lastContentScrollAt > 0
                ? Math.max(0, 700 - (now - lastContentScrollAt))
                : 0;
              var wait = Math.max(earliestWait, scrollIdleWait, contentTouchActive ? 120 : 0);
              locationsIdleTimer = setTimeout(function() {
                if (contentTouchActive || (lastContentScrollAt > 0 && Date.now() - lastContentScrollAt < 700)) {
                  queueLocationsGenerationWhenIdle();
                  return;
                }
                startLocationsGeneration();
              }, wait);
            }

            function scheduleLocationsGeneration() {
              if (locationsReady || locationsGenerationRequested || locationsGenerationStarted) return;
              locationsGenerationRequested = true;
              // 첫 본문 표시 직후에는 시작하지 않고, 기존과 같은 최소 대기 이후 reader가 idle일 때 실행한다.
              locationsEarliestStartAt = Date.now() + 2500;
              queueLocationsGenerationWhenIdle();
            }

            // 화면 중앙 텍스트를 스크롤할 때마다 로컬에 저장 (API 호출 없음)
            var lastVisibleText = "";
            var lastCenterCfi = ""; // 화면 중앙 노드의 CFI (저장/복원 기준)
            var lastAnchorRatio = 0.5; // CFI가 화면 어느 위치에 있었는지 (0~1, 기본 중앙)
            function updateCenterText() {
              try {
                var centerX = window.innerWidth * 0.5;
                var centerY = window.innerHeight * 0.5;
                var iframes = document.querySelectorAll('iframe');

                function findViewByIframe(iframeEl) {
                  var views = rendition.manager && rendition.manager.visible && rendition.manager.visible();
                  if (!views) return null;
                  for (var vi = 0; vi < views.length; vi++) {
                    if (views[vi].element && views[vi].element.querySelector('iframe') === iframeEl) {
                      return views[vi];
                    }
                  }
                  return null;
                }

                function getCaretRangeAt(iDoc, x, y) {
                  try {
                    if (iDoc.caretPositionFromPoint) {
                      var pos = iDoc.caretPositionFromPoint(x, y);
                      if (pos && pos.offsetNode) {
                        var r1 = iDoc.createRange();
                        r1.setStart(pos.offsetNode, pos.offset || 0);
                        r1.collapse(true);
                        return r1;
                      }
                    }
                  } catch(_) {}
                  try {
                    if (iDoc.caretRangeFromPoint) {
                      return iDoc.caretRangeFromPoint(x, y);
                    }
                  } catch(_) {}
                  return null;
                }

                function getRangeRectSafe(iDoc, range) {
                  if (!range) return null;
                  try {
                    var rect = range.getBoundingClientRect();
                    if (rect && (rect.height > 0 || rect.width > 0)) return rect;
                  } catch(_) {}
                  try {
                    var probe = range.cloneRange();
                    var node = probe.startContainer;
                    var off = probe.startOffset || 0;
                    if (node && node.nodeType === 3 && node.textContent && node.textContent.length > 0) {
                      var end = Math.min(node.textContent.length, off + 1);
                      probe.setEnd(node, end);
                      var rect2 = probe.getBoundingClientRect();
                      if (rect2 && (rect2.height > 0 || rect2.width > 0)) return rect2;
                    }
                  } catch(_) {}
                  return null;
                }

                var pickedIframe = null;
                var pickedDoc = null;
                var pickedRange = null;
                var pickedRect = null;

                // 1) 중앙 점이 들어있는 iframe에서 caret 기반으로 정확한 문자 오프셋 획득
                for (var fi = 0; fi < iframes.length; fi++) {
                  var iframe = iframes[fi];
                  var iframeRect = iframe.getBoundingClientRect();
                  if (centerY < iframeRect.top || centerY > iframeRect.bottom) continue;
                  if (centerX < iframeRect.left || centerX > iframeRect.right) continue;
                  try {
                    var iDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (!iDoc || !iDoc.body) continue;
                    var localX = Math.max(1, Math.min((iframeRect.width || 1) - 1, centerX - iframeRect.left));
                    var localY = Math.max(1, Math.min((iframeRect.height || 1) - 1, centerY - iframeRect.top));
                    var r = getCaretRangeAt(iDoc, localX, localY);
                    if (!r) continue;
                    var rr = getRangeRectSafe(iDoc, r);
                    pickedIframe = iframe;
                    pickedDoc = iDoc;
                    pickedRange = r;
                    pickedRect = rr;
                    break;
                  } catch(_) {}
                }

                // 2) 중앙 점에서 실패하면, 화면과 겹치는 iframe들 중 중앙에 가장 가까운 iframe에서 재시도
                if (!pickedRange) {
                  var bestIframe = null;
                  var bestDist = Infinity;
                  for (var fi2 = 0; fi2 < iframes.length; fi2++) {
                    var iframe2 = iframes[fi2];
                    var r2 = iframe2.getBoundingClientRect();
                    if (r2.bottom <= 0 || r2.top >= window.innerHeight) continue;
                    var midY = (r2.top + r2.bottom) * 0.5;
                    var dist = Math.abs(midY - centerY);
                    if (dist < bestDist) { bestDist = dist; bestIframe = iframe2; }
                  }
                  if (bestIframe) {
                    try {
                      var bestRect = bestIframe.getBoundingClientRect();
                      var bestDoc = bestIframe.contentDocument || bestIframe.contentWindow.document;
                      if (bestDoc && bestDoc.body) {
                        var lx = Math.max(1, Math.min((bestRect.width || 1) - 1, centerX - bestRect.left));
                        var ly = Math.max(1, Math.min((bestRect.height || 1) - 1, centerY - bestRect.top));
                        var rrng = getCaretRangeAt(bestDoc, lx, ly);
                        if (rrng) {
                          pickedIframe = bestIframe;
                          pickedDoc = bestDoc;
                          pickedRange = rrng;
                          pickedRect = getRangeRectSafe(bestDoc, rrng);
                        }
                      }
                    } catch(_) {}
                  }
                }

                if (!pickedRange || !pickedIframe || !pickedDoc) return;

                // 중앙 좌표를 기준으로 챕터 전체 텍스트에서 항상 같은 길이의 미리보기 생성
                try {
                  var sc = pickedRange.startContainer;
                  var so = pickedRange.startOffset || 0;

                  function normalizePreviewText(value) {
                    return String(value || '').replace(/\\s+/g, ' ').trim();
                  }

                  var fullText = normalizePreviewText(pickedDoc.body.textContent || '');
                  var beforeText = '';
                  try {
                    var beforeRange = pickedDoc.createRange();
                    beforeRange.selectNodeContents(pickedDoc.body);
                    beforeRange.setEnd(sc, so);
                    beforeText = normalizePreviewText(beforeRange.toString());
                  } catch(_) {}

                  var previewLength = 200;
                  var centerOffset = Math.min(fullText.length, beforeText.length);
                  var startOffset = Math.max(0, centerOffset - Math.floor(previewLength * 0.35));
                  if (startOffset + previewLength > fullText.length) {
                    startOffset = Math.max(0, fullText.length - previewLength);
                  }
                  var snippet = fullText.slice(startOffset, startOffset + previewLength);
                  if (snippet) lastVisibleText = snippet;
                } catch(_) {}

                // caret 실제 좌표 기준 anchorRatio 계산
                try {
                  var container = rendition.manager && rendition.manager.container;
                  if (container && pickedRect) {
                    var iframeRectPicked = pickedIframe.getBoundingClientRect();
                    var containerRect = container.getBoundingClientRect();
                    var caretMidY = iframeRectPicked.top + pickedRect.top + (pickedRect.height > 0 ? (pickedRect.height * 0.5) : 0);
                    var nodeRelY = caretMidY - containerRect.top;
                    lastAnchorRatio = Math.max(0.05, Math.min(0.95, nodeRelY / container.clientHeight));
                  }
                } catch(_) { lastAnchorRatio = 0.5; }

                // caret Range 기준으로 정확한 CFI 생성
                try {
                  var pickedView = findViewByIframe(pickedIframe);
                  var generatedCfi = '';
                  if (pickedView && pickedView.contents && typeof pickedView.contents.cfiFromRange === 'function') {
                    generatedCfi = pickedView.contents.cfiFromRange(pickedRange) || '';
                  }

                  // cfiFromRange 미지원 환경 폴백
                  if (!generatedCfi) {
                    var sectionCfi = pickedView && pickedView.section && pickedView.section.cfiBase || '';
                    var startNode = pickedRange.startContainer;
                    if (sectionCfi && startNode) {
                      var cfiGen = new ePub.CFI();
                      generatedCfi = cfiGen.generate(startNode, pickedDoc.body, sectionCfi) || '';
                    }
                  }

                  if (generatedCfi && typeof generatedCfi === 'string') {
                    lastCenterCfi = generatedCfi;
                  }
                } catch(cfiErr) { /* CFI 생성 실패시 기존 loc.start.cfi 사용 */ }
              } catch(ex) {}
            }

            // 챕터 전환 상태
            var centerTextTimer = null;
            var isSeeking = false;
            var isChapterLoading = false;
            var isAutoTransition = false;
            var lastAutoTransitionAt = 0;
            var coverVisible = false;
            var coverAttempted = false;
            var coverDismissed = false;
            var coverAvailable = false;
            var coverShouldShowWhenLoaded = false;
            var lastDisplayedSectionIndex = -1;
            var activeSeekTargetCfi = '';
            var pendingSectionEdge = null;

            // Pull indicator elements (outer window)
            var pullIndicatorTop = document.getElementById('pull-indicator-top');
            var pullIndicatorBottom = document.getElementById('pull-indicator-bottom');
            var pullBarTop = document.getElementById('pull-bar-top');
            var pullBarBottom = document.getElementById('pull-bar-bottom');
            var pullArrowTop = document.getElementById('pull-arrow-top');
            var pullArrowBottom = document.getElementById('pull-arrow-bottom');
            var pullLabelTop = document.getElementById('pull-label-top');
            var pullLabelBottom = document.getElementById('pull-label-bottom');
            var CHAPTER_EXIT_MS = 190;
            var CHAPTER_ENTER_MS = 280;

            function showPullIndicator(dir, progress) {
              try {
                var clampedP = Math.min(1, Math.max(0, progress));
                var pct = Math.round(clampedP * 100) + '%';
                var maxH = 72; // max height of indicator band in px
                var h = Math.round(clampedP * maxH);
                if (dir === 'prev') {
                  if (pullIndicatorBottom) pullIndicatorBottom.style.height = '0px';
                  if (pullIndicatorTop) pullIndicatorTop.style.height = h + 'px';
                  if (pullBarTop) pullBarTop.style.width = pct;
                  if (pullArrowTop) pullArrowTop.style.transform = clampedP >= 1 ? 'scale(1.3)' : 'scale(1)';
                  if (pullLabelTop) pullLabelTop.textContent = clampedP >= 1 ? '놓아서 이전 챕터' : '이전 챕터로';
                } else {
                  if (pullIndicatorTop) pullIndicatorTop.style.height = '0px';
                  if (pullIndicatorBottom) pullIndicatorBottom.style.height = h + 'px';
                  if (pullBarBottom) pullBarBottom.style.width = pct;
                  if (pullArrowBottom) pullArrowBottom.style.transform = clampedP >= 1 ? 'scale(1.3)' : 'scale(1)';
                  if (pullLabelBottom) pullLabelBottom.textContent = clampedP >= 1 ? '놓아서 다음 챕터' : '다음 챕터로';
                }
              } catch(e) {}
            }

            function hidePullIndicator() {
              try {
                if (pullIndicatorTop) pullIndicatorTop.style.height = '0px';
                if (pullIndicatorBottom) pullIndicatorBottom.style.height = '0px';
                if (pullBarTop) pullBarTop.style.width = '0%';
                if (pullBarBottom) pullBarBottom.style.width = '0%';
                if (pullArrowTop) pullArrowTop.style.transform = 'scale(1)';
                if (pullArrowBottom) pullArrowBottom.style.transform = 'scale(1)';
                if (pullLabelTop) pullLabelTop.textContent = '이전 챕터로';
                if (pullLabelBottom) pullLabelBottom.textContent = '다음 챕터로';
              } catch(e) {}
            }

            function forEachTransitionSurface(callback) {
              [viewerEl, fallbackSectionEl, bookCoverEl].forEach(function(surface) {
                if (surface) callback(surface);
              });
            }

            function playSoftTransition(goPrev) {
              try {
                forEachTransitionSurface(function(surface) {
                  surface.style.willChange = 'transform, opacity';
                  surface.style.transition = 'transform ' + CHAPTER_EXIT_MS + 'ms cubic-bezier(0.4, 0, 1, 1), opacity ' + CHAPTER_EXIT_MS + 'ms ease-out';
                  surface.style.opacity = '0.35';
                  surface.style.transform = goPrev ? 'translateY(24px)' : 'translateY(-24px)';
                });
              } catch(e) {}
            }

            function playSoftEntrance(goPrev) {
              try {
                forEachTransitionSurface(function(surface) {
                  surface.style.transition = 'none';
                  surface.style.opacity = '0.35';
                  surface.style.transform = goPrev ? 'translateY(-20px)' : 'translateY(20px)';
                });
                void viewerEl.offsetHeight;
                requestAnimationFrame(function() {
                  forEachTransitionSurface(function(surface) {
                    surface.style.transition = 'transform ' + CHAPTER_ENTER_MS + 'ms cubic-bezier(0.16, 1, 0.3, 1), opacity ' + CHAPTER_ENTER_MS + 'ms ease-out';
                    surface.style.opacity = '1';
                    surface.style.transform = 'translateY(0px)';
                  });
                });
              } catch(e) {}
            }

            function clearSoftTransition() {
              try {
                forEachTransitionSurface(function(surface) {
                  surface.style.opacity = '1';
                  surface.style.transform = 'translateY(0px)';
                  surface.style.transition = 'none';
                  surface.style.willChange = 'auto';
                });
              } catch(e) {}
            }

            function hideBookCover() {
              coverVisible = false;
              coverDismissed = true;
              if (bookCoverEl) bookCoverEl.style.display = 'none';
            }

            function showExistingBookCover() {
              if (!coverAvailable || !bookCoverEl || !bookCoverImageEl || !bookCoverImageEl.src) return false;
              coverDismissed = false;
              coverVisible = true;
              bookCoverEl.style.display = 'flex';
              sendLog('⬅️ 첫 본문에서 cover 다시 표시');
              return true;
            }

            function loadBookCover(showWhenLoaded) {
              try {
                if (showWhenLoaded) {
                  coverDismissed = false;
                  coverShouldShowWhenLoaded = true;
                  if (showExistingBookCover()) return Promise.resolve(true);
                }
                if (coverAttempted) return Promise.resolve(coverAvailable);
                coverAttempted = true;
                sendLog('🖼️ EPUB cover 조회 시작');
                if (!book.coverUrl || !bookCoverEl || !bookCoverImageEl) {
                  sendLog('⚠️ EPUB coverUrl API 또는 cover element 없음');
                  return Promise.resolve(false);
                }
                return Promise.resolve(book.coverUrl()).then(function(url) {
                  if (!url) {
                    sendLog('⚠️ EPUB metadata에 cover resource 없음');
                    return false;
                  }
                  bookCoverImageEl.onload = function() {
                    coverAvailable = true;
                    if (coverShouldShowWhenLoaded && !coverDismissed) {
                      coverVisible = true;
                      bookCoverEl.style.display = 'flex';
                      sendLog('🖼️ 실제 EPUB cover 표시');
                    } else {
                      sendLog('🖼️ EPUB cover 백그라운드 준비 완료');
                    }
                  };
                  bookCoverImageEl.onerror = function() {
                    coverAvailable = false;
                    hideBookCover();
                    sendLog('⚠️ EPUB cover 이미지 로드 실패');
                  };
                  bookCoverImageEl.src = url;
                  coverAvailable = true;
                  return true;
                }).catch(function(e) {
                  sendLog('⚠️ EPUB cover 조회 실패: ' + e.message);
                  return false;
                });
              } catch(e) {
                sendLog('⚠️ EPUB cover 처리 오류: ' + e.message);
                return Promise.resolve(false);
              }
            }

            function showBookCoverIfAvailable() {
              return loadBookCover(true);
            }

            function preloadBookCover() {
              coverShouldShowWhenLoaded = false;
              return loadBookCover(false);
            }

            function getVisibleSectionIndex() {
              try {
                var views = rendition.manager && rendition.manager.visible && rendition.manager.visible();
                var view = views && views[0];
                if (view && view.section && typeof view.section.index === 'number') {
                  return view.section.index;
                }
              } catch(e) {}
              try {
                var loc = rendition.currentLocation();
                if (loc && loc.start && typeof loc.start.index === 'number') return loc.start.index;
              } catch(e) {}
              return lastDisplayedSectionIndex;
            }

            function getLastNavigableSectionIndex() {
              var items = book.spine && book.spine.spineItems ? book.spine.spineItems : [];
              var fallbackLast = Math.max(0, items.length - 1);
              try {
                var generatedCount = Math.max(1, book.locations.length());
                if (generatedCount > 1) {
                  var lastCfi = book.locations.cfiFromLocation(generatedCount - 1);
                  var parsedCfi = lastCfi ? new ePub.CFI(lastCfi) : null;
                  if (parsedCfi && typeof parsedCfi.spinePos === 'number') {
                    return Math.max(0, Math.min(fallbackLast, parsedCfi.spinePos));
                  }
                }
              } catch(e) {}
              while (fallbackLast > 0 && items[fallbackLast] && items[fallbackLast].linear === 'no') {
                fallbackLast--;
              }
              return fallbackLast;
            }

            function applyPendingSectionEdge(finalize) {
              if (!pendingSectionEdge || pendingSectionEdge.index !== lastDisplayedSectionIndex) return false;
              var edge = pendingSectionEdge.edge;
              if (isFallbackVisible()) {
                var fallbackMax = Math.max(0, fallbackSectionEl.scrollHeight - fallbackSectionEl.clientHeight);
                fallbackSectionEl.scrollTop = edge === 'bottom' ? fallbackMax : 0;
                sendLog('↕️ 챕터 경계 정렬 fallback edge=' + edge + ' scrollTop=' + Math.round(fallbackSectionEl.scrollTop));
              } else {
                var container = rendition.manager && rendition.manager.container;
                if (!container) return false;
                var maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
                container.scrollTop = edge === 'bottom' ? maxScroll : 0;
                sendLog('↕️ 챕터 경계 정렬 edge=' + edge + ' scrollTop=' + Math.round(container.scrollTop));
              }
              if (finalize) pendingSectionEdge = null;
              return true;
            }

            function reportSectionState() {
              try {
                var index = getVisibleSectionIndex();
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: "sectionState",
                  isFirst: index === 0,
                  index: index
                }));
                sendLog('📑 sectionState index=' + index + ' first=' + (index === 0));
              } catch(e) {}
            }

            function displayFirstContentSection() {
              // 표지 overlay는 spine 0 위에 표시된다. 다음 이동은 목차 본문으로
              // 점프하지 않고 EPUB 제작자가 지정한 spine 순서를 그대로 따른다.
              var items = book.spine && book.spine.spineItems ? book.spine.spineItems : [];
              var index = items.length > 1 ? 1 : 0;
              var section = index >= 0 && book.spine && book.spine.get && book.spine.get(index);
              if (!section) return Promise.resolve(false);

              // 목차(index 1)에서 표지를 다시 표시한 경우 목차는 overlay 뒤에 그대로 있다.
              // 같은 spine을 displaySectionByIndex로 다시 열면 fallback을 먼저 지운 뒤
              // epub.js가 rendered 이벤트를 생략해 빈 화면이 되므로, 기존 화면만 다시 노출한다.
              var currentIndex = getVisibleSectionIndex();
              if (currentIndex === index || lastDisplayedSectionIndex === index) {
                hideBookCover();
                pendingSectionEdge = { index: index, edge: 'top' };
                applyPendingSectionEdge(true);
                reportLocationsReady();
                reportSectionState();
                sendLog('➡️ cover 닫기 - 기존 첫 콘텐츠 다시 표시 index=' + index);
                return Promise.resolve(true);
              }

              sendLog('➡️ cover 다음 spine 순차 이동 index=' + index + ' href=' + (section.href || ''));
              return displaySectionByIndex(index).then(function(moved) {
                if (moved) hideBookCover();
                return moved;
              });
            }

            function displaySectionByIndex(index) {
              var items = book.spine && book.spine.spineItems ? book.spine.spineItems : [];
              if (typeof index !== 'number' || index < 0 || index >= items.length) {
                sendLog('⛔ spine 범위 끝 - 이동 취소 index=' + index + ' count=' + items.length);
                return Promise.resolve(false);
              }
              var section = items[index] || (book.spine && book.spine.get && book.spine.get(index));
              if (!section) return Promise.resolve(false);
              hideFallbackSection('spine 이동', Boolean(pendingFallbackSeek));
              lastDisplayedSectionIndex = index;
              return Promise.resolve(rendition.display(index)).then(function() {
                setTimeout(function() { applyPendingSectionEdge(false); }, 100);
                setTimeout(function() { applyPendingSectionEdge(true); }, 500);
                return true;
              }).catch(function(indexError) {
                sendLog('⚠️ spine index 이동 실패, href 폴백: ' + indexError.message);
                return Promise.resolve(rendition.display(section.href)).then(function() {
                  return true;
                }).catch(function(hrefError) {
                  sendLog('⚠️ spine href 이동 실패: ' + hrefError.message);
                  return false;
                });
              });
            }

            function displayAdjacentSection(goPrev) {
              try {
                var curIndex = getVisibleSectionIndex();
                // 첫 표지 렌더 직후 currentLocation이 아직 없으면 첫 spine(index 0)로 간주
                if (curIndex < 0) curIndex = lastDisplayedSectionIndex >= 0 ? lastDisplayedSectionIndex : 0;
                var items = book.spine && book.spine.spineItems ? book.spine.spineItems : [];
                if (!book.spine || typeof book.spine.get !== 'function' || items.length === 0) {
                  return Promise.resolve(false);
                }

                if (!goPrev && coverVisible) {
                  return displayFirstContentSection();
                }

                if (goPrev && curIndex <= 1) {
                  if (showExistingBookCover()) return Promise.resolve(true);
                  return showBookCoverIfAvailable().then(function(shown) { return Boolean(shown); });
                }

                var targetIndex = curIndex + (goPrev ? -1 : 1);
                var lastNavigableIndex = getLastNavigableSectionIndex();
                if (targetIndex < 0 || targetIndex >= items.length || (!goPrev && targetIndex > lastNavigableIndex)) {
                  sendLog('⛔ EPUB ' + (goPrev ? '처음' : '마지막') + ' 경계 - 이동하지 않음');
                  return Promise.resolve(false);
                }
                pendingSectionEdge = {
                  index: targetIndex,
                  edge: goPrev ? 'bottom' : 'top'
                };
                sendLog('➡️ spine 직접 이동 index=' + curIndex + ' → ' + targetIndex);
                return displaySectionByIndex(targetIndex);
              } catch(e) {
                sendLog('⚠️ spine 직접 이동 실패: ' + e.message);
                return Promise.resolve(false);
              }
            }

            function triggerAutoTransition(goPrev) {
              if (isAutoTransition || isSeeking) return;
              var now = Date.now();
              if (now - lastAutoTransitionAt < 400) return;
              var items = book.spine && book.spine.spineItems ? book.spine.spineItems : [];
              var currentIndex = getVisibleSectionIndex();
              if (!goPrev && !coverVisible && items.length > 0 && currentIndex >= getLastNavigableSectionIndex()) {
                hidePullIndicator();
                sendLog('⛔ EPUB 마지막 페이지 - 다음 이동 차단');
                return;
              }

              isAutoTransition = true;
              isSeeking = true;
              isChapterLoading = true;
              hidePullIndicator();
              showChapterIndicator(goPrev ? '이전 챕터 불러오는 중…' : '다음 챕터 불러오는 중…');
              playSoftTransition(goPrev);

              var finished = false;
              function finishTransition() {
                if (finished) return;
                finished = true;
                clearSoftTransition();
                hideChapterIndicator();
                hidePullIndicator();
                isChapterLoading = false;
                isSeeking = false;
                isAutoTransition = false;
                lastAutoTransitionAt = Date.now();
                try {
                  updateCenterText();
                  var loc = rendition.currentLocation();
                  if (loc && locationsReady) safeReport(loc, false);
                } catch(e) {}
                reportSectionState();
              }

              // 일부 EPUB은 display Promise가 끝나지 않으므로 상태 잠금 방지 watchdog 필요
              var watchdog = setTimeout(finishTransition, 3000);
              setTimeout(function() {
                displayAdjacentSection(goPrev).then(function() {
                  if (finished) return;
                  var settleDelay = pendingSectionEdge ? 520 : 80;
                  setTimeout(function() {
                    if (finished) return;
                    playSoftEntrance(goPrev);
                    setTimeout(function() {
                      clearTimeout(watchdog);
                      finishTransition();
                    }, CHAPTER_ENTER_MS + 30);
                  }, settleDelay);
                }).catch(function(e) {
                  sendLog('⚠️ 챕터 직접 이동 오류: ' + e.message);
                  clearTimeout(watchdog);
                  finishTransition();
                });
              }, CHAPTER_EXIT_MS);
            }

            function tryBoundaryTransition(goPrev) {
              try {
                if (coverVisible) {
                  if (!goPrev) triggerAutoTransition(false);
                  return;
                }

                if (isFallbackVisible()) {
                  var fallbackMax = Math.max(0, fallbackSectionEl.scrollHeight - fallbackSectionEl.clientHeight);
                  var fallbackAtTop = fallbackSectionEl.scrollTop <= 8;
                  var fallbackAtBottom = fallbackSectionEl.scrollTop >= fallbackMax - 12;
                  sendLog('🧭 fallback boundary dir=' + (goPrev ? 'prev' : 'next')
                    + ' scrollTop=' + Math.round(fallbackSectionEl.scrollTop)
                    + ' max=' + Math.round(fallbackMax));
                  if ((goPrev && fallbackAtTop) || (!goPrev && fallbackAtBottom)) {
                    triggerAutoTransition(goPrev);
                  }
                  return;
                }

                var container = rendition.manager && rendition.manager.container;
                if (!container) return;
                var maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
                var atTop = container.scrollTop <= 8;
                var atBottom = container.scrollTop >= maxScroll - 12;
                var shortSection = maxScroll <= 140;
                sendLog('🧭 RN boundary 요청 dir=' + (goPrev ? 'prev' : 'next')
                  + ' scrollTop=' + Math.round(container.scrollTop)
                  + ' max=' + Math.round(maxScroll)
                  + ' short=' + shortSection);
                if ((goPrev && atTop) || (!goPrev && (atBottom || shortSection))) {
                  triggerAutoTransition(goPrev);
                }
              } catch(e) {
                sendLog('⚠️ boundary 요청 실패: ' + e.message);
              }
            }

            function alignCfiInViewport(targetCfi, anchorRatio) {
              try {
                var container = rendition.manager && rendition.manager.container;
                var views = rendition.manager && rendition.manager.visible && rendition.manager.visible();
                var view = views && views[0];
                if (!container || !view || !targetCfi) return false;
                var iframeEl = view.element && view.element.querySelector('iframe');
                var iframeDoc = iframeEl && (iframeEl.contentDocument
                  || (iframeEl.contentWindow && iframeEl.contentWindow.document));
                if (!iframeEl || !iframeDoc) return false;

                var targetTop = null;
                var targetHeight = 0;
                try {
                  var range = view.contents && view.contents.range && view.contents.range(targetCfi);
                  if (range) {
                    var rect = range.getBoundingClientRect();
                    var iframeRect = iframeEl.getBoundingClientRect();
                    var containerRect = container.getBoundingClientRect();
                    targetTop = container.scrollTop + (iframeRect.top - containerRect.top) + rect.top;
                    targetHeight = rect.height || 0;
                  }
                } catch(e) {}
                if (targetTop == null) {
                  try {
                    var position = view.contents.locationOf(targetCfi, 'px');
                    var viewTop = view.element ? view.element.offsetTop : 0;
                    targetTop = viewTop + (position && position.top > 0 ? position.top : 0);
                  } catch(e) {}
                }
                if (targetTop == null) return false;

                var ratio = typeof anchorRatio === 'number' ? anchorRatio : 0.5;
                var maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
                var desired = targetTop - container.clientHeight * ratio + targetHeight / 2;
                container.scrollTop = Math.max(0, Math.min(maxScroll, desired));
                sendLog('🎯 CFI 화면 정렬 anchor=' + ratio.toFixed(2)
                  + ' scrollTop=' + Math.round(container.scrollTop)
                  + ' max=' + Math.round(maxScroll));
                return true;
              } catch(e) {
                sendLog('⚠️ CFI 화면 정렬 실패: ' + e.message);
                return false;
              }
            }

            var layoutRestoreGeneration = 0;
            function restoreCfiAfterLayout(targetCfi, anchorRatio, onDone) {
              var generation = ++layoutRestoreGeneration;
              var fontPromises = [];
              loadedContents.forEach(function(contents) {
                try {
                  if (contents.document && contents.document.fonts && contents.document.fonts.ready) {
                    fontPromises.push(contents.document.fonts.ready);
                  }
                } catch(e) {}
              });

              Promise.all(fontPromises).catch(function() {}).then(function() {
                var frame = 0;
                var stableFrames = 0;
                var previousHeight = -1;

                function alignOnStableFrame() {
                  if (generation !== layoutRestoreGeneration) return;
                  alignCfiInViewport(targetCfi, anchorRatio);
                  var container = rendition.manager && rendition.manager.container;
                  var height = container ? container.scrollHeight : 0;
                  stableFrames = height === previousHeight ? stableFrames + 1 : 0;
                  previousHeight = height;
                  frame += 1;

                  if (stableFrames >= 2 || frame >= 18) {
                    if (onDone) onDone();
                    return;
                  }
                  requestAnimationFrame(alignOnStableFrame);
                }

                requestAnimationFrame(alignOnStableFrame);
              });
            }

            function navigateInternalHref(href) {
              if (!href || isSeeking || isAutoTransition) return;
              isSeeking = true;
              isChapterLoading = true;
              hideBookCover();
              showChapterIndicator('목차 위치로 이동 중…');
              sendLog('🔗 rendition.display 내부 링크: ' + href);

              var finished = false;
              function finishInternalNavigation() {
                if (finished) return;
                finished = true;
                hideChapterIndicator();
                isSeeking = false;
                isChapterLoading = false;
                setTimeout(function() {
                  try {
                    updateCenterText();
                    var loc = rendition.currentLocation();
                    if (loc && locationsReady) safeReport(loc, false);
                  } catch(e) {}
                  reportSectionState();
                }, 120);
              }

              var watchdog = setTimeout(finishInternalNavigation, 2500);
              Promise.resolve(rendition.display(href)).then(function() {
                clearTimeout(watchdog);
                finishInternalNavigation();
              }).catch(function(e) {
                sendLog('⚠️ 내부 링크 display 실패: ' + e.message);
                clearTimeout(watchdog);
                finishInternalNavigation();
              });
            }

            var scrollReportTimer = null;
            function onContainerScroll() {
              lastContentScrollAt = Date.now();
              queueLocationsGenerationWhenIdle();
              if (contentTouchActive) contentScrolledDuringTouch = true;
              if (isSeeking || isChapterLoading) return;
              clearTimeout(centerTextTimer);
              clearTimeout(scrollReportTimer);
              centerTextTimer = setTimeout(function() {
                if (isSeeking) return;
                updateCenterText();
              }, 180);
              // 스크롤 멈춘 뒤 600ms 후 CFI 보고 (이어읽기 저장용)
              scrollReportTimer = setTimeout(function() {
                if (isSeeking || isChapterLoading) return;
                try {
                  updateCenterText();
                  var loc = rendition.currentLocation();
                  if (loc) safeReport(loc, true);
                } catch(e) {}
              }, 600);
            }

            function safeReport(location, fromScroll) {
              try {
                if (isFallbackVisible()) {
                  reportFallbackPaging();
                  return;
                }
                var loc = location || rendition.currentLocation();
                if (!loc || !loc.start) return;

                var startCfi = loc.start.cfi || loc.start;
                if (typeof startCfi !== 'string') return;

                // toc cfi는 무시
                var cfiLower = String(startCfi || '').toLowerCase();
                if (cfiLower.indexOf('[calibre_toc_') >= 0 || cfiLower.indexOf('[toc]') >= 0 || cfiLower.indexOf('/toc') >= 0) {
                  sendLog('⚠️ safeReport: TOC CFI 무시');
                  return;
                }

                updateCenterText();

                // 화면 중앙 CFI가 있으면 우선 사용 (정확한 복원 위치)
                // 없으면 loc.start.cfi(븷포트 상단) 폴백
                var saveCfi = (lastCenterCfi && lastCenterCfi.length > 10) ? lastCenterCfi : startCfi;

                var generatedCount = Math.max(1, book.locations.length());
                var current;
                var percent;
                if (generatedCount <= 1 && lastDisplayedSectionIndex >= 0) {
                  var spineCount = book.spine && book.spine.spineItems ? book.spine.spineItems.length : 1;
                  current = lastDisplayedSectionIndex + 1;
                  percent = spineCount > 1 ? (lastDisplayedSectionIndex / (spineCount - 1)) * 100 : 0;
                } else {
                  var canonicalLocationIndex = book.locations.locationFromCfi(saveCfi);
                  if (
                    typeof canonicalLocationIndex !== 'number'
                    || !isFinite(canonicalLocationIndex)
                    || canonicalLocationIndex < 0
                  ) {
                    sendLog('⚠️ safeReport: CFI를 locations 좌표로 변환할 수 없어 이전 위치 유지');
                    return;
                  }
                  canonicalLocationIndex = Math.max(0, Math.min(generatedCount - 1, canonicalLocationIndex));
                  current = canonicalLocationIndex + 1;
                  // Use the exact same zero-based locations coordinate system as
                  // slider -> CFI. epub.js percentageFromCfi divides by a different
                  // total in some versions, so mixing the two makes a completed seek
                  // report a different percentage on the following scroll event.
                  percent = generatedCount > 1
                    ? (canonicalLocationIndex / (generatedCount - 1)) * 100
                    : 0;

                  // The canonical anchor is the visible text CFI, but reaching the
                  // physical end of the final spine is an exact 100% layout state.
                  // Preserve the CFI for resume while deriving the edge percentage
                  // from the settled scroll container so 100% cannot fall back to an
                  // unrelated location after the next ordinary scroll event.
                  var reportContainer = rendition.manager && rendition.manager.container;
                  var visibleSectionIndex = getVisibleSectionIndex();
                  var atDocumentEnd = reportContainer
                    && visibleSectionIndex >= getLastNavigableSectionIndex()
                    && reportContainer.scrollTop + reportContainer.clientHeight
                      >= reportContainer.scrollHeight - 2;
                  if (atDocumentEnd) {
                    current = generatedCount;
                    percent = 100;
                  }
                }
                var reportTotal = generatedCount > 1 ? generatedCount : totalLocations;

                sendLog('💾 safeReport'
                  + ' saveCfi=' + saveCfi.slice(0, 80)
                  + ' startCfi=' + startCfi.slice(0, 40)
                  + ' pct=' + percent.toFixed(1)
                  + ' anchorRatio=' + lastAnchorRatio.toFixed(3)
                  + ' centerTxt=' + lastVisibleText.slice(0, 40)
                  + (fromScroll ? ' [scroll]' : ' [nav]'));

                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: "progress",
                  current: current,
                  total: reportTotal,
                  percent: percent,
                  cfi: saveCfi,
                  anchorRatio: lastAnchorRatio,
                  visibleText: lastVisibleText
                }));
              } catch(e) {
                sendLog("❌ safeReport error: " + e.message);
              }
            }

            function reportLocationsReady() {
              try {
                if (isFallbackVisible()) {
                  reportFallbackPaging();
                  return;
                }
                var current = 1;
                var generatedCount = Math.max(1, book.locations.length());
                var loc = rendition.currentLocation();
                if (generatedCount > 1 && loc && loc.start) {
                  var cfi = loc.start.cfi || loc.start;
                  if (typeof cfi === 'string') {
                    var index = book.locations.locationFromCfi(cfi);
                    if (typeof index === 'number' && index >= 0) current = index + 1;
                  }
                } else if (lastDisplayedSectionIndex >= 0) {
                  current = lastDisplayedSectionIndex + 1;
                }
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: "locationsReady",
                  current: current,
                  total: generatedCount > 1 ? generatedCount : totalLocations
                }));
                sendLog("📄 locationsReady current=" + current + " total="
                  + (generatedCount > 1 ? generatedCount : totalLocations));
              } catch(e) {
                sendLog("⚠️ locationsReady 보고 실패: " + e.message);
              }
            }

            // 빠른 시작: 우선 렌더링 준비를 알리고, locations는 백그라운드에서 생성
            book.ready.then(function () {
              sendLog("📚 book.ready 완료");
              reportPerformance("book.ready 완료");

              // 준비 완료 알림(빠른 시작)
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "ready"
              }));
              sendLog("📚 빠른 시작 준비 완료, themeAndStart 대기 중...");
            }).catch(function(err) {
              showError("EPUB 파일을 로드할 수 없습니다: " + err.message);
            });

            // relocated 이벤트: seek(슬라이더) 완료 후에만 사용 (scroll 중에는 onContainerScroll이 담당)
            // continuous 모드에서 scroll 중 relocated는 챕터 로드 타이밍에 발화되어 offsetTop이 미정착 상태임
            // → scroll 중 호출 시 getViewportCenterCfi()가 엉뚱한 위치를 반환하는 문제 발생
            rendition.on("relocated", function(location) {
              if (!locationsReady) return;
              if (isSeeking) return;
              // 챕터 prepend/append 과도기 relocated는 위치가 크게 튈 수 있어 무시
              if (isChapterLoading) {
                return;
              }
              safeReport(location, false);
            });

            // iframe에서 window.parent.XXX로 접근할 수 있도록 노출
            window.sendLog = sendLog;
            window.showPullIndicator = showPullIndicator;
            window.hidePullIndicator = hidePullIndicator;
            window.triggerAutoTransition = triggerAutoTransition;
            window.hideBookCover = hideBookCover;
            window.navigateInternalHref = navigateInternalHref;

            function normalizeArchivePath(value) {
              var decodedValue = String(value || '');
              try { decodedValue = decodeURIComponent(decodedValue); } catch(e) {}
              var parts = decodedValue.split('#')[0].split('?')[0].replace(/^\\.\\//, '').split('/');
              var normalized = [];
              for (var pathIndex = 0; pathIndex < parts.length; pathIndex++) {
                if (!parts[pathIndex] || parts[pathIndex] === '.') continue;
                if (parts[pathIndex] === '..') normalized.pop();
                else normalized.push(parts[pathIndex]);
              }
              return normalized.join('/');
            }

            function findArchiveFile(zip, path) {
              var clean = normalizeArchivePath(path);
              if (!clean) return null;
              var names = Object.keys(zip.files);
              var matches = [];
              for (var fileIndex = 0; fileIndex < names.length; fileIndex++) {
                if (names[fileIndex] === clean || names[fileIndex].slice(-(clean.length + 1)) === '/' + clean) {
                  if (!zip.files[names[fileIndex]].dir) matches.push(zip.files[names[fileIndex]]);
                }
              }
              // 같은 상대 경로 파일이 여러 개 있으면 빈 placeholder 대신 실제 내용이 큰 파일을 선택한다.
              matches.sort(function(a, b) {
                var aSize = a && a._data && a._data.uncompressedSize || 0;
                var bSize = b && b._data && b._data.uncompressedSize || 0;
                return bSize - aSize;
              });
              return matches[0] || null;
            }

            function mimeFromPath(path) {
              var lower = String(path || '').toLowerCase();
              if (/\\.png(?:$|[?#])/.test(lower)) return 'image/png';
              if (/\\.gif(?:$|[?#])/.test(lower)) return 'image/gif';
              if (/\\.webp(?:$|[?#])/.test(lower)) return 'image/webp';
              if (/\\.svg(?:$|[?#])/.test(lower)) return 'image/svg+xml';
              if (/\\.css(?:$|[?#])/.test(lower)) return 'text/css';
              if (/\\.woff2?(?:$|[?#])/.test(lower)) return 'font/woff';
              if (/\\.ttf(?:$|[?#])/.test(lower)) return 'font/ttf';
              if (/\\.otf(?:$|[?#])/.test(lower)) return 'font/otf';
              return 'image/jpeg';
            }

            function estimateFallbackPageCounts() {
              if (fallbackPaginationReady || fallbackPaginationStarted) return;
              fallbackPaginationStarted = true;
              reportPerformance("fallback 전체 페이지 계산 시작");
              var spineItems = book.spine && book.spine.spineItems ? book.spine.spineItems : [];
              var finalizeFallbackPagination = function(reason) {
                for (var index = 0; index < Math.max(1, spineItems.length); index++) {
                  if (!fallbackPageCounts[index]) {
                    fallbackPageCounts[index] = Math.max(
                      1,
                      Math.ceil((fallbackTextLengths[index] || 0) / fallbackCharsPerPage)
                    );
                  }
                }
                fallbackPaginationReady = true;
                reportPerformance("fallback 전체 페이지 계산 완료", reason);
                var paging = getFallbackPagination();
                totalLocations = paging.total;
                sendLog('📚 fallback 전체 범위 고정=' + paging.total
                  + ' reason=' + reason
                  + ' chars=' + JSON.stringify(fallbackTextLengths));
                if (isFallbackVisible()) {
                  reportFallbackPaging();
                } else if (locationsReady && Math.max(1, book.locations.length()) <= 1) {
                  reportNavigationReady('fallback');
                  reportLocationsReady();
                }
              };

              if (spineItems.length === 0) {
                finalizeFallbackPagination('archive-unavailable');
                return;
              }
              getRawZip().then(function(zip) {
                if (!zip) throw new Error('EPUB archive를 읽을 수 없음');
                var packagePath = book.packaging && book.packaging.path ? String(book.packaging.path) : '';
                var packageDir = packagePath.replace(/[^/]+$/, '');
                return Promise.all(spineItems.map(function(section, index) {
                  var file = findArchiveFile(zip, packageDir + section.href) || findArchiveFile(zip, section.href);
                  if (!file) return Promise.resolve();
                  return file.async('text').then(function(rawHtml) {
                    var doc = new DOMParser().parseFromString(rawHtml, 'text/html');
                    var parsedTextLength = doc && doc.body
                      ? String(doc.body.textContent || '').replace(/\\s+/g, '').trim().length
                      : 0;
                    var rawTextLength = String(rawHtml || '')
                      .replace(/<script\\b[\\s\\S]*?<\\/script\\s*>/gi, '')
                      .replace(/<style\\b[\\s\\S]*?<\\/style\\s*>/gi, '')
                      .replace(/<[^>]+>/g, '')
                      .replace(/&(?:nbsp|#160);/gi, '')
                      .replace(/\\s+/g, '')
                      .trim().length;
                    var textLength = Math.max(parsedTextLength, rawTextLength);
                    var mediaCount = doc && doc.querySelectorAll
                      ? doc.querySelectorAll('img,svg,image,object,video,canvas').length
                      : 0;
                    fallbackTextLengths[index] = textLength;
                    if (!fallbackMeasuredPageCounts[index]) {
                      fallbackPageCounts[index] = Math.max(1, Math.ceil(textLength / fallbackCharsPerPage), mediaCount);
                    }
                  });
                }));
              }).then(function() {
                finalizeFallbackPagination('spine-scan-complete');
              }).catch(function(e) {
                sendLog('⚠️ fallback 페이지 추정 실패: ' + e.message);
                finalizeFallbackPagination('spine-scan-failed');
              });
            }

            function resolveCssResources(zip, cssText, cssDir) {
              var matches = [];
              var urlRegex = /url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi;
              var match;
              while ((match = urlRegex.exec(cssText))) {
                if (!/^(?:data:|https?:|blob:|#)/i.test(match[2])) {
                  matches.push({ full: match[0], path: match[2] });
                }
              }
              var resolvedCss = cssText;
              return Promise.all(matches.map(function(item) {
                var resourceFile = findArchiveFile(zip, cssDir + item.path) || findArchiveFile(zip, item.path);
                if (!resourceFile) return Promise.resolve();
                return resourceFile.async('base64').then(function(resourceBase64) {
                  resolvedCss = resolvedCss.split(item.full).join(
                    'url("data:' + mimeFromPath(item.path) + ';base64,' + resourceBase64 + '")'
                  );
                });
              })).then(function() { return resolvedCss; });
            }

            function resolveElementResource(zip, chapterDir, node, attr, source) {
              if (!source || /^(?:data:|https?:|blob:|#)/i.test(source)) return Promise.resolve(false);
              var resourceFile = findArchiveFile(zip, chapterDir + source) || findArchiveFile(zip, source);
              if (!resourceFile) return Promise.resolve(false);
              return resourceFile.async('base64').then(function(resourceBase64) {
                node.setAttribute(attr, 'data:' + mimeFromPath(source) + ';base64,' + resourceBase64);
                return true;
              });
            }

            function resolveSrcsetResources(zip, chapterDir, node) {
              var sourceSet = String(node.getAttribute('srcset') || '');
              if (!sourceSet) return Promise.resolve(false);
              var candidates = sourceSet.split(',').map(function(candidate) {
                var parts = candidate.trim().split(/\\s+/);
                return { source: parts.shift() || '', descriptor: parts.join(' ') };
              });
              return Promise.all(candidates.map(function(candidate) {
                if (!candidate.source || /^(?:data:|https?:|blob:)/i.test(candidate.source)) {
                  return Promise.resolve(candidate);
                }
                var resourceFile = findArchiveFile(zip, chapterDir + candidate.source)
                  || findArchiveFile(zip, candidate.source);
                if (!resourceFile) return Promise.resolve(candidate);
                return resourceFile.async('base64').then(function(resourceBase64) {
                  candidate.source = 'data:' + mimeFromPath(candidate.source) + ';base64,' + resourceBase64;
                  return candidate;
                });
              })).then(function(resolved) {
                node.setAttribute('srcset', resolved.map(function(candidate) {
                  return candidate.source + (candidate.descriptor ? ' ' + candidate.descriptor : '');
                }).join(', '));
                return true;
              });
            }

            function scopeFallbackSelector(selector) {
              var value = String(selector || '').trim();
              if (!value) return value;
              value = value
                .replace(/:root\\b/gi, '#fallback-document')
                .replace(/\\bhtml\\s+body\\b/gi, '#fallback-document')
                .replace(/\\bbody\\b/gi, '#fallback-document')
                .replace(/\\bhtml\\b/gi, '#fallback-document');
              if (value.indexOf('#fallback-document') >= 0) return value;
              return '#fallback-document ' + value;
            }

            // ZIP fallback은 원본 XHTML의 body를 별도 div에 넣으므로 EPUB CSS 선택자도
            // 그 div를 기준으로 바꿔야 body class, 문단 여백, 정렬 등이 그대로 적용된다.
            function scopeFallbackCss(cssText) {
              var css = String(cssText || '');

              function findOpeningBrace(text, from) {
                var quote = '';
                var comment = false;
                for (var index = from; index < text.length; index++) {
                  var char = text[index];
                  var next = text[index + 1];
                  if (comment) {
                    if (char === '*' && next === '/') {
                      comment = false;
                      index++;
                    }
                    continue;
                  }
                  if (!quote && char === '/' && next === '*') {
                    comment = true;
                    index++;
                    continue;
                  }
                  if (quote) {
                    if (char === '\\\\') index++;
                    else if (char === quote) quote = '';
                    continue;
                  }
                  if (char === '"' || char === "'") {
                    quote = char;
                    continue;
                  }
                  if (char === '{') return index;
                }
                return -1;
              }

              function findClosingBrace(text, opening) {
                var depth = 1;
                var quote = '';
                var comment = false;
                for (var index = opening + 1; index < text.length; index++) {
                  var char = text[index];
                  var next = text[index + 1];
                  if (comment) {
                    if (char === '*' && next === '/') {
                      comment = false;
                      index++;
                    }
                    continue;
                  }
                  if (!quote && char === '/' && next === '*') {
                    comment = true;
                    index++;
                    continue;
                  }
                  if (quote) {
                    if (char === '\\\\') index++;
                    else if (char === quote) quote = '';
                    continue;
                  }
                  if (char === '"' || char === "'") {
                    quote = char;
                    continue;
                  }
                  if (char === '{') depth++;
                  else if (char === '}' && --depth === 0) return index;
                }
                return text.length - 1;
              }

              function scopeRules(text) {
                var result = '';
                var cursor = 0;
                while (cursor < text.length) {
                  var opening = findOpeningBrace(text, cursor);
                  if (opening < 0) {
                    result += text.slice(cursor);
                    break;
                  }
                  var closing = findClosingBrace(text, opening);
                  var prelude = text.slice(cursor, opening);
                  var body = text.slice(opening + 1, closing);
                  var leadingStatements = '';
                  var rulePrelude = prelude;
                  var statementMatch;
                  while ((statementMatch = rulePrelude.match(
                    /^(\\s*(?:\\/\\*[\\s\\S]*?\\*\\/\\s*)*@(charset|import|namespace)\\b[^;]*;\\s*)/i
                  ))) {
                    leadingStatements += statementMatch[1];
                    rulePrelude = rulePrelude.slice(statementMatch[1].length);
                  }
                  var trimmedPrelude = rulePrelude.trim();
                  var directivePrelude = trimmedPrelude.replace(/^(?:\\/\\*[\\s\\S]*?\\*\\/\\s*)+/, '');
                  if (/^@(?:media|supports|layer|container|document)\\b/i.test(directivePrelude)) {
                    result += leadingStatements + rulePrelude + '{' + scopeRules(body) + '}';
                  } else if (/^@/i.test(directivePrelude)) {
                    result += leadingStatements + rulePrelude + '{' + body + '}';
                  } else {
                    var leading = rulePrelude.match(/^\\s*/);
                    var selectors = trimmedPrelude.split(',').map(scopeFallbackSelector).join(', ');
                    result += leadingStatements + (leading ? leading[0] : '') + selectors + '{' + body + '}';
                  }
                  cursor = closing + 1;
                }
                return result;
              }

              return scopeRules(css);
            }

            function buildFallbackReaderCss(t) {
              var ff = (t.fontFamily && t.fontFamily !== 'default')
                ? t.fontFamily + ', sans-serif'
                : 'Roboto, "Noto Sans KR", "Noto Sans CJK KR", sans-serif';
              var fontCss = t.usePublisherFont
                ? '#fallback-section #fallback-document{font-family:' + ff + '}'
                : '#fallback-section #fallback-document,' +
                    '#fallback-section #fallback-document p,' +
                    '#fallback-section #fallback-document li,' +
                    '#fallback-section #fallback-document dd,' +
                    '#fallback-section #fallback-document dt,' +
                    '#fallback-section #fallback-document blockquote,' +
                    '#fallback-section #fallback-document td,' +
                    '#fallback-section #fallback-document th{' +
                    'font-family:' + ff + '!important}';
              return '#fallback-section #fallback-document{' +
                'color:' + t.textColor + '!important;' +
                'font-size:' + t.fontSize + 'px!important;' +
                'line-height:' + t.lineSpacing + '!important;' +
                'word-break:keep-all!important;overflow-wrap:break-word!important;' +
                'text-align:left!important}' + fontCss +
                '#fallback-section #fallback-document p{' +
                'line-height:' + t.lineSpacing + '!important;' +
                'word-break:keep-all!important;' +
                'text-align:left!important}' +
                '#fallback-section #fallback-document.fallback-prose-page p{' +
                'margin-top:0!important;' +
                'margin-bottom:1em!important;' +
                'text-indent:1em!important}' +
                '#fallback-section #fallback-document.fallback-prose-page p:last-child{' +
                'margin-bottom:0!important}';
            }

            function recoverEmptyRenderedSection(section, renderedContents, forceRecovery) {
              if (!section || !renderedContents || !renderedContents.document) {
                return Promise.resolve(false);
              }
              var recoveryGeneration = ++fallbackRecoveryGeneration;
              var renderedDoc = renderedContents.document;
              var renderedBody = renderedDoc.body;
              var currentText = renderedBody ? String(renderedBody.textContent || '').replace(/\\s+/g, '').trim() : '';
              var currentMedia = renderedDoc.querySelectorAll
                ? renderedDoc.querySelectorAll('img,svg,image,object,video,canvas').length
                : 0;
              if (!forceRecovery && renderedBody && renderedBody.scrollHeight > 0) {
                return Promise.resolve(false);
              }

              return getRawZip().then(function(zip) {
                if (!zip) throw new Error('ZIP fallback을 사용할 수 없음');
                var packagePath = book.packaging && book.packaging.path ? String(book.packaging.path) : '';
                var packageDir = packagePath.replace(/[^/]+$/, '');
                var chapterFile = findArchiveFile(zip, packageDir + section.href) || findArchiveFile(zip, section.href);
                if (!chapterFile) throw new Error('ZIP에서 spine 파일을 찾지 못함: ' + section.href);
                var chapterPath = chapterFile.name;
                var chapterDir = chapterPath.replace(/[^/]+$/, '');
                return chapterFile.async('text').then(function(rawHtml) {
                  var parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
                  if (!parsed || !parsed.body) throw new Error('HTML fallback 파싱 실패');
                  var parsedContent = parsed.body.innerHTML || '';
                  var parsedText = String(parsed.body.textContent || '').replace(/\\s+/g, '').trim();
                  var parsedMedia = parsed.querySelectorAll('img,svg,image,object,video,canvas').length;

                  // 일부 비표준 XHTML은 text/html 파서가 body 밖 콘텐츠를 버린다.
                  // XML 파서와 원문 body 추출을 순서대로 시도한다.
                  if (!parsedText && parsedMedia === 0) {
                    try {
                      var xmlParsed = new DOMParser().parseFromString(rawHtml, 'application/xhtml+xml');
                      var xmlBody = xmlParsed && xmlParsed.getElementsByTagName
                        ? xmlParsed.getElementsByTagName('body')[0]
                        : null;
                      if (xmlBody) {
                        parsedContent = xmlBody.innerHTML || new XMLSerializer().serializeToString(xmlBody);
                        parsed.body.innerHTML = parsedContent;
                      }
                    } catch(e) {}
                  }
                  if (!String(parsed.body.textContent || '').replace(/\\s+/g, '').trim()
                    && parsed.querySelectorAll('img,svg,image,object,video,canvas').length === 0) {
                    var bodyMatch = rawHtml.match(/<body\\b[^>]*>([\\s\\S]*?)<\\/body\\s*>/i);
                    if (bodyMatch && bodyMatch[1]) parsed.body.innerHTML = bodyMatch[1];
                  }
                  sendLog('🔬 ZIP XHTML 진단 index=' + section.index
                    + ' file=' + chapterFile.name
                    + ' rawLen=' + rawHtml.length
                    + ' bodyLen=' + parsed.body.innerHTML.length
                    + ' package=' + packagePath);

                  var resourceTasks = [];
                  var resourceNodes = parsed.querySelectorAll('*');
                  for (var resourceIndex = 0; resourceIndex < resourceNodes.length; resourceIndex++) {
                    (function(node) {
                      var tag = String(node.tagName || '').toLowerCase();
                      var attrs = [];
                      if (/^(?:img|image|embed|source|audio|video|input)$/.test(tag)) attrs.push('src');
                      if (/^(?:image|use)$/.test(tag)) attrs.push('href', 'xlink:href');
                      if (/^(?:object)$/.test(tag)) attrs.push('data');
                      if (/^(?:video)$/.test(tag)) attrs.push('poster');
                      if (node.hasAttribute('background')) attrs.push('background');
                      attrs.forEach(function(attr) {
                        if (!node.hasAttribute(attr)) return;
                        resourceTasks.push(resolveElementResource(
                          zip,
                          chapterDir,
                          node,
                          attr,
                          node.getAttribute(attr) || ''
                        ));
                      });
                      if (node.hasAttribute('srcset')) {
                        resourceTasks.push(resolveSrcsetResources(zip, chapterDir, node));
                      }
                      if (node.hasAttribute('style')) {
                        resourceTasks.push(resolveCssResources(
                          zip,
                          node.getAttribute('style') || '',
                          chapterDir
                        ).then(function(styleText) {
                          node.setAttribute('style', styleText);
                        }));
                      }
                    })(resourceNodes[resourceIndex]);
                  }

                  var styleNodes = parsed.querySelectorAll('style');
                  for (var styleIndex = 0; styleIndex < styleNodes.length; styleIndex++) {
                    (function(styleNode) {
                      resourceTasks.push(resolveCssResources(zip, styleNode.textContent || '', chapterDir).then(function(css) {
                        styleNode.textContent = scopeFallbackCss(css);
                      }));
                    })(styleNodes[styleIndex]);
                  }
                  var linkedStyles = parsed.querySelectorAll('link[rel="stylesheet"][href]');
                  for (var linkIndex = 0; linkIndex < linkedStyles.length; linkIndex++) {
                    (function(linkNode) {
                      var cssSource = linkNode.getAttribute('href') || '';
                      var cssFile = findArchiveFile(zip, chapterDir + cssSource) || findArchiveFile(zip, cssSource);
                      if (!cssFile) return;
                      resourceTasks.push(cssFile.async('text').then(function(cssText) {
                        var cssDir = cssFile.name.replace(/[^/]+$/, '');
                        return resolveCssResources(zip, cssText, cssDir);
                      }).then(function(cssText) {
                        var style = parsed.createElement('style');
                        style.textContent = scopeFallbackCss(cssText);
                        linkNode.parentNode.replaceChild(style, linkNode);
                      }));
                    })(linkedStyles[linkIndex]);
                  }

                  return Promise.all(resourceTasks).then(function() {
                    if (!fallbackSectionEl) throw new Error('fallback section element 없음');
                    if (recoveryGeneration !== fallbackRecoveryGeneration
                      || section.index !== lastDisplayedSectionIndex) {
                      sendLog('⏭️ 늦게 완료된 fallback 무시 index=' + section.index
                        + ' current=' + lastDisplayedSectionIndex);
                      return false;
                    }
                    var recoveredStyles = '';
                    var parsedStyles = parsed.querySelectorAll('style');
                    for (var parsedStyleIndex = 0; parsedStyleIndex < parsedStyles.length; parsedStyleIndex++) {
                      recoveredStyles += '<style>' + parsedStyles[parsedStyleIndex].textContent + '</style>';
                    }
                    for (var removeStyleIndex = parsedStyles.length - 1; removeStyleIndex >= 0; removeStyleIndex--) {
                      if (parsedStyles[removeStyleIndex].parentNode) {
                        parsedStyles[removeStyleIndex].parentNode.removeChild(parsedStyles[removeStyleIndex]);
                      }
                    }
                    var bodyClass = String(parsed.body.getAttribute('class') || '').trim();
                    var bodyStyle = String(parsed.body.getAttribute('style') || '').trim();
                    var fallbackBodyTextLength = String(parsed.body.textContent || '').replace(/\\s+/g, '').trim().length;
                    var isImageFocused = fallbackBodyTextLength < 40
                      && /(?:<img\\b|<image\\b|background(?:-image)?\\s*:|url\\s*\\(|\\.(?:jpe?g|png|gif|webp|svg))/i.test(rawHtml);
                    var shouldNormalizeFallbackProse = fallbackBodyTextLength > 500
                      && !isImageFocused
                      && parsedStyles.length === 0;
                    var fallbackDocumentClass = [
                      bodyClass,
                      isImageFocused ? 'fallback-image-page' : '',
                      shouldNormalizeFallbackProse ? 'fallback-prose-page' : ''
                    ]
                      .filter(Boolean).join(' ');
                    fallbackSectionEl.innerHTML = recoveredStyles
                      + '<style id="fallback-reader-theme">' + buildFallbackReaderCss(currentTheme) + '</style>'
                      + '<div id="fallback-document"'
                      + (fallbackDocumentClass ? ' class="' + fallbackDocumentClass.replace(/"/g, '&quot;') + '"' : '')
                      + (bodyStyle ? ' style="' + bodyStyle.replace(/"/g, '&quot;') + '"' : '')
                      + '>' + parsed.body.innerHTML + '</div>';
                    fallbackSectionEl.style.background = currentTheme.bgColor;
                    fallbackSectionEl.style.color = currentTheme.textColor;
                    fallbackSectionEl.style.fontSize = currentTheme.fontSize + 'px';
                    fallbackSectionEl.style.lineHeight = String(currentTheme.lineSpacing);
                    fallbackSectionEl.style.paddingLeft = currentTheme.sidePadding + 'px';
                    fallbackSectionEl.style.paddingRight = currentTheme.sidePadding + 'px';
                    fallbackSectionEl.scrollTop = 0;
                    fallbackSectionEl.style.display = 'block';
                    fallbackTextLengths[section.index] = String(fallbackSectionEl.innerText || '')
                      .replace(/\\s+/g, '').trim().length;
                    var fallbackImages = fallbackSectionEl.querySelectorAll('img');
                    for (var fallbackImageIndex = 0; fallbackImageIndex < fallbackImages.length; fallbackImageIndex++) {
                      fallbackImages[fallbackImageIndex].addEventListener('load', reportFallbackPaging, { once: true });
                      fallbackImages[fallbackImageIndex].addEventListener('error', reportFallbackPaging, { once: true });
                    }
                    if (!fallbackScrollBound) {
                      fallbackSectionEl.addEventListener('scroll', function() {
                        clearTimeout(scrollReportTimer);
                        scrollReportTimer = setTimeout(reportFallbackPaging, 120);
                      }, { passive: true });
                      fallbackScrollBound = true;
                    }
                    sendLog('🛠️ 빈 XHTML HTML fallback 복구 index=' + section.index
                      + ' textLen=' + String(fallbackSectionEl.textContent || '').replace(/\\s+/g, '').trim().length
                      + ' media=' + fallbackSectionEl.querySelectorAll('img,svg,image,object,video,canvas').length);
                    sendLog('🎨 fallback CSS 적용 styles=' + parsedStyles.length
                      + ' bodyClass=' + (bodyClass || '없음')
                      + ' proseNormalize=' + shouldNormalizeFallbackProse);
                    estimateFallbackPageCounts();
                    requestAnimationFrame(function() {
                      setTimeout(function() {
                        if (!applyPendingFallbackSeek()) reportFallbackPaging();
                        applyPendingSectionEdge(false);
                      }, 80);
                      setTimeout(function() {
                        reportFallbackPaging();
                        applyPendingSectionEdge(true);
                      }, 500);
                    });
                    return true;
                  });
                });
              }).catch(function(e) {
                sendLog('⚠️ 빈 XHTML fallback 실패 index=' + section.index + ': ' + e.message);
                return false;
              });
            }

            function recoverRenderedImagesAfterSettlement(section, renderedContents, renderedImages) {
              var finished = false;
              var checkImages = function() {
                if (finished || !section || section.index !== lastDisplayedSectionIndex) return;
                var pendingImages = renderedImages.filter(function(img) { return !img.complete; });
                if (pendingImages.length > 0) return;
                finished = true;
                var loadedImages = renderedImages.filter(function(img) { return img.naturalWidth > 0; });
                if (loadedImages.length > 0) {
                  hideFallbackSection('EPUB 이미지 로드 완료', false);
                  applyPendingSectionEdge(false);
                  return;
                }
                sendLog('⚠️ EPUB 이미지 로드 종료 후 유효 이미지 없음 - fallback 복구 index=' + section.index);
                recoverEmptyRenderedSection(section, renderedContents, true);
              };

              renderedImages.forEach(function(img) {
                if (img.complete) return;
                img.addEventListener('load', checkImages, { once: true });
                img.addEventListener('error', checkImages, { once: true });
              });
              checkImages();
            }

            // rendered 이벤트: container scroll 리스너 등록
            var containerScrollBound = false;
            var chapterLoadTimer = null;
            rendition.on("rendered", function(section) {
              loadingEl.style.display = 'none';
              if (!firstContentRendered) {
                firstContentRendered = true;
                reportPerformance("첫 본문 rendered", section && section.href ? section.href : "");
                requestAnimationFrame(function() {
                  reportPerformance("첫 본문 paint");
                });
              }
              if (section && typeof section.index === 'number') {
                if (lastDisplayedSectionIndex !== section.index) {
                  lastCenterCfi = '';
                  lastVisibleText = '';
                  lastAnchorRatio = 0.5;
                }
                lastDisplayedSectionIndex = section.index;
                sendLog('✅ rendered spine index=' + section.index + ' href=' + (section.href || ''));
              }
              setTimeout(function() {
                try {
                  var contentsList = rendition.getContents ? rendition.getContents() : [];
                  var renderedContents = contentsList && contentsList[contentsList.length - 1];
                  var renderedDoc = renderedContents && renderedContents.document;
                  var renderedBody = renderedDoc && renderedDoc.body;
                  var renderedText = renderedBody ? String(renderedBody.textContent || '').replace(/\\s+/g, ' ').trim() : '';
                  var renderedMedia = renderedDoc && renderedDoc.querySelectorAll
                    ? renderedDoc.querySelectorAll('img,svg,image,object,video,canvas').length
                    : 0;
                  sendLog('🧪 rendered 진단 index=' + lastDisplayedSectionIndex
                    + ' textLen=' + renderedText.length
                    + ' media=' + renderedMedia
                    + ' bodyH=' + (renderedBody ? renderedBody.scrollHeight : -1)
                    + ' htmlH=' + (renderedDoc && renderedDoc.documentElement ? renderedDoc.documentElement.scrollHeight : -1));
                  var renderedImages = renderedDoc && renderedDoc.querySelectorAll
                    ? Array.prototype.slice.call(renderedDoc.querySelectorAll('img'))
                    : [];
                  var loadedImageCount = renderedImages.filter(function(img) { return img.naturalWidth > 0; }).length;
                  var pendingImageCount = renderedImages.filter(function(img) { return !img.complete; }).length;
                  if (renderedImages.length > 0 && loadedImageCount === 0 && pendingImageCount > 0) {
                    // 느린 이미지 로드를 실패로 오판해 정상 iframe을 fallback DOM으로 교체하지 않는다.
                    sendLog('⏳ EPUB 이미지 로딩 대기 index=' + lastDisplayedSectionIndex
                      + ' pending=' + pendingImageCount);
                    recoverRenderedImagesAfterSettlement(section, renderedContents, renderedImages);
                  } else if (renderedBody && (renderedBody.scrollHeight === 0
                    || (renderedImages.length > 0 && loadedImageCount === 0))) {
                    recoverEmptyRenderedSection(
                      section,
                      renderedContents,
                      renderedImages.length > 0 && loadedImageCount === 0
                    ).then(function(recovered) {
                      if (recovered) {
                        setTimeout(function() {
                          try {
                            sendLog('✅ fallback 화면 표시 height=' + fallbackSectionEl.scrollHeight);
                          } catch(e) {}
                        }, 100);
                      }
                    });
                  } else if (renderedBody && renderedBody.scrollHeight > 0) {
                    hideFallbackSection('정상 EPUB 본문 렌더링', false);
                    applyPendingSectionEdge(false);
                  }
                } catch(e) {
                  sendLog('⚠️ rendered 진단 실패: ' + e.message);
                }
              }, 150);
              scheduleLocationsGeneration();
              // 챕터 로드/전환 중 scroll 이벤트로 인한 잘못된 CFI 보고 방지
              // epub.js가 prepend 후 scrollTop을 내부 조정하는 동안 차단
              isChapterLoading = true;
              clearTimeout(chapterLoadTimer);
              chapterLoadTimer = setTimeout(function() {
                isChapterLoading = false;
                if (locationsReady) reportLocationsReady();
                reportSectionState();
              }, 600);
              try {
                var container = rendition.manager && rendition.manager.container;
                if (container) {
                  // container scroll 리스너 최초 1회 등록 (중앙 텍스트 갱신용)
                  if (!containerScrollBound) {
                    container.addEventListener('scroll', onContainerScroll, { passive: true });
                    containerScrollBound = true;
                  }
                }
              } catch(e) {}
            });

            // 렌더링 시작 이벤트
            rendition.on("started", function() {
              sendLog("🔵 EPUB 렌더링 시작됨");
            });
            
            // 렌더링 에러 이벤트
            rendition.on("error", function(err) {
              sendLog("❌ EPUB 렌더링 에러: " + err.message);
            });

            // nav 영역은 제거 (스와이프만 사용)

            var activeSearchRequestId = 0;

            function normalizeSearchHref(value) {
              try {
                return decodeURIComponent(String(value || '')).split('#')[0].replace(/^\\.\\//, '');
              } catch(e) {
                return String(value || '').split('#')[0].replace(/^\\.\\//, '');
              }
            }

            function getSearchChapterLabel(section, sectionIndex) {
              try {
                var targetHref = normalizeSearchHref(section && section.href);
                var queue = book.navigation && Array.isArray(book.navigation.toc)
                  ? book.navigation.toc.slice()
                  : [];
                while (queue.length > 0) {
                  var item = queue.shift();
                  if (!item) continue;
                  var itemHref = normalizeSearchHref(item.href);
                  if (itemHref === targetHref || itemHref.endsWith('/' + targetHref) || targetHref.endsWith('/' + itemHref)) {
                    var label = String(item.label || '').replace(/\\s+/g, ' ').trim();
                    if (label) return label;
                  }
                  if (Array.isArray(item.subitems) && item.subitems.length > 0) {
                    queue.push.apply(queue, item.subitems);
                  }
                }
              } catch(e) {}
              return '챕터 ' + (sectionIndex + 1);
            }

            function postBookSearchResults(requestId, query, results, done, limited, error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'searchResults',
                requestId: requestId,
                query: query,
                results: results,
                done: Boolean(done),
                limited: Boolean(limited),
                error: error || null
              }));
            }

            function loadSectionForSearch(section) {
              return new Promise(function(resolve, reject) {
                var settled = false;
                var timeout = setTimeout(function() {
                  if (settled) return;
                  settled = true;
                  reject(new Error('챕터 검색 시간 초과'));
                }, 5000);

                Promise.resolve(section.load(book.load.bind(book))).then(function(contents) {
                  if (settled) return;
                  settled = true;
                  clearTimeout(timeout);
                  resolve(contents);
                }).catch(function(error) {
                  if (settled) return;
                  settled = true;
                  clearTimeout(timeout);
                  reject(error);
                });
              });
            }

            function isExcludedSearchElement(element) {
              if (!element || element.nodeType !== 1) return false;

              var tagName = String(element.localName || element.nodeName || '').toUpperCase();
              if (
                tagName === 'HEAD' ||
                tagName === 'STYLE' ||
                tagName === 'SCRIPT' ||
                tagName === 'NOSCRIPT' ||
                tagName === 'TEMPLATE' ||
                tagName === 'TITLE' ||
                tagName === 'META' ||
                tagName === 'LINK' ||
                tagName === 'NAV'
              ) {
                return true;
              }

              try {
                if (element.hasAttribute('hidden')) return true;
                if (String(element.getAttribute('aria-hidden') || '').toLowerCase() === 'true') {
                  return true;
                }

                var inlineStyle = String(element.getAttribute('style') || '')
                  .replace(/\\s+/g, '')
                  .toLowerCase();
                if (
                  inlineStyle.indexOf('display:none') >= 0 ||
                  inlineStyle.indexOf('visibility:hidden') >= 0
                ) {
                  return true;
                }
              } catch(e) {}

              return false;
            }

            function isSearchableBodyTextNode(node, body) {
              if (!node || node.nodeType !== 3 || !node.nodeValue) return false;

              var current = node.parentNode;
              while (current) {
                if (isExcludedSearchElement(current)) return false;
                if (current === body) return true;
                current = current.parentNode;
              }
              return false;
            }

            function getSearchBlockElement(node, body) {
              var blockTags = {
                ADDRESS: true, ARTICLE: true, ASIDE: true, BLOCKQUOTE: true,
                DD: true, DIV: true, DL: true, DT: true, FIGCAPTION: true,
                FIGURE: true, FOOTER: true, FORM: true, H1: true, H2: true,
                H3: true, H4: true, H5: true, H6: true, HEADER: true,
                HR: true, LI: true, MAIN: true, OL: true, P: true,
                PRE: true, SECTION: true, TABLE: true, TD: true, TH: true,
                TR: true, UL: true
              };
              var current = node && node.parentNode;
              while (current && current !== body) {
                if (blockTags[String(current.localName || current.nodeName || '').toUpperCase()]) {
                  return current;
                }
                current = current.parentNode;
              }
              return body;
            }

            function findBodyTextMatches(section, loadedDocument, query, requestedLimit) {
              var doc = section && section.document ? section.document : loadedDocument;
              var body = doc && (doc.body || (doc.querySelector && doc.querySelector('body')));
              var limit = Math.max(0, Number(requestedLimit) || 0);
              if (!doc || !body || !limit || !query || typeof doc.createTreeWalker !== 'function') {
                return [];
              }

              var walker = doc.createTreeWalker(body, 4, {
                acceptNode: function(node) {
                  return isSearchableBodyTextNode(node, body) ? 1 : 2;
                }
              });
              var segments = [];
              var fullText = '';
              var previousBlock = null;
              var textNode = walker.nextNode();

              while (textNode) {
                var value = String(textNode.nodeValue || '');
                var block = getSearchBlockElement(textNode, body);
                if (
                  fullText &&
                  previousBlock &&
                  block !== previousBlock &&
                  !/\\s$/.test(fullText) &&
                  !/^\\s/.test(value)
                ) {
                  fullText += '\\n';
                }

                var start = fullText.length;
                fullText += value;
                segments.push({
                  node: textNode,
                  start: start,
                  end: fullText.length
                });
                previousBlock = block;
                textNode = walker.nextNode();
              }

              function locateTextOffset(offset, endPosition) {
                for (var index = 0; index < segments.length; index += 1) {
                  var segment = segments[index];
                  var belongsToSegment = endPosition
                    ? offset > segment.start && offset <= segment.end
                    : offset >= segment.start && offset < segment.end;
                  if (belongsToSegment) {
                    return {
                      node: segment.node,
                      offset: Math.max(0, Math.min(
                        String(segment.node.nodeValue || '').length,
                        offset - segment.start
                      ))
                    };
                  }
                }
                return null;
              }

              var normalizedText = fullText.toLocaleLowerCase();
              var normalizedQuery = String(query).toLocaleLowerCase();
              var matches = [];
              var cursor = 0;

              while (cursor <= normalizedText.length - normalizedQuery.length && matches.length < limit) {
                var matchIndex = normalizedText.indexOf(normalizedQuery, cursor);
                if (matchIndex < 0) break;

                var matchEnd = matchIndex + normalizedQuery.length;
                var startPosition = locateTextOffset(matchIndex, false);
                var endPosition = locateTextOffset(matchEnd, true);

                if (startPosition && endPosition && typeof doc.createRange === 'function') {
                  try {
                    var range = doc.createRange();
                    range.setStart(startPosition.node, startPosition.offset);
                    range.setEnd(endPosition.node, endPosition.offset);
                    var cfi = typeof section.cfiFromRange === 'function'
                      ? section.cfiFromRange(range)
                      : '';

                    if (cfi) {
                      var excerptStart = Math.max(0, matchIndex - 70);
                      var excerptEnd = Math.min(fullText.length, matchEnd + 110);
                      var excerpt = fullText.slice(excerptStart, excerptEnd)
                        .replace(/\\s+/g, ' ')
                        .trim();
                      matches.push({
                        cfi: cfi,
                        excerpt:
                          (excerptStart > 0 ? '… ' : '') +
                          excerpt +
                          (excerptEnd < fullText.length ? ' …' : '')
                      });
                    }
                  } catch(e) {}
                }

                cursor = matchIndex + Math.max(1, normalizedQuery.length);
              }

              return matches;
            }

            function searchBook(query, requestId, requestedLimit) {
              var normalizedQuery = String(query || '').trim();
              var limit = Math.max(1, Math.min(100, Number(requestedLimit) || 100));
              activeSearchRequestId = requestId;

              if (!normalizedQuery) {
                postBookSearchResults(requestId, normalizedQuery, [], true, false, null);
                return;
              }

              var sections = book.spine && book.spine.spineItems ? book.spine.spineItems : [];
              var results = [];
              var sectionCursor = 0;

              function visitNextSection() {
                if (activeSearchRequestId !== requestId) return;
                if (sectionCursor >= sections.length || results.length >= limit) {
                  postBookSearchResults(
                    requestId,
                    normalizedQuery,
                    results,
                    true,
                    results.length >= limit,
                    null
                  );
                  return;
                }

                var sectionIndex = sectionCursor;
                var section = sections[sectionCursor];
                sectionCursor += 1;
                if (!section || section.linear === false || section.linear === 'no') {
                  setTimeout(visitNextSection, 0);
                  return;
                }

                loadSectionForSearch(section).then(function(contents) {
                  if (activeSearchRequestId !== requestId) return [];
                  return findBodyTextMatches(
                    section,
                    contents,
                    normalizedQuery,
                    limit - results.length
                  );
                }).then(function(matches) {
                  if (activeSearchRequestId !== requestId) return;
                  var chapterLabel = getSearchChapterLabel(section, sectionIndex);
                  (Array.isArray(matches) ? matches : []).forEach(function(match) {
                    if (results.length >= limit || !match || !match.cfi) return;
                    results.push({
                      cfi: String(match.cfi),
                      excerpt: String(match.excerpt || normalizedQuery).replace(/\\s+/g, ' ').trim(),
                      sectionIndex: sectionIndex,
                      chapterLabel: chapterLabel
                    });
                  });
                }).catch(function(error) {
                  sendLog('⚠️ EPUB 검색 섹션 건너뜀 index=' + sectionIndex + ' error=' + error.message);
                }).then(function() {
                  try {
                    if (sectionIndex !== getVisibleSectionIndex() && section && typeof section.unload === 'function') {
                      section.unload();
                    }
                  } catch(e) {}

                  if (activeSearchRequestId !== requestId) return;
                  if (results.length > 0 || sectionCursor % 4 === 0) {
                    postBookSearchResults(requestId, normalizedQuery, results, false, false, null);
                  }
                  setTimeout(visitNextSection, 0);
                });
              }

              visitNextSection();
            }

            var lastSearchHighlightCfi = '';

            function clearSearchHighlights() {
              if (!lastSearchHighlightCfi) return;
              try {
                if (rendition.annotations && typeof rendition.annotations.remove === 'function') {
                  rendition.annotations.remove(lastSearchHighlightCfi, 'highlight');
                }
              } catch(e) {}
              lastSearchHighlightCfi = '';
            }

            function highlightSearchResult(targetCfi) {
              clearSearchHighlights();
              try {
                if (!rendition.annotations || typeof rendition.annotations.highlight !== 'function') return;
                rendition.annotations.highlight(
                  targetCfi,
                  { source: 'reader-search' },
                  null,
                  'readme-search-highlight',
                  { fill: '#f6d878', 'fill-opacity': '0.62', 'mix-blend-mode': 'multiply' }
                );
                lastSearchHighlightCfi = targetCfi;
              } catch(e) {
                sendLog('⚠️ 검색 결과 강조 실패: ' + e.message);
              }
            }

            function navigateSearchResult(targetCfi) {
              if (!targetCfi || isSeeking || isAutoTransition) return;

              isSeeking = true;
              isChapterLoading = true;
              activeSeekTargetCfi = targetCfi;
              hideBookCover();
              hideFallbackSection('검색 결과 이동', false);
              showChapterIndicator('검색 위치로 이동 중…');
              playSoftTransition(false);

              var finished = false;
              function finishSearchNavigation() {
                if (finished) return;
                finished = true;
                clearSoftTransition();
                hideChapterIndicator();
                isSeeking = false;
                isChapterLoading = false;
                activeSeekTargetCfi = '';
                lastCenterCfi = targetCfi;
                updateCenterText();
                try {
                  var loc = rendition.currentLocation();
                  if (loc) safeReport(loc, false);
                } catch(e) {}
                reportSectionState();
              }

              var watchdog = setTimeout(finishSearchNavigation, 3000);
              setTimeout(function() {
                Promise.resolve(rendition.display(targetCfi)).then(function() {
                  requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                      setTimeout(function() {
                        if (finished || activeSeekTargetCfi !== targetCfi) return;
                        alignCfiInViewport(targetCfi, 0.32);
                        highlightSearchResult(targetCfi);
                        playSoftEntrance(false);
                        setTimeout(function() {
                          clearTimeout(watchdog);
                          finishSearchNavigation();
                        }, CHAPTER_ENTER_MS + 40);
                      }, 140);
                    });
                  });
                }).catch(function(error) {
                  sendLog('⚠️ 검색 결과 이동 실패: ' + error.message);
                  clearTimeout(watchdog);
                  finishSearchNavigation();
                });
              }, CHAPTER_EXIT_MS);
            }

            // Slider input can arrive faster than rendition.display() can settle. Keep at
            // most one display in flight and coalesce the rest to the newest request so
            // an older async completion cannot replace the user's final drag position.
            var sliderSeekRunning = false;
            var queuedSliderSeek = null;

            function runSliderSeek(request) {
              if (!request) return;
              if (sliderSeekRunning || isSeeking || isAutoTransition) {
                queuedSliderSeek = request;
                return;
              }

              var p = Math.max(0, Math.min(1, request.percent));
              var requestId = request.requestId || 0;
              var generatedCount = Math.max(1, book.locations.length());

              if (p <= 0.001 && coverAvailable) {
                showExistingBookCover();
                lastDisplayedSectionIndex = 0;
                reportLocationsReady();
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'seekComplete', requestId: requestId
                }));
                return;
              }

              if (generatedCount <= 1) {
                seekFallbackPercent(p, requestId);
                return;
              }

              totalLocations = generatedCount;
              var targetIndex = Math.round(p * (generatedCount - 1));
              targetIndex = Math.max(0, Math.min(generatedCount - 1, targetIndex));
              var targetCfi = book.locations.cfiFromLocation(targetIndex);
              if (!targetCfi) return;

              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'seekState',
                requestId: requestId,
                current: targetIndex + 1,
                total: generatedCount,
                percent: generatedCount > 1 ? (targetIndex / (generatedCount - 1)) * 100 : 0
              }));

              sendLog('🔍 슬라이더 이동: ' + Math.round(p * 100) + '% (index: ' + targetIndex + ')');
              sliderSeekRunning = true;
              isSeeking = true;
              isChapterLoading = true;
              activeSeekTargetCfi = targetCfi;
              lastCenterCfi = '';
              hideBookCover();
              hideFallbackSection('locations 슬라이더 이동', false);

              function finishSliderSeek() {
                if (p >= 0.999) {
                  var edgeContainer = rendition.manager && rendition.manager.container;
                  if (edgeContainer) {
                    edgeContainer.scrollTop = Math.max(0, edgeContainer.scrollHeight - edgeContainer.clientHeight);
                  }
                } else {
                  alignCfiInViewport(targetCfi, 0.5);
                }
                lastAnchorRatio = 0.5;
                lastCenterCfi = targetCfi;
                updateCenterText();
                isChapterLoading = false;
                isSeeking = false;
                activeSeekTargetCfi = '';
                sliderSeekRunning = false;
                try {
                  var loc = rendition.currentLocation();
                  if (loc) safeReport(loc, false);
                } catch(e) {}
                reportSectionState();
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'seekComplete', requestId: requestId
                }));

                var nextRequest = queuedSliderSeek;
                queuedSliderSeek = null;
                if (nextRequest) requestAnimationFrame(function() { runSliderSeek(nextRequest); });
              }

              Promise.resolve(rendition.display(targetCfi)).then(function() {
                requestAnimationFrame(function() {
                  requestAnimationFrame(finishSliderSeek);
                });
              }).catch(function(error) {
                sendLog('⚠️ 슬라이더 이동 실패: ' + error.message);
                isChapterLoading = false;
                isSeeking = false;
                activeSeekTargetCfi = '';
                sliderSeekRunning = false;
                var nextRequest = queuedSliderSeek;
                queuedSliderSeek = null;
                if (nextRequest) runSliderSeek(nextRequest);
              });
            }

            // React Native -> WebView 메시지 수신 (window로 수정!)
            window.addEventListener("message", function(e) {
              try {
                var data = JSON.parse(e.data);
                if (data.type === "searchBook") {
                  searchBook(String(data.query || ''), Number(data.requestId) || 0, data.limit);
                } else if (data.type === "cancelSearch") {
                  activeSearchRequestId = Number(data.requestId) || (activeSearchRequestId + 1);
                  if (data.clearHighlight) clearSearchHighlights();
                } else if (data.type === "navigateSearchResult") {
                  navigateSearchResult(String(data.cfi || ''));
                // 저장 직전 최신 CFI 요청
                } else if (data.type === "getCurrentLocation") {
                  try {
                    var loc = rendition.currentLocation();
                    if (loc) safeReport(loc);
                  } catch(e) {}
                } else if (data.type === "seek" && (locationsReady || isFallbackVisible())) {
                  var p = data.percent;
                  if (typeof p !== "number") return;
                  runSliderSeek({
                    percent: Math.max(0, Math.min(1, p)),
                    requestId: Number(data.requestId) || 0
                  });
                } else if (data.type === "tryBoundaryTransition") {
                  tryBoundaryTransition(data.direction === 'prev');
                } else if (data.type === "themeAndStart") {
                  if (!locationsReady && typeof data.locationsCache === 'string' && data.locationsCache.length > 0) {
                    try {
                      book.locations.load(data.locationsCache);
                      var cachedLocationCount = Math.max(1, book.locations.length());
                      if (cachedLocationCount > 1) {
                        locationsReady = true;
                        locationsGenerationRequested = true;
                        locationsGenerationStarted = true;
                        totalLocations = cachedLocationCount;
                        reportNavigationReady('locations-cache');
                        reportLocationsReady();
                        sendLog('✅ locations 캐시 복원 count=' + cachedLocationCount);
                      }
                    } catch(cacheError) {
                      sendLog('⚠️ locations 캐시 복원 실패: ' + cacheError.message);
                    }
                  }
                  // 테마 설정 후 display 시작 (훅이 각 챕터에 CSS 주입 → 챕터 이동 정상화)
                  currentTheme = {
                    bgColor: data.bgColor || '#f5f0e6',
                    textColor: data.textColor || '#333333',
                    fontSize: data.fontSize || 18,
                    lineSpacing: data.lineSpacing || 1.9,
                    sidePadding: (data.sidePadding != null) ? data.sidePadding : 24,
                    fontFamily: data.fontFamily || 'default',
                    usePublisherFont: data.usePublisherFont === true
                  };
                  document.documentElement.style.background = currentTheme.bgColor;
                  document.body.style.background = currentTheme.bgColor;
                  sendLog("📖 themeAndStart 수신 - CFI=" + (data.cfi || '없음(처음부터)') + " anchorRatio=" + (data.anchorRatio || 0.5));
                  reportPerformance("themeAndStart 수신", data.cfi ? "이어읽기" : "처음부터");
                  var savedAnchorRatio = (typeof data.anchorRatio === 'number') ? data.anchorRatio : 0.5;
                  if (typeof data.cfi === 'string' && data.cfi.indexOf('readme-fallback:') === 0) {
                    var fallbackParts = data.cfi.split(':');
                    var fallbackSectionIndex = Number(fallbackParts[1]);
                    var fallbackWithinRatio = Number(fallbackParts[2]);
                    if (!Number.isFinite(fallbackSectionIndex) || !Number.isFinite(fallbackWithinRatio)) {
                      sendLog('⚠️ fallback 저장 위치 형식 오류 - 처음부터 시작');
                      rendition.display();
                      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'restored' }));
                    } else {
                      pendingFallbackSeek = {
                        sectionIndex: Math.max(0, Math.floor(fallbackSectionIndex)),
                        withinRatio: Math.max(0, Math.min(1, fallbackWithinRatio))
                      };
                      pendingFallbackRestore = true;
                      coverDismissed = true;
                      hideBookCover();
                      sendLog('➡️ [fallback 복원] section=' + pendingFallbackSeek.sectionIndex
                        + ' within=' + Math.round(pendingFallbackSeek.withinRatio * 100) + '%');
                      reportPerformance("fallback 이어읽기 display 요청");
                      displaySectionByIndex(pendingFallbackSeek.sectionIndex).then(function(moved) {
                        if (!moved) {
                          pendingFallbackRestore = false;
                          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'restored' }));
                        }
                      });
                    }
                  } else if (data.cfi) {
                    var targetCfi = data.cfi;
                    sendLog("➡️ [복원] display(cfi) 호출: " + targetCfi);
                    reportPerformance("이어읽기 display 요청");
                    rendition.display(targetCfi).then(function() {
                      restoreCfiAfterLayout(targetCfi, savedAnchorRatio, function() {
                        var container = rendition.manager && rendition.manager.container;
                        updateCenterText();
                        var loc2 = rendition.currentLocation();
                        sendLog('✅ [복원완료]'
                          + ' scrollTop=' + (container ? Math.round(container.scrollTop) : 'n/a')
                          + ' cfi=' + (loc2 && loc2.start ? (loc2.start.cfi||'').slice(0,50) : 'n/a')
                          + ' centerTxt=' + lastVisibleText.slice(0, 50));
                        if (loc2) safeReport(loc2, false);
                        reportSectionState();
                        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'restored' }));
                      });
                    }).catch(function(err) {
                      sendLog("❌ display(cfi) 실패, 처음부터: " + err.message);
                      rendition.display();
                    });
                  } else {
                    coverDismissed = false;
                    coverShouldShowWhenLoaded = true;
                    reportPerformance("첫 화면 display 요청");
                    rendition.display().then(function() {
                      setTimeout(function() {
                        reportSectionState();
                        // 처음부터 열기에서는 section index 계산 여부와 무관하게 실제 cover를 조회한다.
                        showBookCoverIfAvailable();
                        if (locationsReady) {
                          reportLocationsReady();
                          try {
                            var loc = rendition.currentLocation();
                            if (loc) safeReport(loc, false);
                          } catch(e) {}
                        }
                      }, 120);
                    }).catch(function(err) {
                      sendLog("❌ display() 실패: " + err.message);
                    });
                  }
                } else if (data.type === "theme") {
                  var layoutChanged = Number(data.fontSize || currentTheme.fontSize) !== currentTheme.fontSize
                    || Number(data.lineSpacing || currentTheme.lineSpacing) !== currentTheme.lineSpacing
                    || Number(data.sidePadding != null ? data.sidePadding : currentTheme.sidePadding) !== currentTheme.sidePadding
                    || String(data.fontFamily || currentTheme.fontFamily) !== currentTheme.fontFamily
                    || (data.usePublisherFont === true) !== currentTheme.usePublisherFont;
                  var preservedCfi = '';
                  var preservedAnchorRatio = lastAnchorRatio;
                  var preservedFallbackRatio = 0;

                  if (layoutChanged) {
                    if (isFallbackVisible()) {
                      var oldFallbackMax = Math.max(1, fallbackSectionEl.scrollHeight - fallbackSectionEl.clientHeight);
                      preservedFallbackRatio = Math.max(0, Math.min(1, fallbackSectionEl.scrollTop / oldFallbackMax));
                    } else {
                      updateCenterText();
                      preservedCfi = lastCenterCfi;
                      if (!preservedCfi) {
                        try {
                          var currentThemeLocation = rendition.currentLocation();
                          preservedCfi = currentThemeLocation && currentThemeLocation.start
                            ? (currentThemeLocation.start.cfi || currentThemeLocation.start)
                            : '';
                        } catch(e) {}
                      }
                    }
                    isSeeking = true;
                    isChapterLoading = true;
                  }

                  // 읽는 중 설정 변경 → 현재 로드된 모든 섹션에 CSS 직접 주입
                  currentTheme = {
                    bgColor: data.bgColor || currentTheme.bgColor,
                    textColor: data.textColor || currentTheme.textColor,
                    fontSize: data.fontSize || currentTheme.fontSize,
                    lineSpacing: data.lineSpacing || currentTheme.lineSpacing,
                    sidePadding: (data.sidePadding != null) ? data.sidePadding : currentTheme.sidePadding,
                    fontFamily: data.fontFamily || currentTheme.fontFamily,
                    usePublisherFont: data.usePublisherFont === true
                  };
                  loadedContents = loadedContents.filter(function(c) {
                    return c && c.document && c.document.head;
                  });
                  loadedContents.forEach(function(c) { injectTheme(c); });
                  var fallbackReaderTheme = document.getElementById('fallback-reader-theme');
                  if (fallbackReaderTheme) fallbackReaderTheme.textContent = buildFallbackReaderCss(currentTheme);
                  if (fallbackSectionEl) {
                    fallbackSectionEl.style.background = currentTheme.bgColor;
                    fallbackSectionEl.style.paddingLeft = currentTheme.sidePadding + 'px';
                    fallbackSectionEl.style.paddingRight = currentTheme.sidePadding + 'px';
                  }
                  sendLog("🎨 테마 업데이트: " + currentTheme.bgColor);

                  if (layoutChanged && isFallbackVisible()) {
                    var fallbackLayoutFrame = 0;
                    var fallbackPreviousHeight = -1;
                    var fallbackStableFrames = 0;
                    function restoreFallbackLayoutAnchor() {
                      var fallbackMax = Math.max(0, fallbackSectionEl.scrollHeight - fallbackSectionEl.clientHeight);
                      fallbackSectionEl.scrollTop = fallbackMax * preservedFallbackRatio;
                      var fallbackHeight = fallbackSectionEl.scrollHeight;
                      fallbackStableFrames = fallbackHeight === fallbackPreviousHeight
                        ? fallbackStableFrames + 1
                        : 0;
                      fallbackPreviousHeight = fallbackHeight;
                      fallbackLayoutFrame += 1;
                      if (fallbackStableFrames < 2 && fallbackLayoutFrame < 18) {
                        requestAnimationFrame(restoreFallbackLayoutAnchor);
                        return;
                      }
                      isSeeking = false;
                      isChapterLoading = false;
                      reportFallbackPaging();
                    }
                    requestAnimationFrame(restoreFallbackLayoutAnchor);
                  } else if (layoutChanged && preservedCfi) {
                    restoreCfiAfterLayout(preservedCfi, preservedAnchorRatio, function() {
                      lastCenterCfi = preservedCfi;
                      lastAnchorRatio = preservedAnchorRatio;
                      updateCenterText();
                      isSeeking = false;
                      isChapterLoading = false;
                      try {
                        var themedLocation = rendition.currentLocation();
                        if (themedLocation) safeReport(themedLocation, false);
                      } catch(e) {}
                    });
                  } else if (layoutChanged) {
                    isSeeking = false;
                    isChapterLoading = false;
                  }
                }
              } catch(err) {
                // WebView 내부 비-JSON 메시지(setImmediate 등) 파싱 실패 → 무시
              }
            });

            // document.addEventListener도 추가 (일부 플랫폼 호환성)
            document.addEventListener("message", function(e) {
              window.dispatchEvent(new MessageEvent('message', { data: e.data }));
            });

            // 뒤로가기 시 현재 CFI + 중앙 텍스트 즉시 전송
            document.addEventListener('visibilitychange', function() {
              if (document.hidden) {
                try {
                  updateCenterText(); // 숨겨지기 직전 마지막으로 갱신
                  var loc = rendition.currentLocation();
                  if (loc) safeReport(loc);
                } catch(e) {}
              }
            });

          } catch(err) {
            showError("EPUB 초기화 실패: " + err.message);
          }
        })();
      </script>
    </body>
  </html>
  `, [epubBase64, epubFileSize, uri]);

  const epubSource = useMemo(() => ({
    html: epubHtml,
    baseUrl: decodeURI(String(uri || "")).replace(/[^/]+$/, ""),
  }), [epubHtml, uri]);

  const title = String(name || "").replace(/\.[^.]+$/, ""); // 확장자 제거
  const hasActiveSearchHighlight = isEpub
    ? epubSearchHighlightActive
    : txtSearchTarget !== null;

  // ===================== 진행도 자동 저장 =====================
  const lastSavedPositionSignatureRef = useRef("");
  const lastQueuedPositionSignatureRef = useRef("");
  const exitFlushCompletedRef = useRef(false);
  const exitInProgressRef = useRef(false);

  useEffect(() => {
    lastSavedPositionSignatureRef.current = "";
    lastQueuedPositionSignatureRef.current = "";
    exitFlushCompletedRef.current = false;
    exitInProgressRef.current = false;
  }, [fileId]);

  useEffect(() => () => {
    if (sliderThrottleTimerRef.current) {
      clearTimeout(sliderThrottleTimerRef.current);
      sliderThrottleTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    lastCfiRef.current = lastCfi;
  }, [lastCfi]);

  const requestCurrentEpubLocation = () => {
    if (!isEpub || !epubReady || !webViewRef.current) return Promise.resolve();
    if (pendingEpubLocationRequestRef.current) {
      return pendingEpubLocationRequestRef.current.promise;
    }

    let resolveRequest = () => {};
    const promise = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    const finish = () => {
      const pending = pendingEpubLocationRequestRef.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingEpubLocationRequestRef.current = null;
      pending.resolve();
    };
    const timer = setTimeout(finish, 350);
    pendingEpubLocationRequestRef.current = {
      promise,
      resolve: resolveRequest,
      timer,
    };

    try {
      webViewRef.current.postMessage(JSON.stringify({ type: "getCurrentLocation" }));
    } catch {
      finish();
    }
    return promise;
  };

  // 서버에 저장하는 함수
  const saveProgressToServer = async (forceLog = false, refreshEpubLocation = false) => {
    if (!fileId) return;
    const saveFileId = Array.isArray(fileId) ? String(fileId[0] ?? "") : String(fileId);
    if (hasSupersedingReaderSession(readerSessionIdRef.current, saveFileId)) return;

    if (refreshEpubLocation) {
      await requestCurrentEpubLocation();
    }
    if (hasSupersedingReaderSession(readerSessionIdRef.current, saveFileId)) return;

    // await 전에 한 번만 캡처해 progress/문자 위치/preview가
    // 서로 다른 시점의 값으로 섞이지 않게 한다.
    const isTxtPositionStable = isEpub || (
      !pendingTxtNavigationRef.current
      && !isTxtProgrammaticNavigationRef.current
    );
    const txtSnapshot = !isEpub && isTxtPositionStable
      ? captureTxtPositionSnapshot()
      : null;
    const currentProgress = txtSnapshot?.progress ?? progressRef.current;
    const canonicalPosition = canonicalReadingPositionRef.current;
    const currentCfi = isEpub && canonicalPosition?.format === "EPUB"
      ? canonicalPosition.cfi
      : lastCfiRef.current;
    const currentAnchorRatio = isEpub && canonicalPosition?.format === "EPUB"
      ? canonicalPosition.anchorRatio
      : lastAnchorRatioRef.current;
    
    // 0으로 덮어쓰기 방지
    if (currentProgress === 0 && initialProgressRef.current === 0) {
      console.log("progress와 initialProgress 모두 0. 초기화 전 저장 거부.");
      return;
    }
    if (currentProgress === 0 && initialProgressRef.current > 0) {
      console.log("progress가 0으로 초기화됨. 저장 안 함.");
      return;
    }

    // EPUB은 CFI가 있어야 정확 복원이 가능함.
    // CFI 없이 progress만 저장하면 이전 CFI와 어긋나서 다른 위치로 이동할 수 있음.
    if (isEpub && !currentCfi) {
      console.log("📚 EPUB CFI 미수신 상태 - progress 저장 보류");
      return;
    }

    const currentPreview = txtSnapshot?.readingPreview ?? currentReadingPreviewRef.current;

    const saveUri = Array.isArray(uri) ? String(uri[0] ?? "") : String(uri ?? "");
    if (txtSnapshot) {
      await persistTxtProgressLocally(txtSnapshot);
      const localPosition: LocalReaderPosition = {
        uri: saveUri,
        format: "TXT",
        progress: currentProgress,
        readingPreview: currentPreview,
        updatedAt: txtSnapshot.updatedAt,
        characterOffset: txtSnapshot.characterOffset,
        previewCharacterOffset: txtSnapshot.previewCharacterOffset,
        lineTopInset: txtSnapshot.lineTopInset,
        layoutSignature: txtSnapshot.layoutSignature,
      };
      await enqueueReaderWrite(`reader-local:${saveFileId}`, () => AsyncStorage.setItem(
        `${READER_LOCAL_PROGRESS_KEY_PREFIX}${saveFileId}`,
        JSON.stringify(localPosition),
      )).catch((error) => {
        console.log("TXT 로컬 이어읽기 위치 저장 실패:", error);
      });
    } else if (isEpub) {
      const localPosition: LocalReaderPosition = {
        uri: saveUri,
        format: "EPUB",
        progress: currentProgress,
        readingPreview: currentPreview,
        updatedAt: Date.now(),
        epubCfi: currentCfi || undefined,
        anchorRatio: currentAnchorRatio,
      };
      await enqueueReaderWrite(`reader-local:${saveFileId}`, () => AsyncStorage.setItem(
        `${READER_LOCAL_PROGRESS_KEY_PREFIX}${saveFileId}`,
        JSON.stringify(localPosition),
      ));
    } else {
      console.log(
        "⏸️ [Persist] TXT 위치 이동 중: 임시 상세 좌표는 로컬에 덮어쓰지 않고 서버 진행도만 저장",
      );
    }

    const body: any = {
      progress: currentProgress,
      // 백엔드가 같은 날 한 번만 FileReadLog를 생성하므로 랭킹용 일별 읽기 기록은 유지한다.
      recordReadLog: forceLog || currentProgress > 0,
    };

    // 현재 화면에 보이는 텍스트를 readingPreview로 저장
    if (currentPreview) {
      body.readingPreview = currentPreview;
    }

    if (isEpub && currentCfi) {
      body.epubCfi = currentCfi;
      body.anchorRatio = currentAnchorRatio;
    }

    const positionSignature = JSON.stringify({
      progress: currentProgress,
      cfi: currentCfi,
      anchorRatio: currentAnchorRatio,
      characterOffset: txtSnapshot?.characterOffset,
      lineTopInset: txtSnapshot?.lineTopInset,
      preview: currentPreview,
    });
    if (positionSignature === lastSavedPositionSignatureRef.current) {
      return;
    }
    if (positionSignature === lastQueuedPositionSignatureRef.current) {
      await waitForReaderWrites(`server-progress:${saveFileId}`);
      if (positionSignature === lastSavedPositionSignatureRef.current) return;
    }
    lastQueuedPositionSignatureRef.current = positionSignature;

    const saveRequest = enqueueReaderWrite(`server-progress:${saveFileId}`, async () => {
        try {
          console.log("📤 [저장 시작]"
            + "\n  progress=" + currentProgress.toFixed(3)
            + "\n  cfi=" + (currentCfi ? currentCfi.slice(0, 80) : '❌없음')
            + "\n  anchorRatio=" + currentAnchorRatio.toFixed(3)
            + "\n  preview=" + (body.readingPreview || '').slice(0, 40)
            + "\n  body=" + JSON.stringify(body).slice(0, 200));

          const response = await authenticatedFetch(`${BASE_URL}/files/${saveFileId}/progress`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (response.ok) {
            lastSavedPositionSignatureRef.current = positionSignature;
            if (lastQueuedPositionSignatureRef.current === positionSignature) {
              lastQueuedPositionSignatureRef.current = "";
            }
            console.log("✅ [저장 성공] progress=" + currentProgress.toFixed(3)
              + " anchorRatio=" + currentAnchorRatio.toFixed(3)
              + " cfi=" + (currentCfi ? currentCfi.slice(0, 60) : '없음'));
          } else {
            const errText = await response.text().catch(() => '');
            console.log("❌ [저장 실패] status=" + response.status + " body=" + errText.slice(0, 100));
            if (lastQueuedPositionSignatureRef.current === positionSignature) {
              lastQueuedPositionSignatureRef.current = "";
            }
          }
        } catch (e) {
          console.log("❌ 진행도 저장 실패:", e);
          if (lastQueuedPositionSignatureRef.current === positionSignature) {
            lastQueuedPositionSignatureRef.current = "";
          }
        }
      });
    await saveRequest;
  };

  // 함수를 ref로 감싸서 unmount/AppState에서 항상 최신 버전 호출 보장
  const saveProgressRef = useRef(saveProgressToServer);
  useEffect(() => {
    saveProgressRef.current = saveProgressToServer;
  });
  flushReaderSessionRef.current = async (reason) => {
    await saveProgressRef.current(true, true);
    if (reason === "external-file" || reason === "hardware-back" || reason === "reader-exit") {
      exitFlushCompletedRef.current = true;
    }
  };

  // unmount 시 저장 (백업)
  useEffect(() => {
    return () => {
      const pendingLocationRequest = pendingEpubLocationRequestRef.current;
      if (pendingLocationRequest) {
        clearTimeout(pendingLocationRequest.timer);
        pendingEpubLocationRequestRef.current = null;
        pendingLocationRequest.resolve();
      }
      // 홈 화면에서 즉시 refetch하도록 플래그 저장
      AsyncStorage.setItem('reader_exited', '1').catch(() => {});
      if (!exitFlushCompletedRef.current) {
        void saveProgressRef.current(true, false);
      }
    };
  }, []);

  // 앱이 백그라운드로 전환될 때 저장 (강제종료 대비)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        void flushReaderSessionRef.current("background");
      }
    });
    return () => subscription.remove();
  }, []);

  const exitReader = async (reason: "hardware-back" | "reader-exit" = "reader-exit") => {
    if (exitInProgressRef.current || exitFlushCompletedRef.current) return;
    exitInProgressRef.current = true;
    try {
      await flushReaderSessionRef.current(reason);
      await AsyncStorage.setItem('reader_exited', '1').catch(() => {});
    } catch (error) {
      console.log("Reader 종료 위치 저장 실패:", error);
    } finally {
      exitFlushCompletedRef.current = true;
    }

    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      void exitReader("hardware-back");
      return true;
    });
    return () => subscription.remove();
  });

  const txtListCallbacksRef = useRef({
    handleScroll,
    updateTxtScrollState,
    handleTxtTextLayout,
  });
  txtListCallbacksRef.current = {
    handleScroll,
    updateTxtScrollState,
    handleTxtTextLayout,
  };

  // 하단 progress가 갱신되어 Reader가 다시 렌더되어도 TXT 목록 자체는 다시
  // 구성하지 않는다. 본문은 파일/검색 강조/보기 설정이 바뀔 때만 갱신한다.
  const txtReaderList = useMemo(() => (
    <FlatList
      ref={scrollRef}
      data={content}
      // 키는 구간의 문자 위치로 고정한다. 글자 크기가 바뀌어도 셀을 통째로
      // 다시 마운트하지 않으므로, 목록 높이가 순간적으로 0으로 무너졌다가
      // 되돌아오면서 화면이 튀는 일이 없다. 새 측정값은 스타일 변경으로
      // onLayout/onTextLayout이 다시 발생하면서 채워진다.
      keyExtractor={(item) => "txt-" + item.start}
      getItemLayout={getTxtItemLayout}
      CellRendererComponent={renderTxtCell}
      onViewableItemsChanged={onTxtViewableItemsChangedRef.current}
      viewabilityConfig={txtViewabilityConfigRef.current}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      updateCellsBatchingPeriod={40}
      windowSize={5}
      removeClippedSubviews={false}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      style={{ flex: 1, backgroundColor: settings.bgColor }}
      contentContainerStyle={{ paddingHorizontal: settings.sidePadding, paddingBottom: 40 }}
      onScroll={(event) => txtListCallbacksRef.current.handleScroll(event)}
      onScrollEndDrag={(event) => txtListCallbacksRef.current.updateTxtScrollState(event, true)}
      onMomentumScrollEnd={(event) => txtListCallbacksRef.current.updateTxtScrollState(event, true)}
      onScrollToIndexFailed={(info) => {
        const pending = pendingTxtNavigationRef.current;
        if (!pending || pending.chunkIndex !== info.index || !scrollRef.current) return;

        // 높이가 서로 다른 TXT chunk를 고정 layout처럼 취급하지 않는다.
        // FlatList가 실제 측정한 평균으로 목표 주변을 먼저 렌더링하면,
        // Cell onLayout/onTextLayout에서 정확한 문자 위치로 마무리한다.
        // 목표 구간이 아직 렌더되지 않았다면 다음 프레임에 개선된 측정값으로 다시 시도한다.
        const estimatedOffset = Math.max(0, info.averageItemLength * info.index);
        scrollRef.current.scrollToOffset({ offset: estimatedOffset, animated: false });
        scheduleTxtNavigationRetryRef.current();
      }}
      onContentSizeChange={(_width, height) => {
        const measuredHeight = Math.max(1, height);
        txtContentHeightRef.current = measuredHeight;
        // state는 최초 복원 준비 신호로만 필요하다. 이후 가상 셀 측정 변화는
        // ref에만 반영해 Reader 전체 재렌더와 셀 재부착을 만들지 않는다.
        setTxtContentHeight((currentHeight) => (
          currentHeight > 1 ? currentHeight : measuredHeight
        ));
      }}
      scrollEventThrottle={16}
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height;
        setViewHeight(height);
        viewHeightRef.current = height;
      }}
      onTouchStart={(event) => {
        touchStartPos.current = {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
          time: Date.now(),
          maxMove: 0,
          active: true,
          didScroll: false,
        };
      }}
      onTouchMove={(event) => {
        const touch = touchStartPos.current;
        const dx = event.nativeEvent.pageX - touch.x;
        const dy = event.nativeEvent.pageY - touch.y;
        touch.maxMove = Math.max(touch.maxMove, Math.sqrt(dx * dx + dy * dy));
        if (touch.maxMove > 8) touch.didScroll = true;
      }}
      onScrollBeginDrag={() => {
        txtNavigationIdRef.current += 1;
        pendingTxtNavigationRef.current = null;
        isTxtProgrammaticNavigationRef.current = false;
        // 사용자가 직접 스크롤하면 이어읽기 복원 정착은 즉시 포기한다.
        txtResumeSettleRef.current = null;
        if (touchStartPos.current.active) {
          touchStartPos.current.didScroll = true;
        }
      }}
      onTouchEnd={(event) => {
        const touch = touchStartPos.current;
        const dx = Math.abs(event.nativeEvent.pageX - touch.x);
        const dy = Math.abs(event.nativeEvent.pageY - touch.y);
        const elapsed = Date.now() - touch.time;
        if (
          !touch.didScroll
          && elapsed >= 40
          && elapsed <= 350
          && dx <= 8
          && dy <= 8
          && touch.maxMove <= 8
        ) {
          setShowUI((previous) => !previous);
        }
        touch.active = false;
      }}
      onTouchCancel={() => {
        touchStartPos.current.active = false;
        touchStartPos.current.didScroll = true;
      }}
      renderItem={({ item, index }) => {
        const target = txtSearchTarget?.chunkIndex === index ? txtSearchTarget : null;
        const itemText = rawTextRef.current.slice(item.start, item.end);
        return (
          <Text
            onTextLayout={(event) => (
              txtListCallbacksRef.current.handleTxtTextLayout(
                index,
                event.nativeEvent.lines || [],
              )
            )}
            style={[
              styles.text,
              {
                fontSize: settings.fontSize,
                color: settings.textColor,
                lineHeight: settings.fontSize * settings.lineSpacing,
                fontFamily: settings.fontFamily !== "default"
                  ? settings.fontFamily
                  : Platform.OS === "android" ? "sans-serif" : undefined,
              },
            ]}
          >
            {target ? (
              <>
                {itemText.slice(0, target.localOffset)}
                <Text style={styles.searchHighlight}>
                  {itemText.slice(target.localOffset, target.localOffset + target.length)}
                </Text>
                {itemText.slice(target.localOffset + target.length)}
              </>
            ) : itemText}
          </Text>
        );
      }}
      extraData={[
        txtSearchTarget?.chunkIndex,
        txtSearchTarget?.localOffset,
        txtSearchTarget?.length,
        settings.fontSize,
        settings.textColor,
        settings.lineSpacing,
        settings.fontFamily,
      ].join(":")}
    />
  ), [
    content,
    getTxtItemLayout,
    renderTxtCell,
    settings.bgColor,
    settings.fontFamily,
    settings.fontSize,
    settings.lineSpacing,
    settings.sidePadding,
    settings.textColor,
    txtLayoutModelVersion,
    txtLayoutSignature,
    txtSearchTarget,
  ]);

  return (
    <View style={styles.root}>
      {/* Expo Router 헤더 숨기기 */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* 에러 시 전체 화면 */}
      {(epubError || txtError) ? (
        <View style={[styles.errorFullScreen, { paddingTop: readerTopInset }]}>
          <TouchableOpacity style={styles.errorBackTop} onPress={() => void exitReader()}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <View style={styles.errorBody}>
            <Text style={styles.errorBigEmoji}>📚</Text>
            <Text style={styles.errorText}>파일을 열 수 없어요</Text>
            <Text style={styles.errorHint}>
              {(epubError || txtError || '').includes('찾을 수 없')
                ? '저장된 경로가 변경됐어요.\n파일을 삭제 후 다시 추가해주세요.'
                : (epubError || txtError)
                  ? `${epubError || txtError}\n\n파일이 손상되지 않았다면 다시 열어주세요.`
                  : '파일이 손상됐거나 지원되지 않는 형식이에요.'}
            </Text>
            <TouchableOpacity style={styles.errorBackBtn} onPress={() => void exitReader()}>
              <Text style={styles.errorBackBtnText}>← 돌아가기</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
      <>
      {/* 상단바 */}
      {showUI && (
        <View style={[styles.topBar, { paddingTop: readerTopInset + 8 }]}>
          <Text style={styles.back} onPress={() => void exitReader()}>
            ←
          </Text>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.topBarActions}>
            <TouchableOpacity
              style={styles.topBarIcon}
              onPress={openReaderSearch}
              accessibilityRole="button"
              accessibilityLabel="본문 검색"
            >
              <Search size={22} color="#fff" />
            </TouchableOpacity>
            {hasActiveSearchHighlight && (
              <TouchableOpacity
                style={styles.topBarIcon}
                onPress={cancelReaderSearch}
                accessibilityRole="button"
                accessibilityLabel="검색 종료 및 강조 해제"
                accessibilityHint="현재 검색어의 노란색 강조 표시를 지웁니다"
              >
                <X size={23} color="#f6d878" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* 본문 영역 */}
      {isEpub ? (
        /* EPUB: WebView 터치 이벤트를 방해하지 않음 */
        <>
          <View style={[styles.readerArea, { paddingTop: readerTopInset }]}>
            {epubBase64 && epubBase64.length > 0 ? (
              <>
              <WebView
                key={epubLoadKey}
                ref={webViewRef}
                originWhitelist={["*"]}
                source={epubSource}
                onMessage={handleWebViewMessage}
                style={{ flex: 1 }}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                allowFileAccess={true}
                allowFileAccessFromFileURLs={true}
                allowUniversalAccessFromFileURLs={true}
                scrollEnabled={true}
                bounces={true}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={true}
                overScrollMode="always"
                nestedScrollEnabled={true}
                androidLayerType="hardware"
                pointerEvents="auto"
                onLoadStart={() => {
                  console.log(
                    `⏱️ EPUB [${Date.now() - epubOpenStartedAtRef.current}ms] WebView 로드 시작`,
                    epubLoadKey,
                  );
                  setEpubNavigationReady(false);
                  setEpubNavigationError(false);
                }}
                onLoadEnd={() => {
                  console.log(
                    `⏱️ EPUB [${Date.now() - epubOpenStartedAtRef.current}ms] WebView loadEnd`,
                    epubLoadKey,
                  );
                }}
                onRenderProcessGone={(event) => {
                  console.warn("❌ EPUB WebView 렌더 프로세스 종료:", event.nativeEvent);
                  webViewRef.current?.reload();
                }}
                onContentProcessDidTerminate={() => {
                  console.warn("❌ EPUB WebView 콘텐츠 프로세스 종료");
                  webViewRef.current?.reload();
                }}
                onTouchStart={(e) => {
                  epubTouchStartRef.current = {
                    x: e.nativeEvent.pageX,
                    y: e.nativeEvent.pageY,
                    time: Date.now(),
                    active: true,
                    didScroll: false,
                  };
                  epubTouchMaxMoveRef.current = 0;
                }}
                onTouchMove={(e) => {
                  const start = epubTouchStartRef.current;
                  const dx = e.nativeEvent.pageX - start.x;
                  const dy = e.nativeEvent.pageY - start.y;
                  epubTouchMaxMoveRef.current = Math.max(
                    epubTouchMaxMoveRef.current,
                    Math.sqrt(dx * dx + dy * dy)
                  );
                  if (epubTouchMaxMoveRef.current > 8) {
                    start.didScroll = true;
                  }
                }}
                onScroll={() => {
                  if (epubTouchStartRef.current.active) {
                    epubTouchStartRef.current.didScroll = true;
                  }
                }}
                onTouchEnd={(e) => {
                  const start = epubTouchStartRef.current;
                  const dx = e.nativeEvent.pageX - start.x;
                  const dy = e.nativeEvent.pageY - start.y;
                  const dt = Date.now() - start.time;
                  const isVerticalSwipe =
                    dt <= 1400 &&
                    Math.abs(dy) >= 96 &&
                    Math.abs(dx) < Math.abs(dy) * 0.75;

                  if (isVerticalSwipe) {
                    webViewRef.current?.postMessage(JSON.stringify({
                      type: "tryBoundaryTransition",
                      direction: dy > 0 ? "prev" : "next",
                    }));
                  } else if (
                    !start.didScroll &&
                    dt >= 40 &&
                    dt <= 350 &&
                    epubTouchMaxMoveRef.current <= 8 &&
                    Math.abs(dx) <= 8 &&
                    Math.abs(dy) <= 8
                  ) {
                    // 높이가 0인 이미지 XHTML 등은 iframe 내부 touch 이벤트가 오지 않을 수 있다.
                    // 내부 이벤트가 먼저 처리됐는지 잠시 기다린 뒤 RN에서 한 번만 보완한다.
                    const touchStartedAt = start.time;
                    setTimeout(() => {
                      if (lastEpubWebToggleAtRef.current < touchStartedAt) {
                        lastEpubWebToggleAtRef.current = Date.now();
                        setShowUI((prev) => !prev);
                        console.log("📑 [RN WebView fallback] tap - UI toggle");
                      }
                    }, 120);
                  }
                  start.active = false;
                }}
                onTouchCancel={() => {
                  epubTouchStartRef.current.active = false;
                  epubTouchStartRef.current.didScroll = true;
                }}
                onError={(syntheticEvent) => {
                  const { nativeEvent } = syntheticEvent;
                  console.warn('WebView error: ', nativeEvent);
                  setEpubError("WebView 로딩 실패");
                }}
              />
              {epubAtFirstSection && !epubRestoring && (
                <View
                  style={StyleSheet.absoluteFill}
                  onTouchStart={(e) => {
                    firstSectionTouchRef.current = {
                      x: e.nativeEvent.pageX,
                      y: e.nativeEvent.pageY,
                      time: Date.now(),
                      maxMove: 0,
                      active: true,
                      didScroll: false,
                    };
                  }}
                  onTouchMove={(e) => {
                    const touch = firstSectionTouchRef.current;
                    const dx = e.nativeEvent.pageX - touch.x;
                    const dy = e.nativeEvent.pageY - touch.y;
                    touch.maxMove = Math.max(touch.maxMove, Math.sqrt(dx * dx + dy * dy));
                    if (touch.maxMove > 8) touch.didScroll = true;
                  }}
                  onTouchEnd={(e) => {
                    const touch = firstSectionTouchRef.current;
                    const dx = e.nativeEvent.pageX - touch.x;
                    const dy = e.nativeEvent.pageY - touch.y;
                    const dt = Date.now() - touch.time;
                    const isVerticalSwipe =
                      dt <= 1400 &&
                      Math.abs(dy) >= 88 &&
                      Math.abs(dx) < Math.abs(dy) * 0.8;

                    if (isVerticalSwipe) {
                      console.log("📑 [RN first section] swipe:", dy > 0 ? "prev" : "next");
                      webViewRef.current?.postMessage(JSON.stringify({
                        type: "tryBoundaryTransition",
                        direction: dy > 0 ? "prev" : "next",
                      }));
                    } else if (
                      !touch.didScroll &&
                      dt >= 40 &&
                      dt <= 350 &&
                      Math.abs(dx) <= 8 &&
                      Math.abs(dy) <= 8 &&
                      touch.maxMove <= 8
                    ) {
                      console.log("📑 [RN first section] tap - UI toggle");
                      lastEpubWebToggleAtRef.current = Date.now();
                      setShowUI((prev) => !prev);
                    }
                    touch.active = false;
                  }}
                  onTouchCancel={() => {
                    firstSectionTouchRef.current.active = false;
                    firstSectionTouchRef.current.didScroll = true;
                  }}
                />
              )}
              {/* CFI 복원 중 로딩 오버레이: 스크롤 계산이 끝날 때까지 WebView를 가림 */}
              {epubRestoring && (
                <View style={styles.restoreOverlay}>
                  <ActivityIndicator size="large" color="#b84a8c" />
                  <Text style={styles.restoreOverlayText}>이어읽기 위치 불러오는 중...</Text>
                </View>
              )}
              </>
            ) : (
              <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>EPUB 파일을 읽는 중...</Text>
              </View>
            )}
          </View>
        </>
      ) : (
        /* TXT: 스크롤 + UI 토글 */
        <>
          <View style={[styles.readerArea, { paddingTop: readerTopInset }]}>
            {txtLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#b84a8c" />
                <Text style={styles.loadingText}>파일을 읽는 중...</Text>
              </View>
            ) : txtError ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>⚠️ {txtError}</Text>
                <TouchableOpacity style={styles.errorBackBtn} onPress={() => void exitReader()}>
                  <Text style={styles.errorBackBtnText}>← 돌아가기</Text>
                </TouchableOpacity>
              </View>
            ) : (
            txtReaderList
            )}
          </View>
        </>
      )}

      {/* 하단 바 (페이지/진행도/슬라이더) */}
      {showUI && (
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.pageRow}>
            <Text style={styles.pageText}>
              {isEpub && epubNavigationError
                ? "이동 위치 계산 실패"
                : isEpub && !epubNavigationReady
                  ? "이동 위치 계산 중"
                  : `${currentPage} / ${totalPages}`}
            </Text>
            <TouchableOpacity style={styles.settingsBtn} onPress={() => setShowSettings(true)}>
              <Text style={[styles.pageText, { fontSize: 16, fontWeight: "700" }]}>Aa</Text>
            </TouchableOpacity>
            {isEpub && !epubNavigationReady && !epubNavigationError ? (
              <ActivityIndicator size="small" color="#b84a8c" />
            ) : isEpub && epubNavigationError ? (
              <Text style={styles.navigationErrorText}>!</Text>
            ) : (
              <Text style={styles.pageText}>{Math.round((sliderPreviewValue ?? progress) * 100)}%</Text>
            )}
          </View>

          <Slider
            style={{ width: "100%", opacity: isEpub && !epubNavigationReady ? 0.35 : 1 }}
            minimumValue={0}
            maximumValue={1}
            value={sliderPreviewValue ?? progress}
            disabled={isEpub && !epubNavigationReady}
            minimumTrackTintColor="#b84a8c"
            maximumTrackTintColor="#ddd"
            thumbTintColor="#b84a8c"
            onSlidingStart={handleSliderStart}
            onValueChange={scheduleSliderSeek}
            onSlidingComplete={handleSliderComplete}
          />
        </View>
      )}

      {/* 밝기 오버레이 */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "#000",
          opacity: (1 - settings.brightness) * 0.75,
        }}
      />

      <ReaderSearchModal
        visible={showSearch}
        query={searchQuery}
        results={searchResults}
        loading={searchLoading}
        limited={searchLimited}
        error={searchError}
        onQueryChange={setSearchQuery}
        onSelect={handleSearchResultSelect}
        onClose={cancelReaderSearch}
      />

      {/* 보기 설정 패널 */}
      {showSettings && (
        <>
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 199 }}
            onPress={() => setShowSettings(false)}
          />
          <View style={[styles.settingsPanel, { paddingBottom: Math.max(insets.bottom + 16, 36) }]}>
            {/* 헤더 */}
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>보기 설정</Text>
              <TouchableOpacity onPress={() => setShowSettings(false)}>
                <Text style={styles.settingsClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* 글자 크기 */}
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>글자 크기</Text>
              <View style={styles.fontSizeRow}>
                <TouchableOpacity
                  style={styles.fontSizeBtn}
                  onPress={() => setSettings(s => ({ ...s, fontSize: Math.max(12, s.fontSize - 2) }))}
                >
                  <Text style={styles.fontSizeBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.fontSizeValue}>{settings.fontSize}px</Text>
                <TouchableOpacity
                  style={styles.fontSizeBtn}
                  onPress={() => setSettings(s => ({ ...s, fontSize: Math.min(36, s.fontSize + 2) }))}
                >
                  <Text style={styles.fontSizeBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 배경색 */}
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>배경색</Text>
              <View style={styles.bgRow}>
                {BG_PRESETS.map((p) => (
                  <TouchableOpacity
                    key={p.label}
                    style={[
                      styles.bgSwatch,
                      { backgroundColor: p.bg },
                      settings.bgColor === p.bg && styles.bgSwatchActive,
                    ]}
                    onPress={() => setSettings(s => ({ ...s, bgColor: p.bg, textColor: p.text }))}
                  >
                    <Text style={[styles.bgSwatchLabel, { color: p.text }]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 글씨체 */}
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>글씨체</Text>
              <View style={styles.fontRow}>
                {FONT_PRESETS.map((f) => (
                  <TouchableOpacity
                    key={f.value}
                    style={[
                      styles.fontBtn,
                      !settings.usePublisherFont
                        && settings.fontFamily === f.value
                        && styles.fontBtnActive,
                    ]}
                    onPress={() => setSettings(s => ({
                      ...s,
                      fontFamily: f.value,
                      usePublisherFont: false,
                    }))}
                  >
                    <Text style={[
                      styles.fontBtnText,
                      !settings.usePublisherFont
                        && settings.fontFamily === f.value
                        && styles.fontBtnTextActive,
                      f.value !== "default" && { fontFamily: f.value },
                    ]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {isEpub && (
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>출판사 글꼴</Text>
                <View style={styles.publisherFontControl}>
                  <Switch
                    value={settings.usePublisherFont}
                    onValueChange={(value) => setSettings((current) => ({
                      ...current,
                      usePublisherFont: value,
                    }))}
                    trackColor={{ false: "#d7d7d7", true: "#d98ab8" }}
                    thumbColor={settings.usePublisherFont ? "#b84a8c" : "#f4f4f4"}
                  />
                </View>
              </View>
            )}

            {/* 줄 간격 */}
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>줄 간격</Text>
              <View style={styles.fontSizeRow}>
                <TouchableOpacity
                  style={styles.fontSizeBtn}
                  onPress={() => setSettings(s => ({ ...s, lineSpacing: parseFloat(Math.max(1.2, s.lineSpacing - 0.1).toFixed(1)) }))}
                >
                  <Text style={styles.fontSizeBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.fontSizeValue}>{settings.lineSpacing.toFixed(1)}x</Text>
                <TouchableOpacity
                  style={styles.fontSizeBtn}
                  onPress={() => setSettings(s => ({ ...s, lineSpacing: parseFloat(Math.min(2.5, s.lineSpacing + 0.1).toFixed(1)) }))}
                >
                  <Text style={styles.fontSizeBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 좌우 여백 */}
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>좌우 여백</Text>
              <View style={styles.fontSizeRow}>
                <TouchableOpacity
                  style={styles.fontSizeBtn}
                  onPress={() => setSettings(s => ({ ...s, sidePadding: Math.max(8, s.sidePadding - 4) }))}
                >
                  <Text style={styles.fontSizeBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.fontSizeValue}>{settings.sidePadding}px</Text>
                <TouchableOpacity
                  style={styles.fontSizeBtn}
                  onPress={() => setSettings(s => ({ ...s, sidePadding: Math.min(60, s.sidePadding + 4) }))}
                >
                  <Text style={styles.fontSizeBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 밝기 */}
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>밝기</Text>
              <View style={{ flex: 1 }}>
                <Slider
                  style={{ width: "100%", height: 36 }}
                  minimumValue={0.2}
                  maximumValue={1.0}
                  value={settings.brightness}
                  minimumTrackTintColor="#b84a8c"
                  maximumTrackTintColor="#ddd"
                  thumbTintColor="#b84a8c"
                  onValueChange={(v) => setSettings(s => ({ ...s, brightness: v }))}
                />
              </View>
            </View>

            {/* 초기화 */}
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => setSettings(DEFAULT_SETTINGS)}
            >
              <Text style={styles.resetBtnText}>기본값으로 초기화</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f5f0e6", // 종이 느낌
  },
  readerArea: {
    flex: 1,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    zIndex: 10,
  },
  back: {
    color: "#fff",
    fontSize: 22,
    marginRight: 12,
  },
  errorFullScreen: {
    flex: 1,
    backgroundColor: "#f5f0e6",
  },
  errorBackTop: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorBody: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  errorBigEmoji: {
    fontSize: 56,
    marginBottom: 20,
  },
  title: {
    flex: 1,
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  topBarIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: -8,
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  pageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  pageText: {
    color: "#fff",
    fontSize: 14,
  },
  navigationErrorText: {
    color: "#ffb4b4",
    fontSize: 18,
    fontWeight: "700",
  },
  text: {
    fontSize: 18,
    lineHeight: 28,
    color: "#333",
  },
  searchHighlight: {
    color: "#1b1b1b",
    backgroundColor: "#f6d878",
    fontWeight: "700",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#f5f0e6",
  },
  errorText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#d32f2f",
    marginBottom: 8,
    textAlign: "center",
  },
  errorHint: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  errorBackBtn: {
    marginTop: 20,
    backgroundColor: "#b84a8c",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
  },
  errorBackBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f0e6",
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
    marginTop: 16,
  },
  settingsBtn: {
    padding: 4,
  },
  settingsPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 36,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 24,
    zIndex: 200,
  },
  settingsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  settingsTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111",
  },
  settingsClose: {
    fontSize: 18,
    color: "#888",
    padding: 4,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 22,
  },
  settingsLabel: {
    width: 68,
    fontSize: 14,
    fontWeight: "600",
    color: "#444",
  },
  fontSizeRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  fontSizeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 16,
  },
  fontSizeBtnText: {
    fontSize: 24,
    color: "#333",
    lineHeight: 28,
  },
  fontSizeValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    minWidth: 52,
    textAlign: "center",
  },
  bgRow: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  bgSwatch: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
    marginRight: 8,
    marginBottom: 4,
  },
  bgSwatchActive: {
    borderColor: "#b84a8c",
  },
  bgSwatchLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  fontRow: {
    flex: 1,
    flexDirection: "row",
  },
  fontBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#e0e0e0",
    backgroundColor: "#f8f8f8",
    marginRight: 10,
  },
  fontBtnActive: {
    borderColor: "#b84a8c",
    backgroundColor: "#fdf0f7",
  },
  fontBtnText: {
    fontSize: 14,
    color: "#555",
  },
  fontBtnTextActive: {
    color: "#b84a8c",
    fontWeight: "700",
  },
  publisherFontControl: {
    flex: 1,
    alignItems: "flex-end",
  },
  resetBtn: {
    marginTop: 4,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e0e0e0",
    alignItems: "center",
  },
  resetBtnText: {
    fontSize: 14,
    color: "#999",
    fontWeight: "600",
  },
  restoreOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#f5f0e6",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 50,
  },
  restoreOverlayText: {
    marginTop: 16,
    fontSize: 15,
    color: "#888",
  },
});
