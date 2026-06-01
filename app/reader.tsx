// app/reader.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import { Buffer } from 'buffer';
import * as FileSystem from "expo-file-system/legacy";
import * as NavigationBar from "expo-navigation-bar";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import iconv from 'iconv-lite';
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { BASE_URL } from "../utils/api";

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
  brightness: number;
  lineSpacing: number;   // 줄 간격 배수 (1.2 ~ 2.5)
  sidePadding: number;  // 좌우 여백 px (8 ~ 60)
}

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  bgColor: "#f5f0e6",
  textColor: "#333333",
  fontFamily: "default",
  brightness: 1.0,
  lineSpacing: 1.9,
  sidePadding: 24,
};

const BG_PRESETS = [
  { label: "종이", bg: "#f5f0e6", text: "#000000" },
  { label: "흰색", bg: "#ffffff", text: "#000000" },
  { label: "회색", bg: "#e8e8e8", text: "#000000" },
  { label: "다크", bg: "#1c1c1e", text: "#e5e5e7" },
  { label: "초록", bg: "#c3dda8", text: "#000000" }, // #dde9cc : 연한 아라그린, #c3dda8 : 아라그린
];

const FONT_PRESETS = [
  { label: "기본", value: "default" },
  { label: "명조", value: "Georgia" },
];

