const currentUser = requireAuth();
if (currentUser) {
  startSessionWatch();
}

const QUESTION_BANK = {
  easy: [
    { text: "Do you usually answer simple personal questions without stress?", category: "stress response" },
    { text: "Would your close friends describe you as generally honest?", category: "personal integrity" },
    { text: "Can you respond to ordinary factual questions confidently?", category: "memory recall" },
    { text: "Do you stay calm when discussing your own actions?", category: "stress response" },
    { text: "Do you prefer direct communication over avoiding the truth?", category: "personal integrity" },
    { text: "Can you describe routine events with little hesitation?", category: "memory recall" }
  ],
  standard: [
    { text: "Do you usually speak honestly even when the truth feels uncomfortable?", category: "personal integrity" },
    { text: "Have you ever changed a story to protect your image?", category: "social pressure" },
    { text: "Do direct personal questions make you hesitate before answering?", category: "stress response" },
    { text: "Can you clearly remember the details of situations where you felt accused?", category: "memory recall" },
    { text: "Do you remain consistent when retelling the same event twice?", category: "memory recall" },
    { text: "Have you ever hidden a fact to avoid consequences?", category: "personal integrity" },
    { text: "Do you feel calm when someone questions your honesty?", category: "stress response" },
    { text: "Would a close friend describe you as transparent and direct?", category: "social pressure" },
    { text: "Do you answer difficult questions quickly when you know the truth?", category: "stress response" },
    { text: "Have you ever exaggerated success to impress someone?", category: "social pressure" }
  ],
  "high-pressure": [
    { text: "If your earlier answers were reviewed one by one, would every detail remain consistent?", category: "memory recall" },
    { text: "Have you ever told a partial truth because the full answer would harm your image?", category: "social pressure" },
    { text: "Do you become physically tense when questioned about uncomfortable events?", category: "stress response" },
    { text: "Could you repeat a sensitive story now without changing any detail?", category: "memory recall" },
    { text: "Have you hidden a fact to avoid blame even when asked directly?", category: "personal integrity" },
    { text: "Do you deny things quickly when they put pressure on you?", category: "stress response" },
    { text: "Would your private behavior match the honest image you present publicly?", category: "social pressure" },
    { text: "Do you ever shape the truth to maintain control of a situation?", category: "personal integrity" }
  ]
};

const QUESTIONS_PER_SESSION = 8;
let questionSet = [];
let current = 0;
let answers = [];
let changes = 0;
let selectedAnswer = null;
let hoverUncertainty = 0;
let questionStart = Date.now();
let sessionStart = Date.now();
let questionTimes = [];
let questionDetails = [];
let liveTruth = 100;
let consistencyScore = 1;
let latestReport = null;
let sessionChart = null;
let currentQuestionChangeCount = 0;
let timerId;
let hoverTimeout;
let generatedFollowUps = [];

function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function currentDifficulty() {
  return document.getElementById("difficultySelect").value;
}

function buildQuestionSet() {
  const difficulty = currentDifficulty();
  return shuffleArray(QUESTION_BANK[difficulty]).slice(0, QUESTIONS_PER_SESSION);
}

function init() {
  questionSet = buildQuestionSet();
  current = 0;
  answers = [];
  changes = 0;
  selectedAnswer = null;
  hoverUncertainty = 0;
  questionTimes = [];
  questionDetails = [];
  consistencyScore = 1;
  sessionStart = Date.now();
  questionStart = Date.now();
  currentQuestionChangeCount = 0;
  latestReport = null;
  generatedFollowUps = [];

  document.getElementById("resultContainer").style.display = "none";
  document.querySelector(".confirm-btn").style.display = "block";
  document.getElementById("answerOptions").style.display = "flex";
  document.querySelector(".question-container").style.display = "flex";

  if (timerId) {
    clearInterval(timerId);
  }

  timerId = setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    document.getElementById("timer").innerText = `Session time: ${elapsed}s | Difficulty: ${currentDifficulty()}`;
    updateLiveMeter();
  }, 1000);

  loadQuestion();
}

