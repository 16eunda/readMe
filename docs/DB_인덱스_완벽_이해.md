# DB 인덱스 — 원리부터 실전까지

---

## 1. 인덱스가 없을 때: Full Table Scan

테이블에 유저가 100만 명 있다고 치면,  
`WHERE email = 'abc@gmail.com'` 쿼리는 이렇게 동작해요:

```
[1번 행] email = 'zzz@naver.com'  ❌
[2번 행] email = 'qwe@gmail.com'  ❌
[3번 행] email = 'abc@gmail.com'  ✅ 찾음!
...하지만 DB는 여기서 멈추지 않고 100만 행을 전부 읽음
```

"혹시 동일한 이메일이 더 있을 수도 있으니까" DB는 끝까지 다 뒤져요.  
시간 복잡도: **O(N)**

---

## 2. 인덱스가 있을 때: B-Tree 탐색

인덱스는 내부적으로 **B-Tree** 자료구조로 저장돼요.

```
                     [M]
                   /      \
              [E~L]        [N~Z]
             /     \       /    \
          [E~G]  [H~L]  [N~P]  [Q~Z]
```

`abc@gmail.com` 찾을 때:
1. 루트에서 비교 → `abc` 는 M보다 앞 → 왼쪽
2. 왼쪽 노드에서 비교 → `abc` 는 E~G 범위 → 더 좁혀짐
3. 정확한 위치 바로 찾음

단계 수 = 트리의 높이만큼만 필요.  
100만 건이면 약 **log₂(1,000,000) ≈ 20번**.

시간 복잡도: **O(log N)**

> 📌 **핵심 비유**  
> 책에서 단어 찾을 때 처음부터 한 장씩 넘기는 게 **Full Scan**,  
> **목차/색인** 보고 바로 페이지 가는 게 **Index** 예요.

---

## 3. 인덱스의 실체 — 별도의 정렬된 복사본

인덱스는 원본 테이블과 **별개로 존재하는 정렬된 테이블**이에요.

```
원본 테이블 (users) — 삽입 순서대로 저장, 정렬 안 됨
┌─────┬──────────────────┬───────┬──────────┐
│ id  │ email            │ name  │ password │
├─────┼──────────────────┼───────┼──────────┤
│  5  │ abc@gmail.com    │ 홍길동 │ hash...  │
│  1  │ zzz@naver.com    │ 김철수 │ hash...  │
│  3  │ mno@gmail.com    │ 이영희 │ hash...  │
└─────┴──────────────────┴───────┴──────────┘

인덱스 (idx_users_email) — email 기준으로 정렬된 별도 구조
┌──────────────────┬────────────────┐
│ email (정렬됨)    │ 원본 행 포인터  │
├──────────────────┼────────────────┤
│ abc@gmail.com    │ → row id=5     │
│ mno@gmail.com    │ → row id=3     │
│ zzz@naver.com    │ → row id=1     │
└──────────────────┴────────────────┘
```

흐름:
1. 인덱스에서 `abc@gmail.com` 을 B-Tree로 빠르게 찾음
2. 포인터를 따라 원본 테이블의 해당 행으로 바로 점프
3. 끝

---

## 4. 복합 인덱스 — 순서가 핵심!

### 예시 쿼리

```sql
UPDATE file_entity
SET user_id = :userId
WHERE device_id = :deviceId
  AND user_id IS NULL
```

### `INDEX(device_id, user_id)` 일 때

B-Tree가 **device_id 로 먼저 정렬**, 같은 device_id 안에서 **user_id 로 다시 정렬**돼요.

```
인덱스 내부
┌────────────┬─────────┬────────────┐
│ device_id  │ user_id │ 행 포인터   │
├────────────┼─────────┼────────────┤
│ 'aaa'      │  NULL   │ → row 1    │
│ 'aaa'      │   5     │ → row 2    │
│ 'abc123'   │  NULL   │ → row 3    │  ← 바로 여기로 점프!
│ 'abc123'   │   7     │ → row 4    │
│ 'bbb'      │  NULL   │ → row 5    │
└────────────┴─────────┴────────────┘
```

