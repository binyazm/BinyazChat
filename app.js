
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://gdzzrarqgzpyjjnwjkda.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hd_RPL7hA7bcUUdg3d0wwQ_mf_2eB4N";

const configured =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_ANON_KEY.includes("PASTE_");

const $ = (id) => document.getElementById(id);

let supabase = null;
let currentUser = null;
let myProfile = null;
let activePeer = null;
let activeConversationId = null;
let conversations = [];
let profiles = [];
let messagesChannel = null;
let inboxChannel = null;
let authMode = "login";
let installPrompt = null;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.classList.remove("show"), 3500);
}

function initials(name = "?") {
  return [...name.trim()][0]?.toUpperCase() || "?";
}

function safeTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeText(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function showAuth() {
  $("auth-view").classList.remove("hidden");
  $("app-view").classList.add("hidden");
}

function showApp() {
  $("auth-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
}

function setAuthMode(mode) {
  authMode = mode;
  $("login-tab").classList.toggle("active", mode === "login");
  $("signup-tab").classList.toggle("active", mode === "signup");
  $("username-field").classList.toggle("hidden", mode !== "signup");
  $("username").required = mode === "signup";
  $("auth-submit").textContent =
    mode === "login" ? "ورود" : "ساخت حساب";
}

$("login-tab").addEventListener("click", () => setAuthMode("login"));
$("signup-tab").addEventListener("click", () => setAuthMode("signup"));

if (configured) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      setTimeout(() => startApp(session.user), 0);
    } else {
      cleanupRealtime();
      currentUser = null;
      myProfile = null;
      activePeer = null;
      showAuth();
    }
  });

  supabase.auth.getSession().then(({ data, error }) => {
    if (error) toast(error.message);
    if (data.session?.user) startApp(data.session.user);
  });
}

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!supabase) {
    toast("تنظیمات Supabase را بررسی کن.");
    return;
  }

  const email = $("email").value.trim();
  const password = $("password").value;
  const submit = $("auth-submit");
  submit.disabled = true;

  try {
    if (authMode === "signup") {
      const username = $("username").value.trim().toLowerCase();

      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        throw new Error(
          "نام کاربری باید ۳ تا ۲۴ حرف انگلیسی، عدد یا زیرخط باشد."
        );
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
            display_name: username
          }
        }
      });

      if (error) throw error;

      if (!data.session) {
        toast("حساب ساخته شد؛ ایمیلت را برای تأیید بررسی کن.");
      } else {
        toast("حساب ساخته شد.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
    }
  } catch (error) {
    toast(error.message || "خطا در ورود یا ثبت‌نام");
  } finally {
    submit.disabled = false;
  }
});

async function startApp(user) {
  if (!supabase) return;
  if (currentUser?.id === user.id && myProfile) return;

  currentUser = user;
  showApp();

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error) throw error;

    myProfile = data;
    $("profile-name").value = data.display_name || data.username;
    $("profile-handle").value = "@" + data.username;
    $("my-avatar").textContent =
      initials(data.display_name || data.username);

    await loadConversations();
    subscribeInbox();
    renderChatList();
  } catch (error) {
    toast("خطای پروفایل: " + error.message);
  }
}

function cleanupRealtime() {
  if (supabase && messagesChannel) {
    supabase.removeChannel(messagesChannel);
  }
  if (supabase && inboxChannel) {
    supabase.removeChannel(inboxChannel);
  }
  messagesChannel = null;
  inboxChannel = null;
}

$("logout-btn").addEventListener("click", async () => {
  if (supabase) await supabase.auth.signOut();
});

$("profile-btn").addEventListener("click", () => {
  $("profile-dialog").showModal();
});

$("save-profile").addEventListener("click", async () => {
  if (!myProfile) return;

  const display_name = $("profile-name").value.trim();
  if (!display_name) {
    toast("نام نمایشی نمی‌تواند خالی باشد.");
    return;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name })
    .eq("id", currentUser.id)
    .select()
    .single();

  if (error) {
    toast(error.message);
    return;
  }

  myProfile = data;
  $("my-avatar").textContent = initials(display_name);
  $("profile-dialog").close();
  renderChatList();
  toast("پروفایل ذخیره شد.");
});

async function loadConversations() {
  const { data, error } = await supabase
    .from("conversations")
    .select("id,user_a,user_b,updated_at")
    .or(`user_a.eq.${currentUser.id},user_b.eq.${currentUser.id}`)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  conversations = data || [];

  const ids = [...new Set(conversations.map(c =>
    c.user_a === currentUser.id ? c.user_b : c.user_a
  ))];

  if (!ids.length) {
    profiles = [];
    return;
  }

  const result = await supabase
    .from("profiles")
    .select("id,username,display_name")
    .in("id", ids);

  if (result.error) throw result.error;
  profiles = result.data || [];
}

function peerFor(conversation) {
  const id = conversation.user_a === currentUser.id
    ? conversation.user_b
    : conversation.user_a;

  return profiles.find(profile => profile.id === id);
}

