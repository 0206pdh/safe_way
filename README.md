# Safe Way

Safe Way는 서울시 사건/인파 데이터를 수집하고 Redis에 캐시한 뒤, `public/` 정적 페이지와 API로 제공하는 Node.js/Express 서비스입니다.

## 주요 기능
- 사건(incident) 피드 제공
- 인파(crowd) 피드 제공
- 구별 위험도 요약
- 위험도 타일(GeoJSON)
- 공개 OSRM 기반 경로 조회

## 요구 사항
- Node.js 18 이상
- Redis
- 서울 OpenAPI 키(사건/인파)

## 시작하기
```bash
npm install
npm run start
