const crypto = require("crypto");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const SESSION_DURATION_MS = 1000 * 60 * 60 * 2;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database("./lie_detector.db", (err) => {
  if (err) {
    console.error("Database connection failed:", err);
    return;
  }

  console.log("SQLite connected successfully");

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    password TEXT,
    last_question INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    session_token TEXT,
    session_expires_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    module TEXT DEFAULT 'lie',
    truth REAL DEFAULT 0,
    confidence REAL DEFAULT 0,
    hesitation REAL DEFAULT 0,
    consistency REAL DEFAULT 0,
    changes INTEGER DEFAULT 0,
    time_taken REAL DEFAULT 0,
    category_breakdown TEXT,
    flagged_questions TEXT,
    summary TEXT,
    mood_label TEXT,
    productivity_hours REAL DEFAULT 0,
    difficulty TEXT DEFAULT 'standard',
    session_meta TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  addColumnIfMissing("users", "last_question", "INTEGER DEFAULT 0");
  addColumnIfMissing("users", "is_admin", "INTEGER DEFAULT 0");
  addColumnIfMissing("users", "session_token", "TEXT");
  addColumnIfMissing("users", "session_expires_at", "TEXT");

  addColumnIfMissing("results", "module", "TEXT DEFAULT 'lie'");
  addColumnIfMissing("results", "confidence", "REAL DEFAULT 0");
  addColumnIfMissing("results", "hesitation", "REAL DEFAULT 0");
  addColumnIfMissing("results", "consistency", "REAL DEFAULT 0");
  addColumnIfMissing("results", "category_breakdown", "TEXT");
  addColumnIfMissing("results", "flagged_questions", "TEXT");
  addColumnIfMissing("results", "summary", "TEXT");
  addColumnIfMissing("results", "mood_label", "TEXT");
  addColumnIfMissing("results", "productivity_hours", "REAL DEFAULT 0");
  addColumnIfMissing("results", "difficulty", "TEXT DEFAULT 'standard'");
  addColumnIfMissing("results", "session_meta", "TEXT");
});

