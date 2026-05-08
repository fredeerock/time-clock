import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

if (
  SUPABASE_URL === "YOUR_SUPABASE_URL" ||
  SUPABASE_ANON_KEY === "YOUR_SUPABASE_ANON_KEY"
) {
  alert("Set SUPABASE_URL and SUPABASE_ANON_KEY in config.js before using the app.");
}

const FIXED_WEEK_TIMEZONE = "America/Chicago";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  session: null,
  user: null,
  profile: null,
  memberships: [],
  currentWorkplace: null,
  currentRole: null,
  activeSession: null,
};

const el = {
  authCard: document.getElementById("authCard"),
  onboardingCard: document.getElementById("onboardingCard"),
  dashboard: document.getElementById("dashboard"),
  headerActions: document.getElementById("headerActions"),
  workplaceSwitch: document.getElementById("workplaceSwitch"),
  adminPanel: document.getElementById("adminPanel"),
  sessionStatus: document.getElementById("sessionStatus"),
  sessionList: document.getElementById("sessionList"),
  timeOffList: document.getElementById("timeOffList"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  memberList: document.getElementById("memberList"),
  scheduleMember: document.getElementById("scheduleMember"),
  latestInvite: document.getElementById("latestInvite"),
  toast: document.getElementById("toast"),
  durationLabel: document.getElementById("durationLabel"),
  clockOutAtLabel: document.getElementById("clockOutAtLabel"),
  clockOutBtn: document.getElementById("clockOutBtn"),
  authNotice: document.getElementById("authNotice"),
};

initialize();

function initialize() {
  bindAuthTabs();
  bindForms();
  bindValidationFeedback();
  bindSmallInteractions();
  hydrateSession();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.user = session?.user || null;
    await refreshApp();
  });
}

function bindAuthTabs() {
  const tabButtons = document.querySelectorAll("[data-auth-tab]");
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      for (const b of tabButtons) b.classList.remove("active");
      button.classList.add("active");
      const tab = button.dataset.authTab;
      loginForm.classList.toggle("hidden", tab !== "login");
      signupForm.classList.toggle("hidden", tab !== "signup");
      hideAuthNotice();
    });
  }
}

function bindSmallInteractions() {
  const autoMode = document.getElementById("autoMode");
  autoMode.addEventListener("change", () => {
    const mode = autoMode.value;
    el.durationLabel.classList.toggle("hidden", mode !== "duration");
    el.clockOutAtLabel.classList.toggle("hidden", mode !== "time");
  });
}

function bindForms() {
  document.getElementById("loginForm").addEventListener("submit", onLogin);
  document.getElementById("signupForm").addEventListener("submit", onSignup);
  document
    .getElementById("createWorkplaceForm")
    .addEventListener("submit", onCreateWorkplace);
  document
    .getElementById("joinWorkplaceForm")
    .addEventListener("submit", onJoinWithInvite);
  document.getElementById("clockInForm").addEventListener("submit", onClockIn);
  document.getElementById("clockOutBtn").addEventListener("click", onClockOut);
  document.getElementById("timeOffForm").addEventListener("submit", onAddTimeOff);
  document
    .getElementById("createInviteForm")
    .addEventListener("submit", onCreateInviteCode);
  document.getElementById("scheduleForm").addEventListener("submit", onSaveSchedule);
  document
    .getElementById("adminCorrectionForm")
    .addEventListener("submit", onCorrectSession);

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });

  el.workplaceSwitch.addEventListener("change", async (event) => {
    const workplaceId = event.target.value;
    const selected = state.memberships.find((m) => m.workplace_id === workplaceId);
    if (!selected) {
      return;
    }
    state.currentWorkplace = selected.workplaces;
    state.currentRole = selected.role;
    await renderAuthenticatedState();
  });
}

function bindValidationFeedback() {
  const forms = [document.getElementById("loginForm"), document.getElementById("signupForm")];
  for (const form of forms) {
    if (!form) continue;
    form.addEventListener(
      "invalid",
      (event) => {
        const field = event.target;
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          const message = field.validationMessage || "Please complete the required fields.";
          showAuthNotice(message, true);
          notify(message, true);
        }
      },
      true,
    );
  }
}

async function hydrateSession() {
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  state.user = data.session?.user || null;
  await refreshApp();
}

