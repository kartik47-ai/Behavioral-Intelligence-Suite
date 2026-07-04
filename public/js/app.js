const SESSION_IDLE_LIMIT_MS = 1000 * 60 * 20;
const MODULE_LABELS = {
  lie: "Response Authenticity",
  mood: "Mood Mapping",
  productivity: "Productivity Signals"
};
const ROUTES = {
  dashboard: "dashboard.html",
  lie: "lie.html",
  mood: "mood.html",
  productivity: "productivity.html",
  history: "history.html",
  profile: "profile.html",
  presentation: "presentation.html",
  admin: "admin.html"
};

function getCurrentUser() {
  return JSON.parse(localStorage.getItem("currentUser") || "null");
}

function saveCurrentUser(payload) {
  localStorage.setItem("currentUser", JSON.stringify(payload));
}

function clearCurrentUser() {
  localStorage.removeItem("currentUser");
}

function formatModuleName(module) {
  return MODULE_LABELS[module] || "Behavioral Insight";
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function formatTimestamp(value) {
  if (!value) {
    return "Unknown time";
  }
  return new Date(value).toLocaleString();
}

function sessionExpired() {
  const user = getCurrentUser();
  if (!user?.expiresAt) {
    return true;
  }
  return new Date(user.expiresAt).getTime() <= Date.now();
}

function requireAuth() {
  const user = getCurrentUser();
  if (!user || sessionExpired()) {
    clearCurrentUser();
    window.location = "login.html";
    return null;
  }
  return user;
}

async function authFetch(url, options = {}) {
  const user = requireAuth();
  if (!user) {
    throw new Error("Authentication required");
  }

  const headers = {
    ...(options.headers || {}),
    "x-user-email": user.email,
    "x-auth-token": user.token
  };

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    clearCurrentUser();
    window.location = "login.html";
    throw new Error("Session expired");
  }
  return response;
}

function logout() {
  const user = getCurrentUser();
  if (user?.token) {
    fetch("/logout", {
      method: "POST",
      headers: {
        "x-user-email": user.email,
        "x-auth-token": user.token
      }
    }).catch(() => {});
  }
  clearCurrentUser();
  window.location = "login.html";
}

function navigateTo(route) {
  if (ROUTES[route]) {
    window.location = ROUTES[route];
  }
}

function startSessionWatch() {
  let lastActivity = Date.now();

  const updateActivity = () => {
    lastActivity = Date.now();
  };

  ["click", "keydown", "mousemove", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, updateActivity, { passive: true });
  });

  setInterval(() => {
    if (Date.now() - lastActivity > SESSION_IDLE_LIMIT_MS || sessionExpired()) {
      logout();
    }
  }, 30000);
}

function showToast(message, tone = "default") {
  let stack = document.getElementById("toastStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toastStack";
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  stack.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}

function createMetricCard(label, value, detail = "") {
  return `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      ${detail ? `<p>${detail}</p>` : ""}
    </article>
  `;
}

function createListItems(items, formatter) {
  if (!items?.length) {
    return `<div class="list-item muted-item">No records available yet.</div>`;
  }
  return items.map(formatter).join("");
}

function createInsightPill(label, tone = "default") {
  return `<span class="insight-pill insight-${tone}">${label}</span>`;
}

function chartTextColor() {
  return "#d9dfeb";
}

function chartGridColor() {
  return "rgba(217, 223, 235, 0.08)";
}

function baseChartOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: chartTextColor(),
          usePointStyle: true
        }
      }
    },
    scales: {
      x: {
        ticks: { color: chartTextColor() },
        grid: { color: chartGridColor() }
      },
      y: {
        beginAtZero: true,
        ticks: { color: chartTextColor() },
        grid: { color: chartGridColor() }
      }
    },
    ...extra
  };
}

function openPrintableReport(title, sections) {
  const reportWindow = window.open("", "_blank", "width=900,height=700");
  if (!reportWindow) {
    return;
  }

  reportWindow.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
          h1, h2 { margin-bottom: 8px; }
          .section { margin-bottom: 24px; }
          .card { border: 1px solid #d0d7de; border-radius: 12px; padding: 14px; margin-top: 10px; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        ${sections.map((section) => `<div class="section"><h2>${section.title}</h2>${section.body}</div>`).join("")}
      </body>
    </html>
  `);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}
