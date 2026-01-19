// app/reader.tsx
import Slider from "@react-native-community/slider";
import { Buffer } from 'buffer';
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import iconv from 'iconv-lite';
import React, { useEffect, useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { WebView } from "react-native-webview";

// 여러 인코딩 시도 방식 (효율적인 순서)
function decodeTextSafe(buffer: Buffer): string {
  // 1. UTF-8 BOM 체크 (EF BB BF) - 확실한 경우 즉시 리턴
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return iconv.decode(buffer.slice(3), 'utf-8');
  }
  
  // 2. 여러 인코딩 시도 (한국 사용자 기준 효율적 순서)
  const encodings = ['cp949', 'utf-8', 'euc-kr', 'windows-1252'];
  
  for (const enc of encodings) {
    try {
      const text = iconv.decode(buffer, enc);
      
      // 깨진 문자(�) 비율 확인
      const broken = (text.match(/\uFFFD/g)?.length || 0);
      const ratio = broken / text.length;
      
      // 1% 미만이면 성공으로 간주
      if (ratio < 0.01) {
        console.log('✅ 성공한 인코딩:', enc);
        return text;
      }
    } catch (e) {
      continue;
    }
  }
  
  // 모두 실패하면 UTF-8로 폴백
  console.log('⚠️ 모든 인코딩 실패, UTF-8로 폴백');
  return iconv.decode(buffer, 'utf-8');
}