async function refreshApp() {
  if (!state.user) {
    state.profile = null;
    state.memberships = [];
    state.currentWorkplace = null;
    state.currentRole = null;
    showAuthView();
    return;
  }

  await ensureProfile();
  await loadMemberships();

  if (state.memberships.length === 0) {
    showOnboardingView();
    return;
  }

  if (!state.currentWorkplace) {
    const preferred = state.memberships.find(
      (m) => m.workplace_id === state.profile?.primary_workplace_id,
    );
    const fallback = preferred || state.memberships[0];
    state.currentWorkplace = fallback.workplaces;
    state.currentRole = fallback.role;
  }

  await renderAuthenticatedState();
}

async function ensureProfile() {
  const fallbackName = state.user.email.split("@")[0];
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  const { data: existing, error: selectErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", state.user.id)
    .maybeSingle();

  if (selectErr) {
    notify(selectErr.message, true);
    return;
  }

  if (existing) {
    state.profile = existing;
    return;
  }

  const profile = {
    id: state.user.id,
    email: state.user.email,
    full_name: fallbackName,
    preferred_timezone: timezone,
  };

  const { data, error } = await supabase
    .from("profiles")
    .insert(profile)
    .select()
    .single();

  if (error) {
    notify(error.message, true);
    return;
  }

  state.profile = data;
}

async function loadMemberships() {
  const { data, error } = await supabase
    .from("workplace_memberships")
    .select("workplace_id, role, workplaces(id, name)")
    .eq("user_id", state.user.id);

  if (error) {
    notify(error.message, true);
    return;
  }

  state.memberships = data || [];
}

function showAuthView() {
  el.authCard.classList.remove("hidden");
  el.onboardingCard.classList.add("hidden");
  el.dashboard.classList.add("hidden");
  el.headerActions.classList.add("hidden");
}

function showOnboardingView() {
  el.authCard.classList.add("hidden");
  el.onboardingCard.classList.remove("hidden");
  el.dashboard.classList.add("hidden");
  el.headerActions.classList.add("hidden");
}

async function renderAuthenticatedState() {
  el.authCard.classList.add("hidden");
  el.onboardingCard.classList.add("hidden");
  el.dashboard.classList.remove("hidden");
  el.headerActions.classList.remove("hidden");

  drawWorkplaceSwitch();
  drawAdminVisibility();

  await Promise.all([
    loadActiveSession(),
    loadRecentSessions(),
    loadTimeOffEntries(),
    loadWeeklyProgress(),
    loadAdminData(),
  ]);
}

function drawWorkplaceSwitch() {
  const options = state.memberships
    .map((item) => {
      const selected =
        state.currentWorkplace && item.workplace_id === state.currentWorkplace.id
          ? "selected"
          : "";
      return `<option value="${item.workplace_id}" ${selected}>${item.workplaces.name} (${item.role})</option>`;
    })
    .join("");

  el.workplaceSwitch.innerHTML = options;
}

function drawAdminVisibility() {
  const isAdmin = state.currentRole === "admin";
  el.adminPanel.classList.toggle("hidden", !isAdmin);
}

async function onLogin(event) {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;

  setButtonLoading(submitButton, true, "Signing In...");
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      showAuthNotice(error.message, true);
      notify(error.message, true);
      return;
    }

    showAuthNotice("Login successful. Loading your workspace...", false);
    notify("Welcome back.");
  } catch (_error) {
    showAuthNotice("Login failed due to a network or browser error.", true);
    notify("Login failed due to a network or browser error.", true);
  } finally {
    setButtonLoading(submitButton, false, "Login");
  }
}

async function onSignup(event) {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');

  const fullName = document.getElementById("signupName").value;
  const email = document.getElementById("signupEmail").value;
  const password = document.getElementById("signupPassword").value;
  const preferredTimezone = document.getElementById("signupTimezone").value;

  setButtonLoading(submitButton, true, "Creating Account...");
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      const isDuplicate = String(error.message || "").toLowerCase().includes("already registered");
      const message = isDuplicate
        ? "That email already has an account. Use the Login tab instead."
        : error.message;
      showAuthNotice(message, true);
      notify(message, true);
      return;
    }

    const userId = data.user?.id;
    if (userId) {
      const { error: upsertErr } = await supabase.from("profiles").upsert({
        id: userId,
        email,
        full_name: fullName,
        preferred_timezone: preferredTimezone,
      });

      if (upsertErr) {
        notify(upsertErr.message, true);
      }
    }

    showAuthNotice(
      "Account created. Continue with workplace setup below.",
      false,
    );
    notify("Account created. If email confirmation is enabled, confirm then log in.");
  } catch (_error) {
    showAuthNotice("Signup failed due to a network or browser error.", true);
    notify("Signup failed due to a network or browser error.", true);
  } finally {
    setButtonLoading(submitButton, false, "Create Account");
  }
}

