# HTTP 메서드 쉽게 이해하기 (초보자용)

## 📌 HTTP 메서드란?

서버에게 **"이런 일을 해줘!"** 라고 말하는 **명령어**입니다.

마치 식당에서 주문하는 것과 비슷해요:
- "메뉴 좀 보여줘" → **GET**
- "햄버거 하나 주세요" → **POST**
- "주문 취소해주세요" → **DELETE**
- "햄버거를 치킨으로 바꿔주세요" → **PATCH** 또는 **PUT**

---

## 🍔 5가지 주요 메서드

### 1. GET - "보여줘!"
**용도:** 데이터를 **읽기만** 할 때

```javascript
// 예시: 파일 목록 가져오기
fetch("http://localhost:8080/files")  // 👈 기본이 GET
  .then(res => res.json())
  .then(files => console.log(files))
```

**특징:**
- 서버의 데이터를 **변경하지 않음**
- 주소창에 직접 입력 가능
- 북마크 가능

**실생활 비유:** 책장에서 책 제목 읽기

---

### 2. POST - "새로 만들어줘!"
**용도:** **새로운** 데이터를 생성할 때

```javascript
// 예시: 새 파일 추가
fetch("http://localhost:8080/files", {
  method: "POST",  // 👈 POST 명시
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "새 파일.txt",
    rating: 5
  })
})
```

**특징:**
- 서버에 **새로운 것**을 추가
- 같은 요청 여러 번 → 여러 개 생김

**실생활 비유:** 책장에 새 책 추가하기

---

### 3. DELETE - "삭제해줘!"
**용도:** 데이터를 **삭제**할 때

```javascript
// 예시: 파일 삭제
fetch("http://localhost:8080/files/123", {
  method: "DELETE"  // 👈 DELETE 명시
})
```

**특징:**
- 서버의 데이터를 **제거**
- 보통 ID를 URL에 포함

**실생활 비유:** 책장에서 책 버리기

---

### 4. PATCH - "부분만 수정해줘!"
**용도:** 데이터의 **일부분만** 수정할 때

```javascript
// 예시: 별점만 수정 (다른 건 그대로)
fetch("http://localhost:8080/files/123", {
  method: "PATCH",  // 👈 PATCH 명시
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rating: 4  // 👈 별점만 보냄
  })
})
```

**특징:**
- **바꾸고 싶은 부분만** 보냄
- 나머지는 그대로 유지

**실생활 비유:** 책 표지에 스티커만 붙이기

---

### 5. PUT - "전체를 교체해줘!"
**용도:** 데이터를 **통째로** 교체할 때

```javascript
// 예시: 파일 정보 전체 교체
fetch("http://localhost:8080/files/123", {
  method: "PUT",  // 👈 PUT 명시
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "수정된 파일.txt",
    rating: 4,
    review: "좋아요",
    date: "2026-02-02"
    // 👈 모든 정보를 다 보내야 함!
  })
})
```

**특징:**
- **모든 정보**를 다시 보내야 함
- 안 보낸 정보는 사라질 수 있음

**실생활 비유:** 책을 새 책으로 완전히 바꾸기

---

## 🆚 PATCH vs PUT 차이

### PATCH (부분 수정)
```javascript
// 별점만 바꾸고 싶을 때
fetch("/files/123", {
  method: "PATCH",
  body: JSON.stringify({
    rating: 5  // 이것만 보냄
  })
})

// 서버에서:
// title: "원래제목" ✅ 유지
// rating: 5 ✅ 변경됨
// review: "원래리뷰" ✅ 유지
```

### PUT (전체 교체)
```javascript
// 별점만 바꾸려고 했지만...
fetch("/files/123", {
  method: "PUT",
  body: JSON.stringify({
    rating: 5  // 이것만 보냄
  })
})

// 서버에서:
// title: null ❌ 사라짐!
// rating: 5 ✅ 변경됨
// review: null ❌ 사라짐!
```

**결론:** 
- **부분만** 바꿀 땐 → **PATCH** 사용
- **전체** 바꿀 땐 → **PUT** 사용

---

## 🎯 너의 경우

### 문제 상황
```javascript
// 프론트엔드 (React Native)
fetch("http://localhost:8080/files/123", {
  method: "PATCH",  // 👈 PATCH 보냄
  body: JSON.stringify({
    title: "새 제목",
    rating: 5
  })
})
```

### 백엔드 (Spring Boot)
```java
// ❌ 없음! 그래서 에러 발생
// "Request method 'PATCH' is not supported"
```

### 해결 방법

**백엔드에 추가:**
```java
@PatchMapping("/{id}")  // 👈 PATCH 받을 준비
public FileEntity updateFile(
    @PathVariable Long id,
    @RequestBody Map<String, Object> body
) {
    // 여기서 업데이트 처리
}
```

---

## 📊 메서드 비교표

| 메서드 | 용도 | 예시 | 데이터 보냄 | 안전 | 멱등성 |
|--------|------|------|-------------|------|--------|
| **GET** | 조회 | 목록 보기 | ❌ | ✅ | ✅ |
| **POST** | 생성 | 파일 추가 | ✅ | ❌ | ❌ |
| **PUT** | 전체 수정 | 모든 정보 교체 | ✅ | ❌ | ✅ |
| **PATCH** | 부분 수정 | 별점만 수정 | ✅ | ❌ | ❌ |
| **DELETE** | 삭제 | 파일 삭제 | ❌ | ❌ | ✅ |