export default function ReaderScreen() {
  const router = useRouter();
  const { fileId, uri, name, type, resetProgress } = useLocalSearchParams();
  const insets = useSafeAreaInsets();

  const [isEpub, setIsEpub] = useState(false);
  const [content, setContent] = useState<string[]>([]); // txt 문단 배열
  const [txtLoading, setTxtLoading] = useState(false); // txt 로딩 중
  const [txtError, setTxtError] = useState<string | null>(null); // txt 에러
  const [showUI, setShowUI] = useState(true);

  // 공통 진행도 상태 (0~1)
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // 터치 vs 드래그 구분용
  const touchStartPos = useRef({ x: 0, y: 0 });
  const isTouchMove = useRef(false);

  // txt 전용 스크롤 정보
  const scrollRef = useRef<ScrollView>(null);
  const [contentHeight, setContentHeight] = useState(1);
  const [viewHeight, setViewHeight] = useState(1);
  const contentHeightRef = useRef(1); // setTimeout 내부에서 최신값 읽기용
  const viewHeightRef = useRef(1);
  const hasResumedRef = useRef(false); // TXT 이어읽기 한 번만 실행
  const contentRef = useRef<string[]>([]); // 현재 렌더링 중인 문단 배열 (저장 시 preview 생성용)
  const rawTextRef = useRef<string>(""); // 전체 원문 (progress 비율로 preview 추출용)
  const currentReadingPreviewRef = useRef<string>(""); // 현재 화면에 보이는 텍스트
  const lastProgressUpdateAtRef = useRef<number>(0); // 마지막 progress 메시지 수신 시간 (최신 preview 타이밍 추적용)

  // epub 전용 base64 데이터
  const [epubBase64, setEpubBase64] = useState("");
  const webViewRef = useRef<WebView>(null);
  const [lastCfi, setLastCfi] = useState<string | null>(null);     // 마지막 위치
  const lastAnchorRatioRef = useRef<number>(0.5); // 저장 당시 CFI의 화면 내 위치 비율 (re-render 불필요)
  const [initialCfi, setInitialCfi] = useState<string | null>(null); // 서버에서 받은 CFI
  const [fileInfoLoaded, setFileInfoLoaded] = useState(false); // 서버 파일 정보 로딩 완료 여부
  const [epubReady, setEpubReady] = useState(false);               // WebView 준비 여부
  const [epubRestoring, setEpubRestoring] = useState(false);       // CFI 복원 스크롤 계산 중 (로딩 오버레이)
  const [epubError, setEpubError] = useState<string | null>(null); // EPUB 로딩 에러
  const lastWebPercentRef = useRef<number | null>(null);
  const lastWebLogAtRef = useRef<number>(0);

  // ===== 리더 설정 =====
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);

  // 설정 불러오기
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then((val) => {
      if (val) {
        try { setSettings(JSON.parse(val)); } catch {}
      }
    });
  }, []);

  // 설정 저장
  useEffect(() => {
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // 읽는 중 설정 변경 → "theme" 메시지 전송 (display 이후에만)
  useEffect(() => {
    if (!isEpub || !epubReady || !epubStartedRef.current || !webViewRef.current) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: "theme",
      bgColor: settings.bgColor,
      textColor: settings.textColor,
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      lineSpacing: settings.lineSpacing,
      sidePadding: settings.sidePadding,
    }));
  }, [settings]);


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

    const read = async () => {
      try {
        const decoded = decodeURI(uri as string);
        console.log("📖 파일 읽기 시작:", fileName, "→", decoded);

        // readAsStringAsync 시도 후 ENOENT면 documentDirectory로 폴백
        const readWithFallback = async (path: string, opts: any): Promise<string> => {
          try {
            return await FileSystem.readAsStringAsync(path, opts);
          } catch (e) {
            const msg = String(e);
            if (msg.includes('ENOENT') || msg.includes('FileNotFoundException')) {
              const fileNameOnly = path.split('/').pop() || '';
              const fallback = (FileSystem.documentDirectory ?? '') + fileNameOnly;
              console.log("⚠️ 폴백 시도:", fallback);
              return await FileSystem.readAsStringAsync(fallback, opts);
            }
            throw e;
          }
        };

        if (isEpubFile) {
          // EPUB → base64로 읽기
          try {
            const b64 = await readWithFallback(decoded, {
              encoding: FileSystem.EncodingType.Base64,
            });
            console.log("✅ EPUB base64 로드 완료, 길이:", b64.length);
            
            if (!b64 || b64.length === 0) {
              console.error("❌ base64가 비어있습니다");
              setEpubError("파일을 읽을 수 없습니다");
              return;
            }
            setEpubBase64(b64);
          } catch (epubError) {
            console.log('❌ EPUB 읽기 실패:', epubError);
            setEpubError("EPUB 파일을 읽을 수 없습니다");
          }
        } else {
          // TXT 파일
          console.log("text 파일 읽기");
          setTxtLoading(true);
          const base64 = await readWithFallback(decoded, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const buffer = Buffer.from(base64, 'base64');
          const text = decodeTextSafe(buffer);
          rawTextRef.current = text; // progress 비율로 preview 추출용
          // 빈 줄 기준 문단 분리 → FlatList 가상화로 빠른 렌더링
          const paragraphs = text
            .split(/\n{2,}/)
            .map((p: string) => p.replace(/\r/g, '').trim())
            .filter((p: string) => p.length > 0);
          setContent(paragraphs.length > 0 ? paragraphs : [text]);
          contentRef.current = paragraphs.length > 0 ? paragraphs : [text];
          setTxtLoading(false);
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
  }, [uri, name]);

  // 서버에서 불러온 초기 progress (이어읽기 시작점)
  const [initialProgress, setInitialProgress] = useState<number>(0);
  const initialProgressRef = useRef<number>(0); // saveProgressToServer에서 사용

  useEffect(() => {
  const load = async () => {
    try {
      console.log("🔍 서버에서 파일 정보 불러오는 중...", fileId);
      const res = await fetch(`${BASE_URL}/files/${fileId}`);
      const fileInfo = await res.json();
      console.log("📚 서버에서 받은 데이터:", fileInfo);

      if (fileInfo.progress > 0) {
        console.log("✅ 저장된 progress 발견:", fileInfo.progress);
        setProgress(fileInfo.progress);
        setInitialProgress(fileInfo.progress);
        initialProgressRef.current = fileInfo.progress;
      } else {
        console.log("⚠️ 저장된 progress 없음");
      }

      // ⭐ EPUB 이어 읽기: 저장된 CFI 있으면 기억 (문자열인지 반드시 확인)
      if (fileInfo.epubCfi && typeof fileInfo.epubCfi === 'string') {
        setInitialCfi(fileInfo.epubCfi);
        console.log("✅ [복원] 서버 CFI 로드:", fileInfo.epubCfi.slice(0, 80), "| progress:", fileInfo.progress);
      } else if (fileInfo.epubCfi) {
        console.log("⚠️ CFI가 문자열이 아님, 무시:", typeof fileInfo.epubCfi);
      } else {
        console.log("⚠️ [복원] 서버에 저장된 CFI 없음 - 처음부터 시작");
      }

      // ⭐ anchorRatio 복원: 저장 당시 CFI의 화면 내 위치 비율
      if (typeof fileInfo.anchorRatio === 'number' && fileInfo.anchorRatio > 0) {
        lastAnchorRatioRef.current = fileInfo.anchorRatio;
        console.log("✅ [복원] 서버 anchorRatio 로드:", fileInfo.anchorRatio);
      }
      setFileInfoLoaded(true); // 서버 응답 완료
    } catch (e) {
      console.log("진행도 불러오기 실패:", e);
      setFileInfoLoaded(true); // 실패해도 EPUB 시작은 해야 함
    }
  };

  load();
}, [fileId, BASE_URL]);

// TXT 컨텐츠 렌더링이 끝나고 높이가 계산된 뒤, 저장된 progress대로 스크롤 이동 (한 번만)
useEffect(() => {
  // EPUB이거나 이미 이어읽기 실행했으면 패스
  if (isEpub) return;
  if (hasResumedRef.current) return;
  // 처음부터 읽기 선택 시 이어읽기 스킵
  if (resetProgress === "true") return;

  // 아직 ref 없거나 높이 없으면 패스
  if (!scrollRef.current) return;
  if (contentHeight <= 0 || viewHeight <= 0) return;

  // initialProgressRef에 저장된 값 사용 (서버에서 받은 원본)
  const savedProgress = initialProgress;
  if (!savedProgress || savedProgress <= 0) return;

  const maxScroll = contentHeight - viewHeight;
  if (maxScroll <= 0) return;

  // 이미 여기서 flag → 중복 실행 방지
  hasResumedRef.current = true;

  // FlatList가 아이템을 완전히 렌더링한 후 스크롤하도록 딜레이
  // setTimeout 내부에서 ref(최신값)를 읽어야 정확한 위치로 이동
  setTimeout(() => {
    const latestMaxScroll = contentHeightRef.current - viewHeightRef.current;
    if (latestMaxScroll <= 0) return;
    const scrollY = latestMaxScroll * savedProgress;
    console.log("📚 TXT 이어읽기 실행! progress:", savedProgress, "scrollY:", scrollY, "maxScroll:", latestMaxScroll);
    (scrollRef.current as any)?.scrollToOffset({
      offset: scrollY,
      animated: false,
    });
    // scrollToOffset 후 onScroll이 발사 안 될 수 있으므로 preview 강제 갱신
    // rawText에서 progress 비율 위치의 텍스트 직접 추출
    const raw = rawTextRef.current;
    if (raw.length > 0) {
      const pos = Math.floor(savedProgress * raw.length);
      const start = Math.max(0, pos - 50);
      const end = Math.min(raw.length, pos + 200);
      const snippet = raw.slice(start, end).replace(/\s+/g, ' ').trim();
      if (snippet) {
        currentReadingPreviewRef.current = snippet;
        console.log("📖 이어읽기 preview 갱신:", snippet.slice(0, 50));
      }
    }
  }, 600);
}, [contentHeight, viewHeight, isEpub, resetProgress, initialProgress]);

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
    if (!isEpub || !epubReady || !fileInfoLoaded || !webViewRef.current) return;
    const cfiToUse = resetProgress === "true" ? null : (initialCfi || null);

    // 이미 시작했고 같은 CFI로 시작했다면 스킵
    if (epubStartedRef.current && epubStartedCfiRef.current === cfiToUse) return;

    // 이미 CFI로 시작한 상태면 재전송 불필요
    if (epubStartedRef.current && epubStartedCfiRef.current && cfiToUse) return;

    epubStartedRef.current = true;
    epubStartedCfiRef.current = cfiToUse;
    // CFI가 있으면 복원 중 오버레이 표시
    if (cfiToUse) setEpubRestoring(true);
    console.log("📤 themeAndStart 전송 - CFI:", cfiToUse, "/ initialCfi:", initialCfi, "/ resetProgress:", resetProgress, "/ anchorRatio:", lastAnchorRatioRef.current);
    webViewRef.current.postMessage(JSON.stringify({
      type: "themeAndStart",
      bgColor: settings.bgColor,
      textColor: settings.textColor,
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      lineSpacing: settings.lineSpacing,
      sidePadding: settings.sidePadding,
      cfi: resetProgress === "true" ? null : (initialCfi || null),
      anchorRatio: resetProgress === "true" ? 0.5 : (lastAnchorRatioRef.current || 0.5),
    }));
  }, [isEpub, epubReady, fileInfoLoaded, initialCfi, resetProgress]);


  // ===================== TXT 쪽 진행도 계산 =====================
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = e.nativeEvent.contentOffset.y;
    const maxScroll = Math.max(contentHeight - viewHeight, 1);
    // offsetY=0이고 아직 이어읽기 복원 전이면 preview 갱신 스킵 (초기 렌더 onScroll 방지)
    const skipPreview = offsetY < 5 && !hasResumedRef.current;

    const ratio = offsetY / maxScroll;
    const clamped = Math.min(1, Math.max(0, ratio));

    setProgress(clamped);

    const pages = Math.max(1, Math.round(contentHeight / viewHeight));
    setTotalPages(pages);
    setCurrentPage(Math.max(1, Math.round(clamped * pages)));

    // readingPreview: rawText에서 progress 비율 위치의 텍스트 직접 추출
    if (!skipPreview) {
      const raw = rawTextRef.current;
      if (raw.length > 0) {
        const pos = Math.floor(clamped * raw.length);
        const start = Math.max(0, pos - 50);
        const end = Math.min(raw.length, pos + 200);
        const snippet = raw.slice(start, end).replace(/\s+/g, ' ').trim();
        if (snippet) currentReadingPreviewRef.current = snippet;
      }
    }
  };

  // txt 슬라이더로 위치 이동
  const handleSeekText = (value: number) => {
    if (!scrollRef.current) return;
    const maxScroll = Math.max(contentHeight - viewHeight, 0);
    const offset = maxScroll * value;
    (scrollRef.current as any).scrollToOffset?.({ offset, animated: false });
  };

  // ===================== Slider 공통 핸들러 =====================
  // txt면 스크롤, epub이면 WebView에 "seek" 메시지 전송
  const handleSliderComplete = (value: number) => {
    if (isEpub) {
      webViewRef.current?.postMessage(
        JSON.stringify({ type: "seek", percent: value })
      );
    } else {
      handleSeekText(value);
    }
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
        const nextPercent = (percent || 0);
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

        setCurrentPage(current || 1);
        setTotalPages(total || 1);
        setProgress(nextPercent / 100);

        if (cfi) {
          console.log("💾 [RN] CFI 저장:", cfi.slice(0, 80), "| pct:", nextPercent.toFixed(1), "| anchor:", anchorRatio);
          setLastCfi(cfi);
          if (typeof anchorRatio === 'number') lastAnchorRatioRef.current = anchorRatio;
        }
        if (visibleText) {
          currentReadingPreviewRef.current = visibleText;
          lastProgressUpdateAtRef.current = Date.now(); // 최신 preview 도착 시간 기록
        }
      } else if (data.type === "restored") {
        // 복원 스크롤 완료 → 로딩 오버레이 제거
        console.log("✅ EPUB 복원 완료 - 오버레이 제거");
        setEpubRestoring(false);
      } else if (data.type === "ready") {
        // EPUB 쪽 준비 완료
        console.log("✅ EPUB 준비 완료");
        setEpubReady(true);
        setEpubError(null);
      } else if (data.type === "toggleUI") {
        // WebView 탭 → UI 토글
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
  const epubHtml = `
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
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
          
          var loadingEl = document.getElementById('loading');
          var errorEl = document.getElementById('error');
          var viewerEl = document.getElementById('viewer');
          var chapterIndicatorEl = document.getElementById('chapter-indicator');

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

            // base64를 ArrayBuffer로 변환
            var base64Data = "${epubBase64}";
            if (!base64Data || base64Data.length === 0) {
              showError("EPUB 데이터가 비어있습니다");
              return;
            }

            sendLog("📦 base64 디코딩 시작, 길이: " + base64Data.length);
            var binaryString = window.atob(base64Data);
            var bytes = new Uint8Array(binaryString.length);
            for (var i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            
            sendLog("📚 EPUB 초기화 중...");
            // ArrayBuffer로 EPUB 초기화
            var book = ePub(bytes.buffer);
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
            
            sendLog("✅ EPUB 렌더링 설정 완료");

            // 테마 상태
            var currentTheme = {
              bgColor: '#f5f0e6', textColor: '#333333', fontSize: 18,
              lineSpacing: 1.9, sidePadding: 24, fontFamily: 'default'
            };
            var loadedContents = [];

            function buildThemeCss(t) {
              var ff = (t.fontFamily && t.fontFamily !== 'default')
                ? t.fontFamily + ', sans-serif'
                : '-apple-system, BlinkMacSystemFont, sans-serif';
              return 'html{background:' + t.bgColor + '!important;margin:0!important;padding:0!important;width:100%!important}' +
                'body{background:' + t.bgColor + '!important;color:' + t.textColor + '!important;' +
                'font-size:' + t.fontSize + 'px!important;line-height:' + t.lineSpacing + '!important;' +
                'padding-left:' + t.sidePadding + 'px!important;padding-right:' + t.sidePadding + 'px!important;' +
                'margin:0!important;box-sizing:border-box!important;width:100%!important;' +
                'word-break:keep-all!important;overflow-wrap:break-word!important;' +
                'text-align:left!important;' +
                'font-family:' + ff + '!important}' +
                'p{line-height:' + t.lineSpacing + '!important;margin-left:0!important;margin-right:0!important;word-break:keep-all!important;text-align:left!important}';
            }

            function injectTheme(contents) {
              try {
                if (!contents || !contents.document || !contents.document.head) return;
                var doc = contents.document;
                var el = doc.getElementById('__rdr_theme__');
                var css = buildThemeCss(currentTheme);
                if (el) { el.textContent = css; }
                else {
                  var s = doc.createElement('style');
                  s.id = '__rdr_theme__'; s.textContent = css;
                  doc.head.appendChild(s);
                }
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

                // ── Pull-to-chapter 상태 ──
                var pullDir = null;
                var pullStartY = 0;
                var pullDist = 0;
                var pullTriggered = false;
                var PULL_TH = 200; // px ← 이 값을 크게 할수록 더 많이 당겨야 챕터 전환됨

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

                doc.addEventListener("touchstart", function(e) {
                  tapStartX = e.touches[0].clientX;
                  tapStartY = e.touches[0].clientY;
                  tapStartTime = Date.now();
                  pullDir = null;
                  pullDist = 0;
                  pullTriggered = false;
                  pullStartY = e.touches[0].clientY;
                  try { window.parent.hidePullIndicator(); } catch(_) {}

                  // touchstart 시 스크롤 상태 진단 로그
                  var si = findScrollInfo();
                  log('🔍TOUCH_START src=' + si.src + ' scrollTop=' + Math.round(si.scrollTop) + ' scrollH=' + Math.round(si.scrollH) + ' clientH=' + Math.round(si.clientH));
                }, { passive: true });

                doc.addEventListener("touchmove", function(e) {
                  if (pullTriggered) return;
                  try {
                    if (window.parent.isAutoTransition || window.parent.isSeeking || window.parent.isChapterLoading) return;
                  } catch(_) { return; }

                  var currentY = e.touches[0].clientY;
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
                    } else if (atBottom && dy < -12) {
                      pullDir = 'next';
                      pullStartY = currentY;
                      pullDist = 0;
                      log('🔍PULL ▶ START NEXT');
                    }
                    return;
                  }

                  // 경계를 벗어나면 취소
                  if ((pullDir === 'prev' && !atTop) || (pullDir === 'next' && !atBottom)) {
                    log('🔍PULL ▶ CANCEL (left boundary)');
                    pullDir = null; pullDist = 0;
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

                  // pull 중 native 스크롤/bounce 방지
                  try { e.preventDefault(); } catch(_) {}

                  if (pullDist >= PULL_TH) {
                    pullTriggered = true;
                    log('🔍PULL ▶ TRIGGER ' + pullDir + ' dist=' + Math.round(pullDist));
                    try { window.parent.triggerAutoTransition(pullDir === 'prev'); } catch(_) {}
                  }
                }, { passive: false }); // passive:false 필수 (preventDefault 사용)

                doc.addEventListener("touchend", function(e) {
                  var dx = Math.abs(e.changedTouches[0].clientX - tapStartX);
                  var dy = Math.abs(e.changedTouches[0].clientY - tapStartY);
                  var dt = Date.now() - tapStartTime;
                  if (dx < 10 && dy < 10 && dt < 300) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "toggleUI" }));
                  }
                  if (!pullTriggered) {
                    try { window.parent.hidePullIndicator(); } catch(_) {}
                  }
                  pullDir = null; pullDist = 0; pullTriggered = false;
                }, { passive: true });

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

                // 중앙 좌표의 정확한 문자 주변 미리보기 생성
                try {
                  var sc = pickedRange.startContainer;
                  var so = pickedRange.startOffset || 0;
                  var snippet = '';
                  if (sc && sc.nodeType === 3 && sc.textContent) {
                    var txt = sc.textContent;
                    var s = Math.max(0, so - 70);
                    var e = Math.min(txt.length, so + 130);
                    snippet = txt.slice(s, e);
                  } else if (sc && sc.parentElement) {
                    snippet = (sc.parentElement.textContent || '').slice(0, 200);
                  }
                  snippet = String(snippet || '').replace(/\s+/g, ' ').trim().slice(0, 200);
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

            // Pull indicator elements (outer window)
            var pullIndicatorTop = document.getElementById('pull-indicator-top');
            var pullIndicatorBottom = document.getElementById('pull-indicator-bottom');
            var pullBarTop = document.getElementById('pull-bar-top');
            var pullBarBottom = document.getElementById('pull-bar-bottom');
            var pullArrowTop = document.getElementById('pull-arrow-top');
            var pullArrowBottom = document.getElementById('pull-arrow-bottom');
            var PULL_THRESHOLD = 80;

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
                } else {
                  if (pullIndicatorTop) pullIndicatorTop.style.height = '0px';
                  if (pullIndicatorBottom) pullIndicatorBottom.style.height = h + 'px';
                  if (pullBarBottom) pullBarBottom.style.width = pct;
                  if (pullArrowBottom) pullArrowBottom.style.transform = clampedP >= 1 ? 'scale(1.3)' : 'scale(1)';
                }
              } catch(e) {}
            }

            function hidePullIndicator() {
              try {
                if (pullIndicatorTop) pullIndicatorTop.style.height = '0px';
                if (pullIndicatorBottom) pullIndicatorBottom.style.height = '0px';
              } catch(e) {}
            }

            function playSoftTransition(goPrev) {
              try {
                viewerEl.style.transition = 'transform 180ms ease, opacity 180ms ease';
                viewerEl.style.opacity = '0.92';
                viewerEl.style.transform = goPrev ? 'translateY(20px)' : 'translateY(-20px)';
              } catch(e) {}
            }

            function clearSoftTransition() {
              try {
                viewerEl.style.opacity = '1';
                viewerEl.style.transform = 'translateY(0px)';
              } catch(e) {}
            }

            function triggerAutoTransition(goPrev) {
              if (isAutoTransition || isSeeking) return;
              var now = Date.now();
              if (now - lastAutoTransitionAt < 400) return;

              isAutoTransition = true;
              isSeeking = true;
              isChapterLoading = true;
              hidePullIndicator();
              showChapterIndicator(goPrev ? '이전 챕터 불러오는 중…' : '다음 챕터 불러오는 중…');
              playSoftTransition(goPrev);

              setTimeout(function() {
                var p = goPrev ? rendition.prev() : rendition.next();
                Promise.resolve(p).then(function() {
                  setTimeout(function() {
                    clearSoftTransition();
                    hideChapterIndicator();
                    isChapterLoading = false;
                    isSeeking = false;
                    isAutoTransition = false;
                    lastAutoTransitionAt = Date.now();
                    try {
                      var loc = rendition.currentLocation();
                      if (loc) safeReport(loc, false);
                    } catch(e) {}
                  }, 220);
                }).catch(function() {
                  clearSoftTransition();
                  hideChapterIndicator();
                  isChapterLoading = false;
                  isSeeking = false;
                  isAutoTransition = false;
                });
              }, 120);
            }

            var scrollReportTimer = null;
            function onContainerScroll() {
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

                var current = book.locations.locationFromCfi(saveCfi);
                var percent = book.locations.percentageFromCfi(saveCfi) * 100;

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
                  total: totalLocations,
                  percent: percent,
                  cfi: saveCfi,
                  anchorRatio: lastAnchorRatio,
                  visibleText: lastVisibleText
                }));
              } catch(e) {
                sendLog("❌ safeReport error: " + e.message);
              }
            }

            // 빠른 시작: 우선 렌더링 준비를 알리고, locations는 백그라운드에서 생성
            book.ready.then(function () {
              sendLog("📚 book.ready 완료");

              // 준비 완료 알림(빠른 시작)
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "ready"
              }));
              sendLog("📚 빠른 시작 준비 완료, themeAndStart 대기 중...");

              // locations는 백그라운드 생성 (초기 체감 속도 개선)
              loadingEl.querySelector('div:last-child').textContent = '페이지 정보 생성 중...';
              return book.locations.generate(180).then(function() {
                sendLog("📚 locations.generate 완료");
                locationsReady = true;
                totalLocations = book.locations.length();
                loadingEl.style.display = 'none';
              });
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

            // rendered 이벤트: container scroll 리스너 등록
            var containerScrollBound = false;
            var chapterLoadTimer = null;
            rendition.on("rendered", function(section) {
              loadingEl.style.display = 'none';
              // 챕터 로드/전환 중 scroll 이벤트로 인한 잘못된 CFI 보고 방지
              // epub.js가 prepend 후 scrollTop을 내부 조정하는 동안 차단
              isChapterLoading = true;
              clearTimeout(chapterLoadTimer);
              chapterLoadTimer = setTimeout(function() {
                isChapterLoading = false;
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

            // React Native -> WebView 메시지 수신 (window로 수정!)
            window.addEventListener("message", function(e) {
              try {
                var data = JSON.parse(e.data);
                // 저장 직전 최신 CFI 요청
                if (data.type === "getCurrentLocation" && locationsReady) {
                  try {
                    var loc = rendition.currentLocation();
                    if (loc) safeReport(loc);
                  } catch(e) {}
                } else if (data.type === "seek" && locationsReady) {
                  var p = data.percent;
                  if (typeof p !== "number") return;

                  // 0~1 범위로 클램프
                  p = Math.max(0, Math.min(1, p));

                  // percent를 location index로 변환
                  var targetIndex = Math.floor(p * totalLocations);
                  targetIndex = Math.max(0, Math.min(totalLocations - 1, targetIndex));
                  
                  // index를 CFI로 변환해서 이동
                  var cfi = book.locations.cfiFromLocation(targetIndex);
                  if (cfi) {
                    sendLog("🔍 슬라이더 이동: " + Math.round(p * 100) + "% (index: " + targetIndex + ")");
                    isSeeking = true;
                    rendition.display(cfi).then(function() {
                      setTimeout(function() {
                        isSeeking = false;
                        try {
                          var loc = rendition.currentLocation();
                          if (loc) safeReport(loc);
                        } catch(e) {}
                      }, 500);
                    }).catch(function() {
                      isSeeking = false;
                    });
                  }
                } else if (data.type === "themeAndStart") {
                  // 테마 설정 후 display 시작 (훅이 각 챕터에 CSS 주입 → 챕터 이동 정상화)
                  currentTheme = {
                    bgColor: data.bgColor || '#f5f0e6',
                    textColor: data.textColor || '#333333',
                    fontSize: data.fontSize || 18,
                    lineSpacing: data.lineSpacing || 1.9,
                    sidePadding: (data.sidePadding != null) ? data.sidePadding : 24,
                    fontFamily: data.fontFamily || 'default'
                  };
                  document.documentElement.style.background = currentTheme.bgColor;
                  document.body.style.background = currentTheme.bgColor;
                  sendLog("📖 themeAndStart 수신 - CFI=" + (data.cfi || '없음(처음부터)') + " anchorRatio=" + (data.anchorRatio || 0.5));
                  var savedAnchorRatio = (typeof data.anchorRatio === 'number') ? data.anchorRatio : 0.5;
                  if (data.cfi) {
                    var targetCfi = data.cfi;
                    sendLog("➡️ [복원] display(cfi) 호출: " + targetCfi);
                    rendition.display(targetCfi).then(function() {

                      // CFI를 저장 당시의 화면 내 상대 위치(anchorRatio)에 정렬하는 함수
                      // getBoundingClientRect() 기반 → 레이아웃 완료 후에만 정확
                      function scrollCfiToCenter(onDone) {
                        try {
                          var container = rendition.manager && rendition.manager.container;
                          var views = rendition.manager && rendition.manager.visible && rendition.manager.visible();
                          var view = views && views[0];
                          if (!container || !view) { if (onDone) onDone(); return; }

                          // iframe 엘리먼트 찾기
                          var iframeEl = view.element && view.element.querySelector('iframe');
                          if (!iframeEl) { if (onDone) onDone(); return; }
                          var iframeDoc = iframeEl.contentDocument || (iframeEl.contentWindow && iframeEl.contentWindow.document);
                          if (!iframeDoc) { if (onDone) onDone(); return; }

                          // CFI → DOM Range: view.contents.range() 사용 (epub.js 공식 API)
                          var range;
                          try {
                            range = view.contents.range(targetCfi);
                          } catch(rangeErr) {
                            range = null;
                          }
                          if (!range) {
                            sendLog('⚠️ [복원] toRange 반환 null, locationOf 폴백 시도');
                            // 폴백: locationOf 방식
                            var pos = view.contents.locationOf(targetCfi, 'px');
                            var viewOffsetTop = view.element ? view.element.offsetTop : 0;
                            var rawTarget = viewOffsetTop + (pos && pos.top > 0 ? pos.top : 0);
                            var targetScrollTop = Math.max(0, rawTarget - container.clientHeight * savedAnchorRatio);
                            container.scrollTop = targetScrollTop;
                            if (onDone) onDone();
                            return;
                          }

                          // getBoundingClientRect: iframe viewport 기준 좌표
                          var rect = range.getBoundingClientRect();
                          var iframeRect = iframeEl.getBoundingClientRect();
                          var containerRect = container.getBoundingClientRect();

                          // CFI 요소의 outer container 스크롤 공간 기준 절대 y
                          // = 현재 scrollTop + (iframe 뷰포트 내 y) + (iframe가 outer container 내에서의 y)
                          var elementAbsTop = container.scrollTop
                            + (iframeRect.top - containerRect.top)
                            + rect.top;

                          // 저장 당시 anchorRatio 위치에 오도록: scrollTop = elementAbsTop - clientHeight*anchorRatio + rect.height/2
                          // anchorRatio=0.5 → 정중앙, 0.3 → 화면 위쪽 30% 위치
                          var desiredY = container.clientHeight * savedAnchorRatio;
                          var desiredScrollTop = elementAbsTop
                            - desiredY
                            + rect.height / 2;

                          desiredScrollTop = Math.max(0, desiredScrollTop);

                          sendLog('📍 [복원스크롤]'
                            + ' anchor=' + savedAnchorRatio.toFixed(3)
                            + ' desiredY=' + Math.round(desiredY)
                            + ' iframeTop=' + Math.round(iframeRect.top)
                            + ' rect.top=' + Math.round(rect.top)
                            + ' rect.h=' + Math.round(rect.height)
                            + ' scrollBefore=' + Math.round(container.scrollTop)
                            + ' elemAbsTop=' + Math.round(elementAbsTop)
                            + ' → target=' + Math.round(desiredScrollTop));

                          container.scrollTop = desiredScrollTop;

                          if (onDone) onDone();
                        } catch(e) {
                          sendLog('⚠️ [복원스크롤 오류] ' + e.message);
                          if (onDone) onDone();
                        }
                      }

                      // 1차 보정: 2 RAF + 200ms (iframe 레이아웃 + 테마 CSS 안정화)
                      requestAnimationFrame(function() {
                        requestAnimationFrame(function() {
                          setTimeout(function() {
                            scrollCfiToCenter(function() {
                              // 2차 보정: 폰트/이미지 로딩 후 재보정 (300ms 후)
                              setTimeout(function() {
                                scrollCfiToCenter(function() {
                                  // 최종 확인 로그
                                  var container = rendition.manager && rendition.manager.container;
                                  updateCenterText();
                                  var loc2 = rendition.currentLocation();
                                  sendLog('✅ [복원완료]'
                                    + ' scrollTop=' + (container ? Math.round(container.scrollTop) : 'n/a')
                                    + ' cfi=' + (loc2 && loc2.start ? (loc2.start.cfi||'').slice(0,50) : 'n/a')
                                    + ' centerTxt=' + lastVisibleText.slice(0, 50));
                                  if (loc2) safeReport(loc2, false);
                                  // 복원 완료 → RN 로딩 오버레이 제거
                                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'restored' }));
                                });
                              }, 300);
                            });
                          }, 200);
                        });
                      });

                    }).catch(function(err) {
                      sendLog("❌ display(cfi) 실패, 처음부터: " + err.message);
                      rendition.display();
                    });
                  } else {
                    rendition.display().catch(function(err) {
                      sendLog("❌ display() 실패: " + err.message);
                    });
                  }
                } else if (data.type === "theme") {
                  // 읽는 중 설정 변경 → 현재 로드된 모든 섹션에 CSS 직접 주입
                  currentTheme = {
                    bgColor: data.bgColor || currentTheme.bgColor,
                    textColor: data.textColor || currentTheme.textColor,
                    fontSize: data.fontSize || currentTheme.fontSize,
                    lineSpacing: data.lineSpacing || currentTheme.lineSpacing,
                    sidePadding: (data.sidePadding != null) ? data.sidePadding : currentTheme.sidePadding,
                    fontFamily: data.fontFamily || currentTheme.fontFamily
                  };
                  loadedContents = loadedContents.filter(function(c) {
                    return c && c.document && c.document.head;
                  });
                  loadedContents.forEach(function(c) { injectTheme(c); });
                  sendLog("🎨 테마 업데이트: " + currentTheme.bgColor);
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
              if (document.hidden && locationsReady) {
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
  `;

  const title = String(name || "").replace(/\.[^.]+$/, ""); // 확장자 제거

  // ===================== 진행도 자동 저장 =====================
  // unmount 시점에 최신 progress를 저장하기 위해 useRef 사용
  const progressRef = useRef(progress);
  const lastCfiRef = useRef(lastCfi);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedProgressRef = useRef<number>(0); // 마지막으로 저장한 progress

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    lastCfiRef.current = lastCfi;
  }, [lastCfi]);

  // 서버에 저장하는 함수
  const saveProgressToServer = async (forceLog = false) => {
    if (!fileId) return;

    const currentProgress = progressRef.current;
    const currentCfi = lastCfiRef.current;
    
    // 0으로 덮어쓰기 방지
    if (currentProgress === 0 && initialProgressRef.current === 0) {
      console.log("progress와 initialProgress 모두 0. 초기화 전 저장 거부.");
      return;
    }
    if (currentProgress === 0 && initialProgressRef.current > 0) {
      console.log("progress가 0으로 초기화됨. 저장 안 함.");
      return;
    }

    // 이전과 같은 값이면 저장 안 함 (중복 방지)
    if (currentProgress === lastSavedProgressRef.current && !forceLog) {
      return;
    }

    // EPUB은 CFI가 있어야 정확 복원이 가능함.
    // CFI 없이 progress만 저장하면 이전 CFI와 어긋나서 다른 위치로 이동할 수 있음.
    if (isEpub && !currentCfi) {
      console.log("📚 EPUB CFI 미수신 상태 - progress 저장 보류");
      return;
    }

    const body: any = { 
      progress: currentProgress,
      recordReadLog: forceLog || currentProgress > 0,
    };

    // 현재 화면에 보이는 텍스트를 readingPreview로 저장
    if (currentReadingPreviewRef.current) {
      body.readingPreview = currentReadingPreviewRef.current;
    }

    if (isEpub && currentCfi) {
      body.epubCfi = currentCfi;
      body.anchorRatio = lastAnchorRatioRef.current;
    }

    try {
      console.log("📤 [저장 시작]"
        + "\n  progress=" + currentProgress.toFixed(3)
        + "\n  cfi=" + (currentCfi ? currentCfi.slice(0, 80) : '❌없음')
        + "\n  anchorRatio=" + lastAnchorRatioRef.current.toFixed(3)
        + "\n  preview=" + (currentReadingPreviewRef.current || '').slice(0, 40)
        + "\n  body=" + JSON.stringify(body).slice(0, 200));
      
      const response = await fetch(`${BASE_URL}/files/${fileId}/progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        lastSavedProgressRef.current = currentProgress;
        console.log("✅ [저장 성공] progress=" + currentProgress.toFixed(3)
          + " anchorRatio=" + lastAnchorRatioRef.current.toFixed(3)
          + " cfi=" + (currentCfi ? currentCfi.slice(0, 60) : '없음'));
      } else {
        const errText = await response.text().catch(() => '');
        console.log("❌ [저장 실패] status=" + response.status + " body=" + errText.slice(0, 100));
      }
    } catch (e) {
      console.log("❌ 진행도 저장 실패:", e);
    }
  };

  // 함수를 ref로 감싸서 unmount/AppState에서 항상 최신 버전 호출 보장
  const saveProgressRef = useRef(saveProgressToServer);
  useEffect(() => {
    saveProgressRef.current = saveProgressToServer;
  });

  // unmount 시 저장 (백업)
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      // 홈 화면에서 즉시 refetch하도록 플래그 저장
      AsyncStorage.setItem('reader_exited', '1').catch(() => {});
      if (isEpub && webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({ type: 'getCurrentLocation' }));
        // 최신 preview가 도착했는지 확인하고 동적 대기
        const now = Date.now();
        const timeSinceLastUpdate = now - lastProgressUpdateAtRef.current;
        // 최근 100ms 내 업데이트면 바로 저장, 아니면 최대 700ms 대기
        const waitTime = timeSinceLastUpdate < 100 ? 50 : Math.min(700, 800 - timeSinceLastUpdate);
        console.log("💾 [unmount] timeSinceUpdate=" + timeSinceLastUpdate + "ms, waiting " + waitTime + "ms");
        setTimeout(() => saveProgressRef.current(true), waitTime);
      } else {
        saveProgressRef.current(true);
      }
    };
  }, [isEpub]);

  // 앱이 백그라운드로 전환될 때 저장 (강제종료 대비)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (isEpub && webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({ type: 'getCurrentLocation' }));
          // 최신 preview가 도착했는지 확인하고 동적 대기
          const now = Date.now();
          const timeSinceLastUpdate = now - lastProgressUpdateAtRef.current;
          // 최근 100ms 내 업데이트면 바로 저장, 아니면 최대 700ms 대기
          const waitTime = timeSinceLastUpdate < 100 ? 50 : Math.min(700, 800 - timeSinceLastUpdate);
          console.log("💾 [background] timeSinceUpdate=" + timeSinceLastUpdate + "ms, waiting " + waitTime + "ms");
          setTimeout(() => saveProgressRef.current(true), waitTime);
        } else {
          saveProgressRef.current(true);
        }
      }
    });
    return () => subscription.remove();
  }, [isEpub]);

  return (
    <View style={styles.root}>
      {/* Expo Router 헤더 숨기기 */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* 에러 시 전체 화면 */}
      {(epubError || txtError) ? (
        <View style={[styles.errorFullScreen, { paddingTop: insets.top }]}>
          <TouchableOpacity style={styles.errorBackTop} onPress={() => router.back()}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <View style={styles.errorBody}>
            <Text style={styles.errorBigEmoji}>📚</Text>
            <Text style={styles.errorText}>파일을 열 수 없어요</Text>
            <Text style={styles.errorHint}>
              {(epubError || txtError || '').includes('찾을 수 없')
                ? '저장된 경로가 변경됐어요.\n파일을 삭제 후 다시 추가해주세요.'
                : '파일이 손상됐거나 지원되지 않는 형식이에요.'}
            </Text>
            <TouchableOpacity style={styles.errorBackBtn} onPress={() => router.back()}>
              <Text style={styles.errorBackBtnText}>← 돌아가기</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
      <>
      {/* 상단바 */}
      {showUI && (
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Text style={styles.back} onPress={() => router.back()}>
            ←
          </Text>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}

      {/* 본문 영역 */}
      {isEpub ? (
        /* EPUB: WebView 터치 이벤트를 방해하지 않음 */
        <>
          <View style={styles.readerArea}>
            {epubBase64 && epubBase64.length > 0 ? (
              <>
              <WebView
                ref={webViewRef}
                originWhitelist={["*"]}
                source={{ html: epubHtml }}
                onMessage={handleWebViewMessage}
                style={{ flex: 1 }}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                scrollEnabled={true}
                bounces={true}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={true}
                overScrollMode="always"
                nestedScrollEnabled={true}
                androidLayerType="hardware"
                pointerEvents="auto"
                onError={(syntheticEvent) => {
                  const { nativeEvent } = syntheticEvent;
                  console.warn('WebView error: ', nativeEvent);
                  setEpubError("WebView 로딩 실패");
                }}
              />
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
          <View style={styles.readerArea}>
            {txtLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#b84a8c" />
                <Text style={styles.loadingText}>파일을 읽는 중...</Text>
              </View>
            ) : txtError ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>⚠️ {txtError}</Text>
                <TouchableOpacity style={styles.errorBackBtn} onPress={() => router.back()}>
                  <Text style={styles.errorBackBtnText}>← 돌아가기</Text>
                </TouchableOpacity>
              </View>
            ) : (
            <FlatList
              ref={scrollRef as any}
              data={content}
              keyExtractor={(_, i) => String(i)}
              style={{ flex: 1, backgroundColor: settings.bgColor }}
              contentContainerStyle={{ paddingHorizontal: settings.sidePadding, paddingBottom: 40 }}
              onScroll={handleScroll}
              scrollEventThrottle={200}
              onContentSizeChange={(_, h) => { setContentHeight(h); contentHeightRef.current = h; }}
              onLayout={(e) => { const h = e.nativeEvent.layout.height; setViewHeight(h); viewHeightRef.current = h; }}
              onTouchStart={(e) => {
                touchStartPos.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
                isTouchMove.current = false;
              }}
              onTouchMove={() => { isTouchMove.current = true; }}
              onTouchEnd={(e) => {
                if (!isTouchMove.current) {
                  const dx = Math.abs(e.nativeEvent.pageX - touchStartPos.current.x);
                  const dy = Math.abs(e.nativeEvent.pageY - touchStartPos.current.y);
                  if (dx < 10 && dy < 10) setShowUI((prev) => !prev);
                }
              }}
              removeClippedSubviews={true}
              initialNumToRender={30}
              maxToRenderPerBatch={20}
              windowSize={10}
              renderItem={({ item }: { item: string }) => (
                <Text style={[
                  styles.text,
                  {
                    fontSize: settings.fontSize,
                    color: settings.textColor,
                    lineHeight: settings.fontSize * settings.lineSpacing,
                    fontFamily: settings.fontFamily !== "default" ? settings.fontFamily : undefined,
                    marginBottom: settings.fontSize * 0.8,
                  },
                ]}>{item}</Text>
              )}
            />
            )}
          </View>
        </>
      )}

      {/* 하단 바 (페이지/진행도/슬라이더) */}
      {showUI && (
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.pageRow}>
            <Text style={styles.pageText}>
              {currentPage} / {totalPages}
            </Text>
            <TouchableOpacity style={styles.settingsBtn} onPress={() => setShowSettings(true)}>
              <Text style={[styles.pageText, { fontSize: 16, fontWeight: "700" }]}>Aa</Text>
            </TouchableOpacity>
            <Text style={styles.pageText}>{Math.round(progress * 100)}%</Text>
          </View>

          <Slider
            style={{ width: "100%" }}
            minimumValue={0}
            maximumValue={1}
            value={progress}
            minimumTrackTintColor="#b84a8c"
            maximumTrackTintColor="#ddd"
            thumbTintColor="#b84a8c"
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
                      settings.fontFamily === f.value && styles.fontBtnActive,
                    ]}
                    onPress={() => setSettings(s => ({ ...s, fontFamily: f.value }))}
                  >
                    <Text style={[
                      styles.fontBtnText,
                      settings.fontFamily === f.value && styles.fontBtnTextActive,
                      f.value !== "default" && { fontFamily: f.value },
                    ]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

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
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "flex-end",
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
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
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
  text: {
    fontSize: 18,
    lineHeight: 28,
    color: "#333",
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