function showAuthNotice(message, isError = false) {
  if (!el.authNotice) return;
  el.authNotice.textContent = message;
  el.authNotice.classList.remove("hidden", "error");
  if (isError) {
    el.authNotice.classList.add("error");
  }
}

function hideAuthNotice() {
  if (!el.authNotice) return;
  el.authNotice.classList.add("hidden");
  el.authNotice.classList.remove("error");
  el.authNotice.textContent = "";
}

function setButtonLoading(button, isLoading, idleText) {
  if (!button) return;
  button.disabled = isLoading;
  button.textContent = isLoading ? "Please wait..." : idleText;
}

async function onCreateWorkplace(event) {
  event.preventDefault();
  const workplaceName = document.getElementById("workplaceName").value.trim();

  if (!workplaceName) {
    notify("Provide a workplace name.", true);
    return;
  }

  const { data: workplace, error: workplaceErr } = await supabase
    .from("workplaces")
    .insert({
      name: workplaceName,
      created_by_id: state.user.id,
    })
    .select()
    .single();

  if (workplaceErr) {
    notify(workplaceErr.message, true);
    return;
  }

  const { error: memberErr } = await supabase.from("workplace_memberships").insert({
    user_id: state.user.id,
    workplace_id: workplace.id,
    role: "admin",
  });

  if (memberErr) {
    notify(memberErr.message, true);
    return;
  }

  await supabase
    .from("profiles")
    .update({ primary_workplace_id: workplace.id })
    .eq("id", state.user.id);

  notify("Workplace created. You are now an admin.");
  await refreshApp();
}

async function onJoinWithInvite(event) {
  event.preventDefault();
  const code = document.getElementById("inviteCode").value.trim().toUpperCase();

  if (!code) {
    notify("Invite code is required.", true);
    return;
  }

  const { data, error } = await supabase.rpc("consume_invite_code", {
    p_code: code,
    p_user_id: state.user.id,
  });

  if (error) {
    notify(error.message, true);
    return;
  }

  if (!data?.ok) {
    notify(data?.message || "Could not use invite code.", true);
    return;
  }

  await supabase
    .from("profiles")
    .update({ primary_workplace_id: data.workplace_id })
    .eq("id", state.user.id);

  notify("Joined workplace successfully.");
  await refreshApp();
}

async function onClockIn(event) {
  event.preventDefault();

  if (!state.currentWorkplace) {
    notify("Select a workplace first.", true);
    return;
  }

  if (state.activeSession) {
    notify("You already have an active session.", true);
    return;
  }

  const mode = document.getElementById("autoMode").value;
  const now = new Date();
  let autoClockOutAt = null;
  let durationMinutes = null;

  if (mode === "duration") {
    const hours = Number(document.getElementById("durationHours").value || "0");
    if (hours <= 0) {
      notify("Duration must be greater than 0.", true);
      return;
    }
    durationMinutes = Math.round(hours * 60);
    autoClockOutAt = new Date(now.getTime() + durationMinutes * 60000).toISOString();
  }

  if (mode === "time") {
    const clockOutTime = document.getElementById("clockOutAt").value;
    if (!clockOutTime) {
      notify("Choose a clock-out time.", true);
      return;
    }
    const [hours, minutes] = clockOutTime.split(":").map(Number);
    const localTarget = new Date(now);
    localTarget.setHours(hours, minutes, 0, 0);
    if (localTarget <= now) {
      localTarget.setDate(localTarget.getDate() + 1);
    }
    autoClockOutAt = localTarget.toISOString();
  }

  const { error } = await supabase.from("clock_sessions").insert({
    user_id: state.user.id,
    workplace_id: state.currentWorkplace.id,
    clock_in_at: now.toISOString(),
    auto_clock_out_mode: mode,
    auto_clock_out_at: autoClockOutAt,
    duration_minutes: durationMinutes,
    status: "active",
  });

  if (error) {
    notify(error.message, true);
    return;
  }

  notify("Clocked in.");
  await loadActiveSession();
  await loadRecentSessions();
  await loadWeeklyProgress();
}