function renderChatList(searchResults = null) {
  const list = $("chat-list");
  const items = searchResults ??
    conversations
      .map(c => ({ conversation: c, profile: peerFor(c) }))
      .filter(item => item.profile);

  $("search-hint").textContent =
    searchResults ? "نتایج کاربران" : "گفت‌وگوها";

  if (!items.length) {
    list.innerHTML = `<div class="empty-state">${
      searchResults
        ? "کاربری پیدا نشد."
        : "برای شروع، نام کاربری یک نفر را جست‌وجو کن."
    }</div>`;
    return;
  }

  list.innerHTML = items.map(item => {
    const p = item.profile || item;
    const c = item.conversation;
    const name = p.display_name || p.username;

    return `
      <div class="chat-row ${
        c?.id === activeConversationId ? "selected" : ""
      }" data-peer="${escapeText(p.id)}"
         data-conversation="${escapeText(c?.id || "")}">
        <div class="avatar">${escapeText(initials(name))}</div>
        <div class="chat-meta">
          <div class="chat-meta-top">
            <strong>${escapeText(name)}</strong>
            <span class="chat-time">${c ? safeTime(c.updated_at) : ""}</span>
          </div>
          <div class="chat-preview">
            ${c ? "برای دیدن پیام‌ها انتخاب کن" : "شروع گفت‌وگوی جدید"}
          </div>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".chat-row").forEach(row => {
    row.addEventListener("click", async () => {
      const peer = items
        .map(item => item.profile || item)
        .find(profile => profile.id === row.dataset.peer);

      let conversation = conversations.find(
        c => c.id === row.dataset.conversation
      );

      if (!conversation) {
        conversation = conversations.find(c =>
          [c.user_a, c.user_b].includes(peer.id) &&
          [c.user_a, c.user_b].includes(currentUser.id)
        );
      }

      if (!conversation) {
        conversation = await createConversation(peer.id);
      }

      if (conversation) openConversation(conversation, peer);
    });
  });
}

$("search-input").addEventListener("input", async event => {
  const query = event.target.value.trim().replace(/^@/, "").toLowerCase();

  if (!query) {
    renderChatList();
    return;
  }

  if (!currentUser) return;

  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,display_name")
    .ilike("username", `%${query}%`)
    .neq("id", currentUser.id)
    .limit(30);

  if (error) {
    toast(error.message);
    return;
  }

  renderChatList((data || []).map(profile => ({ profile })));
});

async function createConversation(peerId) {
  const [user_a, user_b] = [currentUser.id, peerId].sort();

  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_a, user_b })
    .select()
    .single();

  if (error) {
    const existing = await supabase
      .from("conversations")
      .select("*")
      .eq("user_a", user_a)
      .eq("user_b", user_b)
      .maybeSingle();

    if (existing.data) {
      await loadConversations();
      return existing.data;
    }

    toast(error.message);
    return null;
  }

  await loadConversations();
  return data;
}

async function openConversation(conversation, peer) {
  activePeer = peer;
  activeConversationId = conversation.id;
  $("app-view").classList.add("chat-open");

  $("welcome-panel").classList.add("hidden");
  $("chat-header").classList.remove("hidden");
  $("messages").classList.remove("hidden");
  $("message-form").classList.remove("hidden");

  $("active-avatar").textContent =
    initials(peer.display_name || peer.username);
  $("active-name").textContent =
    peer.display_name || peer.username;
  $("active-handle").textContent = "@" + peer.username;

  renderChatList();

  if (messagesChannel) {
    await supabase.removeChannel(messagesChannel);
  }

  await loadMessages();

  messagesChannel = supabase
    .channel("messages-" + conversation.id)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `conversation_id=eq.${conversation.id}`
    }, payload => appendMessage(payload.new))
    .subscribe();
}

$("back-btn").addEventListener("click", () => {
  $("app-view").classList.remove("chat-open");
});

async function loadMessages() {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", activeConversationId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    toast(error.message);
    return;
  }

  $("messages").innerHTML = "";
  (data || []).forEach(appendMessage);
  scrollMessages();
}

function appendMessage(message) {
  if (message.conversation_id !== activeConversationId) return;

  const duplicate = [...$("messages").children].some(
    el => el.dataset.messageId === message.id
  );
  if (duplicate) return;

  const el = document.createElement("div");
  el.className = "message " +
    (message.sender_id === currentUser.id ? "out" : "in");
  el.dataset.messageId = message.id;

  const body = document.createElement("div");
  body.textContent = message.body;

  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = safeTime(message.created_at) +
    (message.sender_id === currentUser.id ? " ✓" : "");

  el.append(body, time);
  $("messages").appendChild(el);
  scrollMessages();
}

function scrollMessages() {
  $("messages").scrollTop = $("messages").scrollHeight;
}

$("message-form").addEventListener("submit", async event => {
  event.preventDefault();

  const body = $("message-input").value.trim();
  if (!body || !activeConversationId) return;

  const button = $("message-form").querySelector("button");
  button.disabled = true;

  const { error } = await supabase.from("messages").insert({
    conversation_id: activeConversationId,
    sender_id: currentUser.id,
    body
  });

  button.disabled = false;

  if (error) {
    toast(error.message);
    return;
  }

  $("message-input").value = "";
  $("message-input").focus();
});

$("message-input").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("message-form").requestSubmit();
  }
});

function subscribeInbox() {
  if (inboxChannel) supabase.removeChannel(inboxChannel);

  inboxChannel = supabase
    .channel("inbox-" + currentUser.id)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages"
    }, async payload => {
      if (payload.new?.sender_id !== currentUser.id) {
        await loadConversations().catch(() => {});
        renderChatList();
      }
    })
    .subscribe();
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  $("install-btn").classList.remove("hidden");
});

$("install-btn").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("install-btn").classList.add("hidden");
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}
