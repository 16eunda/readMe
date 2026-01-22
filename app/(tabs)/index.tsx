import * as DocumentPicker from "expo-document-picker";
//import * as FileSystem from "expo-file-system";
import { Buffer } from "buffer";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { htmlToText } from "html-to-text";
import JSZip from "jszip";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View
} from "react-native";
// 파일 카드
import FileCard, { FileItem } from "../../components/FileCard";

// 검색 바
import SearchBar from "../../components/SearchBar";
import styles from "../../styles/Home.styles";

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

// BASE_URL을 컴포넌트 외부로 이동
const getBaseURL = () => {
  if (Platform.OS === "web") {
    return "http://localhost:8080";
  } else if (Platform.OS === "android") {
    return "http://10.0.2.2:8080";
  } else if (Platform.OS === "ios") {
    return "http://127.0.0.1:8080";
  } else {
    return "http://192.168.35.99:8080";
  }
};

const BASE_URL = getBaseURL();

export default function Home() {
  console.log("🔵 RN 화면 렌더링 시작됨");

  // ========== 1. 외부 Hooks (useRouter, useLocalSearchParams) ==========
  const router = useRouter();
  const { folder } = useLocalSearchParams();
  const currentFolder = folder ?? "root";

  // ========== 2. 모든 useState ==========
  const [search, setSearch] = useState("");
  
  // 파일 상태
  const [files, setFiles] = useState<any[]>([]);
  const [fileOptionsVisible, setFileOptionsVisible] = useState(false);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // 폴더 상태
  const [folders, setFolders] = useState<any[]>([]);
  const [folderModal, setFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<any>(null);
  const [folderOptionsVisible, setFolderOptionsVisible] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameText, setRenameText] = useState("");

  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [lastProgress, setLastProgress] = useState(0);

  // 중복 파일 확인 모달
  const [duplicateModalVisible, setDuplicateModalVisible] = useState(false);
  const [duplicateFileName, setDuplicateFileName] = useState("");
  const [pendingFile, setPendingFile] = useState<any>(null);

  // 무한 스크롤
  const [displayCount, setDisplayCount] = useState(10);

  // ========== 3. 모든 useMemo ==========
  const filteredFiles = useMemo(() => {
    const listInCurrentFolder = files
      .filter((f) => f && f.path !== undefined)
      .filter((f) => f.path === currentFolder);

    if (!search.trim()) return listInCurrentFolder;

    const text = search.toLowerCase();
    return listInCurrentFolder.filter((item) =>
      item.title.toLowerCase().includes(text)
    );
  }, [search, files, currentFolder]);

  const visibleFolders = useMemo(() => {
    return folders.filter((f) => f && f.name && f.path === currentFolder);
  }, [folders, currentFolder]);

  // ========== 4. 모든 useEffect ==========
  useEffect(() => {
    console.log(" currentFolder =", currentFolder);
  }, [currentFolder]);

  useEffect(() => {
    fetchFiles();
    fetchFolders();
  }, []);

  useEffect(() => {
    setDisplayCount(10);
  }, [search, currentFolder]);
  // -----------------------------
  // 파일 조회
  // -----------------------------
  async function fetchFiles() {
    try {
      const response = await fetch(`${BASE_URL}/files`); // Android 에뮬레이터에서 백엔드 주소
      const data = await response.json();
      setFiles(data); // 서버에서 가져온 목록을 files에 저장
    } catch (e) {
      console.log("Error fetching files:", e);
    }
  }

  // -----------------------------
  // 파일 저장
  // -----------------------------
  async function saveFileToServer(fileData: any) {
    try {
      const response = await fetch(`${BASE_URL}/files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(fileData),
      });

      const saved = await response.json(); // 서버 DB에 저장된 객체 반환
      return saved;
    } catch (error) {
      console.log("Error saving file:", error);
    }
  }

  // -----------------------------
  // 폴더 조회
  // -----------------------------
  async function fetchFolders() {
    try {
      const response = await fetch(`${BASE_URL}/folders`);
      const data = await response.json();
      setFolders(data);
    } catch (e) {
      console.log("Error fetching folders:", e);
    }
  }

  // -----------------------------
  // 폴더 저장
  // -----------------------------
  async function saveFolderToServer(folderData: any) {
    try {
      const response = await fetch(`${BASE_URL}/folders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(folderData),
      });

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
    const res = await fetch(`${BASE_URL}/folders/${id}`, {
      method: "DELETE",
    });

    // 백엔드는 body 없이 200/204만 반환하므로 OK면 삭제 성공
    return res.ok;
  } catch (e) {
    console.log("Error deleting folder:", e);
    return false;
  }
}

  // -----------------------------
  // 파일 추가 (+ 버튼)
  // -----------------------------
  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["text/plain", "application/epub+zip"],
      copyToCacheDirectory: true, // ★ 반드시 추가
    });
    if (res.canceled) return;

    const file = res.assets[0];

    // 🔵 서버 API로 중복 체크
    const checkRes = await fetch(
      `${BASE_URL}/files/check?title=${encodeURIComponent(file.name)}&path=${currentFolder}`
    );
    const { exists } = await checkRes.json();
    
    if (exists) {
      // 중복 파일일 경우 모달 표시
      setDuplicateFileName(file.name);
      setPendingFile(file);
      setDuplicateModalVisible(true);
      return;
    }

    // 중복이 아니면 바로 추가
    await addFileToSystem(file);
  };

  // 실제 파일 추가 로직을 별도 함수로 분리
  const addFileToSystem = async (file: any) => {
    // 🔵 앱 전용 폴더로 복사
    const newPath = FileSystem.documentDirectory + file.name;
    await FileSystem.copyAsync({
      from: file.uri,
      to: newPath,
    });

    let preview = "";

    try {
      if (file.name.endsWith(".epub")) {
        preview = await extractEpubPreview(newPath);
      } else {
        // const text = await FileSystem.readAsStringAsync(newPath, { 
        //   encoding: FileSystem.EncodingType.UTF8 });
        // preview = text.slice(0, 100) + "...";
        // console.log("preview : " + preview);

        // Base64로 읽고 자동 인코딩 감지
        const base64 = await FileSystem.readAsStringAsync(newPath, { 
          encoding: FileSystem.EncodingType.Base64 
        });
        
        const buffer = Buffer.from(base64, 'base64');
        const text = decodeTextSafe(buffer);
        
        preview = text.slice(0, 100) + "...";
        console.log("preview : " + preview);
      }
    } catch(e) {
      console.log("읽기 실패:", e);
      preview = "(미리보기를 불러올 수 없습니다)";
    }

    
    // 백엔드에 보낼 파일 정보
    const newFile = {
      title: file.name,
      preview,
      date: new Date().toISOString().slice(0, 10),
      rating: 0,
      uri: newPath,
      path: currentFolder, // ★ 현재 폴더 안에 저장됨
    };

    // 1) 서버에 저장 요청
    const saved = await saveFileToServer(newFile);

    // 2) 서버에서 저장된 객체가 오면 그걸 files에 반영
    if (saved) {
      setFiles((prev) => [...prev, saved]);
    }
  };

  const extractEpubPreview = async (newPath:any) => {
    try {
      // 1) base64로 읽기 (zip 해석용)
      const base64 = await FileSystem.readAsStringAsync(newPath, {
        encoding: FileSystem.EncodingType.Base64
      });

      const zip = await JSZip.loadAsync(base64, { base64: true });

      // 2) .opf 파일 찾기 (epub 메타데이터)
      let opfPath = Object.keys(zip.files).find((p) => p.endsWith(".opf"));

      // 못 찾았을 때 대체 검색
      if (!opfPath) {
        opfPath = Object.keys(zip.files).find((p) =>
          p.toLowerCase().includes("opf")
        );
      }

      // 그래도 없다면 에러 처리
      if (!opfPath) {
        console.log("⚠️ OPF 파일을 찾을 수 없습니다.");
        return "(EPUB 메타데이터를 읽을 수 없습니다)";
      }
      
      const opfText = await zip.files[opfPath].async("text");

      // 3) OPF에서 첫 chapter 경로 찾기
      const itemMatch = opfText.match(/<item.*?id="[^"]*?".*?href="([^"]+)"/);
      if (!itemMatch) return "(본문을 찾을 수 없습니다)";
      const firstChapterPath = itemMatch[1];

      // 4) 상대 경로 처리
      const baseDir = opfPath.replace(/[^/]+$/, "");
      const chapterFullPath = baseDir + firstChapterPath;

      // 5) 첫 chapter xhtml 읽기
      const chapterText = await zip.files[chapterFullPath].async("text");

      // 6) HTML → 본문 텍스트 변환
      const plain = htmlToText(chapterText, {
        wordwrap: false,
        selectors: [{ selector: 'img', format: 'skip' }],
      });

      return plain.slice(0, 200) + "...";

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
    const res = await fetch(`${BASE_URL}/files/${file.id}`);
    const info = await res.json();

    // progress 없으면 바로 Reader로 이동
    if (!info.progress || info.progress === 0) {
      router.push({
        pathname: "/reader",
        params: { fileId: file.id, uri: file.uri, name: file.title }
      });
      return;
    }

    // progress 있음 → 모달 띄우기
    setSelectedFile(file);
    setLastProgress(info.progress);

    const base64 = await FileSystem.readAsStringAsync(file.uri, { 
      encoding: FileSystem.EncodingType.Base64 
    });

    const buffer = Buffer.from(base64, 'base64');
    const localContent = decodeTextSafe(buffer);

    const preview = localContent.slice(Math.floor(localContent.length * info.progress), Math.floor(localContent.length * info.progress) + 150);

    setPreviewText(preview);
    setPreviewModalVisible(true);
  };

  const handleLongPress = (item: FileItem) => {
    setSelectedFile(item);
    setShowEditModal(true);
  };

  const updateFileInfo = async (updated: FileItem) => {
    try {
      const res = await fetch(`${BASE_URL}/files/${updated.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: updated.title,
          review: updated.review,
          rating: updated.rating,
        }),
      });

      const saved = await res.json();

      setFiles((prev) =>
        prev.map((f) => (f.id === saved.id ? saved : f))
      );
    } catch (err) {
      console.log(err);
    } finally {
      setShowEditModal(false);
    }
  };

  // 검색어 변경 시 displayCount 리셋 (이미 위에 useEffect로 처리됨)
  const isInitial = files.length === 0 && !search;
  const noSearchResult = filteredFiles.length === 0 && search;
  console.log("🟣 before return");
  return (
    <View style={styles.container}>
       {/* 🔹 상단 전체 묶음 */}
    <View style={styles.topArea}>
      <Text style={styles.homeTitle}>
        {currentFolder === "root" ? "Home" : "Folder"}
      </Text>


      {/* 검색창 */}
      <SearchBar value={search} onChange={setSearch} />

      {/* 폴더 가로 스크롤 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.folderScroll}
      >
        {visibleFolders
          .filter((folder) => folder && folder.id && folder.name)
          .map((folder) => (
            <TouchableOpacity
              key={folder.id}
              style={styles.folderItem}
              onPress={() =>
                router.push({ pathname: "/", params: { folder: folder.id } })
              }
              onLongPress={() => {
                setSelectedFolder(folder);
                setFolderOptionsVisible(true);
              }}
            >
              <Text style={styles.folderText}>📁 {folder.name}</Text>
            </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.folderMenu}>
        <TouchableOpacity onPress={() => setFolderModal(true)}>
          <Text>폴더생성</Text>
        </TouchableOpacity>
        <Text>정렬</Text>
        <Text>편집</Text>
      </View>
    </View>

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
        data={filteredFiles.slice(0, displayCount)}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <FileCard
            item={item}
            onPress={handleFilePress}
            onLongPress={() => {
              handleLongPress(item)
            }}
            onOptionsPress={(file) => {
              setSelectedFile(file);
              setFileOptionsVisible(true);
            }}
          />
        )}
        onEndReached={() => {
          if (displayCount < filteredFiles.length) {
            setDisplayCount(prev => prev + 10);
          }
        }}
        onEndReachedThreshold={0.5}
      />
    )}

    {/* 플로팅 버튼 */}
    <TouchableOpacity style={styles.fab} onPress={pickFile}>
      <Text style={styles.fabText}>+</Text>
    </TouchableOpacity>

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
          alert("폴더 이름을 입력해주세요");
          return;
        }

        const newFolder = {
          name: newFolderName,
          path: currentFolder,
        };

        // 서버 저장
        const saved = await saveFolderToServer(newFolder);

        if (saved) {
          setFolders((prev) => [...prev, saved]);
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
      onDelete={async () => {
        if (!selectedFolder || !selectedFolder.id) {
          console.log("❗ 삭제 실패: selectedFolder 없음");
          return;
        }

        // 폴더 안에 파일이 있는지 체크
        const hasFiles = files.some(f => f.path === selectedFolder.id);
        
        if (hasFiles) {
          alert("폴더 안에 파일이 있습니다. 파일을 먼저 삭제하거나 이동하세요.");
          setFolderOptionsVisible(false);
          return;
        }

        const ok = await deleteFolderFromServer(selectedFolder.id);

        if (!ok) {
          alert("서버에서 삭제 실패");
          return;
        }

        setFolders((prev) => prev.filter((f) => f.id !== selectedFolder.id));
        setFolderOptionsVisible(false);
      }}
    />

    {/* 폴더 이름 변경 모달 */}
    <FolderRenameModal
      visible={renameModalVisible}
      name={renameText}
      onChangeName={setRenameText}
      onSave={() => {
        setFolders((prev) =>
          prev.map((f) =>
            f.id === selectedFolder.id ? { ...f, name: renameText } : f
          )
        );

        setRenameModalVisible(false);
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
      onDelete={() => {
        if (!selectedFile) return;
        
        setFiles((prev) => prev.filter((f) => f.id !== selectedFile.id));
        setFileOptionsVisible(false);
      }}
      onMove={() => {
        setFileOptionsVisible(false);
        setMoveModalVisible(true);
      }}
      onClose={() => setFileOptionsVisible(false)}
    />


    {/* 파일 이동 모달 */}
    <FileMoveModal
      visible={moveModalVisible}
      folders={folders}
      selectedFile={selectedFile}
      onMove={async (folder) => {
        if (!selectedFile) return;

        // 서버에 파일 이동 저장
        try {
          await fetch(`${BASE_URL}/files/${selectedFile.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: folder.id })
          });

          // 로컬 상태 업데이트
          setFiles((prev) =>
            prev.map((f) =>
              f.id === selectedFile.id ? { ...f, path: folder.id } : f
            )
          );
        } catch (error) {
          console.log("파일 이동 실패:", error);
          alert("파일 이동에 실패했습니다.");
        }

        setMoveModalVisible(false);
      }}
      onClose={() => setMoveModalVisible(false)}
    />

    {/* 하단 탭 메뉴 */}
    <View style={styles.bottomMenu}>
      <Text>추천</Text>
      <Text>랭킹</Text>
      <Text>목록</Text>
      <Text>히스토리</Text>
      <Text>설정</Text>
    </View>
  </View>
  );
}