async function onClockOut() {
  if (!state.activeSession) {
    notify("No active session to close.", true);
    return;
  }

  const { error } = await supabase
    .from("clock_sessions")
    .update({
      clock_out_at: new Date().toISOString(),
      status: "completed",
    })
    .eq("id", state.activeSession.id)
    .eq("status", "active");

  if (error) {
    notify(error.message, true);
    return;
  }

  notify("Clocked out.");
  await loadActiveSession();
  await loadRecentSessions();
  await loadWeeklyProgress();
}

async function loadActiveSession() {
  if (!state.currentWorkplace) {
    return;
  }

  const { data, error } = await supabase
    .from("clock_sessions")
    .select("id, clock_in_at, auto_clock_out_mode, auto_clock_out_at")
    .eq("user_id", state.user.id)
    .eq("workplace_id", state.currentWorkplace.id)
    .eq("status", "active")
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    notify(error.message, true);
    return;
  }

  state.activeSession = data || null;

  if (!state.activeSession) {
    el.sessionStatus.textContent = "No active session";
    el.clockOutBtn.disabled = true;
    return;
  }

  const started = new Date(state.activeSession.clock_in_at).toLocaleString();
  const suffix = state.activeSession.auto_clock_out_at
    ? ` | auto at ${new Date(state.activeSession.auto_clock_out_at).toLocaleString()}`
    : "";
  el.sessionStatus.textContent = `Active since ${started}${suffix}`;
  el.clockOutBtn.disabled = false;
}

async function loadRecentSessions() {
  if (!state.currentWorkplace) {
    return;
  }

  const { data, error } = await supabase
    .from("clock_sessions")
    .select("id, clock_in_at, clock_out_at, status")
    .eq("user_id", state.user.id)
    .eq("workplace_id", state.currentWorkplace.id)
    .order("clock_in_at", { ascending: false })
    .limit(8);

  if (error) {
    notify(error.message, true);
    return;
  }

  el.sessionList.innerHTML = (data || [])
    .map((session) => {
      const inAt = new Date(session.clock_in_at).toLocaleString();
      const outAt = session.clock_out_at
        ? new Date(session.clock_out_at).toLocaleString()
        : "Active";
      return `<li><strong>${session.id.slice(0, 8)}</strong> | ${inAt} -> ${outAt} | ${session.status}</li>`;
    })
    .join("");
}

async function onAddTimeOff(event) {
  event.preventDefault();

  const startDate = document.getElementById("timeOffStart").value;
  const endDate = document.getElementById("timeOffEnd").value;
  const hours = document.getElementById("timeOffHours").value;
  const notes = document.getElementById("timeOffNotes").value;

  const { error } = await supabase.from("time_off_entries").insert({
    user_id: state.user.id,
    workplace_id: state.currentWorkplace.id,
    start_date: startDate,
    end_date: endDate,
    hours: hours ? Number(hours) : null,
    notes,
  });

  if (error) {
    notify(error.message, true);
    return;
  }

  notify("Time off recorded.");
  event.target.reset();
  await loadTimeOffEntries();
}

async function loadTimeOffEntries() {
  if (!state.currentWorkplace) {
    return;
  }

  const { data, error } = await supabase
    .from("time_off_entries")
    .select("start_date, end_date, hours, notes")
    .eq("user_id", state.user.id)
    .eq("workplace_id", state.currentWorkplace.id)
    .order("start_date", { ascending: false })
    .limit(10);

  if (error) {
    notify(error.message, true);
    return;
  }

  el.timeOffList.innerHTML = (data || [])
    .map((entry) => {
      const hoursText = entry.hours ? `${entry.hours}h` : "n/a";
      return `<li>${entry.start_date} to ${entry.end_date} | ${hoursText} | ${entry.notes || "No notes"}</li>`;
    })
    .join("");
}

async function loadWeeklyProgress() {
  if (!state.currentWorkplace) {
    return;
  }

  const weekStart = getWeekStartDateString(new Date(), FIXED_WEEK_TIMEZONE);
  const { data, error } = await supabase.rpc("get_weekly_progress", {
    p_workplace_id: state.currentWorkplace.id,
    p_user_id: state.user.id,
    p_week_start_date: weekStart,
  });

  if (error) {
    notify(error.message, true);
    return;
  }

  const result = data?.[0] || { scheduled_hours: 0, worked_hours: 0, remaining_hours: 0 };
  const percentage =
    result.scheduled_hours > 0
      ? Math.min(100, (result.worked_hours / result.scheduled_hours) * 100)
      : 0;

  el.progressBar.style.width = `${percentage.toFixed(2)}%`;
  el.progressText.textContent = `${result.worked_hours.toFixed(2)} of ${result.scheduled_hours.toFixed(2)} hours (${result.remaining_hours.toFixed(2)} left)`;
}