function restartSession() {
  if (sessionChart) {
    sessionChart.destroy();
    sessionChart = null;
  }
  init();
}

function maybeGenerateFollowUp(detail) {
  if (generatedFollowUps.length >= 2) {
    return;
  }
  if (detail.risk < 62 && detail.time < 6 && detail.changeCount === 0) {
    return;
  }

  const prompt = {
    text: `Follow-up: Can you explain "${detail.category}" responses with the same certainty right now?`,
    category: detail.category
  };
  generatedFollowUps.push(prompt);
  questionSet.splice(Math.min(current + 1, questionSet.length), 0, prompt);
}

function loadQuestion() {
  selectedAnswer = null;
  currentQuestionChangeCount = 0;
  questionStart = Date.now();

  const question = questionSet[current];
  document.getElementById("q").innerText = question.text;
  document.getElementById("qcount").innerText = `Question ${current + 1} of ${questionSet.length}`;
  document.getElementById("qCategory").innerText = `Category: ${question.category}`;
  document.getElementById("progressFill").style.width = `${((current + 1) / questionSet.length) * 100}%`;
  document.getElementById("questionFeedback").classList.remove("visible");

  document.querySelectorAll(".answer-btn").forEach((button) => {
    button.classList.remove("selected");
    button.onmouseover = () => {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        hoverUncertainty += 1;
        showFloatingFeedback("Hesitation marker detected");
      }, 700);
    };
    button.onmouseout = () => {
      clearTimeout(hoverTimeout);
    };
  });

  updateLiveAnalysis();
}

function selectAnswer(value, event) {
  if (selectedAnswer && selectedAnswer !== value) {
    changes += 1;
    currentQuestionChangeCount += 1;
  }

  selectedAnswer = value;
  document.querySelectorAll(".answer-btn").forEach((button) => button.classList.remove("selected"));
  event.currentTarget.classList.add("selected");
}

function questionRisk(time, changeCount, hoverCount, answer) {
  const pressure = currentDifficulty() === "high-pressure" ? 8 : currentDifficulty() === "easy" ? -5 : 0;
  let risk = 20 + pressure;
  risk += Math.min(time * 7, 35);
  risk += changeCount * 12;
  risk += Math.min(hoverCount, 2) * 6;
  if (answer === "no") {
    risk += 5;
  }
  return Math.max(0, Math.min(100, Math.round(risk)));
}

function questionReason(time, changeCount, answer) {
  if (time >= 6) return "High delay before answer";
  if (changeCount > 0) return "Answer changed before confirmation";
  if (answer === "no") return "Quick denial pattern";
  return "Stable response pattern";
}

function confirmAnswer() {
  if (!selectedAnswer) {
    alert("Please select Yes or No.");
    return;
  }

  const question = questionSet[current];
  const time = Number(((Date.now() - questionStart) / 1000).toFixed(2));
  const risk = questionRisk(time, currentQuestionChangeCount, hoverUncertainty, selectedAnswer);
  const reason = questionReason(time, currentQuestionChangeCount, selectedAnswer);

  const detail = {
    question: question.text,
    category: question.category,
    answer: selectedAnswer,
    time,
    changeCount: currentQuestionChangeCount,
    risk,
    reason
  };

  questionTimes.push(time);
  answers.push(selectedAnswer);
  questionDetails.push(detail);
  maybeGenerateFollowUp(detail);

  if (answers.length > 1) {
    const previousAnswer = answers[answers.length - 2];
    consistencyScore += previousAnswer === selectedAnswer ? 0.08 : -0.05;
    consistencyScore = Math.max(0, Math.min(1, consistencyScore));
  }

  showFloatingFeedback(reason);
  current += 1;

  if (current < questionSet.length) {
    setTimeout(loadQuestion, 650);
  } else {
    setTimeout(submitSession, 900);
  }
}

