const SESSION_IDLE_LIMIT_MS = 1000 * 60 * 20;

function getCurrentUser() {
  return JSON.parse(localStorage.getItem("currentUser") || "null");
}

function saveCurrentUser(payload) {
  localStorage.setItem("currentUser", JSON.stringify(payload));
}

function clearCurrentUser() {
  localStorage.removeItem("currentUser");
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