async function onCreateInviteCode(event) {
  event.preventDefault();

  if (state.currentRole !== "admin") {
    notify("Only admins can generate invite codes.", true);
    return;
  }

  const expiryHours = Number(document.getElementById("inviteExpiryHours").value || "24");
  const code = randomCode();
  const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000).toISOString();

  const { error } = await supabase.from("invite_codes").insert({
    workplace_id: state.currentWorkplace.id,
    code,
    expires_at: expiresAt,
    created_by_id: state.user.id,
  });

  if (error) {
    notify(error.message, true);
    return;
  }

  el.latestInvite.textContent = `Invite code: ${code} (one-time, expires ${new Date(expiresAt).toLocaleString()})`;
  notify("Invite code created.");
}

async function loadAdminData() {
  if (state.currentRole !== "admin" || !state.currentWorkplace) {
    el.memberList.innerHTML = "";
    el.scheduleMember.innerHTML = "";
    return;
  }

  const { data, error } = await supabase
    .from("workplace_memberships")
    .select("user_id, role, profiles(full_name, email)")
    .eq("workplace_id", state.currentWorkplace.id)
    .order("joined_at", { ascending: true });

  if (error) {
    notify(error.message, true);
    return;
  }

  const members = data || [];
  el.memberList.innerHTML = members
    .map(
      (member) =>
        `<li>${member.profiles?.full_name || member.profiles?.email || member.user_id} (${member.role})</li>`,
    )
    .join("");

  el.scheduleMember.innerHTML = members
    .map((member) => {
      const label = member.profiles?.full_name || member.profiles?.email || member.user_id;
      return `<option value="${member.user_id}">${label}</option>`;
    })
    .join("");
}

async function onSaveSchedule(event) {
  event.preventDefault();

  if (state.currentRole !== "admin") {
    notify("Only admins can edit schedules.", true);
    return;
  }

  const memberId = document.getElementById("scheduleMember").value;
  const hours = Number(document.getElementById("scheduleHours").value || "0");
  const weekStartDate = getWeekStartDateString(new Date(), FIXED_WEEK_TIMEZONE);

  const { error } = await supabase.from("weekly_schedules").upsert(
    {
      workplace_id: state.currentWorkplace.id,
      user_id: memberId,
      week_start_date: weekStartDate,
      scheduled_hours: hours,
      created_by_id: state.user.id,
    },
    {
      onConflict: "workplace_id,user_id,week_start_date",
    },
  );

  if (error) {
    notify(error.message, true);
    return;
  }

  notify("Weekly schedule saved.");
  await loadWeeklyProgress();
}

async function onCorrectSession(event) {
  event.preventDefault();

  if (state.currentRole !== "admin") {
    notify("Only admins can correct sessions.", true);
    return;
  }

  const sessionId = document.getElementById("correctionSessionId").value.trim();
  const newClockIn = document.getElementById("correctionClockIn").value.trim();
  const newClockOut = document.getElementById("correctionClockOut").value.trim();
  const reason = document.getElementById("correctionReason").value.trim();

  const { data, error } = await supabase.rpc("admin_correct_clock_session", {
    p_session_id: sessionId,
    p_new_clock_in: newClockIn,
    p_new_clock_out: newClockOut,
    p_reason: reason,
  });

  if (error || !data?.ok) {
    notify(error?.message || data?.message || "Correction failed.", true);
    return;
  }

  notify("Session corrected with audit log.");
  await loadRecentSessions();
  await loadWeeklyProgress();
}

function notify(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  el.toast.style.background = isError ? "#7f3d33" : "#27493f";
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => el.toast.classList.add("hidden"), 3500);
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let index = 0; index < 8; index += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function getWeekStartDateString(date, timezone) {
  const localDate = getDatePartsInTimeZone(date, timezone);
  const weekdayIndex = weekdayToMondayIndex(localDate.weekday);
  const utcPivot = Date.UTC(localDate.year, localDate.month - 1, localDate.day);
  const weekStart = new Date(utcPivot - weekdayIndex * 86400000);
  return weekStart.toISOString().slice(0, 10);
}

function getDatePartsInTimeZone(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: map.weekday,
  };
}

function weekdayToMondayIndex(weekday) {
  const values = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return values[weekday] ?? 0;
}