function showFloatingFeedback(message) {
  const feedback = document.getElementById("questionFeedback");
  feedback.innerText = message;
  feedback.classList.add("visible");
  setTimeout(() => feedback.classList.remove("visible"), 1000);
}

function updateLiveMeter() {
  if (!questionTimes.length) return;

  const avgTime = questionTimes.reduce((sum, item) => sum + item, 0) / questionTimes.length;
  const difficultyPenalty = currentDifficulty() === "high-pressure" ? 8 : currentDifficulty() === "easy" ? -5 : 0;
  const tempTruth = 100 - avgTime * 4 - changes * 5 - hoverUncertainty * 2.5 + consistencyScore * 18 - difficultyPenalty;
  liveTruth = Math.max(0, Math.min(100, tempTruth));
  document.getElementById("liveTruth").innerText = `${Math.round(liveTruth)}%`;
  document.getElementById("liveMeter").style.width = `${liveTruth}%`;
}

function updateLiveAnalysis() {
  let message = "Collecting baseline signals.";
  if (answers.length >= 2) {
    const avgTime = questionTimes.reduce((sum, item) => sum + item, 0) / questionTimes.length;
    if (avgTime < 3 && consistencyScore > 0.8) message = "Fast, steady pattern so far.";
    else if (avgTime < 5) message = "Measured responses with moderate deliberation.";
    else message = "Hesitation markers are building.";
  }
  if (generatedFollowUps.length) {
    message += ` Adaptive follow-up prompts added: ${generatedFollowUps.length}.`;
  }
  document.getElementById("liveAnalysis").innerText = message;
}

async function submitSession() {
  clearInterval(timerId);
  document.querySelector(".confirm-btn").style.display = "none";
  document.getElementById("answerOptions").style.display = "none";
  document.querySelector(".question-container").style.display = "none";

  const timeTaken = (Date.now() - sessionStart) / 1000;
  const response = await authFetch("/lie-detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      answers,
      timeTaken,
      changes,
      questionTimes,
      questionDetails,
      consistencyScore,
      hoverUncertainty,
      difficulty: currentDifficulty(),
      generatedFollowUps
    })
  });

  const data = await response.json();
  latestReport = {
    generatedAt: new Date().toISOString(),
    user: currentUser,
    answers,
    questionDetails,
    result: data,
    difficulty: currentDifficulty()
  };

  document.getElementById("resultContainer").style.display = "block";
  renderMetricCards(data);
  renderResultText(data, timeTaken);
  renderChart(data);
}

function renderMetricCards(data) {
  document.getElementById("metricCards").innerHTML = `
    <div class="metric-card"><span>Authenticity</span><strong>${data.authenticity}%</strong></div>
    <div class="metric-card"><span>Confidence</span><strong>${data.confidence}%</strong></div>
    <div class="metric-card"><span>Hesitation</span><strong>${data.hesitation}%</strong></div>
    <div class="metric-card"><span>Consistency</span><strong>${data.consistency}%</strong></div>
  `;
}

