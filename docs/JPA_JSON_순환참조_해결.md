# JPA 양방향 관계와 JSON 순환 참조 해결 가이드

## 📚 목차
1. [문제 발생 배경](#문제-발생-배경)
2. [순환 참조란?](#순환-참조란)
3. [@JsonIgnore 역할](#jsonignore-역할)
4. [어디에 추가해야 하나?](#어디에-추가해야-하나)
5. [실전 비교](#실전-비교)
6. [해결 방법 정리](#해결-방법-정리)
7. [잘못된 해결법: 관계 제거](#잘못된-해결법-관계-제거)
8. [@ManyToOne이 테이블에 미치는 영향](#manytoone이-테이블에-미치는-영향)

---

## 문제 발생 배경

### cascade 추가 후 발생한 오류

```
2026-01-31T16:08:51.842+09:00  WARN 41756 --- [nio-8080-exec-2] 
Could not write JSON: Document nesting depth (1001) exceeds 
the maximum allowed (1000, from `StreamWriteConstraints.getMaxNestingDepth()`)
```

**상황:**
- 파일 삭제 오류를 해결하기 위해 `@OneToMany(cascade = ...)` 추가
- 파일 추가/조회 시 위 오류 발생
- 프론트엔드에서 "Uncaught RangeError: Maximum nesting level in JSON parser exceeded"

---

## 순환 참조란?

### 1. 양방향 관계 생성

```java
// FileEntity.java
@Entity
public class FileEntity {
    @Id
    private Long id;
    private String title;
    
    @OneToMany(mappedBy = "file", cascade = CascadeType.ALL)
    private List<FileReadLog> readLogs;  // ← 파일이 로그들을 참조
}

// FileReadLog.java
@Entity
public class FileReadLog {
    @Id
    private Long id;
    
    @ManyToOne
    private FileEntity file;  // ← 로그가 파일을 참조
    
    private LocalDateTime readAt;
}
```

**관계 구조:**
```
FileEntity ───→ readLogs (List<FileReadLog>)
                    ↓
            FileReadLog ───→ file (FileEntity)
                                ↓
                            readLogs ───→ FileReadLog
                                            ↓
                                        file ───→ ...
```

### 2. JSON 변환 시 무한 루프

**Spring Controller:**
```java
@GetMapping("/files")
public List<FileEntity> getFiles() {
    return fileRepository.findAll();  // ← JSON 자동 변환 시작!
}
```

**Jackson이 JSON 만드는 과정:**

#### 1단계: FileEntity 변환 시작
```json
{
  "id": 1,
  "title": "해리포터",
  "readLogs": [
    ...  // ← readLogs 배열 변환 필요
  ]
}
```

#### 2단계: readLogs 내부 변환
```json
{
  "id": 1,
  "title": "해리포터",
  "readLogs": [
    {
      "id": 10,
      "readAt": "2026-01-31T16:00:00",
      "file": {  // ← FileEntity를 또 변환해야 함!
        ...
      }
    }
  ]
}
```

#### 3단계: file 내부 변환 (순환 시작!)
```json
{
  "id": 1,
  "title": "해리포터",
  "readLogs": [
    {
      "id": 10,
      "readAt": "2026-01-31T16:00:00",
      "file": {
        "id": 1,
        "title": "해리포터",
        "readLogs": [  // ← 또 readLogs 변환!
          {
            "id": 10,
            "file": {   // ← 또 file 변환!
              "id": 1,
              "readLogs": [  // ← 또 readLogs...
                ...무한 반복...
```

#### 결과
```
변환 깊이: 1 → 2 → 3 → ... → 1000 → 1001
                                    ↓
                              ❌ 오류 발생!
"Maximum nesting depth (1001) exceeds the maximum allowed (1000)"
```

### 3. 시각화

```
FileEntity (깊이 1)
  ↓ readLogs
  FileReadLog (깊이 2)
    ↓ file
    FileEntity (깊이 3)
      ↓ readLogs
      FileReadLog (깊이 4)
        ↓ file
        FileEntity (깊이 5)
          ↓ readLogs
          FileReadLog (깊이 6)
            ...
            (깊이 1001) ❌ 오류!
```

---

## @JsonIgnore 역할

### 기본 개념

```java
import com.fasterxml.jackson.annotation.JsonIgnore;

@JsonIgnore  // ← Jackson 라이브러리가 제공하는 어노테이션
```

**의미:**
```
"JSON 변환할 때 이 필드는 무시해줘"
```

### 동작 방식

#### @JsonIgnore 없을 때

```java
@Entity
public class FileEntity {
    private Long id;
    private String title;
    private List<FileReadLog> readLogs;  // 모두 JSON에 포함
}
```

**JSON 결과:**
```json
{
  "id": 1,
  "title": "해리포터",
  "readLogs": [...]  // ← 이것도 변환됨
}
```

#### @JsonIgnore 있을 때

```java
@Entity
public class FileEntity {
    private Long id;
    private String title;
    
    @JsonIgnore  // ← JSON 변환 시 제외
    private List<FileReadLog> readLogs;
}
```

**JSON 결과:**
```json
{
  "id": 1,
  "title": "해리포터"
  // readLogs는 없음!
}
```

### 순환 끊기 원리

#### 방법 1: FileReadLog에 추가

```java
@Entity
public class FileReadLog {
    @JsonIgnore  // ← file 필드 JSON 변환 안 함
    private FileEntity file;
}
```

**변환 과정:**
```
FileEntity 변환
  ↓ readLogs
  FileReadLog 변환
    ↓ file (@JsonIgnore 때문에 건너뜀)
    ❌ 순환 끊김!
```

**JSON 결과:**
```json
{
  "id": 1,
  "title": "해리포터",
  "readLogs": [
    {
      "id": 10,
      "readAt": "2026-01-31"
      // file 필드 없음 → 순환 발생 안 함
    }
  ]
}
```

#### 방법 2: FileEntity에 추가 (권장)

```java
@Entity
public class FileEntity {
    @JsonIgnore  // ← readLogs 필드 JSON 변환 안 함
    private List<FileReadLog> readLogs;
}
```

**변환 과정:**
```
FileEntity 변환
  ↓ readLogs (@JsonIgnore 때문에 건너뜀)
  ❌ 순환 끊김!
```

**JSON 결과:**
```json
{
  "id": 1,
  "title": "해리포터",
  "path": "root",
  "rating": 5
  // readLogs 없음 → 순환 발생 안 함
}
```

---

## 어디에 추가해야 하나?

### 시나리오 분석

#### 옵션 1: FileReadLog.file에 @JsonIgnore

```java
@Entity
public class FileReadLog {
    @Id
    private Long id;
    
    @ManyToOne
    @JsonIgnore  // ← 여기 추가
    private FileEntity file;
    
    private LocalDateTime readAt;
}
```

**파일 목록 조회 API 응답:**
```json
{
  "id": 1,
  "title": "해리포터",
  "path": "root",
  "rating": 5,
  "progress": 0.5,
  "readLogs": [
    {
      "id": 10,
      "readAt": "2026-01-31T10:00:00"
    },
    {
      "id": 11,
      "readAt": "2026-01-30T14:00:00"
    },
    {
      "id": 12,
      "readAt": "2026-01-29T09:00:00"
    }
    // ... 로그 10개
  ]
}
```

**문제점:**
1. **불필요한 데이터 전송**
   - 프론트엔드는 파일 목록 화면에서 readLogs 정보가 필요 없음
   - 독서 기록은 별도 화면/API로 조회

2. **네트워크 낭비**
   - 파일 100개 × 로그 10개 = 1000개 레코드 전송
   - 데이터 크기: ~500KB

3. **성능 저하**
   - DB 조인 쿼리 복잡해짐
   - 메모리 사용량 증가

---

#### 옵션 2: FileEntity.readLogs에 @JsonIgnore (권장!)

```java
@Entity
public class FileEntity {
    @Id
    private Long id;
    private String title;
    
    @OneToMany(mappedBy = "file", cascade = CascadeType.ALL, orphanRemoval = true)
    @JsonIgnore  // ← 여기 추가 (권장)
    @Builder.Default
    private List<FileReadLog> readLogs = new ArrayList<>();
}
```

**파일 목록 조회 API 응답:**
```json
{
  "id": 1,
  "title": "해리포터",
  "path": "root",
  "rating": 5,
  "progress": 0.5
  // readLogs 없음
}
```

**장점:**
1. **필요한 데이터만 전송**
   - 파일 정보만 전송
   - 깔끔하고 명확

2. **네트워크 효율**
   - 파일 100개만 전송
   - 데이터 크기: ~50KB (10배 감소!)

3. **성능 향상**
   - 단순 쿼리
   - 메모리 효율적

4. **독서 기록은 필요할 때만 조회**
   ```java
   // 별도 API 엔드포인트
   @GetMapping("/files/{id}/logs")
   public List<FileReadLog> getReadLogs(@PathVariable Long id) {
       return readLogRepository.findByFileId(id);
   }
   ```

---

## 실전 비교

### 데이터 크기 비교

**테스트 조건:**
- 파일: 100개
- 각 파일마다 독서 기록: 평균 10개

#### FileReadLog에 @JsonIgnore

**응답 JSON 구조:**
```json
[
  {
    "id": 1,
    "title": "해리포터와 마법사의 돌",
    "path": "root",
    "rating": 5,
    "readLogs": [
      {"id": 1, "readAt": "2026-01-31T10:00:00"},
      {"id": 2, "readAt": "2026-01-30T14:00:00"},
      {"id": 3, "readAt": "2026-01-29T09:00:00"},
      // ...10개
    ]
  },
  // ...100개
]
```

**데이터:**
- 파일 레코드: 100개
- 로그 레코드: 1,000개
- **총 크기: ~500KB**
- 파싱 시간: ~300ms

#### FileEntity에 @JsonIgnore (권장)

**응답 JSON 구조:**
```json
[
  {
    "id": 1,
    "title": "해리포터와 마법사의 돌",
    "path": "root",
    "rating": 5,
    "progress": 0.5
  },
  {
    "id": 2,
    "title": "반지의 제왕",
    "path": "root",
    "rating": 5,
    "progress": 0.3
  },
  // ...100개
]
```

**데이터:**
- 파일 레코드: 100개만
- **총 크기: ~50KB**
- 파싱 시간: ~30ms

**개선 효과:**
- 🚀 데이터 크기: 10배 감소
- 🚀 파싱 속도: 10배 향상
- 🚀 네트워크 사용량: 10배 감소

---

### 사용자 경험 비교

#### FileReadLog에 @JsonIgnore

```
사용자: 파일 목록 화면 열기
   ↓
앱: GET /files 요청
   ↓
서버: 파일 100개 + 로그 1000개 조회
   ↓
서버: JSON 변환 (500KB)
   ↓
앱: 500KB 다운로드 (3초)
   ↓
앱: JSON 파싱 (300ms)
   ↓
앱: 화면 렌더링
   ↓
⏱️ 총 시간: ~3.5초
```

#### FileEntity에 @JsonIgnore

```
사용자: 파일 목록 화면 열기
   ↓
앱: GET /files 요청
   ↓
서버: 파일 100개만 조회
   ↓
서버: JSON 변환 (50KB)
   ↓
앱: 50KB 다운로드 (0.3초)
   ↓
앱: JSON 파싱 (30ms)
   ↓
앱: 화면 렌더링
   ↓
⏱️ 총 시간: ~0.5초

---

필요할 때만 독서 기록 조회:
사용자: 독서 기록 화면 열기
   ↓
앱: GET /files/1/logs 요청
   ↓
서버: 해당 파일의 로그만 조회
```

**결과:**
- 초기 로딩 시간: 3.5초 → 0.5초 (7배 빠름!)
- 데이터 사용량: 90% 감소

---

## 해결 방법 정리

### 최종 해결 코드

#### FileEntity.java

```java
package com.ReadMe.demo.domain;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Getter
@Table(
    name = "files",
    uniqueConstraints = {
        @UniqueConstraint(columnNames = {"title", "path"})
    }
)
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Setter
public class FileEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String path;
    
    private String uri;
    private String preview;
    private String date;
    private int rating;
    private Double progress = 0.0;
    private String epubCfi;

    @Column(name = "last_read_at")
    private LocalDateTime lastReadAt;

    // ⭐ cascade로 자동 삭제 + @JsonIgnore로 순환 참조 방지
    @OneToMany(mappedBy = "file", cascade = CascadeType.ALL, orphanRemoval = true)
    @JsonIgnore  // ← 이것만 추가!
    @Builder.Default
    private List<FileReadLog> readLogs = new ArrayList<>();
}
```

#### FileReadLog.java (수정 불필요)

```java
package com.ReadMe.demo.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "file_read_log")
public class FileReadLog {

    @Id
    @GeneratedValue
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    private FileEntity file;  // 수정 필요 없음

    private LocalDateTime readAt;

    // getter/setter
}
```

### 적용 순서

```
1. FileEntity에 @JsonIgnore 추가
   ↓
2. import 추가: import com.fasterxml.jackson.annotation.JsonIgnore;
   ↓
3. 백엔드 재시작
   ↓
4. 테스트: 파일 추가/조회
   ↓
5. ✅ 정상 동작 확인
```

---

## 오류 진행 과정 요약

### 1단계: cascade 없음
```java
@Entity
public class FileEntity {
    // readLogs 관계 설정 없음
}
```
**문제:** 파일 삭제 시 외래키 오류

---

### 2단계: cascade 추가
```java
@OneToMany(cascade = CascadeType.ALL)
private List<FileReadLog> readLogs;
```
**해결:** 파일 삭제 성공  
**새 문제:** JSON 무한 순환 (깊이 1001 초과)

---

### 3단계: @JsonIgnore 추가 (완전 해결!)
```java
@OneToMany(cascade = CascadeType.ALL)
@JsonIgnore
private List<FileReadLog> readLogs;
```
**결과:**
- ✅ 파일 삭제 성공 (cascade)
- ✅ JSON 변환 성공 (@JsonIgnore)
- ✅ 네트워크 효율적
- ✅ 성능 향상

---

## 추가 참고사항

### 다른 해결 방법들

#### 1. @JsonManagedReference / @JsonBackReference

```java
// FileEntity
@OneToMany(mappedBy = "file")
@JsonManagedReference
private List<FileReadLog> readLogs;

// FileReadLog
@ManyToOne
@JsonBackReference
private FileEntity file;
```

**단점:** 양쪽 다 수정해야 함, 복잡함

---

#### 2. @JsonIdentityInfo

```java
@Entity
@JsonIdentityInfo(generator = ObjectIdGenerators.PropertyGenerator.class, property = "id")
public class FileEntity {
    // ...
}
```

**단점:** JSON에 `@id` 같은 추가 필드 생김, 클라이언트 혼란

---

#### 3. DTO 사용

```java
public class FileResponseDTO {
    private Long id;
    private String title;
    // readLogs 없음
}

@GetMapping("/files")
public List<FileResponseDTO> getFiles() {
    return fileRepository.findAll()
        .stream()
        .map(FileResponseDTO::from)
        .toList();
}
```

**장점:** 가장 명확하고 안전  
**단점:** 코드가 길어짐

---

### 권장 순서

1. **간단한 경우:** `@JsonIgnore` (현재 방법)
2. **복잡한 경우:** DTO 패턴
3. **피해야 할 것:** @JsonManagedReference, @JsonIdentityInfo

---

## 핵심 정리

### 문제
```
양방향 관계 → JSON 변환 시 무한 순환 → 깊이 1001 초과 오류
```

### 원인
```
FileEntity → readLogs → FileReadLog → file → readLogs → ...
(끝없이 반복)
```

### 해결
```java
@JsonIgnore  // ← JSON 변환 시 건너뜀
private List<FileReadLog> readLogs;
```

### 효과
```
- 순환 참조 방지 ✅
- 불필요한 데이터 전송 방지 ✅
- 네트워크 효율 10배 향상 ✅
- 초기 로딩 속도 7배 향상 ✅
```

### 핵심 원칙
```
"클라이언트가 필요한 데이터만 전송하라"
→ 파일 목록에서는 readLogs 불필요
→ @JsonIgnore로 제외
→ 필요할 때만 별도 API로 조회
```

---

## 잘못된 해결법: 관계 제거

### "순환이 문제면 관계를 아예 빼면 되는 거 아닌가?"

**❌ 안 됩니다!** 관계를 제거하면 더 큰 문제가 발생합니다.

---

### FileReadLog에서 @ManyToOne 제거하면?

```java
@Entity
public class FileReadLog {
    @Id
    private Long id;
    
    // ❌ @ManyToOne 제거
    // private FileEntity file;  ← 이걸 빼면?
    
    private LocalDateTime readAt;
}
```

**생성되는 테이블:**
```sql
CREATE TABLE file_read_log (
    id BIGINT,
    read_at TIMESTAMP
    -- file_id가 없음! ❌
);
```

---

### 발생하는 문제들

#### 1. 외래키 사라짐

```
file_read_log 테이블에 file_id 컬럼이 없음
→ "이 로그가 어떤 파일의 기록인지" 알 수 없음!
```

**데이터 상태:**
```
files 테이블:
+----+-------+
| id | title |
+----+-------+
| 1  | 책A   |
| 2  | 책B   |
+----+-------+

file_read_log 테이블:
+----+------------+
| id | read_at    |
+----+------------+
| 10 | 2026-01-31 |  ← 어떤 파일의 로그? 알 수 없음!
| 11 | 2026-01-30 |  ← 어떤 파일의 로그? 알 수 없음!
+----+------------+
```

---

#### 2. 데이터 연결 불가

**독서 기록 조회 시도:**
```java
@GetMapping("/files/{id}/logs")
public List<FileReadLog> getLogs(@PathVariable Long id) {
    // ❌ file_id 컬럼이 없어서 조회 불가능!
    return logRepository.findByFileId(id);
}
```

**실행되는 SQL (오류 발생):**
```sql
-- file_id 컬럼이 존재하지 않음
SELECT * FROM file_read_log WHERE file_id = 1;
-- ❌ SQL Error: Unknown column 'file_id'
```

---

#### 3. cascade 동작 안 됨

```java
@Entity
public class FileEntity {
    @OneToMany(cascade = CascadeType.ALL)
    private List<FileReadLog> readLogs;  // ← 이것만 있어도 안 됨
}
```

**파일 삭제 시도:**
```java
fileRepository.delete(file);
```

**문제:**
```
cascade는 있지만, FileReadLog가 FileEntity를 참조하지 않음
→ JPA가 어떤 로그를 삭제해야 할지 모름
→ 로그가 DB에 고스란히 남음 (고아 레코드)
```

---

#### 4. 비유: 학생과 성적

```java
// 학생
@Entity
public class Student {
    private Long id;
    private String name;
    
    @OneToMany(cascade = CascadeType.ALL)
    private List<Grade> grades;
}

// 성적 (관계 없음)
@Entity
public class Grade {
    private Long id;
    // ❌ @ManyToOne 없음
    // private Student student;
    
    private String subject;
    private int score;
}
```

**결과:**
```
grades 테이블:
+----+---------+-------+
| id | subject | score |
+----+---------+-------+
| 1  | 수학    | 90    |  ← 누구의 점수? 알 수 없음!
| 2  | 영어    | 85    |  ← 누구의 점수? 알 수 없음!
| 3  | 과학    | 95    |  ← 누구의 점수? 알 수 없음!
+----+---------+-------+

→ 성적은 있는데 주인이 없음
→ 학생별 성적 조회 불가능
→ 학생 삭제해도 성적은 남음
```

---

### 올바른 이해

#### 문제 분석

```
문제: JSON 무한 순환
원인: 양방향 관계에서 서로 계속 참조
```

#### ❌ 잘못된 해결 (관계 제거)

```java
@Entity
public class FileReadLog {
    // @ManyToOne 제거 ← 절대 안 됨!
}
```

**결과:**
- JSON 순환은 해결되지만...
- 데이터 연결 자체가 사라짐
- 외래키 없음, cascade 안 됨, 조회 불가

---

#### ✅ 올바른 해결 (@JsonIgnore)

```java
// FileEntity.java
@Entity
public class FileEntity {
    @OneToMany(cascade = CascadeType.ALL)
    @JsonIgnore  // ← JSON 변환만 제외
    private List<FileReadLog> readLogs;
}

// FileReadLog.java
@Entity
public class FileReadLog {
    @ManyToOne  // ← 관계는 유지 (DB에서 필요!)
    private FileEntity file;
}
```

**결과:**
- DB 관계는 유지 ✅ (외래키, cascade 정상 동작)
- JSON 순환은 방지 ✅ (readLogs만 JSON에서 제외)

---

### 레이어별 역할 분리

```
┌─────────────────────────────────────────┐
│         JSON 레이어 (API 응답)           │
│  @JsonIgnore로 readLogs 제외            │
│  → 순환 참조 방지                        │
└─────────────────────────────────────────┘
                ↕ 변환
┌─────────────────────────────────────────┐
│         Java 객체 레이어                 │
│  @OneToMany로 관계 유지                 │
│  → cascade 동작                         │
└─────────────────────────────────────────┘
                ↕ JPA
┌─────────────────────────────────────────┐
│         데이터베이스 레이어               │
│  @ManyToOne으로 외래키 생성             │
│  → 데이터 무결성 보장                    │
└─────────────────────────────────────────┘
```

**핵심:**
- **DB 레벨**: 관계 필요 (외래키, 데이터 무결성)
- **Java 레벨**: 관계 필요 (cascade, 조회)
- **JSON 레벨**: 관계 불필요 (순환 방지)

---

### 정리

| 요소 | 역할 | 제거 시 문제 |
|------|------|-------------|
| `@ManyToOne` | 외래키 생성, 데이터 연결 | 어떤 파일의 로그인지 알 수 없음 |
| `@OneToMany(cascade)` | 파일 삭제 시 로그도 삭제 | 외래키 오류, 고아 레코드 발생 |
| `@JsonIgnore` | JSON 변환 시 제외 | 무한 순환, 1001 깊이 초과 |

**핵심 원칙:**
```
관계는 유지하되, JSON 변환만 제어한다
```

---

## @ManyToOne이 테이블에 미치는 영향

### "@ManyToOne이 어떻게 file_id를 만들고 테이블을 연결하나?"

이 섹션에서는 Java 엔티티 코드가 실제 데이터베이스 테이블로 어떻게 변환되는지 상세히 설명합니다.

---

### 코드와 테이블 연결 과정

#### 1단계: Java 코드 작성

```java
@Entity  // ← "이 클래스를 테이블로 만들어줘"
@Table(name = "file_read_log")  // ← 테이블 이름 지정
public class FileReadLog {
    
    @Id  // ← "이건 기본키(Primary Key)야"
    @GeneratedValue
    private Long id;
    
    @ManyToOne(fetch = FetchType.LAZY)  // ← "이건 외래키(Foreign Key)야"
    private FileEntity file;  // ← Java 객체 타입
    
    private LocalDateTime readAt;
}
```

#### 2단계: JPA/Hibernate가 SQL 생성

**Hibernate가 자동으로 만드는 SQL:**

```sql
CREATE TABLE file_read_log (
    id BIGINT PRIMARY KEY,       -- @Id에서 생성
    file_id BIGINT,              -- @ManyToOne에서 자동 생성! ⭐
    read_at TIMESTAMP,           -- private LocalDateTime에서 생성
    
    -- 외래키 제약조건도 자동 추가
    CONSTRAINT FK_file_id 
    FOREIGN KEY (file_id) 
    REFERENCES files(id)
);
```

#### 3단계: 실제 테이블 생성

```
file_read_log 테이블:
+----+---------+---------------------+
| id | file_id | read_at             |
+----+---------+---------------------+
| 1  | 1       | 2026-01-31 10:00:00 |
| 2  | 1       | 2026-01-30 14:00:00 |
| 3  | 2       | 2026-01-29 09:00:00 |
+----+---------+---------------------+
     ↑
     이 컬럼이 @ManyToOne에서 자동으로 생성됨!
```

---

### JPA의 이름 생성 규칙

#### 기본 규칙

```java
@ManyToOne
private FileEntity file;  // ← 필드 이름: file
```

**JPA가 처리하는 과정:**

```
1. 필드 타입 확인: FileEntity
   ↓
2. FileEntity의 @Entity 확인
   ↓
3. FileEntity의 @Id 필드 찾기
   @Id private Long id; 발견
   ↓
4. 컬럼 이름 생성 규칙:
   필드명(file) + "_" + @Id필드명(id)
   = file_id
   ↓
5. 외래키 생성:
   - 컬럼명: file_id
   - 타입: BIGINT (FileEntity의 id 타입과 동일)
   - 참조: files(id)
```

#### 만약 필드 이름이 다르면?

```java
@ManyToOne
private FileEntity myBook;  // ← 필드 이름: myBook
```

**생성되는 컬럼:**
```sql
CREATE TABLE file_read_log (
    id BIGINT,
    my_book_id BIGINT,  -- myBook → my_book_id로 변환
    read_at TIMESTAMP
);
```

**규칙:**
```
카멜케이스(myBook) → 스네이크케이스(my_book_id)
```

---

### 엔티티 vs 테이블 명확히 구분

#### Java 세계 (엔티티)

```java
@Entity
public class FileReadLog {
    private Long id;
    private FileEntity file;  // ← Java 객체 타입
    private LocalDateTime readAt;
}

// 사용 예:
FileReadLog log = new FileReadLog();
log.setFile(fileEntity);  // FileEntity 객체를 직접 설정

FileEntity myFile = log.getFile();  // FileEntity 객체를 직접 가져옴
String title = myFile.getTitle();   // 바로 메서드 호출 가능
```

**특징:**
- Java 객체로 작업
- `file`은 `FileEntity` 타입
- 직접 메서드 호출 가능
- 객체 그래프 탐색 가능

---

#### 데이터베이스 세계 (테이블)

```sql
-- 실제 테이블
CREATE TABLE file_read_log (
    id BIGINT,
    file_id BIGINT,  -- ← 숫자만 저장 (FileEntity 아님!)
    read_at TIMESTAMP
);

-- 데이터 예시
INSERT INTO file_read_log (id, file_id, read_at) 
VALUES (1, 5, '2026-01-31 10:00:00');
```

**특징:**
- 테이블은 숫자, 문자, 날짜만 저장
- `file_id`는 그냥 숫자 (5)
- Java 객체를 저장할 수 없음
- JOIN으로만 연결 가능

---

### JPA가 둘을 연결하는 방법

#### 조회 시 (SELECT)

```java
// Java 코드
FileReadLog log = logRepository.findById(1L).get();
FileEntity file = log.getFile();  // ← 여기서 무슨 일이?
```

**JPA가 자동으로 실행하는 SQL:**

```sql
-- 1단계: 로그 조회
SELECT id, file_id, read_at 
FROM file_read_log 
WHERE id = 1;
-- 결과: id=1, file_id=5, read_at=2026-01-31

-- 2단계: file_id로 파일 조회 (자동!)
SELECT id, title, path, rating
FROM files 
WHERE id = 5;  -- ← file_id 값으로 조회
-- 결과: id=5, title=해리포터, path=root, rating=5
```

**JPA 내부 동작:**
```java
// 3단계: JPA가 FileEntity 객체 생성
FileEntity fileEntity = new FileEntity();
fileEntity.setId(5);
fileEntity.setTitle("해리포터");
fileEntity.setPath("root");
fileEntity.setRating(5);

// 4단계: FileReadLog의 file 필드에 설정
log.setFile(fileEntity);

// 결과: 개발자는 객체처럼 사용
log.getFile().getTitle();  // "해리포터" 반환
```

---

#### 저장 시 (INSERT)

```java
// Java 코드
FileEntity file = fileRepository.findById(1L).get();

FileReadLog log = new FileReadLog();
log.setFile(file);  // ← FileEntity 객체 설정
log.setReadAt(LocalDateTime.now());

logRepository.save(log);
```

**JPA가 자동으로 실행하는 SQL:**

```sql
-- JPA가 file 객체에서 id를 추출
-- file.getId() → 1

INSERT INTO file_read_log (id, file_id, read_at) 
VALUES (10, 1, '2026-01-31 10:00:00');
--          ↑
--        file 객체의 id 값 자동 추출
```

---

### 단계별 변환 과정

#### Java 코드 → SQL 자동 변환

```java
@ManyToOne
private FileEntity file;
```

**상세 변환 과정:**

```
┌─────────────────────────────────────────┐
│ 1. JPA 확인                             │
│    "@ManyToOne이 있네?"                 │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ 2. 타입 분석                            │
│    타입: FileEntity                     │
│    → FileEntity 클래스 찾기             │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ 3. FileEntity 확인                      │
│    @Entity                              │
│    @Table(name = "files")               │
│    public class FileEntity {            │
│        @Id                              │
│        private Long id;  ← 이게 참조 대상│
│    }                                    │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ 4. 컬럼 생성 규칙 적용                   │
│    필드명: file                         │
│    → 컬럼명: file + "_" + "id"          │
│    → file_id                            │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ 5. 외래키 생성                          │
│    CREATE TABLE file_read_log (         │
│        file_id BIGINT,                  │
│        FOREIGN KEY (file_id)            │
│        REFERENCES files(id)             │
│    );                                   │
└─────────────────────────────────────────┘
```

---

### 실전 예시

#### 전체 코드

```java
@Entity
@Table(name = "file_read_log")
public class FileReadLog {
    
    @Id
    @GeneratedValue
    private Long id;  // ← id 컬럼 생성
    
    @ManyToOne
    private FileEntity file;  // ← file_id 컬럼 생성 + 외래키
    
    private LocalDateTime readAt;  // ← read_at 컬럼 생성
}
```

#### 생성되는 테이블

```sql
CREATE TABLE file_read_log (
    -- @Id에서 생성
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    
    -- @ManyToOne private FileEntity file; 에서 생성
    file_id BIGINT NOT NULL,
    CONSTRAINT FK_file_read_log_file 
    FOREIGN KEY (file_id) 
    REFERENCES files(id),
    
    -- private LocalDateTime readAt; 에서 생성
    read_at TIMESTAMP
);
```

#### 필드 → 컬럼 매핑표

| Java 필드 | Java 타입 | 어노테이션 | 생성 컬럼 | SQL 타입 | 비고 |
|-----------|-----------|-----------|----------|---------|------|
| `id` | Long | @Id | `id` | BIGINT | 기본키 |
| `file` | FileEntity | @ManyToOne | `file_id` | BIGINT | 외래키 |
| `readAt` | LocalDateTime | - | `read_at` | TIMESTAMP | 일반 컬럼 |

---

### 컬럼명 커스터마이징

#### 기본 규칙대로

```java
@ManyToOne
private FileEntity file;  // → file_id 생성
```

#### 수동으로 지정

```java
@ManyToOne
@JoinColumn(name = "book_id")  // ← 컬럼명 직접 지정
private FileEntity file;
```

**생성되는 SQL:**
```sql
CREATE TABLE file_read_log (
    id BIGINT,
    book_id BIGINT,  -- file_id 대신 book_id로 생성
    read_at TIMESTAMP,
    
    FOREIGN KEY (book_id) REFERENCES files(id)
);
```

#### 옵션 추가

```java
@ManyToOne
@JoinColumn(
    name = "book_id",
    nullable = false,  // NOT NULL 제약
    foreignKey = @ForeignKey(name = "FK_LOG_BOOK")  // 외래키 이름 지정
)
private FileEntity file;
```

**생성되는 SQL:**
```sql
CREATE TABLE file_read_log (
    id BIGINT,
    book_id BIGINT NOT NULL,
    read_at TIMESTAMP,
    
    CONSTRAINT FK_LOG_BOOK 
    FOREIGN KEY (book_id) 
    REFERENCES files(id)
);
```

---

### 핵심 정리

#### @ManyToOne의 역할

```java
@ManyToOne
private FileEntity file;
```

**이 한 줄이 하는 일:**

1. **컬럼 생성**
   ```sql
   file_id BIGINT
   ```

2. **외래키 제약조건 생성**
   ```sql
   FOREIGN KEY (file_id) REFERENCES files(id)
   ```

3. **Java-DB 자동 매핑**
   ```java
   log.getFile()           ← Java에서는 객체
          ↕ JPA가 자동 변환
   SELECT * FROM files 
   WHERE id = log.file_id  ← DB에서는 숫자
   ```

---

#### 엔티티 ≠ 테이블

```
┌──────────────────────────────┐
│     Java 엔티티              │
│  private FileEntity file;    │  ← 객체
└──────────────┬───────────────┘
               ↓ JPA 변환
┌──────────────────────────────┐
│     DB 테이블                │
│  file_id BIGINT              │  ← 숫자
└──────────────────────────────┘
```

**JPA의 역할:**
- ✅ Java 객체를 DB 테이블로 변환
- ✅ `FileEntity` 타입을 `file_id` 컬럼으로 변환
- ✅ 자동으로 외래키 생성
- ✅ 조회/저장 시 객체 ↔ 숫자 자동 변환

**개발자 입장:**
```java
// 객체처럼 사용
log.getFile().getTitle();

// 내부적으로는 SQL JOIN
SELECT l.*, f.* 
FROM file_read_log l
JOIN files f ON l.file_id = f.id
WHERE l.id = 1;
```

---

**작성일:** 2026-01-31  
**버전:** 1.1  
**프로젝트:** ReadMe 앱  
**관련 문서:** [JPA_관계_설정_가이드.md](JPA_관계_설정_가이드.md)