export default function ReaderScreen() {
  const router = useRouter();
  const { fileId, uri, name } = useLocalSearchParams();

  const [isEpub, setIsEpub] = useState(false);
  const [content, setContent] = useState(""); // txt 내용
  const [showUI, setShowUI] = useState(true);

  // 공통 진행도 상태 (0~1)
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // txt 전용 스크롤 정보
  const scrollRef = useRef<ScrollView>(null);
  const [contentHeight, setContentHeight] = useState(1);
  const [viewHeight, setViewHeight] = useState(1);

  // epub 전용 base64 데이터
  const [epubBase64, setEpubBase64] = useState("");
  const webViewRef = useRef<WebView>(null);
  const [lastCfi, setLastCfi] = useState<string | null>(null);     // 마지막 위치
  const [initialCfi, setInitialCfi] = useState<string | null>(null); // 서버에서 받은 CFI
  const [epubReady, setEpubReady] = useState(false);               // WebView 준비 여부

  let BASE_URL = "";

  if (Platform.OS === "web") {
    BASE_URL = "http://localhost:8080";
  } else if (Platform.OS === "android") {
    // ▫ Android Emulator일 경우, Expo Go(실기기)는 아님
    BASE_URL = "http://10.0.2.2:8080";
  } else if (Platform.OS === "ios") {
    // ▫ iOS Simulator는 localhost 사용 가능
    BASE_URL = "http://127.0.0.1:8080";
  } else {
    // 마지막으로, Expo Go(실제 기기)는 이렇게 override 필요
    BASE_URL = "http://192.168.35.99:8080"; // ← 너 PC의 실제 IP로 바꿔야 함
  }

  useEffect(() => {
    const fileName = String(name || "");
    const isEpubFile = fileName.toLowerCase().endsWith(".epub");
    setIsEpub(isEpubFile);

    const read = async () => {
      try {
        const decoded = decodeURI(uri as string);

        if (isEpubFile) {
          // EPUB → base64로 읽기
          const b64 = await FileSystem.readAsStringAsync(decoded, {
            encoding: "base64",
          });
          setEpubBase64(b64);
        } else {
          console.log("text 파일 읽기");
          // TXT → base64로 읽고 자동 인코딩 감지
          const base64 = await FileSystem.readAsStringAsync(decoded, {
            encoding: "base64",
          });
          const buffer = Buffer.from(base64, 'base64');
          const text = decodeTextSafe(buffer);
          setContent(text);
        }
      } catch (e) {
        console.log("파일 읽기 오류:", e);
      }
    };

    read();
  }, [uri, name]);

  useEffect(() => {
  const load = async () => {
    try {
      const res = await fetch(`${BASE_URL}/files/${fileId}`);
      const fileInfo = await res.json();

      if (fileInfo.progress > 0) {
        setProgress(fileInfo.progress);   // 진행도만 넣어둔다
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
}, []);

// TXT 컨텐츠 렌더링이 끝나고 높이가 계산된 뒤, 저장된 progress대로 스크롤 이동
useEffect(() => {
  // EPUB일 땐 스크롤 안 쓰니까 TXT일 때만
  if (isEpub) return;

  // 아직 ref 없으면 패스
  if (!scrollRef.current) return;

  // progress 0이면 처음부터 읽는 거니까 패스
  if (!progress || progress <= 0) return;

  const maxScroll = contentHeight - viewHeight;
  if (maxScroll <= 0) return;

  scrollRef.current.scrollTo({
    y: maxScroll * progress,
    animated: false,
  });
}, [contentHeight, viewHeight, progress, isEpub]);

useEffect(() => {
  if (!isEpub) return;
  if (!epubReady) return;        // WebView & locations 준비 완료 후
  if (!initialCfi) return;       // 저장된 CFI 없으면 패스
  if (!webViewRef.current) return;

  webViewRef.current.postMessage(
    JSON.stringify({ type: "loadLocation", cfi: initialCfi })
  );
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
    const y = maxScroll * value;
    scrollRef.current.scrollTo({ y, animated: false });
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
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "progress") {
        const { current, total, percent, cfi } = data;
        setCurrentPage(current || 1);
        setTotalPages(total || 1);
        setProgress((percent || 0) / 100);

        if (cfi) {
          setLastCfi(cfi);     // 마지막 CFI 기억
        }
      } else if (data.type === "ready") {
        // EPUB 쪽 준비 완료
        setEpubReady(true);
      }
    } catch (e) {
      console.log("webview message parse error:", e);
    }
  };

  // ===================== EPUB용 HTML =====================
  const epubHtml = `
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <script src="https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js"></script>
      <style>
        body { margin:0; padding:0; background:#f5f0e6; }
        #viewer { height:100vh; }
      </style>
    </head>
    <body>
      <div id="viewer"></div>
      <script>
        (function() {
          var book = ePub("data:application/epub+zip;base64,${epubBase64}");
          var rendition = book.renderTo("viewer", { width: "100%", height: "100%" });

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
              // ignore
            }
          }

          rendition.display();

          // 위치 정보 생성
          book.ready.then(function () {
            return book.locations.generate(1000);
          }).then(function () {
            locationsReady = true;
            totalLocations = book.locations.length();

            // 첫 위치 리포트
            var currentLocation = rendition.currentLocation();
            if (currentLocation) safeReport(currentLocation);

            // 준비 완료 알림
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: "ready"
            }));

          });

          // 페이지 이동될 때마다 진행도 전송
          rendition.on("relocated", function(location) {
            if (!locationsReady) return;
            safeReport(location);
          });

          // React Native -> WebView : Slider로부터 "seek" 메시지 받기
          document.addEventListener("message", function(e) {
            try {
              var data = JSON.parse(e.data);
              if (data.type === "seek" && locationsReady) {
                var p = data.percent;
                if (typeof p !== "number") return;

                // 0~1 범위로 클램프
                if (p < 0) p = 0;
                if (p > 1) p = 1;

                // percent를 CFI로 변환해서 이동
                var cfi = book.locations.cfiFromPercentage(p);
                if (cfi) {
                  rendition.display(cfi);
                }
              } else if (data.type === "loadLocation" && locationsReady && data.cfi) {
                // 저장된 CFI로 바로 이동
                rendition.display(data.cfi);
              }
            } catch(err) {
              // ignore
            }
          });
        })();
      </script>
    </body>
  </html>
  `;

  const title = String(name || "").replace(/\.[^.]+$/, ""); // 확장자 제거

  async function saveProgressToServer() {
  if (!fileId) return;

  const body: any = { progress };

  // ⭐ EPUB이면 CFI도 같이 보내기
  if (isEpub && lastCfi) {
    body.epubCfi = lastCfi;
  }

  try {
    await fetch(`${BASE_URL}/files/${fileId}/progress`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log("🔵 진행도 저장됨:", progress);
  } catch (e) {
    console.log("❌ 진행도 저장 실패:", e);
  }
}

  // ===================== 진행도 자동 저장 =====================
  useEffect(() => {
  return () => {
    // 여기가 unmount 시점
    saveProgressToServer();
  };
}, []);

  return (
    <View style={styles.root}>
      {/* 상단바 */}
      {showUI && (
        <View style={styles.topBar}>
          <Text style={styles.back} onPress={() => router.back()}>
            ←
          </Text>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}

      {/* 본문 영역: 탭하면 UI 토글 */}
      <Pressable style={styles.readerArea} onPress={() => setShowUI(!showUI)}>
        {isEpub ? (
          <WebView
            ref={webViewRef}
            originWhitelist={["*"]}
            source={{ html: epubHtml }}
            onMessage={handleWebViewMessage}
            style={{ flex: 1 }}
          />
        ) : (
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onContentSizeChange={(_, h) => setContentHeight(h)}
            onLayout={(e) => setViewHeight(e.nativeEvent.layout.height)}
          >
            <Text style={styles.text}>{content}</Text>
          </ScrollView>
        )}
      </Pressable>

      {/* 하단 바 (페이지/진행도/슬라이더) */}
      {showUI && (
        <View style={styles.bottomBar}>
          <View style={styles.pageRow}>
            <Text style={styles.pageText}>
              {currentPage} / {totalPages}
            </Text>
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
    height: 56,
    paddingHorizontal: 16,
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
    paddingVertical: 10,
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
});
