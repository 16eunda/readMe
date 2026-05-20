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
  const { fileId, uri, name, resetProgress } = useLocalSearchParams();
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

  // epub 전용 base64 데이터
  const [epubBase64, setEpubBase64] = useState("");
  const webViewRef = useRef<WebView>(null);
  const [lastCfi, setLastCfi] = useState<string | null>(null);     // 마지막 위치
  const [initialCfi, setInitialCfi] = useState<string | null>(null); // 서버에서 받은 CFI
  const [epubReady, setEpubReady] = useState(false);               // WebView 준비 여부
  const [epubError, setEpubError] = useState<string | null>(null); // EPUB 로딩 에러

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

  // EPUB 시작 여부 추적 (display 시작 전에 theme 메시지 보내지 않기 위해)
  const epubStartedRef = useRef(false);

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
    const isEpubFile = fileName.toLowerCase().endsWith(".epub");
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
          const b64 = await readWithFallback(decoded, {
            encoding: FileSystem.EncodingType.Base64,
          });
          console.log("✅ EPUB base64 로드 완료, 길이:", b64.length);
          
          if (!b64 || b64.length === 0) {
            console.error("❌ EPUB base64가 비어있습니다");
            setEpubError("파일을 읽을 수 없습니다");
            return;
          }
          
          setEpubBase64(b64);
        } else {
          console.log("text 파일 읽기");
          setTxtLoading(true);
          // TXT → base64로 읽고 자동 인코딩 감지
          const base64 = await readWithFallback(decoded, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const buffer = Buffer.from(base64, 'base64');
          const text = decodeTextSafe(buffer);
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

      // ⭐ EPUB 이어 읽기: 저장된 CFI 있으면 기억
      if (fileInfo.epubCfi) {
        setInitialCfi(fileInfo.epubCfi);
      }
    } catch (e) {
      console.log("진행도 불러오기 실패:", e);
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

  // EPUB ready → 테마 + display 한번에 시작 (테마가 display 전에 적용되어야 챕터 이동 정상 동작)
  useEffect(() => {
    if (!isEpub || !epubReady || !webViewRef.current) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: "themeAndStart",
      bgColor: settings.bgColor,
      textColor: settings.textColor,
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      lineSpacing: settings.lineSpacing,
      sidePadding: settings.sidePadding,
      cfi: resetProgress === "true" ? null : (initialCfi || null),
    }));
    epubStartedRef.current = true;
  }, [isEpub, epubReady, initialCfi]);


  // ===================== TXT 쪽 진행도 계산 =====================
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = e.nativeEvent.contentOffset.y;
    const maxScroll = Math.max(contentHeight - viewHeight, 1);

    const ratio = offsetY / maxScroll;
    const clamped = Math.min(1, Math.max(0, ratio));

    setProgress(clamped);

    const pages = Math.max(1, Math.round(contentHeight / viewHeight));
    setTotalPages(pages);
    setCurrentPage(Math.max(1, Math.round(clamped * pages)));
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
        const { current, total, percent, cfi } = data;
        setCurrentPage(current || 1);
        setTotalPages(total || 1);
        setProgress((percent || 0) / 100);

        if (cfi) {
          setLastCfi(cfi);     // 마지막 CFI 기억
        }
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
              flow: "scrolled",
              manager: "continuous",
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
                var tapStartX = 0, tapStartY = 0, tapStartTime = 0;
                doc.addEventListener("touchstart", function(e) {
                  tapStartX = e.touches[0].clientX;
                  tapStartY = e.touches[0].clientY;
                  tapStartTime = Date.now();
                }, { passive: true });
                doc.addEventListener("touchend", function(e) {
                  var dx = Math.abs(e.changedTouches[0].clientX - tapStartX);
                  var dy = Math.abs(e.changedTouches[0].clientY - tapStartY);
                  var dt = Date.now() - tapStartTime;
                  if (dx < 10 && dy < 10 && dt < 300) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "toggleUI" }));
                  }
                }, { passive: true });
              } catch(e) { sendLog("❌ attachTap error: " + e.message); }
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

            function safeReport(location) {
              try {
                var startCfi = location.start.cfi || location.start;
                var current = book.locations.locationFromCfi(startCfi);
                var percent = book.locations.percentageFromCfi(startCfi) * 100;

                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: "progress",
                  current: current,
                  total: totalLocations,
                  percent: percent,
                  cfi: startCfi
                }));
              } catch(e) {
                sendLog("❌ safeReport error: " + e.message);
              }
            }

            // 위치 정보 생성
            book.ready.then(function () {
              sendLog("📚 book.ready 완료");
              loadingEl.querySelector('div:last-child').textContent = '페이지 정보 생성 중...';
              return book.locations.generate(400);
            }).then(function () {
              sendLog("📚 locations.generate 완료");
              locationsReady = true;
              totalLocations = book.locations.length();
              loadingEl.style.display = 'none';

              // 준비 완료 알림
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "ready"
              }));
              
              // ⭐ display()는 themeAndStart 메시지에서 호출됨 (테마 적용 후 display 보장)
              sendLog("📚 locations 준비 완료, themeAndStart 대기 중...");

            }).catch(function(err) {
              showError("EPUB 파일을 로드할 수 없습니다: " + err.message);
            });

            // 페이지 이동될 때마다 진행도 전송 (scrolled 모드에서는 자동 스크롤됨)
            rendition.on("relocated", function(location) {
              if (!locationsReady) return;
              safeReport(location);
            });

            // 렌더링 완료 이벤트
            rendition.on("rendered", function(section) {
              loadingEl.style.display = 'none';
              sendLog("✅ EPUB 렌더링 완료 - section: " + section.href);
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
                if (data.type === "seek" && locationsReady) {
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
                    rendition.display(cfi);
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
                  sendLog("📖 themeAndStart: " + (data.cfi ? 'CFI=' + data.cfi : '처음부터'));
                  if (data.cfi) {
                    rendition.display(data.cfi).catch(function(err) {
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
    
    // 0으로 덮어쓰기 방지
    if (currentProgress === 0 && initialProgressRef.current > 0) {
      console.log("progress가 0으로 초기화됨. 저장 안 함.");
      return;
    }

    // 이전과 같은 값이면 저장 안 함 (중복 방지)
    if (currentProgress === lastSavedProgressRef.current && !forceLog) {
      return;
    }

    const body: any = { 
      progress: currentProgress,
      recordReadLog: forceLog || currentProgress > 0
    };

    // TXT: 현재 스크롤 위치의 문단을 readingPreview로 저장
    if (!isEpub && contentRef.current.length > 0) {
      const paragraphs = contentRef.current;
      const paraIndex = Math.max(0, Math.floor(currentProgress * paragraphs.length) - 1);
      body.readingPreview = paragraphs.slice(paraIndex, paraIndex + 3).join('\n').slice(0, 200);
    }

    if (isEpub && lastCfiRef.current) {
      body.epubCfi = lastCfiRef.current;
    }

    try {
      console.log("📤 서버로 전송하는 데이터:", body);
      
      const response = await fetch(`${BASE_URL}/files/${fileId}/progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        lastSavedProgressRef.current = currentProgress;
        console.log("🔵 진행도 저장됨:", currentProgress);
      }
    } catch (e) {
      console.log("❌ 진행도 저장 실패:", e);
    }
  };

  // unmount 시 저장 (백업)
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      // unmount 시에는 로그 기록
      saveProgressToServer(true);
    };
  }, [fileId, isEpub, BASE_URL]);

  // 앱이 백그라운드로 전환될 때 저장 (강제종료 대비)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        saveProgressToServer(true);
      }
    });
    return () => subscription.remove();
  }, [fileId, isEpub, BASE_URL]);

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
});