`device_id = 'abc123' AND user_id IS NULL`  
→ 인덱스 안에서만 두 조건 동시에 걸러냄  
→ 원본 테이블 거의 안 봐도 됨 ✅

### 순서를 바꾸면?

```sql
-- 인덱스가 INDEX(user_id, device_id) 로 되어 있다면
-- user_id 기준으로 먼저 정렬되어 있음

WHERE device_id = 'abc123' AND user_id IS NULL
```

`user_id IS NULL` 인 행이 수십만 개라면?  
→ 그 수십만 개 중에서 device_id를 하나씩 뒤져야 함  
→ 이득이 훨씬 줄어듦

> 📌 **복합 인덱스는 WHERE 조건에서 가장 선택도(좁히는 정도)가 높은 컬럼을 앞에!**  
> `device_id` 는 유저마다 고유 → 선택도 높음 → 앞에 두는 게 맞음

---

## 5. 언제 인덱스를 걸어야 할까?

| 상황 | 인덱스 필요? | 이유 |
|------|------------|------|
| `WHERE email = ?` 로그인 | ✅ 필수 | 자주 쓰는 단일 조건 |
| `WHERE device_id = ?` | ✅ 필수 | 자주 쓰는 단일 조건 |
| `JOIN ON user_id = ?` 외래키 | ✅ 보통 자동 생성 | JPA가 FK에 자동 인덱스 생성 |
| `WHERE device_id = ? AND user_id IS NULL` | ✅ 복합 인덱스 | 두 조건 동시 사용 |
| `WHERE name LIKE '%홍%'` | ❌ 효과 없음 | 앞에 `%` 붙으면 B-Tree 탐색 불가 |
| 자주 INSERT/UPDATE 되는 컬럼 | ⚠️ 신중하게 | 쓸 때마다 B-Tree 재정렬 비용 발생 |

---

## 6. 트레이드오프

인덱스는 **읽기는 빠르게, 쓰기는 약간 느리게** 해요.

데이터가 INSERT/UPDATE 될 때마다 **인덱스 B-Tree도 같이 갱신**해야 하거든요.  
그래서 모든 컬럼에 다 걸면 오히려 역효과가 납니다.

```
인덱스 없음:  읽기 느림 / 쓰기 빠름
인덱스 있음:  읽기 빠름 / 쓰기 약간 느림  ← 보통 이게 이득
인덱스 남발:  읽기 빠름 / 쓰기 많이 느림  ← 역효과
```

---

## 7. JPA에서 인덱스 만드는 법

```java
@Entity
@Table(
    name = "file_entity",
    indexes = {
        // 핵심! device_id + user_id 복합 인덱스
        @Index(name = "idx_file_device_user", columnList = "device_id, user_id"),

        // 파일 경로 검색용 (중복 체크 등)
        @Index(name = "idx_file_path", columnList = "path"),

        // user_id 기준 조회용 (유저 파일 목록 불러올 때)
        @Index(name = "idx_file_user", columnList = "user_id")
    }
)
public class FileEntity {
    ...
}
```

`spring.jpa.hibernate.ddl-auto = update` 설정이면  
**앱 재시작 시 자동으로 DB에 인덱스 생성**됨.

### 순수 SQL로 직접 추가할 때

```sql
-- 복합 인덱스
CREATE INDEX idx_file_device_user ON file_entity(device_id, user_id);

-- 단일 인덱스
CREATE INDEX idx_file_path ON file_entity(path);

-- UNIQUE 인덱스 (중복 방지 + 속도)
CREATE UNIQUE INDEX idx_users_email ON users(email);
```

---

## 8. 이 프로젝트에서 걸어야 할 인덱스 요약

| 테이블 | 인덱스 | 이유 |
|--------|--------|------|
| `file_entity` | `(device_id, user_id)` | 로그인 시 디바이스 파일 연결 쿼리 |
| `file_entity` | `(user_id)` | 유저 파일 목록 조회 |
| `file_entity` | `(path)` | 파일 경로 중복 체크 |
| `users` | `(email)` | 로그인 이메일 조회 |
| `users` | `(device_id)` | 디바이스 ID로 유저 조회 |