**용어 설명:**
- **안전(Safe):** 서버 데이터를 바꾸지 않음
- **멱등성(Idempotent):** 여러 번 해도 결과가 같음

---

## 🔥 실전 예제 (너의 코드)

### 상황: 파일 정보 수정 (제목, 리뷰, 별점)

#### 프론트엔드 (index.tsx)
```typescript
const updateFileInfo = async (updated: FileItem) => {
  try {
    // 1. 서버에 PATCH 요청
    const res = await fetch(`${BASE_URL}/files/${updated.id}`, {
      method: "PATCH",  // 👈 부분 수정이니까 PATCH
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: updated.title,    // 제목
        review: updated.review,  // 리뷰
        rating: updated.rating   // 별점
      }),
    });

    // 2. 응답 받기
    const saved = await res.json();

    // 3. 화면 업데이트
    setFiles(prev => 
      prev.map(f => f.id === saved.id ? saved : f)
    );
  } catch (err) {
    console.log(err);
  }
};
```

#### 백엔드 (FileController.java)
```java
@RestController
@RequestMapping("/files")
public class FileController {
    
    // PATCH /files/123 요청을 받을 준비
    @PatchMapping("/{id}")  // 👈 이게 필요해!
    public FileEntity updateFile(
        @PathVariable Long id,  // URL의 123
        @RequestBody Map<String, Object> body  // JSON 데이터
    ) {
        // 서비스에서 업데이트 처리
        return fileService.updateFile(id, body);
    }
}
```

#### 백엔드 서비스 (FileService.java)
```java
public FileEntity updateFile(Long id, Map<String, Object> body) {
    // 1. DB에서 파일 찾기
    FileEntity file = fileRepository.findById(id)
        .orElseThrow(() -> new RuntimeException("파일 없음"));
    
    // 2. 보낸 정보만 수정
    if (body.containsKey("title")) {
        file.setTitle((String) body.get("title"));
    }
    if (body.containsKey("review")) {
        file.setReview((String) body.get("review"));
    }
    if (body.containsKey("rating")) {
        file.setRating(((Number) body.get("rating")).intValue());
    }
    
    // 3. DB에 저장
    return fileRepository.save(file);
}
```

---

## 💡 핵심 정리

### 1. HTTP 메서드 = 명령어
- GET: 보여줘
- POST: 새로 만들어줘
- DELETE: 삭제해줘
- PATCH: 부분만 바꿔줘
- PUT: 전체를 바꿔줘

### 2. 프론트 ↔ 백엔드 연결
```
프론트엔드                      백엔드
fetch(..., {method: "PATCH"})  →  @PatchMapping
fetch(..., {method: "GET"})    →  @GetMapping
fetch(..., {method: "POST"})   →  @PostMapping
fetch(..., {method: "DELETE"}) →  @DeleteMapping
```

### 3. 너의 문제
- 프론트: `method: "PATCH"` 사용 중
- 백엔드: `@PatchMapping` 없음 ❌
- 해결: 백엔드에 `@PatchMapping("/{id}")` 추가 ✅

---

## 🎓 더 알아보기

### RESTful API란?
서버와 통신하는 **규칙**입니다.

**좋은 API 예시:**
```
GET    /files        → 파일 목록 조회
GET    /files/123    → 123번 파일 상세 조회
POST   /files        → 새 파일 생성
PATCH  /files/123    → 123번 파일 수정
DELETE /files/123    → 123번 파일 삭제
```

**나쁜 API 예시:**
```
GET    /getFiles           ❌ 불필요한 get
GET    /deleteFile?id=123  ❌ DELETE 써야 함
POST   /files/update       ❌ PATCH 써야 함
```

---

## 🤔 자주 하는 질문

### Q1: GET과 POST 중 뭐 써야 할지 모르겠어요
**A:** 서버 데이터를 바꾸나요?
- 바꾸지 않음 (조회만) → **GET**
- 바꿈 (생성/수정/삭제) → **POST/PATCH/PUT/DELETE**

### Q2: PATCH와 PUT 중 뭐 써야 할지 모르겠어요
**A:** 전체를 보내나요?
- 일부만 보냄 (별점만) → **PATCH**
- 전체 보냄 (모든 필드) → **PUT**

### Q3: 왜 method를 명시해야 하나요?
**A:** 명시 안 하면 무조건 **GET**이 됩니다.
```javascript
fetch("/files")  // GET (기본값)

fetch("/files", { 
  method: "POST"  // POST로 변경
})
```

### Q4: 백엔드에 왜 @PatchMapping이 필요한가요?
**A:** 프론트가 보낸 PATCH 요청을 받으려면 필요합니다.
```
프론트: "PATCH로 요청 보냄!"
백엔드: @PatchMapping이 없으면 → "그런 요청 몰라!" (405 에러)
```

---

**작성일:** 2026년 2월 2일  
**난이도:** ⭐ 초급  
**대상:** HTTP 메서드를 처음 배우는 분
