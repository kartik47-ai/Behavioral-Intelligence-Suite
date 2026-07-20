# VeraLens Behavioral Intelligence By Kartik Katke

VeraLens is a professional behavioral response analysis platform built with Node.js, Express, SQLite, and a multi-page frontend. It reframes the project away from a simplistic "lie detector" and toward a more credible behavioral intelligence product with explainable scoring, baseline tracking, cross-module context, and admin-grade reporting.

## Core Experience

- Secure registration and login with session-based access
- Response authenticity assessment with difficulty-aware prompts and adaptive follow-ups
- Mood mapping and productivity context modules
- Insight console with filters, trends, comparison, benchmark positioning, and heatmaps
- Profile intelligence with baseline tracking, weekly activity, and standout moments
- Admin console for platform-wide oversight
- Presentation mode for demos, reviews, and stakeholder walkthroughs

## Product Positioning

This project should be interpreted as a behavioral analysis support system. It estimates authenticity-related signals from measurable interaction cues such as timing, hesitation, answer changes, and consistency. It does not claim scientific or definitive lie detection.

## Project Structure

- [server.js](./server.js): Express server, SQLite setup, scoring logic, analytics endpoints
- [public](./public): Frontend pages, shared styling, and browser-side logic
- [Behavioral-Response-Analysis-UI.pdf](./Behavioral-Response-Analysis-UI.pdf): Original concept deck

## Run Locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. If port `3000` is already in use, the server automatically retries the next available port.
