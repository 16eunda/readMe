# JPA 관계 설정 완벽 가이드

## 📚 목차
1. [엔티티 vs 테이블](#엔티티-vs-테이블)
2. [외래키가 생성되는 원리](#외래키가-생성되는-원리)
3. [실제 오류 사례 분석](#실제-오류-사례-분석)
4. [JPA 관계 어노테이션](#jpa-관계-어노테이션)
5. [cascade와 orphanRemoval](#cascade와-orphanremoval)
6. [코드 동작 원리 상세](#코드-동작-원리-상세)
7. [실전 예제](#실전-예제)

---

## 엔티티 vs 테이블

### 테이블 (Table)
- **실제 데이터베이스**에 저장되는 구조
- SQL로 생성: `CREATE TABLE files (...)`
- 행(Row)과 열(Column)로 구성

```sql
-- 실제 DB에 생성되는 테이블
CREATE TABLE files (
    id BIGINT PRIMARY KEY,
    title VARCHAR(255),
    path VARCHAR(255)
);

CREATE TABLE file_read_log (
    id BIGINT PRIMARY KEY,
    file_id BIGINT,  -- 외래키!
    read_at TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id)
);
```

### 엔티티 (Entity)
- **Java 코드**로 작성하는 클래스
- `@Entity` 어노테이션 사용
- JPA/Hibernate가 자동으로 테이블로 변환

```java
@Entity
@Table(name = "files")  // 테이블 이름 지정
public class FileEntity {
    @Id
    @GeneratedValue
    private Long id;
    
    private String title;
    private String path;
}
```

### 🔄 변환 과정
```
Java 엔티티 클래스
       ↓
  JPA/Hibernate
       ↓
   SQL DDL 생성
       ↓
데이터베이스 테이블
```

**결론: 엔티티 ≠ 테이블**
- 엔티티 = Java 객체 (코드)
- 테이블 = 데이터베이스 구조 (실제 저장소)
- JPA가 엔티티를 보고 테이블을 자동 생성

---

## 외래키가 생성되는 원리

### ❌ 오해
```java
// FileEntity에 관계 설정 없음
@Entity
public class FileEntity {
    private Long id;
    // ...관계 설정 없음
}

// "외래키가 없겠지?"  ← 틀림!
```

### ✅ 진실

```java
// FileReadLog에 @ManyToOne만 있어도
@Entity
public class FileReadLog {
    @ManyToOne  // ⬅️ 이것만으로 외래키 생성!
    private FileEntity file;
}
```

**JPA가 자동으로 생성하는 SQL:**
```sql
CREATE TABLE file_read_log (
    id BIGINT,
    file_id BIGINT,  -- 자동 추가!
    read_at TIMESTAMP,
    
    -- 외래키 제약조건도 자동 추가!
    CONSTRAINT FK_file_id 
    FOREIGN KEY (file_id) 
    REFERENCES files(id)
);
```

### 🔑 핵심 규칙
```
@ManyToOne 또는 @OneToOne 있음
    ↓
JPA가 외래키 컬럼 생성
    ↓
외래키 제약조건 자동 추가
    ↓
삭제 시 제약조건 위반 가능!
```

---

## 실제 오류 사례 분석

### 발생한 오류

ReadMe 앱 개발 중 파일 삭제 시 다음 오류가 발생했습니다:

```
org.h2.jdbc.JdbcSQLIntegrityConstraintViolationException: 
Referential integrity constraint violation: 
"FKO7FEEFQ9SOCXHAD329B5J2XQA: PUBLIC.FILE_READ_LOG FOREIGN KEY(FILE_ID) 
REFERENCES PUBLIC.FILES(ID) (CAST(1 AS BIGINT))"; 
SQL statement: delete from files where id=? [23503-232]
```

### 오류 원인 분석

#### 당시 코드 상태

```java
// FileEntity.java - 관계 설정 없음
@Entity
public class FileEntity {
    @Id
    private Long id;
    private String title;
    // ...관계 설정 없음
}

// FileReadLog.java - @ManyToOne만 있음
@Entity
public class FileReadLog {
    @ManyToOne(fetch = FetchType.LAZY)
    private FileEntity file;  // ⬅️ 외래키는 생성됨!
    private LocalDateTime readAt;
}
```

#### 왜 오류가 났을까?

**1단계: 외래키 자동 생성**
```java
@ManyToOne  // ⬅️ 이것만으로 외래키 생성!
private FileEntity file;
```

JPA가 자동으로 생성한 SQL:
```sql
CREATE TABLE file_read_log (
    id BIGINT,
    file_id BIGINT,  -- 자동 생성!
    read_at TIMESTAMP,
    
    -- 외래키 제약조건도 자동 추가!
    CONSTRAINT FK_file_id 
    FOREIGN KEY (file_id) 
    REFERENCES files(id)
);
```

**2단계: 삭제 시도**
```java
// Service에서 파일 삭제
fileRepository.deleteById(1L);
```

**3단계: DB가 거부**
```
❌ 오류 발생!
"안 돼! file_read_log 테이블에 file_id=1인 레코드가 있어!
 외래키 제약조건 때문에 부모(files)를 먼저 지울 수 없어!"
```

### DB 상태 시각화

```
files 테이블:
+----+-------+
| id | title |
+----+-------+
| 1  | 책A   |  ← 이걸 삭제하려고 함
+----+-------+

file_read_log 테이블:
+----+---------+------------+
| id | file_id | read_at    |
+----+---------+------------+
| 10 | 1       | 2026-01-20 |  ← 이게 file_id=1을 참조 중!
| 11 | 1       | 2026-01-25 |  ← 이것도!
+----+---------+------------+

외래키 제약: file_id는 반드시 files.id에 존재하는 값이어야 함
→ files.id=1을 삭제하면 file_read_log의 레코드가 잘못된 값을 참조하게 됨
→ DB가 삭제를 거부!
```

### 오류 메시지 해석

```
Referential integrity constraint violation
→ "참조 무결성 제약 조건 위반"

FOREIGN KEY(FILE_ID) REFERENCES PUBLIC.FILES(ID)
→ "FILE_ID가 FILES 테이블의 ID를 참조하는 외래키임"

delete from files where id=?
→ "files 테이블에서 삭제하려 했지만 실패함"
```

### 해결 방법

**FileEntity에 cascade 추가:**

```java
@Entity
public class FileEntity {
    @Id
    private Long id;
    
    // ✅ 이걸 추가!
    @OneToMany(
        mappedBy = "file",
        cascade = CascadeType.ALL,  // 삭제 명령 전파
        orphanRemoval = true
    )
    private List<FileReadLog> readLogs = new ArrayList<>();
}
```

**해결 후 동작:**
```
1. fileRepository.deleteById(1L) 실행
   ↓
2. JPA: "cascade = ALL 확인! 자식들도 삭제해야지"
   ↓
3. DELETE FROM file_read_log WHERE file_id = 1;
   ↓
4. DELETE FROM files WHERE id = 1;
   ↓
5. ✅ 성공!
```

---

## JPA 관계 어노테이션

### 1. @ManyToOne (다대일)
```java
@Entity
public class FileReadLog {
    @ManyToOne  // 여러 로그 → 1개 파일
    private FileEntity file;
}
```

**의미:**
- FileReadLog **여러 개** → FileEntity **1개**
- 로그가 "다(Many)", 파일이 "일(One)"

**DB 결과:**
```
file_read_log 테이블에 file_id 컬럼 생성 (외래키)
```

### 2. @OneToMany (일대다)
```java
@Entity
public class FileEntity {
    @OneToMany(mappedBy = "file")
    private List<FileReadLog> readLogs;
}
```

**의미:**
- FileEntity **1개** → FileReadLog **여러 개**
- 파일이 "일(One)", 로그가 "다(Many)"

**DB 결과:**
```
FileEntity 테이블에는 아무것도 추가 안 됨!
단지 관계를 "알고 있음"만 선언
```

### 3. 단방향 vs 양방향

#### 단방향 (편도)
```java
// FileReadLog만 FileEntity를 알고 있음
FileReadLog → FileEntity
```

```java
@Entity
public class FileReadLog {
    @ManyToOne
    private FileEntity file;  // 파일 참조 가능
}

@Entity
public class FileEntity {
    // 관계 설정 없음
}
```

**사용 예:**
```java
FileReadLog log = findLog();
FileEntity file = log.getFile();  // ✅ 가능

FileEntity file = findFile();
List<FileReadLog> logs = file.getLogs();  // ❌ 불가능
```

#### 양방향 (쌍방)
```java
// 서로 알고 있음
FileReadLog ↔ FileEntity
```

```java
@Entity
public class FileReadLog {
    @ManyToOne
    private FileEntity file;
}

@Entity
public class FileEntity {
    @OneToMany(mappedBy = "file")
    private List<FileReadLog> readLogs;
}
```

**사용 예:**
```java
FileReadLog log = findLog();
FileEntity file = log.getFile();  // ✅ 가능

FileEntity file = findFile();
List<FileReadLog> logs = file.getReadLogs();  // ✅ 가능
```

---

## cascade와 orphanRemoval

### 문제 상황
```java
// 단방향 관계만 있을 때
@Entity
public class FileReadLog {
    @ManyToOne
    private FileEntity file;  // 외래키 있음
}

// 파일 삭제 시도
fileRepository.delete(file);

// ❌ 오류 발생!
// "file_read_log가 이 파일을 참조하고 있어서 삭제 불가"
```

### 해결: cascade 사용

```java
@Entity
public class FileEntity {
    @OneToMany(
        mappedBy = "file",
        cascade = CascadeType.ALL,      // ⬅️ 핵심!
        orphanRemoval = true
    )
    private List<FileReadLog> readLogs;
}
```

### cascade 종류

| 옵션 | 설명 | 예시 |
|------|------|------|
| `CascadeType.ALL` | 모든 작업 전파 | 삭제/저장/수정 모두 |
| `CascadeType.PERSIST` | 저장만 전파 | 파일 저장 → 로그도 저장 |
| `CascadeType.REMOVE` | 삭제만 전파 | 파일 삭제 → 로그도 삭제 |
| `CascadeType.MERGE` | 병합만 전파 | 파일 수정 → 로그도 수정 |

### orphanRemoval (고아 제거)

```java
@OneToMany(orphanRemoval = true)
private List<FileReadLog> readLogs;
```

**의미:**
```java
// 파일에서 로그 제거
file.getReadLogs().remove(log);
fileRepository.save(file);

// orphanRemoval = true일 때
// → DB에서도 로그 자동 삭제 (고아가 되었으므로)
```

### cascade vs orphanRemoval 차이

```java
// cascade = CascadeType.REMOVE
fileRepository.delete(file);  // 파일 삭제 시 로그도 삭제
file.getReadLogs().remove(log);  // 로그는 안 지워짐

// orphanRemoval = true
fileRepository.delete(file);  // 파일 삭제 시 로그도 삭제
file.getReadLogs().remove(log);  // 로그도 자동 삭제!
```

**권장 조합:**
```java
@OneToMany(
    cascade = CascadeType.ALL,      // 모든 작업 전파
    orphanRemoval = true            // 고아 자동 제거
)
```

---

## 코드 동작 원리 상세

이 섹션에서는 cascade 코드가 **정확히 어떻게** 자동 삭제를 수행하는지 단계별로 분석합니다.

### 추가하는 코드 분해

```java
@OneToMany(mappedBy = "file", cascade = CascadeType.ALL, orphanRemoval = true)
@Builder.Default
private List<FileReadLog> readLogs = new ArrayList<>();
```

---

### 1. `@OneToMany(mappedBy = "file")`

#### 의미
"FileReadLog의 `file` 필드가 주인이야"

```java
// FileReadLog.java
@ManyToOne
private FileEntity file;  // ⬅️ 이게 "주인" (외래키 관리)
```

#### JPA에게 알려주는 것
```
"나(FileEntity)는 여러 로그를 가지고 있지만,
 실제 외래키는 FileReadLog 쪽에 있어.
 FileReadLog의 'file' 필드를 봐."
```

#### 이게 없으면?
JPA가 중간 테이블을 만들려고 시도:
```sql
-- 잘못된 동작: 불필요한 중간 테이블 생성
CREATE TABLE files_read_logs (
    file_entity_id BIGINT,
    read_logs_id BIGINT
);
```

---

### 2. `cascade = CascadeType.ALL`

#### 의미
"내가 받은 모든 명령을 자식들에게도 전파해"

#### Before (cascade 없을 때)

```java
// 1. 파일 삭제 시도
fileRepository.delete(file);

// 2. JPA가 SQL 실행
DELETE FROM files WHERE id = 1;

// 3. DB가 거부
❌ "안 돼! file_read_log가 이 파일을 참조 중이야!"
```

**에러 로그:**
```
org.h2.jdbc.JdbcSQLIntegrityConstraintViolationException: 
Referential integrity constraint violation
```

#### After (cascade 있을 때)

```java
// 1. 파일 삭제 시도
fileRepository.delete(file);

// 2. JPA가 cascade 확인
"아, cascade = ALL이네? 자식들도 같이 삭제해야지!"

// 3. JPA가 자동으로 순서대로 SQL 실행
DELETE FROM file_read_log WHERE file_id = 1;  // 먼저 로그 삭제
DELETE FROM files WHERE id = 1;                // 그 다음 파일 삭제

// 4. 성공! ✅
```

#### 실제 SQL 실행 순서

```sql
-- JPA가 자동으로 생성하는 쿼리 순서

-- 1단계: 자식 레코드 조회
SELECT * FROM file_read_log WHERE file_id = 1;
-- 결과: 3개 발견 (id: 101, 102, 103)

-- 2단계: 자식 레코드 삭제
DELETE FROM file_read_log WHERE id = 101;
DELETE FROM file_read_log WHERE id = 102;
DELETE FROM file_read_log WHERE id = 103;

-- 3단계: 부모 레코드 삭제
DELETE FROM files WHERE id = 1;

-- ✅ 완료!
```

#### cascade 종류별 동작

```java
// CascadeType.ALL = 모든 작업 전파
fileRepository.delete(file);     // 자식도 삭제 ✅
fileRepository.save(file);       // 자식도 저장 ✅
entityManager.merge(file);       // 자식도 병합 ✅

// CascadeType.REMOVE = 삭제만 전파
fileRepository.delete(file);     // 자식도 삭제 ✅
fileRepository.save(file);       // 자식 저장 안 됨 ❌

// CascadeType.PERSIST = 저장만 전파
fileRepository.save(file);       // 자식도 저장 ✅
fileRepository.delete(file);     // ❌ 오류 발생 (자식 때문에)
```

---

### 3. `orphanRemoval = true`

#### 의미
"부모와 관계가 끊어진 자식은 자동으로 삭제해"

#### 동작 예시

```java
// 1. 파일과 로그 조회
FileEntity file = fileRepository.findById(1L).get();
// 현재: readLogs에 3개 로그 있음

// 2. 로그 1개 제거 (관계 끊기)
FileReadLog removedLog = file.getReadLogs().remove(0);

// 3. 저장
fileRepository.save(file);

// 4. orphanRemoval = true일 때
// → DB에서도 그 로그가 삭제됨!
```

**JPA가 자동 실행하는 SQL:**
```sql
-- 부모와 관계가 끊어진 자식 감지
DELETE FROM file_read_log WHERE id = 101;
```

#### orphanRemoval = false면?

```java
// 로그 제거
file.getReadLogs().remove(log);
fileRepository.save(file);

// DB 상태:
// 로그는 남아있고, file_id만 NULL이 됨
file_read_log 테이블:
+----+---------+
| id | file_id |
+----+---------+
| 10 | NULL    |  ← 고아 레코드 (좋지 않음)
+----+---------+
```

#### cascade vs orphanRemoval 차이

```java
// cascade = CascadeType.REMOVE
fileRepository.delete(file);          // 자식 삭제 ✅
file.getReadLogs().remove(log);       // 자식 안 지워짐 ❌

// orphanRemoval = true
fileRepository.delete(file);          // 자식 삭제 ✅
file.getReadLogs().remove(log);       // 자식 자동 삭제 ✅
```

---

### 4. `@Builder.Default`

#### 의미
Lombok Builder 사용 시 초기값 설정

#### 없을 때

```java
// @Builder.Default 없으면
FileEntity file = FileEntity.builder()
    .title("해리포터")
    .path("root")
    .build();

List<FileReadLog> logs = file.getReadLogs();
// ❌ NullPointerException 발생!
```

#### 있을 때

```java
// @Builder.Default 있으면
FileEntity file = FileEntity.builder()
    .title("해리포터")
    .path("root")
    .build();

List<FileReadLog> logs = file.getReadLogs();
// ✅ [] (빈 리스트 반환)

file.getReadLogs().add(newLog);  // ✅ 안전하게 추가 가능
```

---

### 전체 동작 흐름 시각화

#### 시나리오 1: 파일 삭제 (cascade)

```
┌─────────────────────────────────────────┐
│ 사용자: fileRepository.delete(file);    │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ JPA: cascade = ALL 확인                 │
│ "자식들도 삭제해야지!"                    │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ JPA: SELECT * FROM file_read_log        │
│      WHERE file_id = 1;                 │
│ → 로그 3개 발견 (id: 101, 102, 103)      │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ JPA: DELETE FROM file_read_log          │
│      WHERE id = 101;                    │
│ JPA: DELETE FROM file_read_log          │
│      WHERE id = 102;                    │
│ JPA: DELETE FROM file_read_log          │
│      WHERE id = 103;                    │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ JPA: DELETE FROM files WHERE id = 1;    │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ ✅ 성공!                                │
└─────────────────────────────────────────┘
```

#### 시나리오 2: 관계 제거 (orphanRemoval)

```
┌─────────────────────────────────────────┐
│ 사용자: file.getReadLogs().remove(log); │
│        fileRepository.save(file);       │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ JPA: orphanRemoval = true 확인          │
│ "이 로그는 이제 부모가 없네? 삭제!"        │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ JPA: DELETE FROM file_read_log          │
│      WHERE id = 101;                    │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│ ✅ 고아 제거 완료!                       │
└─────────────────────────────────────────┘
```

---

### 코드 비교: 수동 vs 자동

#### ❌ cascade 설정 안 했을 때 (수동 처리)

```java
@Service
public class FileService {
    
    public void deleteFile(Long fileId) {
        // 1. 로그 먼저 수동 삭제
        List<FileReadLog> logs = logRepository.findByFileId(fileId);
        logRepository.deleteAll(logs);
        
        // 2. 파일 삭제
        fileRepository.deleteById(fileId);
        
        // 문제점:
        // - 코드가 길어짐
        // - 순서 바뀌면 오류
        // - 트랜잭션 관리 복잡
        // - 실수 가능성 높음
    }
}
```

#### ✅ cascade 설정 했을 때 (자동 처리)

```java
@Service
public class FileService {
    
    public void deleteFile(Long fileId) {
        fileRepository.deleteById(fileId);  // 끝!
        
        // 장점:
        // - 코드 간결
        // - JPA가 순서 보장
        // - 트랜잭션 안전
        // - 실수 방지
    }
}
```

---

### 각 옵션의 역할 정리

| 옵션 | 역할 | 없으면? | DB 영향 |
|------|------|---------|---------|
| `@OneToMany` | "나는 여러 자식 있어" 선언 | 관계 인식 안 됨 | 없음 |
| `mappedBy` | "외래키는 저쪽에 있어" | 중간 테이블 생성 | 불필요한 테이블 |
| `cascade` | "내 명령을 자식에게도 전파" | 수동 삭제 필요 | 삭제 오류 발생 |
| `orphanRemoval` | "고아 자식 자동 삭제" | 고아 레코드 발생 | 데이터 정합성 문제 |
| `@Builder.Default` | "Builder에서 초기값 설정" | NullPointerException | 없음 (런타임 오류) |

---

### 한 줄로 정리하면?

```java
@OneToMany(mappedBy = "file", cascade = CascadeType.ALL, orphanRemoval = true)
@Builder.Default
private List<FileReadLog> readLogs = new ArrayList<>();
```

**이 코드가 하는 일:**
```
"JPA야, 내가 여러 개의 FileReadLog를 가지고 있어.
 외래키는 FileReadLog의 'file' 필드에 있고,
 내가 삭제되면 자식들도 같이 삭제해줘.
 그리고 관계가 끊어진 자식도 자동으로 지워줘.
 Builder로 생성할 때는 빈 리스트로 초기화해줘."
```

**JPA가 하는 일:**
1. 삭제 명령 받음
2. cascade 확인
3. 자식 레코드 조회
4. 자식부터 순차 삭제
5. 부모 삭제
6. 성공 반환

**결론:** 코드 3줄로 복잡한 삭제 로직을 JPA가 자동으로 처리!

---

## 실전 예제

### 현재 ReadMe 앱 구조

#### 문제가 있던 코드
```java
// FileEntity (파일)
@Entity
public class FileEntity {
    @Id
    private Long id;
    private String title;
    // ...관계 설정 없음
}

// FileReadLog (독서 기록)
@Entity
public class FileReadLog {
    @ManyToOne  // 외래키는 생성됨!
    private FileEntity file;
    private LocalDateTime readAt;
}
```

**문제:**
```java
fileRepository.delete(file);
// ❌ 오류: file_read_log가 이 파일을 참조 중!
```

#### 해결된 코드
```java
// FileEntity
@Entity
public class FileEntity {
    @Id
    private Long id;
    
    // ✅ 추가!
    @OneToMany(
        mappedBy = "file",
        cascade = CascadeType.ALL,
        orphanRemoval = true
    )
    @Builder.Default
    private List<FileReadLog> readLogs = new ArrayList<>();
}

// FileReadLog (그대로)
@Entity
public class FileReadLog {
    @ManyToOne
    private FileEntity file;
    private LocalDateTime readAt;
}
```

**결과:**
```java
// 파일 삭제
fileRepository.delete(file);
// ✅ 성공! 관련 독서 기록도 자동 삭제됨
```

### 실제 DB 흐름

#### Before (cascade 없음)
```
1. DELETE FROM files WHERE id = 1
   ↓
2. ❌ 오류 발생!
   "file_read_log에 file_id=1인 레코드 존재"
```

#### After (cascade 있음)
```
1. SELECT * FROM file_read_log WHERE file_id = 1
   ↓
2. DELETE FROM file_read_log WHERE file_id = 1
   ↓
3. DELETE FROM files WHERE id = 1
   ↓
4. ✅ 성공!
```

---

## 🎯 핵심 요약

### 1. 엔티티 ≠ 테이블
- 엔티티 = Java 클래스 (코드)
- 테이블 = 데이터베이스 (실제 저장)
- JPA가 엔티티 → 테이블 변환

### 2. 외래키 생성 시점
```java
@ManyToOne  // ⬅️ 이것만으로 외래키 생성!
private FileEntity file;
```

### 3. 관계 방향
- **단방향**: 한쪽만 상대를 알고 있음
- **양방향**: 서로 알고 있음 (조회 편리)

### 4. cascade 사용 이유
```java
// 없으면: 수동으로 삭제해야 함
logRepository.deleteByFileId(fileId);
fileRepository.deleteById(fileId);

// 있으면: 자동!
fileRepository.deleteById(fileId);  // 끝!
```

### 5. 권장 패턴
```java
@Entity
public class Parent {
    @OneToMany(
        mappedBy = "parent",
        cascade = CascadeType.ALL,
        orphanRemoval = true
    )
    private List<Child> children = new ArrayList<>();
}

@Entity
public class Child {
    @ManyToOne(fetch = FetchType.LAZY)
    private Parent parent;
}
```

---

## 📖 추가 학습 자료

### 관계 종류 치트시트

| 관계 | 예시 | 외래키 위치 |
|------|------|-------------|
| `@ManyToOne` | 여러 로그 → 1개 파일 | 로그 테이블 |
| `@OneToMany` | 1개 파일 → 여러 로그 | 없음 (반대편) |
| `@OneToOne` | 1개 회원 → 1개 프로필 | 한쪽 선택 |
| `@ManyToMany` | 여러 학생 ↔ 여러 강의 | 중간 테이블 |

### fetch 전략

```java
@ManyToOne(fetch = FetchType.LAZY)   // 지연 로딩 (권장)
@ManyToOne(fetch = FetchType.EAGER)  // 즉시 로딩
```

**LAZY (지연):**
```java
FileReadLog log = findLog();
// 이 시점에는 file이 로딩 안 됨
String title = log.getFile().getTitle();
// 사용할 때 SELECT 쿼리 실행
```

**EAGER (즉시):**
```java
FileReadLog log = findLog();
// log를 조회할 때 file도 함께 조회 (JOIN)
```

**권장:**
- `@ManyToOne`, `@OneToOne` → `LAZY`
- `@OneToMany`, `@ManyToMany` → `LAZY` (기본값)

---

## 🛠️ 실습 문제

### 문제 1
다음 코드의 문제점을 찾아보세요:

```java
@Entity
public class Book {
    @Id
    private Long id;
    private String title;
}

@Entity
public class Review {
    @ManyToOne
    private Book book;
    private String content;
}

// 사용
bookRepository.delete(book);  // ?
```

<details>
<summary>답</summary>

**문제:** Review가 Book을 참조하고 있어서 삭제 실패

**해결:**
```java
@Entity
public class Book {
    @OneToMany(mappedBy = "book", cascade = CascadeType.ALL)
    private List<Review> reviews = new ArrayList<>();
}
```
</details>

### 문제 2
다음 중 외래키가 생성되는 것은?

```java
// A
@Entity
public class Post {
    @OneToMany
    private List<Comment> comments;
}

// B
@Entity
public class Comment {
    @ManyToOne
    private Post post;
}
```

<details>
<summary>답</summary>

**B (Comment)에만 외래키 생성**

- `@ManyToOne`, `@OneToOne` → 외래키 생성
- `@OneToMany`, `@ManyToMany` → 외래키 안 생성 (반대편에 생김)
</details>

---

**작성일:** 2026-01-31  
**버전:** 1.0  
**프로젝트:** ReadMe 앱
