# UTF-16 BOM 인코딩 문제 해결 가이드

## 📋 목차
1. [문제 상황](#문제-상황)
2. [원인 분석](#원인-분석)
3. [BOM이란?](#bom이란)
4. [해결 방법](#해결-방법)
5. [코드 수정](#코드-수정)
6. [추가 개선사항](#추가-개선사항)
7. [테스트 방법](#테스트-방법)

---

## 문제 상황

### 증상
- UTF-16으로 인코딩된 한글 텍스트 파일을 읽으면 깨진 문자로 표시됨
- 콘솔 로그: `✅ 성공한 인코딩: utf-16le`
- 화면 출력: `쟇슴뀠쇸듖ꇔ⣘캺ꛁ됺뷧샅돇삲룚삦좯잤뗘룥뒳듏⧙...`
- 미리보기(preview): `ÿþ입술로내게키스해.txt` (BOM이 텍스트로 표시됨)

### 발생 위치
- `app/reader.tsx`: 리더 화면에서 파일 내용 표시
- `app/(tabs)/index.tsx`: 파일 추가 시 미리보기 생성

---

## 원인 분석

### 문제의 핵심
UTF-16 파일의 **BOM(Byte Order Mark)을 제거하지 않고** 디코딩했기 때문입니다.

```typescript
// ❌ 잘못된 코드
if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
  console.log('✅ UTF-16 LE BOM 발견');
  return iconv.decode(buffer, 'utf-16le');  // BOM 포함된 채로 디코딩
}
```

### 왜 깨질까?
1. UTF-16 파일 구조: `[FF FE] [실제 내용...]`
2. BOM(FF FE) 2바이트도 함께 디코딩됨
3. BOM이 문자로 변환되면서 이후 내용이 잘못된 위치에서 해석됨
4. 결과: 모든 문자가 2바이트씩 밀려서 깨진 문자로 표시

### 실제 예시
```
파일 내용 (hex): FF FE 48 00 65 00 6C 00 6C 00 6F 00
                  [BOM] [ H ][ e ][ l ][ l ][ o ]

잘못된 디코딩:
- FF FE를 문자로 인식 → 'ÿþ'
- 48 00 부터 시작해야 하는데 00 65부터 시작
- 모든 문자가 2바이트씩 밀림 → 깨진 문자

올바른 디코딩:
- FF FE 제거 (slice(2))
- 48 00 65 00... 부터 디코딩
- 정상: "Hello"
```

---

## BOM이란?

### BOM (Byte Order Mark)
파일의 **맨 앞**에 위치하는 특수한 바이트 시퀀스로, 파일의 인코딩과 바이트 순서를 나타냅니다.

### 주요 BOM 종류

| 인코딩 | BOM (hex) | 크기 | 설명 |
|--------|-----------|------|------|
| UTF-8 | EF BB BF | 3바이트 | UTF-8은 BOM이 선택사항 |
| UTF-16 LE | FF FE | 2바이트 | Little Endian (주로 Windows) |
| UTF-16 BE | FE FF | 2바이트 | Big Endian (주로 Mac/Unix) |
| UTF-32 LE | FF FE 00 00 | 4바이트 | 거의 사용 안 함 |
| UTF-32 BE | 00 00 FE FF | 4바이트 | 거의 사용 안 함 |

### BOM의 역할
1. **인코딩 감지**: "이 파일은 UTF-16이야"
2. **바이트 순서 표시**: Little Endian vs Big Endian
3. **자동 인식**: 텍스트 에디터가 인코딩을 자동으로 판단

### BOM은 텍스트가 아니다!
- BOM은 **메타데이터**이지 실제 내용이 아님
- 디코딩할 때 반드시 **제거**해야 함
- 제거하지 않으면 → 문자로 인식 → 내용 깨짐

---

## 해결 방법

### 핵심 원칙
**BOM을 감지하면 → 해당 바이트를 제거(`slice`) → 나머지만 디코딩**

### 단계별 해결
1. BOM 체크 (파일 첫 2-3바이트 확인)
2. BOM 발견 시 → `buffer.slice(N)`으로 제거
3. 제거된 버퍼를 해당 인코딩으로 디코딩
4. 깨끗한 텍스트 획득

---

## 코드 수정

### 1. UTF-16 BOM 처리 수정

#### 이전 코드 (❌ 버그)
```typescript
function decodeTextSafe(buffer: Buffer): string {
  if (buffer.length >= 2) {
    // UTF-16 LE BOM (FF FE)
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      console.log('✅ UTF-16 LE BOM 발견');
      return iconv.decode(buffer, 'utf-16le');  // ❌ BOM 포함
    }
    // UTF-16 BE BOM (FE FF)
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      console.log('✅ UTF-16 BE BOM 발견');
      return iconv.decode(buffer, 'utf-16be');  // ❌ BOM 포함
    }
  }
  // ...
}
```

#### 수정된 코드 (✅ 정상)
```typescript
function decodeTextSafe(buffer: Buffer): string {
  // 1. UTF-16 BOM 체크 (가장 먼저!)
  if (buffer.length >= 2) {
    // UTF-16 LE BOM (FF FE)
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      console.log('✅ UTF-16 LE BOM 발견');
      return iconv.decode(buffer.slice(2), 'utf-16le');  // ✅ BOM 제거
    }
    // UTF-16 BE BOM (FE FF)
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      console.log('✅ UTF-16 BE BOM 발견');
      return iconv.decode(buffer.slice(2), 'utf-16be');  // ✅ BOM 제거
    }
  }
  
  // 2. UTF-8 BOM 체크 (EF BB BF)
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    console.log('✅ UTF-8 BOM 발견');
    return iconv.decode(buffer.slice(3), 'utf-8');  // ✅ 3바이트 제거
  }
  
  // 3. BOM 없는 경우: 여러 인코딩 시도
  // ...
}
```

### 2. 수정이 필요한 파일

#### app/reader.tsx
```typescript
// 파일: app/reader.tsx
// 위치: 파일 상단의 decodeTextSafe 함수

function decodeTextSafe(buffer: Buffer): string {
  // UTF-16 BOM 체크 및 제거
  if (buffer.length >= 2) {
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      return iconv.decode(buffer.slice(2), 'utf-16le');
    }
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      return iconv.decode(buffer.slice(2), 'utf-16be');
    }
  }
  
  // UTF-8 BOM 체크 및 제거
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return iconv.decode(buffer.slice(3), 'utf-8');
  }
  
  // ... 나머지 로직
}
```

#### app/(tabs)/index.tsx
```typescript
// 파일: app/(tabs)/index.tsx
// 위치: 파일 상단의 decodeTextSafe 함수
// 내용: reader.tsx와 동일하게 수정
```

---

## 추가 개선사항

### 1. 한글 감지 로직 추가
BOM 없는 파일도 올바르게 디코딩하기 위해 한글 체크 추가:

```typescript
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
```

**개선 효과:**
- 한글이 포함된 파일을 더 정확하게 감지
- 잘못된 인코딩으로 디코딩되는 것을 방지

### 2. 인코딩 우선순위 변경
한국어 파일에 최적화된 순서로 변경:

```typescript
// 이전: utf-16le, utf-16be, cp949, utf-8, euc-kr, windows-1252
// 변경: cp949, utf-8, euc-kr, utf-16le, utf-16be, windows-1252

const encodings = ['cp949', 'utf-8', 'euc-kr', 'utf-16le', 'utf-16be', 'windows-1252'];
```

**이유:**
- CP949: Windows 한글 파일의 표준 인코딩
- UTF-8: 최신 파일들의 표준
- EUC-KR: 오래된 한글 인코딩
- UTF-16: BOM이 없는 경우 최후 시도

### 3. 폴백 인코딩 변경
```typescript
// 이전: UTF-8로 폴백
// 변경: CP949로 폴백

console.log('⚠️ 모든 인코딩 실패, CP949로 폴백');
return iconv.decode(buffer, 'cp949');
```

**이유:** 한국어 파일일 가능성이 높으므로 CP949가 더 안전

---

## 테스트 방법

### 1. UTF-16 LE 파일 테스트
```bash
# Windows 메모장에서 "UTF-16 LE"로 저장한 파일
# BOM: FF FE
# 예상 결과: 한글 정상 표시
```

### 2. UTF-16 BE 파일 테스트
```bash
# Mac에서 UTF-16 BE로 저장한 파일
# BOM: FE FF
# 예상 결과: 한글 정상 표시
```

### 3. UTF-8 BOM 파일 테스트
```bash
# UTF-8 with BOM으로 저장한 파일
# BOM: EF BB BF
# 예상 결과: 한글 정상 표시
```

### 4. CP949 파일 테스트
```bash
# Windows에서 ANSI로 저장한 한글 파일
# BOM: 없음
# 예상 결과: 한글 정상 표시
```

### 5. 콘솔 로그 확인
```typescript
// 정상 케이스 로그:
✅ UTF-16 LE BOM 발견
✅ 성공한 인코딩: utf-16le  // 또는 cp949, utf-8 등

// 미리보기 텍스트 확인:
preview : "정상적인 한글 텍스트..."  // ✅ 깨지지 않음
```

---

## 핵심 요약

### 문제
- UTF-16 BOM을 제거하지 않고 디코딩 → 모든 문자가 깨짐

### 해결
- `buffer.slice(2)` 또는 `buffer.slice(3)`으로 BOM 제거 후 디코딩

### 기억할 점
1. **BOM은 메타데이터, 텍스트 아님**
2. **디코딩 전에 반드시 제거**
3. **UTF-16 = 2바이트, UTF-8 = 3바이트**
4. **한글 체크로 정확도 향상**

### 적용 파일
- ✅ `app/reader.tsx` - 수정 완료
- ✅ `app/(tabs)/index.tsx` - 수정 완료

---

## 참고 자료

### 유니코드 한글 범위
- **현대 한글**: `\uAC00` ~ `\uD7A3` (가 ~ 힣)
- **자모**: `\u1100` ~ `\u11FF`, `\u3130` ~ `\u318F`

### iconv-lite 지원 인코딩
- UTF-8, UTF-16LE, UTF-16BE
- CP949 (Windows 한글 코드)
- EUC-KR (Unix/Linux 한글 코드)
- Windows-1252 (서유럽 문자)

### Buffer.slice()
```typescript
buffer.slice(start, end?)
// start: 시작 인덱스 (포함)
// end: 끝 인덱스 (제외, 생략하면 끝까지)

buffer.slice(2)     // 2번째 바이트부터 끝까지 (UTF-16 BOM 제거)
buffer.slice(3)     // 3번째 바이트부터 끝까지 (UTF-8 BOM 제거)
```

---

**작성일:** 2026년 2월 2일  
**작성자:** 개발팀  
**버전:** 1.0