function renderResultText(data, timeTaken) {
  const flags = data.flaggedQuestions.length
    ? data.flaggedQuestions.map((item) => `
        <div class="list-item">
          <strong>${item.category}</strong>
          <p>${item.reason}</p>
          <p>${item.question}</p>
        </div>
      `).join("")
    : `<div class="list-item">No high-risk questions were flagged in this session.</div>`;

  const categories = data.categoryBreakdown.length
    ? data.categoryBreakdown.map((item) => `
        <div class="list-item">
          <strong>${item.category}</strong>
          <p>Risk ${item.risk}% | Average time ${item.avgTime}s</p>
        </div>
      `).join("")
    : `<div class="list-item">No category data available.</div>`;

  const recommendations = (data.recommendations || [])
    .map((item) => `<div class="list-item">${item}</div>`)
    .join("");

  const sessionNotes = generatedFollowUps.length
    ? generatedFollowUps.map((item) => `<div class="list-item">${item.text}</div>`).join("")
    : `<div class="list-item">No adaptive follow-up prompts were needed in this session.</div>`;

  document.getElementById("resultText").innerHTML = `
    <div class="detail-grid" style="margin-top: 20px;">
      <div class="detail-card">
        <h4>Executive summary</h4>
        <p>Total session time: ${Math.round(timeTaken)} seconds</p>
        <p>Difficulty: ${data.analysis.difficulty}</p>
        <p style="margin-top: 10px;">${data.summary}</p>
      </div>
      <div class="detail-card">
        <h4>Scoring model</h4>
        <p>Formula: 100 - time penalty - change penalty - hover penalty - pattern penalty + consistency bonus</p>
        <div class="panel-list" style="margin-top: 14px;">
          <div class="list-item">Time penalty: ${data.analysis.timePenalty}%</div>
          <div class="list-item">Change penalty: ${data.analysis.changePenalty}%</div>
          <div class="list-item">Hover penalty: ${data.analysis.hoverPenalty}%</div>
          <div class="list-item">Pattern penalty: ${data.analysis.patternPenalty}%</div>
          <div class="list-item">Consistency bonus: ${data.analysis.consistencyBonus}%</div>
        </div>
      </div>
    </div>

    <div class="analysis-columns" style="margin-top: 18px;">
      <div class="panel">
        <h4>Flagged prompts</h4>
        <div class="panel-list">${flags}</div>
      </div>
      <div class="panel">
        <h4>Adaptive follow-ups used</h4>
        <div class="panel-list">${sessionNotes}</div>
      </div>
    </div>

    <div class="analysis-columns" style="margin-top: 18px;">
      <div class="panel">
        <h4>Category risk</h4>
        <div class="panel-list">${categories}</div>
      </div>
      <div class="panel">
        <h4>Recommendations</h4>
        <div class="panel-list">${recommendations || `<div class="list-item">No recommendations generated.</div>`}</div>
      </div>
    </div>
  `;
}

function renderChart(data) {
  if (sessionChart) sessionChart.destroy();
  sessionChart = new Chart(document.getElementById("chart"), {
    type: "bar",
    data: {
      labels: ["Authenticity", "Confidence", "Consistency", "Hesitation"],
      datasets: [{
        data: [data.authenticity, data.confidence, data.consistency, data.hesitation],
        backgroundColor: ["#21c1ff", "#0ed3a0", "#537dff", "#ff7b7b"]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { color: chartTextColor() },
          grid: { color: chartGridColor() }
        },
        x: {
          ticks: { color: chartTextColor() },
          grid: { display: false }
        }
      }
    }
  });
}

function downloadReport() {
  if (!latestReport) return;
  const blob = new Blob([JSON.stringify(latestReport, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "response-authenticity-report.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function printReport() {
  if (!latestReport) return;
  const result = latestReport.result;
  openPrintableReport("Response Authenticity Report", [
    {
      title: "Session overview",
      body: `<div class="card"><p>User: ${currentUser.name}</p><p>Difficulty: ${latestReport.difficulty}</p><p>Generated: ${new Date(latestReport.generatedAt).toLocaleString()}</p></div>`
    },
    {
      title: "Key metrics",
      body: `<div class="grid">
        <div class="card">Authenticity: ${result.authenticity}%</div>
        <div class="card">Confidence: ${result.confidence}%</div>
        <div class="card">Hesitation: ${result.hesitation}%</div>
        <div class="card">Consistency: ${result.consistency}%</div>
      </div>`
    },
    {
      title: "Summary",
      body: `<div class="card">${result.summary}</div>`
    }
  ]);
}

document.getElementById("difficultySelect").addEventListener("change", restartSession);
init();