function addColumnIfMissing(table, column, definition) {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (err) => {
    if (err && !String(err.message).includes("duplicate column name")) {
      console.error(`Failed to add ${column} to ${table}:`, err.message);
    }
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (err) {
    return fallback;
  }
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function computeTrend(values) {
  if (values.length < 2) {
    return "Not enough data";
  }

  const recent = average(values.slice(0, 3));
  const previous = average(values.slice(3, 6));

  if (!previous) {
    return "Building baseline";
  }

  const delta = recent - previous;
  if (delta > 5) {
    return "Improving";
  }
  if (delta < -5) {
    return "Needs attention";
  }
  return "Stable";
}

function analyzeAnswerPatterns(answers) {
  let alternations = 0;
  for (let i = 1; i < answers.length; i += 1) {
    if (answers[i] !== answers[i - 1]) {
      alternations += 1;
    }
  }
  return answers.length ? alternations / answers.length : 0;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword) {
    return false;
  }

  if (!storedPassword.startsWith("scrypt:")) {
    return storedPassword === password;
  }

  const [, salt, hash] = storedPassword.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function buildCategoryBreakdown(questionDetails) {
  const grouped = {};

  questionDetails.forEach((detail) => {
    const key = detail.category || "general";
    if (!grouped[key]) {
      grouped[key] = { category: key, totalRisk: 0, totalTime: 0, count: 0 };
    }
    grouped[key].totalRisk += Number(detail.risk || 0);
    grouped[key].totalTime += Number(detail.time || 0);
    grouped[key].count += 1;
  });

  return Object.values(grouped).map((item) => ({
    category: item.category,
    risk: Math.round(item.totalRisk / item.count),
    avgTime: Number((item.totalTime / item.count).toFixed(2))
  }));
}

function buildBehaviorSummary(metrics) {
  const statements = [];

  if (metrics.authenticity >= 80) {
    statements.push("Responses showed strong authenticity signals.");
  } else if (metrics.authenticity >= 60) {
    statements.push("Responses were moderately reliable with visible friction.");
  } else {
    statements.push("The session contained multiple uncertainty markers.");
  }

  if (metrics.hesitation >= 60) {
    statements.push("Hesitation was high, especially on reflective prompts.");
  } else if (metrics.hesitation >= 35) {
    statements.push("A few prompts triggered noticeable deliberation.");
  } else {
    statements.push("Response speed stayed fairly stable.");
  }

  if (metrics.consistency >= 75) {
    statements.push("Answer patterns remained consistent across categories.");
  } else if (metrics.consistency < 45) {
    statements.push("Category-to-category consistency was weak.");
  }

  return statements.join(" ");
}

function buildRecommendations({ moduleAverages, correlations, historyRows }) {
  const recommendations = [];
  const lieAverage = moduleAverages.lie?.score || 0;
  const moodAverage = moduleAverages.mood?.score || 0;
  const productivityAverage = moduleAverages.productivity?.score || 0;

  if (lieAverage && lieAverage < 60) {
    recommendations.push("Use the easy or standard question set first to establish a cleaner authenticity baseline.");
  }
  if (moodAverage && moodAverage < 55) {
    recommendations.push("Run sessions when mood is calmer to reduce hesitation-related noise.");
  }
  if (productivityAverage && productivityAverage < 55) {
    recommendations.push("Schedule response analysis after higher-focus periods for more stable behavior signals.");
  }
  if (historyRows.some((row) => row.flagged_questions.length >= 3)) {
    recommendations.push("Review frequently flagged categories in the risk heatmap to identify repeat triggers.");
  }
  if (correlations.some((item) => item.includes("weaker authenticity"))) {
    recommendations.push("Mood and authenticity are moving together; track both modules on the same day for clearer interpretation.");
  }
  if (!recommendations.length) {
    recommendations.push("Your signals are fairly stable. Continue building sessions to improve benchmarks and trend confidence.");
  }

  return recommendations.slice(0, 5);
}

function normalizeResultRow(row) {
  return {
    id: row.id,
    email: row.email,
    module: row.module || "lie",
    score: Math.round(Number(row.truth || 0)),
    confidence: Math.round(Number(row.confidence || 0)),
    hesitation: Math.round(Number(row.hesitation || 0)),
    consistency: Math.round(Number(row.consistency || 0)),
    changes: Number(row.changes || 0),
    time_taken: Number(row.time_taken || 0),
    category_breakdown: safeJsonParse(row.category_breakdown, []),
    flagged_questions: safeJsonParse(row.flagged_questions, []),
    summary: row.summary || "",
    mood_label: row.mood_label || "",
    productivity_hours: Number(row.productivity_hours || 0),
    difficulty: row.difficulty || "standard",
    session_meta: safeJsonParse(row.session_meta, {}),
    timestamp: row.timestamp
  };
}

function buildModuleAverages(rows) {
  const modules = ["lie", "mood", "productivity"];
  const result = {};

  modules.forEach((moduleName) => {
    const subset = rows.filter((row) => row.module === moduleName);
    if (!subset.length) {
      return;
    }
    result[moduleName] = {
      score: Math.round(average(subset.map((row) => row.score))),
      confidence: Math.round(average(subset.map((row) => row.confidence))),
      hesitation: Math.round(average(subset.map((row) => row.hesitation))),
      consistency: Math.round(average(subset.map((row) => row.consistency)))
    };
  });

  return result;
}

function buildCorrelations(rows) {
  const moodRows = rows.filter((row) => row.module === "mood");
  const productivityRows = rows.filter((row) => row.module === "productivity");
  const lieRows = rows.filter((row) => row.module === "lie");
  const correlations = [];

  if (moodRows.length && lieRows.length) {
    const moodAvg = average(moodRows.map((row) => row.score));
    const lieAvg = average(lieRows.map((row) => row.score));
    correlations.push(
      moodAvg >= 65 && lieAvg >= 65
        ? "Positive mood sessions tend to align with stronger authenticity scores."
        : "Lower mood stability appears to coincide with weaker authenticity scores."
    );
  }

  if (productivityRows.length && lieRows.length) {
    const productivityAvg = average(productivityRows.map((row) => row.score));
    const lieConfidenceAvg = average(lieRows.map((row) => row.confidence));
    correlations.push(
      productivityAvg >= 65 && lieConfidenceAvg >= 60
        ? "Higher productivity days are associated with more confident response behavior."
        : "Focus and authenticity confidence are not yet moving together consistently."
    );
  }

  const highDifficultyRows = lieRows.filter((row) => row.difficulty === "high-pressure");
  const easyRows = lieRows.filter((row) => row.difficulty === "easy");
  if (highDifficultyRows.length && easyRows.length) {
    correlations.push(
      average(highDifficultyRows.map((row) => row.hesitation)) > average(easyRows.map((row) => row.hesitation))
        ? "High-pressure question sets are increasing hesitation compared with easy sessions."
        : "Difficulty changes are not heavily impacting hesitation yet."
    );
  }

  return correlations;
}

function buildHeatmap(rows) {
  const heatmap = {};
  rows.forEach((row) => {
    row.category_breakdown.forEach((item) => {
      if (!heatmap[item.category]) {
        heatmap[item.category] = { category: item.category, riskSum: 0, count: 0 };
      }
      heatmap[item.category].riskSum += Number(item.risk || 0);
      heatmap[item.category].count += 1;
    });
  });

  return Object.values(heatmap)
    .map((item) => ({
      category: item.category,
      risk: Math.round(item.riskSum / item.count)
    }))
    .sort((a, b) => b.risk - a.risk);
}

function buildBaselineProfile(rows) {
  const modules = ["lie", "mood", "productivity"];

  return modules
    .map((moduleName) => {
      const moduleRows = rows.filter((row) => row.module === moduleName);
      if (!moduleRows.length) {
        return null;
      }

      const chronological = moduleRows.slice().reverse();
      const baselineRows = chronological.slice(0, Math.min(3, chronological.length));
      const recentRows = moduleRows.slice(0, Math.min(3, moduleRows.length));
      const baselineScore = Math.round(average(baselineRows.map((row) => row.score)));
      const currentScore = Math.round(average(recentRows.map((row) => row.score)));
      const delta = currentScore - baselineScore;

      let status = "Stable";
      if (delta >= 8) {
        status = "Above baseline";
      } else if (delta <= -8) {
        status = "Below baseline";
      }

      return {
        module: moduleName,
        sessions: moduleRows.length,
        baselineScore,
        currentScore,
        delta,
        status
      };
    })
    .filter(Boolean);
}

function buildWeeklyActivity(rows) {
  const buckets = {};

  rows.forEach((row) => {
    const dayKey = new Date(row.timestamp).toISOString().slice(0, 10);
    if (!buckets[dayKey]) {
      buckets[dayKey] = { day: dayKey, sessions: 0, scoreSum: 0 };
    }
    buckets[dayKey].sessions += 1;
    buckets[dayKey].scoreSum += row.score;
  });

  return Object.values(buckets)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-7)
    .map((item) => ({
      day: item.day,
      sessions: item.sessions,
      averageScore: Math.round(item.scoreSum / item.sessions)
    }));
}

function buildRiskDistribution(rows) {
  const distribution = {
    low: 0,
    guarded: 0,
    elevated: 0,
    high: 0
  };

  rows.forEach((row) => {
    if (row.hesitation >= 70 || row.flagged_questions.length >= 3 || row.score < 45) {
      distribution.high += 1;
    } else if (row.hesitation >= 55 || row.flagged_questions.length >= 1 || row.score < 60) {
      distribution.elevated += 1;
    } else if (row.hesitation >= 35 || row.score < 75) {
      distribution.guarded += 1;
    } else {
      distribution.low += 1;
    }
  });

  return distribution;
}

function buildTopMoments(rows) {
  return rows
    .filter((row) => row.flagged_questions.length || row.score >= 80)
    .slice(0, 6)
    .map((row) => ({
      id: row.id,
      module: row.module,
      score: row.score,
      confidence: row.confidence,
      hesitation: row.hesitation,
      headline:
        row.flagged_questions.length
          ? `${row.flagged_questions.length} prompt${row.flagged_questions.length > 1 ? "s were" : " was"} flagged`
          : "High-confidence session",
      timestamp: row.timestamp
    }));
}

async function saveResult(payload) {
  await dbRun(
    `INSERT INTO results (
      email,
      module,
      truth,
      confidence,
      hesitation,
      consistency,
      changes,
      time_taken,
      category_breakdown,
      flagged_questions,
      summary,
      mood_label,
      productivity_hours,
      difficulty,
      session_meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.email,
      payload.module,
      payload.truth,
      payload.confidence,
      payload.hesitation,
      payload.consistency,
      payload.changes,
      payload.time_taken,
      JSON.stringify(payload.category_breakdown || []),
      JSON.stringify(payload.flagged_questions || []),
      payload.summary || "",
      payload.mood_label || "",
      payload.productivity_hours || 0,
      payload.difficulty || "standard",
      JSON.stringify(payload.session_meta || {})
    ]
  );
}

async function authenticate(req, res, next) {
  const email = String(req.headers["x-user-email"] || "").trim().toLowerCase();
  const token = String(req.headers["x-auth-token"] || "").trim();

  if (!email || !token) {
    res.status(401).json({ success: false, message: "Authentication required." });
    return;
  }

  try {
    const user = await dbGet(
      "SELECT id, name, email, phone, is_admin, session_token, session_expires_at FROM users WHERE email = ?",
      [email]
    );

    if (!user || user.session_token !== token || !user.session_expires_at) {
      res.status(401).json({ success: false, message: "Invalid session." });
      return;
    }

    if (new Date(user.session_expires_at).getTime() < Date.now()) {
      res.status(401).json({ success: false, message: "Session expired." });
      return;
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      isAdmin: Boolean(user.is_admin)
    };

    next();
  } catch (err) {
    res.status(500).json({ success: false, message: "Authentication check failed." });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    res.status(403).json({ success: false, message: "Admin access required." });
    return;
  }
  next();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/register", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "").trim();

  if (!name || !email || !phone || !password) {
    res.json({ success: false, message: "All fields are required." });
    return;
  }

  try {
    const existingUser = await dbGet("SELECT id FROM users WHERE email = ?", [email]);
    if (existingUser) {
      res.json({ success: false, message: "User already exists." });
      return;
    }

    const userCountRow = await dbGet("SELECT COUNT(*) AS count FROM users");
    const isAdmin = Number(userCountRow?.count || 0) === 0 ? 1 : 0;

    await dbRun(
      "INSERT INTO users (name, email, phone, password, is_admin) VALUES (?, ?, ?, ?, ?)",
      [name, email, phone, hashPassword(password), isAdmin]
    );

    res.json({
      success: true,
      message: isAdmin ? "Registration successful. You are the initial admin user." : "Registration successful."
    });
  } catch (err) {
    res.json({ success: false, message: "Registration failed." });
  }
});

app.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();

  if (!email || !password) {
    res.json({ success: false, message: "Enter email and password." });
    return;
  }

  try {
    const user = await dbGet("SELECT * FROM users WHERE email = ?", [email]);
    if (!user || !verifyPassword(password, user.password)) {
      res.json({ success: false, message: "User not found or wrong password." });
      return;
    }

    if (!String(user.password || "").startsWith("scrypt:")) {
      await dbRun("UPDATE users SET password = ? WHERE email = ?", [hashPassword(password), email]);
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    await dbRun("UPDATE users SET session_token = ?, session_expires_at = ? WHERE email = ?", [token, expiresAt, email]);

    res.json({
      success: true,
      message: "Login successful.",
      token,
      expiresAt,
      user: {
        name: user.name,
        email: user.email,
        phone: user.phone,
        isAdmin: Boolean(user.is_admin)
      }
    });
  } catch (err) {
    res.json({ success: false, message: "Database error during login." });
  }
});

app.post("/logout", authenticate, async (req, res) => {
  await dbRun("UPDATE users SET session_token = NULL, session_expires_at = NULL WHERE email = ?", [req.user.email]);
  res.json({ success: true });
});

app.get("/me", authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.post("/lie-detect", authenticate, async (req, res) => {
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const questionTimes = Array.isArray(req.body.questionTimes) ? req.body.questionTimes : [];
  const questionDetails = Array.isArray(req.body.questionDetails) ? req.body.questionDetails : [];
  const difficulty = String(req.body.difficulty || "standard");
  const generatedFollowUps = Array.isArray(req.body.generatedFollowUps) ? req.body.generatedFollowUps : [];
  const timeTaken = Number(req.body.timeTaken || 0);
  const changes = Number(req.body.changes || 0);
  const consistencyScore = clamp(Number(req.body.consistencyScore || 0), 0, 1);
  const hoverUncertainty = Number(req.body.hoverUncertainty || 0);

  const difficultyMultiplier = difficulty === "high-pressure" ? 1.15 : difficulty === "easy" ? 0.9 : 1;
  const avgTime = average(questionTimes);
  const patternPenalty = analyzeAnswerPatterns(answers) * 16 * difficultyMultiplier;
  const timePenalty = Math.min(avgTime * 5 * difficultyMultiplier, 32);
  const changePenalty = Math.min(changes * 6, 24);
  const hoverPenalty = Math.min(hoverUncertainty * 3, 18);
  const hesitation = clamp((avgTime / 8) * 100 + hoverUncertainty * 6 + changes * 4 + (difficulty === "high-pressure" ? 8 : 0), 0, 100);
  const confidence = clamp(100 - hesitation * 0.45 - patternPenalty + consistencyScore * 28, 0, 100);
  const consistency = clamp(consistencyScore * 100 - patternPenalty * 0.8, 0, 100);
  const authenticity = clamp(
    100 - timePenalty - changePenalty - hoverPenalty - patternPenalty + consistencyScore * 20,
    0,
    100
  );

  const flaggedQuestions = questionDetails
    .filter((detail) => Number(detail.risk || 0) >= 55 || Number(detail.time || 0) >= 6 || Number(detail.changeCount || 0) > 0)
    .map((detail) => ({
      question: detail.question,
      category: detail.category,
      time: Number(Number(detail.time || 0).toFixed(2)),
      risk: Math.round(detail.risk || 0),
      reason: detail.reason || "Elevated uncertainty marker"
    }));

  const categoryBreakdown = buildCategoryBreakdown(questionDetails);
  const summary = buildBehaviorSummary({ authenticity, hesitation, consistency });
  const recommendations = [];
  if (hesitation >= 60) {
    recommendations.push("Repeat the session under lower-pressure conditions to compare hesitation shift.");
  }
  if (flaggedQuestions.some((item) => item.category === "memory recall")) {
    recommendations.push("Review memory-recall prompts; they appear to trigger the highest uncertainty.");
  }
  if (!recommendations.length) {
    recommendations.push("Signals were fairly stable. Use the comparison tool to track future sessions.");
  }

  await saveResult({
    email: req.user.email,
    module: "lie",
    truth: Number(authenticity.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    hesitation: Number(hesitation.toFixed(2)),
    consistency: Number(consistency.toFixed(2)),
    changes,
    time_taken: Number(timeTaken.toFixed(2)),
    category_breakdown: categoryBreakdown,
    flagged_questions: flaggedQuestions,
    summary,
    difficulty,
    session_meta: {
      questionCount: questionDetails.length,
      generatedFollowUps,
      avgTime: Number(avgTime.toFixed(2))
    }
  });

  res.json({
    authenticity: Math.round(authenticity),
    confidence: Math.round(confidence),
    hesitation: Math.round(hesitation),
    consistency: Math.round(consistency),
    categoryBreakdown,
    flaggedQuestions,
    summary,
    recommendations,
    analysis: {
      difficulty,
      timePenalty: Math.round(timePenalty),
      changePenalty: Math.round(changePenalty),
      hoverPenalty: Math.round(hoverPenalty),
      patternPenalty: Math.round(patternPenalty),
      consistencyBonus: Math.round(consistencyScore * 20)
    }
  });
});

app.post("/mood-analyze", authenticate, async (req, res) => {
  const responses = Array.isArray(req.body.responses) ? req.body.responses : [];
  const scoreMap = {
    calm: 85,
    happy: 88,
    focused: 82,
    tired: 42,
    stressed: 30,
    sad: 24,
    angry: 18
  };

  const values = responses.map((item) => scoreMap[item.answer] || 50);
  const moodScore = clamp(Math.round(average(values)), 0, 100);
  const negativeCount = responses.filter((item) => ["sad", "angry", "stressed", "tired"].includes(item.answer)).length;
  const confidence = clamp(100 - negativeCount * 12, 20, 95);
  const hesitation = clamp(negativeCount * 15, 0, 100);
  const consistency = clamp(100 - responses.reduce((sum, item) => sum + (item.changed ? 8 : 0), 0), 40, 100);

  let moodLabel = "Balanced";
  if (moodScore >= 75) {
    moodLabel = "Positive and stable";
  } else if (moodScore >= 50) {
    moodLabel = "Mixed emotional state";
  } else {
    moodLabel = "Emotionally strained";
  }

  const flaggedQuestions = responses
    .filter((item) => ["sad", "angry", "stressed"].includes(item.answer))
    .map((item) => ({
      question: item.question,
      category: "mood",
      time: 0,
      risk: 70,
      reason: `${item.answer} selected`
    }));

  const summary = `${moodLabel}. The emotional pattern suggests ${negativeCount > 1 ? "heightened strain across multiple prompts." : "mostly manageable emotional load."}`;

  await saveResult({
    email: req.user.email,
    module: "mood",
    truth: moodScore,
    confidence,
    hesitation,
    consistency,
    changes: responses.filter((item) => item.changed).length,
    time_taken: 0,
    category_breakdown: [{ category: "mood", risk: 100 - moodScore, avgTime: 0 }],
    flagged_questions: flaggedQuestions,
    summary,
    mood_label: moodLabel,
    difficulty: "self-report",
    session_meta: { responses }
  });

  res.json({
    score: moodScore,
    label: moodLabel,
    confidence,
    hesitation,
    consistency,
    summary
  });
});

app.post("/productivity-analyze", authenticate, async (req, res) => {
  const hours = clamp(Number(req.body.hours || 0), 0, 24);
  const focus = clamp(Number(req.body.focus || 0), 1, 10);
  const energy = clamp(Number(req.body.energy || 0), 1, 10);
  const distractions = clamp(Number(req.body.distractions || 0), 0, 10);

  const productivityScore = clamp(Math.round(hours * 4 + focus * 6 + energy * 4 - distractions * 5), 0, 100);
  const confidence = clamp(Math.round(focus * 9 + energy * 4 - distractions * 3), 0, 100);
  const hesitation = clamp(Math.round(distractions * 10 + Math.max(0, 6 - focus) * 8), 0, 100);
  const consistency = clamp(Math.round((hours >= 4 ? 50 : 30) + focus * 4 + energy * 2), 0, 100);

  let summary = "Productivity pattern is developing.";
  if (productivityScore >= 75) {
    summary = "Strong output with healthy focus and energy.";
  } else if (productivityScore >= 50) {
    summary = "Moderate output with room to improve focus discipline.";
  } else {
    summary = "Low-output day with visible focus and energy drag.";
  }

  await saveResult({
    email: req.user.email,
    module: "productivity",
    truth: productivityScore,
    confidence,
    hesitation,
    consistency,
    changes: 0,
    time_taken: hours,
    category_breakdown: [{ category: "productivity", risk: 100 - productivityScore, avgTime: hours }],
    flagged_questions: distractions >= 6
      ? [{ question: "Distraction load", category: "productivity", time: hours, risk: 72, reason: "High distraction count" }]
      : [],
    summary,
    productivity_hours: hours,
    difficulty: "daily-log",
    session_meta: { focus, energy, distractions }
  });

  res.json({
    score: productivityScore,
    confidence,
    hesitation,
    consistency,
    summary
  });
});

app.get("/history", authenticate, async (req, res) => {
  const moduleFilter = String(req.query.module || "all");
  const startDate = String(req.query.startDate || "");
  const endDate = String(req.query.endDate || "");
  const minScore = Number(req.query.minScore || 0);
  const highRiskOnly = String(req.query.highRiskOnly || "false") === "true";
  const difficulty = String(req.query.difficulty || "all");

  const where = ["email = ?"];
  const params = [req.user.email];

  if (moduleFilter !== "all") {
    where.push("module = ?");
    params.push(moduleFilter);
  }
  if (startDate) {
    where.push("date(timestamp) >= date(?)");
    params.push(startDate);
  }
  if (endDate) {
    where.push("date(timestamp) <= date(?)");
    params.push(endDate);
  }
  if (minScore > 0) {
    where.push("truth >= ?");
    params.push(minScore);
  }
  if (difficulty !== "all") {
    where.push("difficulty = ?");
    params.push(difficulty);
  }

  const rows = await dbAll(`SELECT * FROM results WHERE ${where.join(" AND ")} ORDER BY timestamp DESC`, params);
  let normalized = rows.map(normalizeResultRow);

  if (highRiskOnly) {
    normalized = normalized.filter((row) => row.flagged_questions.length > 0 || row.hesitation >= 60);
  }

  res.json(normalized);
});

app.get("/summary", authenticate, async (req, res) => {
  const rows = (await dbAll("SELECT * FROM results WHERE email = ? ORDER BY timestamp DESC", [req.user.email])).map(normalizeResultRow);

  if (!rows.length) {
    res.json({
      totals: { sessions: 0, avgScore: 0, avgConfidence: 0, avgHesitation: 0 },
      moduleAverages: {},
      trends: {},
      correlations: [],
      recentFlags: [],
      heatmap: [],
      recommendations: [],
      baselineProfile: [],
      weeklyActivity: [],
      riskDistribution: { low: 0, guarded: 0, elevated: 0, high: 0 },
      topMoments: []
    });
    return;
  }

  const totals = {
    sessions: rows.length,
    avgScore: Math.round(average(rows.map((row) => row.score))),
    avgConfidence: Math.round(average(rows.map((row) => row.confidence))),
    avgHesitation: Math.round(average(rows.map((row) => row.hesitation)))
  };

  const moduleAverages = buildModuleAverages(rows);
  const trends = Object.fromEntries(
    Object.keys(moduleAverages).map((moduleName) => [
      moduleName,
      computeTrend(rows.filter((row) => row.module === moduleName).map((row) => row.score))
    ])
  );
  const correlations = buildCorrelations(rows);
  const recentFlags = rows
    .flatMap((row) =>
      row.flagged_questions.map((item) => ({
        module: row.module,
        question: item.question,
        reason: item.reason,
        timestamp: row.timestamp
      }))
    )
    .slice(0, 8);
  const heatmap = buildHeatmap(rows);
  const recommendations = buildRecommendations({ moduleAverages, correlations, historyRows: rows });
  const baselineProfile = buildBaselineProfile(rows);
  const weeklyActivity = buildWeeklyActivity(rows);
  const riskDistribution = buildRiskDistribution(rows);
  const topMoments = buildTopMoments(rows);

  res.json({
    totals,
    moduleAverages,
    trends,
    correlations,
    recentFlags,
    heatmap,
    recommendations,
    baselineProfile,
    weeklyActivity,
    riskDistribution,
    topMoments
  });
});

app.get("/benchmark", authenticate, async (req, res) => {
  const ownRows = (await dbAll("SELECT * FROM results WHERE email = ?", [req.user.email])).map(normalizeResultRow);
  const allRows = (await dbAll("SELECT * FROM results")).map(normalizeResultRow);

  const ownAverage = Math.round(average(ownRows.map((row) => row.score)));
  const globalAverage = Math.round(average(allRows.map((row) => row.score)));
  const confidenceAverage = Math.round(average(allRows.map((row) => row.confidence)));
  const betterThan = allRows.length
    ? Math.round((allRows.filter((row) => row.score <= ownAverage).length / allRows.length) * 100)
    : 0;

  res.json({
    ownAverage,
    globalAverage,
    confidenceAverage,
    percentile: betterThan,
    label:
      ownAverage >= globalAverage
        ? "Your average session score is currently above the platform baseline."
        : "Your average session score is currently below the platform baseline."
  });
});

app.get("/profile-summary", authenticate, async (req, res) => {
  const rows = (await dbAll("SELECT * FROM results WHERE email = ? ORDER BY timestamp DESC", [req.user.email])).map(normalizeResultRow);
  const benchmarkRows = (await dbAll("SELECT * FROM results")).map(normalizeResultRow);
  const moduleAverages = buildModuleAverages(rows);
  const recommendations = buildRecommendations({
    moduleAverages,
    correlations: buildCorrelations(rows),
    historyRows: rows
  });

  res.json({
    user: req.user,
    recentSessions: rows.slice(0, 5),
    moduleAverages,
    streak: rows.length,
    baselineProfile: buildBaselineProfile(rows),
    weeklyActivity: buildWeeklyActivity(rows),
    topMoments: buildTopMoments(rows),
    benchmark: {
      ownAverage: Math.round(average(rows.map((row) => row.score))),
      platformAverage: Math.round(average(benchmarkRows.map((row) => row.score)))
    },
    recommendations
  });
});

app.get("/compare", authenticate, async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
    .slice(0, 4);

  if (!ids.length) {
    res.json({ rows: [], deltas: {} });
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  const rows = (await dbAll(
    `SELECT * FROM results WHERE email = ? AND id IN (${placeholders}) ORDER BY timestamp DESC`,
    [req.user.email, ...ids]
  )).map(normalizeResultRow);

  const deltas = {};
  if (rows.length >= 2) {
    const [latest, previous] = rows;
    deltas.score = latest.score - previous.score;
    deltas.confidence = latest.confidence - previous.confidence;
    deltas.hesitation = latest.hesitation - previous.hesitation;
    deltas.consistency = latest.consistency - previous.consistency;
  }

  res.json({ rows, deltas });
});

app.get("/admin/overview", authenticate, requireAdmin, async (req, res) => {
  const users = await dbAll("SELECT id, name, email, is_admin FROM users ORDER BY id ASC");
  const results = (await dbAll("SELECT * FROM results ORDER BY timestamp DESC")).map(normalizeResultRow);

  const moduleAverages = buildModuleAverages(results);
  const activeUsers = new Set(results.map((row) => row.email)).size;
  const flaggedSessions = results.filter((row) => row.flagged_questions.length > 0).length;

  res.json({
    totals: {
      users: users.length,
      activeUsers,
      sessions: results.length,
      flaggedSessions
    },
    moduleAverages,
    heatmap: buildHeatmap(results),
    recentSessions: results.slice(0, 10),
    weeklyActivity: buildWeeklyActivity(results),
    riskDistribution: buildRiskDistribution(results),
    topMoments: buildTopMoments(results)
  });
});

app.get("/admin/users", authenticate, requireAdmin, async (req, res) => {
  const users = await dbAll("SELECT id, name, email, is_admin FROM users ORDER BY id ASC");
  const results = (await dbAll("SELECT * FROM results")).map(normalizeResultRow);

  const userRows = users.map((user) => {
    const sessions = results.filter((row) => row.email === user.email);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: Boolean(user.is_admin),
      sessions: sessions.length,
      avgScore: Math.round(average(sessions.map((row) => row.score))),
      avgConfidence: Math.round(average(sessions.map((row) => row.confidence)))
    };
  });

  res.json(userRows);
});

const DEFAULT_PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

function startServer(port) {
  return app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

function attemptStart(port, maxRetries = 3) {
  const server = startServer(port);
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && maxRetries > 0) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is in use. Trying port ${nextPort}...`);
      setTimeout(() => {
        attemptStart(nextPort, maxRetries - 1);
      }, 250);
      return;
    }

    console.error(`Server failed to start on port ${port}:`, err);
    process.exit(1);
  });
}

attemptStart(DEFAULT_PORT);
